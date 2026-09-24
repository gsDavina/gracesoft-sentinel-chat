import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "../query/types.js";
import { buildDemoFallbackAnswers, findFallbackAnswer } from "./demo-fallback.js";

let ctx: QueryContext;
let answers: ReturnType<typeof buildDemoFallbackAnswers>;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
  answers = buildDemoFallbackAnswers(ctx);
});

describe("buildDemoFallbackAnswers", () => {
  it("covers the 10-question demo script with real, cache-labelled figures", () => {
    expect(answers).toHaveLength(10);
    for (const a of answers) expect(a.text).toContain("cached demo answer");
  });

  it("matches the hand-verified overdue cards", () => {
    const text = findFallbackAnswer(answers, "What's overdue?");
    expect(text).toContain("Card 5");
    expect(text).toContain("Card 7");
  });

  it("matches the hand-verified August billable hours", () => {
    const text = findFallbackAnswer(answers, "How many billable hours did I log in August?");
    expect(text).toContain("16 billable hours");
  });

  it("matches the hand-verified cash position", () => {
    const text = findFallbackAnswer(answers, "What's my cash position now?");
    expect(text).toContain("$9,810.00");
    expect(text).toContain("$2,380.00");
  });

  it("declines to de-redact User 1", () => {
    const text = findFallbackAnswer(answers, "Who is User 1?");
    expect(text).toMatch(/redacted pseudonym/);
  });
});

describe("findFallbackAnswer", () => {
  it("matches regardless of trailing punctuation or case", () => {
    expect(findFallbackAnswer(answers, "who is user 1")).toBeDefined();
    expect(findFallbackAnswer(answers, "WHO IS USER 1???")).toBeDefined();
  });

  it("returns undefined for a question outside the demo script", () => {
    expect(findFallbackAnswer(answers, "What's the meaning of life?")).toBeUndefined();
  });
});
