import { describe, expect, it } from "vitest";
import { buildComposition } from "./composition.js";
import type { AssistantServiceEnv } from "./env.js";
import { FIXTURE_SNAPSHOT_DIR } from "./test-support.js";

const ENV: AssistantServiceEnv = {
  PORT: 0,
  OPENAI_API_KEY: "sk-test",
  OPENAI_MODEL: "gpt-4o-mini",
  SNAPSHOT_DIR: FIXTURE_SNAPSHOT_DIR,
  AS_OF_DATE: "2026-09-10",
  DEMO_TOKEN: "test-token",
  MAX_TOOL_STEPS: 6,
  MODEL_TIMEOUT_MS: 5000,
  MAX_TOKENS_PER_REQUEST: 512,
  RATE_LIMIT_PER_IP_PER_MINUTE: 100,
  RATE_LIMIT_PER_SESSION_PER_MINUTE: 100,
  DAILY_MODEL_CALL_CAP: 500,
};

describe("buildComposition", () => {
  it("loads the snapshot and wires a query context from it", () => {
    const composition = buildComposition(ENV);
    expect(composition.ctx.asOfDate).toBe("2026-09-10");
    expect(composition.snapshot.summary.recordCounts.projects).toBe(5);
    expect(composition.snapshot.summary.warnings.length).toBeGreaterThan(0); // the fixture deliberately has unmatched board/project warnings
  });

  it("throws (fails fast) when the snapshot directory is invalid", () => {
    expect(() => buildComposition({ ...ENV, SNAPSHOT_DIR: "/no/such/dir" })).toThrow();
  });
});
