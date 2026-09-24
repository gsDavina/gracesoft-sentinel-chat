import { buildComposition } from "./composition.js";
import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

const env = loadEnv();
const { snapshot, chatHandler, resetSession, appLogger } = buildComposition(env);

const app = buildServer({ env, snapshot, chatHandler, resetSession, appLogger, isReady: () => true });

app.listen(env.PORT, () => {
  appLogger.info({ port: env.PORT, asOfDate: env.AS_OF_DATE, recordCounts: snapshot.summary.recordCounts }, "assistant-service listening");
});
