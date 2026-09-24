import { z } from "zod";
import type { SnapshotSearchProvider } from "@gracesoft-sentinel/core";
import type { QueryResult } from "../query/types.js";
import { defineTool, type ToolDefinition } from "./tool-definition.js";

const SEARCH_TOOL_DESCRIPTION =
  "Semantic search over the GraceSoft Desk/Skylight snapshot: pre-aggregated project status, time/billable summaries, finance (income/expenses/cash), Skylight boards/cards, overdue items and daily logs, already computed — read the numbers straight out of the returned text, never recompute them. Use this for every question. Formulate a focused natural-language query capturing what's being asked (e.g. \"Project 4 billable hours July\", \"overdue Skylight cards\", \"SaaS vendor spend August\", \"cash position accounts\"). If the first search doesn't return what's needed, call it again with a different phrasing rather than guessing.";

/**
 * Builds the tool catalog for Pinecone-search mode: one tool,
 * `search_snapshot`, replacing the structured query-layer's 22 tools
 * (`tools/definitions.ts`). Swapped in via `runAssistant({ tools: ... })`
 * — the orchestrator, system prompt and every guardrail are otherwise
 * unchanged, since this is still just a `ToolDefinition`.
 */
export function buildSearchTools(provider: SnapshotSearchProvider): ToolDefinition[] {
  return [
    defineTool({
      name: "search_snapshot",
      description: SEARCH_TOOL_DESCRIPTION,
      argsSchema: z.object({ query: z.string().min(1), topK: z.number().int().positive().max(10).optional() }),
      argsShape: "{ query: string, topK?: number }",
      run: async (_ctx, args: { query: string; topK?: number }) => {
        const matches = await provider.search({ query: args.query, topK: args.topK });
        return {
          data: matches.map((m) => ({
            text: m.text,
            score: m.score,
            source: typeof m.metadata?.source === "string" ? m.metadata.source : m.id,
          })),
          sourceTool: "both",
          caveats: matches.length === 0 ? [`No matching snapshot data found for "${args.query}" — try a different or more specific phrasing.`] : [],
          outOfSnapshot: false,
        } satisfies QueryResult<unknown>;
      },
    }),
  ];
}
