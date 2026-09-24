import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "../query/types.js";
import { runAssistant } from "./orchestrator.js";
import { ScriptedAIProvider } from "./test-support.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("runAssistant", () => {
  it("returns a final_answer straight away with no tool calls", async () => {
    const provider = new ScriptedAIProvider([JSON.stringify({ action: "final_answer", text: "Hello!" })]);
    const result = await runAssistant({ aiProvider: provider, ctx, question: "hi" });
    expect(result).toMatchObject({ answer: "Hello!", steps: 1, gracefulFailure: false, toolCalls: [] });
  });

  it("executes a tool call, feeds the real result back, and logs it via onToolCall", async () => {
    const provider = new ScriptedAIProvider([
      JSON.stringify({ action: "call_tool", tool: "get_current_stage", arguments: { projectPseudonym: "Project 4" } }),
      JSON.stringify({ action: "final_answer", text: "Project 4 is in Development." }),
    ]);
    const logged: string[] = [];
    const result = await runAssistant({ aiProvider: provider, ctx, question: "what stage is project 4 in?", onToolCall: (log) => logged.push(log.tool) });

    expect(result.answer).toBe("Project 4 is in Development.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.tool).toBe("get_current_stage");
    expect((result.toolCalls[0]?.result as { data: { stage: string } }).data.stage).toBe("Development");
    expect(logged).toEqual(["get_current_stage"]);

    // The real tool result (not a model-invented number) must have reached the model as the third message.
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain("Development");
  });

  it("recovers from an invalid-JSON response with a corrective message, then succeeds", async () => {
    const provider = new ScriptedAIProvider(["not json at all", JSON.stringify({ action: "final_answer", text: "Recovered." })]);
    const result = await runAssistant({ aiProvider: provider, ctx, question: "hi" });
    expect(result).toMatchObject({ answer: "Recovered.", gracefulFailure: false });
    expect(provider.calls[1]?.messages.some((m) => m.content.includes("valid JSON"))).toBe(true);
  });

  it("recovers from an unknown tool name with a corrective message", async () => {
    const provider = new ScriptedAIProvider([
      JSON.stringify({ action: "call_tool", tool: "delete_everything", arguments: {} }),
      JSON.stringify({ action: "final_answer", text: "I can't do that, but here's what I can answer." }),
    ]);
    const result = await runAssistant({ aiProvider: provider, ctx, question: "delete project 4" });
    expect(result.answer).toBe("I can't do that, but here's what I can answer.");
    expect(result.toolCalls).toHaveLength(0);
  });

  it("recovers from invalid tool arguments with a corrective message naming the problem", async () => {
    const provider = new ScriptedAIProvider([
      JSON.stringify({ action: "call_tool", tool: "get_hours_for_period", arguments: { projectPseudonym: "Project 4" } }), // missing required `period`
      JSON.stringify({ action: "final_answer", text: "Recovered from bad arguments." }),
    ]);
    const result = await runAssistant({ aiProvider: provider, ctx, question: "hours for project 4" });
    expect(result.answer).toBe("Recovered from bad arguments.");
    expect(provider.calls[1]?.messages.at(-1)?.content).toMatch(/invalid arguments/);
  });

  it("stops gracefully at the step limit and returns a friendly message, not a crash", async () => {
    const alwaysCallTool = () => JSON.stringify({ action: "call_tool", tool: "get_overdue_cards", arguments: {} });
    const provider = new ScriptedAIProvider(Array.from({ length: 10 }, alwaysCallTool));
    const result = await runAssistant({ aiProvider: provider, ctx, question: "loop forever", config: { maxSteps: 3 } });
    expect(result.gracefulFailure).toBe(true);
    expect(result.steps).toBe(3);
    expect(result.answer).toMatch(/step limit/);
  });

  it("fails gracefully, without throwing, when the model is unreachable after retries", async () => {
    const provider = new ScriptedAIProvider([new Error("network down"), new Error("network down")]);
    const result = await runAssistant({ aiProvider: provider, ctx, question: "hi", config: { maxRetries: 1, timeoutMs: 1000 } });
    expect(result.gracefulFailure).toBe(true);
    expect(result.answer).toMatch(/trouble reaching/);
  });

  it("includes prior session history in the messages sent to the model, for follow-up questions", async () => {
    const provider = new ScriptedAIProvider([JSON.stringify({ action: "final_answer", text: "In July, 22 billable hours." })]);
    await runAssistant({
      aiProvider: provider,
      ctx,
      question: "what about July?",
      history: [
        { role: "user", content: "how many billable hours in August?" },
        { role: "assistant", content: "16 billable hours in August." },
      ],
    });
    const sentContents = provider.calls[0]?.messages.map((m) => m.content) ?? [];
    expect(sentContents).toContain("how many billable hours in August?");
    expect(sentContents).toContain("16 billable hours in August.");
  });
});
