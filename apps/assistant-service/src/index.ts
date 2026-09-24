import { buildComposition } from "./composition.js";
import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

const WARM_UP_TIMEOUT_MS = 10_000;

const env = loadEnv();
const { onMessage, readinessCheck, appLogger, aiProvider } = buildComposition(env);

/**
 * M7's "warm-up on start" — a throwaway model call before the first real
 * message, so a chatter's first question isn't also paying for the
 * provider's cold-start latency. Best-effort only: never blocks or delays
 * `app.listen`, and a warm-up failure just means the first real question
 * is slower (or, in structured mode, falls back to the cached demo-script
 * answers — see on-message.ts).
 */
function warmUp(): void {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("warm-up timed out")), WARM_UP_TIMEOUT_MS));
  Promise.race([aiProvider.chatComplete({ messages: [{ role: "user", content: "ping" }], maxTokens: 5 }), timeout])
    .then(() => appLogger.info({}, "model warm-up succeeded"))
    .catch((err: unknown) => appLogger.warn({ err }, "model warm-up failed — first real question may be slower"));
}

warmUp();

const app = buildServer({ env, onMessage, readinessCheck, appLogger });

app.listen(env.PORT, () => {
  appLogger.info({ port: env.PORT }, "assistant-service listening");
});
