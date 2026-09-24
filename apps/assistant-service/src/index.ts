import { buildComposition } from "./composition.js";
import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

const WARM_UP_TIMEOUT_MS = 10_000;

const env = loadEnv();
const { snapshot, aiProvider, chatHandler, resetSession, appLogger } = buildComposition(env);

/**
 * M7's "warm-up on start" — a throwaway model call before the first real
 * request, so a chatter's first question isn't also paying for the
 * provider's cold-start latency. Best-effort only: this never blocks or
 * delays `app.listen` (a warm-up failure just means the *first* real
 * question is slower, not that the demo can't start), and the fallback
 * cache still covers the demo script if the model turns out to be down.
 */
function warmUp(): void {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("warm-up timed out")), WARM_UP_TIMEOUT_MS));
  Promise.race([aiProvider.chatComplete({ messages: [{ role: "user", content: "ping" }], maxTokens: 5 }), timeout])
    .then(() => appLogger.info({}, "model warm-up succeeded"))
    .catch((err: unknown) => appLogger.warn({ err }, "model warm-up failed — first real question may be slower, and the demo-script fallback cache will cover a live outage"));
}

warmUp();

const app = buildServer({ env, snapshot, chatHandler, resetSession, appLogger, isReady: () => true });

app.listen(env.PORT, () => {
  appLogger.info({ port: env.PORT, asOfDate: env.AS_OF_DATE, recordCounts: snapshot.summary.recordCounts }, "assistant-service listening");
});
