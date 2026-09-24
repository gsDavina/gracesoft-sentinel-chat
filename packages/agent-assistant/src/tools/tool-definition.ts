import type { ZodType } from "zod";
import type { QueryContext, QueryResult } from "../query/types.js";

export type ToolValidation = { success: true; data: unknown } | { success: false; error: string };

/**
 * The stored/erased shape — `run` only ever takes `unknown` here, so a
 * heterogeneous array of tools with different argument types never runs
 * into TypeScript's contravariant function-parameter check. Each concrete
 * tool's own `Args` type stays fully checked inside `defineTool()` below,
 * where the cast back from `unknown` is a single contained step, justified
 * by the orchestrator always calling `validate()` before `run()`.
 *
 * `run` may be sync or async: the structured query-layer tools
 * (`tools/definitions.ts`) are pure/sync, but a search-backed tool
 * (`tools/search-tools.ts`, querying Pinecone) is inherently async — the
 * orchestrator always `await`s the result either way.
 */
export interface ToolDefinition {
  name: string;
  /** What the tool answers and when to call it — read directly into the system prompt's tool catalog. */
  description: string;
  /** Human/model-readable shape shown in the prompt, e.g. `{ period: Period, projectPseudonym?: string }`. */
  argsShape: string;
  validate: (rawArgs: unknown) => ToolValidation;
  run: (ctx: QueryContext, args: unknown) => QueryResult<unknown> | Promise<QueryResult<unknown>>;
}

export interface ToolSpec<Args> {
  name: string;
  description: string;
  argsSchema: ZodType<Args>;
  argsShape: string;
  run: (ctx: QueryContext, args: Args) => QueryResult<unknown> | Promise<QueryResult<unknown>>;
}

export function defineTool<Args>(spec: ToolSpec<Args>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    argsShape: spec.argsShape,
    validate: (rawArgs) => {
      const result = spec.argsSchema.safeParse(rawArgs);
      if (!result.success) {
        return { success: false, error: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
      }
      return { success: true, data: result.data };
    },
    run: (ctx, rawArgs) => spec.run(ctx, rawArgs as Args),
  };
}

export function findToolIn(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
