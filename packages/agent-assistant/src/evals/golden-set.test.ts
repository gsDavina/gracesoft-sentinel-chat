import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "../query/types.js";
import { buildGoldenSet, type GoldenQuestion } from "./golden-set.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("buildGoldenSet", () => {
  it("builds at least 40 questions spread across every required category", () => {
    const questions = buildGoldenSet(ctx);
    expect(questions.length).toBeGreaterThanOrEqual(40);

    const categories = new Set(questions.map((q) => q.category));
    const requiredCategories: GoldenQuestion["category"][] = ["desk-time", "desk-finance", "skylight", "cross-tool", "out-of-range", "redaction", "injection", "misuse", "conversation"];
    for (const required of requiredCategories) {
      expect(categories.has(required)).toBe(true);
    }
  });

  it("gives every question at least one real requirement — never an unconstrained pass", () => {
    const questions = buildGoldenSet(ctx);
    for (const q of questions) {
      const totalRequirements = q.mustIncludeAll.filter((f) => f.length > 0).length + (q.mustNotIncludeAny?.length ?? 0);
      expect(totalRequirements, `question ${q.id} ("${q.question}") has no checkable requirement`).toBeGreaterThan(0);
    }
  });

  it("has unique, sequential ids", () => {
    const questions = buildGoldenSet(ctx);
    expect(questions.map((q) => q.id)).toEqual(questions.map((_, i) => i + 1));
  });

  it('derives "What\'s overdue?" fragments from the real overdue-cards query, not a hand-typed list', () => {
    const overdueQuestion = buildGoldenSet(ctx).find((q) => q.question === "What's overdue?");
    expect(overdueQuestion?.mustIncludeAll.sort()).toEqual(["Card 5", "Card 7"]);
  });

  it("seeds the two conversational cases with real prior history", () => {
    const conversational = buildGoldenSet(ctx).filter((q) => q.category === "conversation");
    expect(conversational).toHaveLength(2);
    for (const q of conversational) {
      expect(q.history?.length).toBeGreaterThan(0);
    }
  });
});
