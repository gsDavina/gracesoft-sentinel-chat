import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { buildGoldenSet, loadSnapshot, runGoldenSet, type QueryContext } from "@gracesoft-sentinel/agent-assistant";

/**
 * M6's eval runner, invoked from the command line: `node dist/eval-cli.js`.
 * Needs a real OPENAI_API_KEY (and therefore lives in this app, not in
 * `agent-assistant` — that package must depend only on `core`'s provider
 * interface, never a concrete provider, per this repo's own dependency-
 * cruiser boundary rule). Exits non-zero when the pass rate falls below
 * the threshold, so this is CI-gateable once a real key exists.
 */
async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required to run the golden set.");
    process.exit(1);
  }

  const snapshotDir = process.env.SNAPSHOT_DIR ?? "packages/agent-assistant/data/snapshot/valid";
  const asOfDate = process.env.AS_OF_DATE ?? "2026-09-10";
  const threshold = Number(process.env.EVAL_PASS_THRESHOLD ?? "0.95");

  const loaded = loadSnapshot(snapshotDir, { asOfDate });
  const ctx: QueryContext = { desk: loaded.desk, skylight: loaded.skylight, crossTool: loaded.crossTool, asOfDate };

  const aiProvider = new OpenAIProvider({ apiKey, model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" });
  const questions = buildGoldenSet(ctx);

  console.log(`Running ${questions.length} golden questions against ${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}...`);
  const report = await runGoldenSet({ aiProvider, ctx, questions });

  console.log(`\nPass rate: ${(report.passRate * 100).toFixed(1)}% (${report.passCount}/${report.totalCount})`);
  console.log(`Median latency: ${report.medianLatencyMs}ms, p95: ${report.p95LatencyMs}ms`);
  console.log("\nBy category:");
  for (const [category, rate] of Object.entries(report.passRateByCategory)) {
    console.log(`  ${category}: ${(rate * 100).toFixed(1)}%`);
  }

  const failures = report.results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    for (const f of failures) {
      console.log(`  #${f.id} [${f.category}] "${f.question}"`);
      if (f.missingFragments.length > 0) console.log(`    missing: ${f.missingFragments.join(", ")}`);
      if (f.forbiddenFragmentsFound.length > 0) console.log(`    forbidden found: ${f.forbiddenFragmentsFound.join(", ")}`);
      if (f.gracefulFailure) console.log(`    graceful failure: ${f.answer}`);
    }
  }

  process.exit(report.passRate >= threshold ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
