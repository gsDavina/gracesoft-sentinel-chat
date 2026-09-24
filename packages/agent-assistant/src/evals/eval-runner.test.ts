import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import { ScriptedAIProvider } from "../orchestrator/test-support.js";
import type { QueryContext } from "../query/types.js";
import type { GoldenQuestion } from "./golden-set.js";
import { runGoldenSet } from "./eval-runner.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

function finalAnswer(text: string): string {
  return JSON.stringify({ action: "final_answer", text });
}

describe("runGoldenSet", () => {
  it("passes a question whose answer contains every required fragment", async () => {
    const questions: GoldenQuestion[] = [{ id: 1, question: "hours?", category: "desk-time", mustIncludeAll: ["16", "August"] }];
    const provider = new ScriptedAIProvider([finalAnswer("You logged 16 billable hours in August.")]);
    const report = await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(report.passRate).toBe(1);
    expect(report.results[0]).toMatchObject({ pass: true, missingFragments: [] });
  });

  it("fails a question missing a required fragment", async () => {
    const questions: GoldenQuestion[] = [{ id: 1, question: "hours?", category: "desk-time", mustIncludeAll: ["16", "August"] }];
    const provider = new ScriptedAIProvider([finalAnswer("You logged some hours recently.")]);
    const report = await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(report.passRate).toBe(0);
    expect(report.results[0]?.missingFragments).toEqual(["16", "August"]);
  });

  it("fails a question containing a forbidden fragment", async () => {
    const questions: GoldenQuestion[] = [{ id: 1, question: "earned from project 4?", category: "desk-finance", mustIncludeAll: ["4500"], mustNotIncludeAny: ["2700"] }];
    const provider = new ScriptedAIProvider([finalAnswer("You earned $4500, roughly $2700 of which was billable value.")]);
    const report = await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(report.results[0]).toMatchObject({ pass: false, forbiddenFragmentsFound: ["2700"] });
  });

  it("fails a question that hits a graceful failure, even with no fragment requirements", async () => {
    const questions: GoldenQuestion[] = [{ id: 1, question: "anything", category: "desk-time", mustIncludeAll: [] }];
    const provider = new ScriptedAIProvider([new Error("down"), new Error("down"), new Error("down")]);
    const report = await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(report.results[0]).toMatchObject({ pass: false, gracefulFailure: true });
  });

  it("aggregates pass rate by category and reports latency percentiles", async () => {
    const questions: GoldenQuestion[] = [
      { id: 1, question: "a", category: "desk-time", mustIncludeAll: ["yes"] },
      { id: 2, question: "b", category: "desk-time", mustIncludeAll: ["no-match"] },
      { id: 3, question: "c", category: "skylight", mustIncludeAll: ["yes"] },
    ];
    const provider = new ScriptedAIProvider([finalAnswer("yes"), finalAnswer("yes"), finalAnswer("yes")]);
    const report = await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(report.passRateByCategory["desk-time"]).toBeCloseTo(0.5);
    expect(report.passRateByCategory.skylight).toBe(1);
    expect(report.totalCount).toBe(3);
    expect(report.passCount).toBe(2);
    expect(typeof report.medianLatencyMs).toBe("number");
    expect(typeof report.p95LatencyMs).toBe("number");
  });

  it("passes prior session history through to each question (for the conversational cases)", async () => {
    const questions: GoldenQuestion[] = [
      { id: 1, question: "and July?", category: "conversation", mustIncludeAll: ["yes"], history: [{ role: "user", content: "August?" }, { role: "assistant", content: "16 hours" }] },
    ];
    const provider = new ScriptedAIProvider([finalAnswer("yes")]);
    await runGoldenSet({ aiProvider: provider, ctx, questions });
    expect(provider.calls[0]?.messages.some((m) => m.content === "16 hours")).toBe(true);
  });
});
