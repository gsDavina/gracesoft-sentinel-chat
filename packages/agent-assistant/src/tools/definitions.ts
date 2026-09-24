import { z, type ZodType } from "zod";
import type { StageSchema } from "../types/desk.js";
import type { QueryContext, QueryResult } from "../query/types.js";
import { type PeriodInput } from "../query/period.js";
import * as time from "../query/time.js";
import * as finance from "../query/finance.js";
import * as skylight from "../query/skylight.js";
import * as crossTool from "../query/cross-tool.js";

/** Every tool argument that names a project takes the pseudonym the user actually says ("Project 4"), never an internal id — the model never sees internal ids at all. */
const PeriodInputSchema: ZodType<PeriodInput> = z.union([
  z.object({ kind: z.literal("keyword"), keyword: z.enum(["today", "this_week", "this_month", "last_month", "last_30_days", "q3"]) }),
  z.object({ kind: z.literal("month"), month: z.string(), year: z.number().int().optional() }),
  z.object({ kind: z.literal("explicit"), start: z.string(), end: z.string() }),
]);

function resolveProjectId(ctx: QueryContext, pseudonym: string): string | undefined {
  return ctx.desk.projects.find((p) => p.pseudonym === pseudonym)?.id;
}

function resolveBoardId(ctx: QueryContext, pseudonym: string): string | undefined {
  return ctx.skylight.boards.find((b) => b.pseudonym === pseudonym)?.id;
}

function noSuchProject<T>(pseudonym: string): QueryResult<T> {
  return { data: null, sourceTool: "desk", caveats: [`No such project in the snapshot: ${pseudonym}`], outOfSnapshot: false };
}

function noSuchBoard<T>(pseudonym: string): QueryResult<T> {
  return { data: null, sourceTool: "skylight", caveats: [`No such board in the snapshot: ${pseudonym}`], outOfSnapshot: false };
}

export type ToolValidation = { success: true; data: unknown } | { success: false; error: string };

/**
 * The stored/erased shape — `run` only ever takes `unknown` here, so a
 * heterogeneous array of tools with different argument types never runs
 * into TypeScript's contravariant function-parameter check. Each concrete
 * tool's own `Args` type stays fully checked inside `tool()` below, where
 * the cast back from `unknown` is a single contained step, justified by
 * the orchestrator always calling `validate()` before `run()`.
 */
export interface ToolDefinition {
  name: string;
  /** What the tool answers and when to call it — read directly into the system prompt's tool catalog. */
  description: string;
  /** Human/model-readable shape shown in the prompt, e.g. `{ period: Period, projectPseudonym?: string }`. */
  argsShape: string;
  validate: (rawArgs: unknown) => ToolValidation;
  run: (ctx: QueryContext, args: unknown) => QueryResult<unknown>;
}

interface ToolSpec<Args> {
  name: string;
  description: string;
  argsSchema: ZodType<Args>;
  argsShape: string;
  run: (ctx: QueryContext, args: Args) => QueryResult<unknown>;
}

function tool<Args>(spec: ToolSpec<Args>): ToolDefinition {
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

const StageArgSchema = z.enum(["Discovery", "Design", "Development", "Testing", "Deployment", "Maintenance"]) satisfies ZodType<z.infer<typeof StageSchema>>;

export const TOOLS: ToolDefinition[] = [
  tool({
    name: "get_hours_for_period",
    description: "Total, billable and non-billable Desk time-entry hours for a period, optionally scoped to one project or stage. Use for hours/billable/logged-time questions.",
    argsSchema: z.object({ period: PeriodInputSchema, projectPseudonym: z.string().optional(), stage: StageArgSchema.optional() }),
    argsShape: "{ period: Period, projectPseudonym?: string, stage?: Stage }",
    run: (ctx, args: { period: PeriodInput; projectPseudonym?: string; stage?: import("../types/desk.js").Stage }) => {
      const projectId = args.projectPseudonym ? resolveProjectId(ctx, args.projectPseudonym) : undefined;
      if (args.projectPseudonym && !projectId) return noSuchProject(args.projectPseudonym);
      return time.hoursForPeriod(ctx, args.period, { projectId, stage: args.stage });
    },
  }),
  tool({
    name: "get_billable_value_for_period",
    description: "Billable value (billable hours x hourly rate) by project for a period. Never the same as income received.",
    argsSchema: z.object({ period: PeriodInputSchema, projectPseudonym: z.string().optional() }),
    argsShape: "{ period: Period, projectPseudonym?: string }",
    run: (ctx, args: { period: PeriodInput; projectPseudonym?: string }) => {
      const projectId = args.projectPseudonym ? resolveProjectId(ctx, args.projectPseudonym) : undefined;
      if (args.projectPseudonym && !projectId) return noSuchProject(args.projectPseudonym);
      return time.billableValueForPeriod(ctx, args.period, { projectId });
    },
  }),
  tool({
    name: "get_stage_breakdown",
    description: "A project's hours and billable value by SDLC stage, across its whole history. Use for 'where did the hours go by stage' questions.",
    argsSchema: z.object({ projectPseudonym: z.string() }),
    argsShape: "{ projectPseudonym: string }",
    run: (ctx, args: { projectPseudonym: string }) => {
      const projectId = resolveProjectId(ctx, args.projectPseudonym);
      if (!projectId) return noSuchProject(args.projectPseudonym);
      return time.stageBreakdown(ctx, projectId);
    },
  }),
  tool({
    name: "get_current_stage",
    description: "Which SDLC stage a project is currently in, and the rule used (its most recent time entry).",
    argsSchema: z.object({ projectPseudonym: z.string() }),
    argsShape: "{ projectPseudonym: string }",
    run: (ctx, args: { projectPseudonym: string }) => {
      const projectId = resolveProjectId(ctx, args.projectPseudonym);
      if (!projectId) return noSuchProject(args.projectPseudonym);
      return time.currentStage(ctx, projectId);
    },
  }),
  tool({
    name: "get_project_summary",
    description: "One-stop Desk summary for a project: status, dates, rate, hours to date, billable value to date, stage breakdown, last activity.",
    argsSchema: z.object({ projectPseudonym: z.string() }),
    argsShape: "{ projectPseudonym: string }",
    run: (ctx, args: { projectPseudonym: string }) => {
      const projectId = resolveProjectId(ctx, args.projectPseudonym);
      if (!projectId) return noSuchProject(args.projectPseudonym);
      return time.projectSummary(ctx, projectId);
    },
  }),
  tool({
    name: "get_commit_vs_manual",
    description: "Split of commit-derived vs manually-logged hours for a period (commit tracking only exists 1-3 Aug 2026).",
    argsSchema: z.object({ period: PeriodInputSchema, projectPseudonym: z.string().optional() }),
    argsShape: "{ period: Period, projectPseudonym?: string }",
    run: (ctx, args: { period: PeriodInput; projectPseudonym?: string }) => {
      const projectId = args.projectPseudonym ? resolveProjectId(ctx, args.projectPseudonym) : undefined;
      if (args.projectPseudonym && !projectId) return noSuchProject(args.projectPseudonym);
      return time.commitVsManualForPeriod(ctx, args.period, { projectId });
    },
  }),
  tool({
    name: "get_project_with_most_time",
    description: "Which project took the most logged time in a period.",
    argsSchema: z.object({ period: PeriodInputSchema }),
    argsShape: "{ period: Period }",
    run: (ctx, args: { period: PeriodInput }) => time.projectWithMostTimeInPeriod(ctx, args.period),
  }),
  tool({
    name: "get_finance_for_period",
    description: "Desk income, expenses and net for a period, broken down by category/vendor/account/payment method. Posted transactions only.",
    argsSchema: z.object({ period: PeriodInputSchema }),
    argsShape: "{ period: Period }",
    run: (ctx, args: { period: PeriodInput }) => finance.financeForPeriod(ctx, args.period),
  }),
  tool({
    name: "get_cash_position",
    description: "Account balances as of a date (defaults to the as-of date) — opening balance plus posted movements.",
    argsSchema: z.object({ asOfDate: z.string().optional() }),
    argsShape: "{ asOfDate?: string }",
    run: (ctx, args: { asOfDate?: string }) => finance.cashPosition(ctx, args.asOfDate),
  }),
  tool({
    name: "get_pending_and_outstanding",
    description: "Pending and outstanding (not-yet-settled) transactions.",
    argsSchema: z.object({}),
    argsShape: "{}",
    run: (ctx) => finance.pendingAndOutstanding(ctx),
  }),
  tool({
    name: "get_monthly_summary",
    description: "Desk's Monthly Summary report for a given month: finance plus that month's billable hours/value.",
    argsSchema: z.object({ month: z.string() }),
    argsShape: "{ month: string }",
    run: (ctx, args: { month: string }) =>
      finance.monthlySummary(ctx, args.month, (period) => {
        const hours = time.hoursForPeriod(ctx, period);
        const billable = time.billableValueForPeriod(ctx, period);
        return {
          totalBillableHours: hours.data?.billableHours ?? 0,
          totalBillableValueCents: (billable.data ?? []).reduce((sum, p) => sum + p.billableValueCents, 0),
        };
      }),
  }),
  tool({
    name: "get_category_spend",
    description: "Expense spend for one category over a period (e.g. Software & SaaS), broken down by vendor.",
    argsSchema: z.object({ period: PeriodInputSchema, categoryName: z.string() }),
    argsShape: "{ period: Period, categoryName: string }",
    run: (ctx, args: { period: PeriodInput; categoryName: string }) => {
      const category = ctx.desk.categories.find((c) => c.name.toLowerCase() === args.categoryName.toLowerCase());
      if (!category) return { data: null, sourceTool: "desk", caveats: [`No such category in the snapshot: ${args.categoryName}`], outOfSnapshot: false };
      return finance.categorySpendForPeriod(ctx, args.period, category.id);
    },
  }),
  tool({
    name: "get_income_received_for_project",
    description: "Income actually received for a project — distinct from billable value, never the same figure.",
    argsSchema: z.object({ projectPseudonym: z.string() }),
    argsShape: "{ projectPseudonym: string }",
    run: (ctx, args: { projectPseudonym: string }) => {
      const projectId = resolveProjectId(ctx, args.projectPseudonym);
      if (!projectId) return noSuchProject(args.projectPseudonym);
      return finance.incomeReceivedForProject(ctx, projectId);
    },
  }),
  tool({
    name: "get_overdue_cards",
    description: "Skylight cards past due (relative to the as-of date) and not in a Done column.",
    argsSchema: z.object({}),
    argsShape: "{}",
    run: (ctx) => skylight.overdueCards(ctx),
  }),
  tool({
    name: "get_cards_due_on",
    description: "Skylight cards due on a specific date.",
    argsSchema: z.object({ date: z.string() }),
    argsShape: "{ date: string }",
    run: (ctx, args: { date: string }) => skylight.cardsDueOn(ctx, args.date),
  }),
  tool({
    name: "get_cards_by",
    description: "Skylight cards filtered by board (pseudonym), column name, label or tag. Use for 'what's in progress on X' questions.",
    argsSchema: z.object({ boardPseudonym: z.string().optional(), columnName: z.string().optional(), label: z.string().optional(), tag: z.string().optional() }),
    argsShape: "{ boardPseudonym?: string, columnName?: string, label?: string, tag?: string }",
    run: (ctx, args: { boardPseudonym?: string; columnName?: string; label?: string; tag?: string }) => {
      const boardId = args.boardPseudonym ? resolveBoardId(ctx, args.boardPseudonym) : undefined;
      if (args.boardPseudonym && !boardId) return noSuchBoard(args.boardPseudonym);
      const columnId = args.columnName ? ctx.skylight.columns.find((c) => (!boardId || c.boardId === boardId) && c.name.toLowerCase() === args.columnName!.toLowerCase())?.id : undefined;
      return skylight.cardsBy(ctx, { boardId, columnId, label: args.label, tag: args.tag });
    },
  }),
  tool({
    name: "get_checklist_progress",
    description: "Checklist progress for a card (by card title), with the remaining items listed by name.",
    argsSchema: z.object({ cardTitle: z.string() }),
    argsShape: "{ cardTitle: string }",
    run: (ctx, args: { cardTitle: string }) => {
      const card = ctx.skylight.cards.find((c) => c.title.toLowerCase() === args.cardTitle.toLowerCase() && !c.deletedAt);
      if (!card) return { data: null, sourceTool: "skylight", caveats: [`No such card in the snapshot: ${args.cardTitle}`], outOfSnapshot: false };
      return skylight.checklistProgress(ctx, card.id);
    },
  }),
  tool({
    name: "get_cards_completed_in_period",
    description: "Cards moved into a Done column within a period (using the activity log), optionally scoped to a board.",
    argsSchema: z.object({ period: PeriodInputSchema, boardPseudonym: z.string().optional() }),
    argsShape: "{ period: Period, boardPseudonym?: string }",
    run: (ctx, args: { period: PeriodInput; boardPseudonym?: string }) => {
      const boardId = args.boardPseudonym ? resolveBoardId(ctx, args.boardPseudonym) : undefined;
      if (args.boardPseudonym && !boardId) return noSuchBoard(args.boardPseudonym);
      return skylight.cardsCompletedInPeriod(ctx, args.period, { boardId });
    },
  }),
  tool({
    name: "get_recent_activity",
    description: "Recent activity (moves, comments, notes) on a board or card.",
    argsSchema: z.object({ boardPseudonym: z.string().optional(), cardTitle: z.string().optional(), limit: z.number().int().positive().max(50).optional() }),
    argsShape: "{ boardPseudonym?: string, cardTitle?: string, limit?: number }",
    run: (ctx, args: { boardPseudonym?: string; cardTitle?: string; limit?: number }) => {
      const boardId = args.boardPseudonym ? resolveBoardId(ctx, args.boardPseudonym) : undefined;
      if (args.boardPseudonym && !boardId) return noSuchBoard(args.boardPseudonym);
      const cardId = args.cardTitle ? ctx.skylight.cards.find((c) => c.title.toLowerCase() === args.cardTitle!.toLowerCase())?.id : undefined;
      return skylight.recentActivity(ctx, { boardId, cardId }, args.limit);
    },
  }),
  tool({
    name: "search_boards",
    description: "Case-insensitive partial-match search over Skylight board names.",
    argsSchema: z.object({ query: z.string() }),
    argsShape: "{ query: string }",
    run: (ctx, args: { query: string }) => skylight.searchBoards(ctx, args.query),
  }),
  tool({
    name: "search_cards",
    description: "Case-insensitive partial-match search over Skylight card titles.",
    argsSchema: z.object({ query: z.string() }),
    argsShape: "{ query: string }",
    run: (ctx, args: { query: string }) => skylight.searchCards(ctx, args.query),
  }),
  tool({
    name: "get_project_health",
    description: "Cross-tool project performance: Desk hours/billable value alongside Skylight open/overdue/done counts for the same project.",
    argsSchema: z.object({ projectPseudonym: z.string() }),
    argsShape: "{ projectPseudonym: string }",
    run: (ctx, args: { projectPseudonym: string }) => crossTool.projectHealth(ctx, args.projectPseudonym),
  }),
  tool({
    name: "get_time_vs_completion_correlation",
    description: "Correlates Desk time logged with Skylight cards completed in the same period for a project/board (correlation only, tools don't sync).",
    argsSchema: z.object({ projectPseudonym: z.string(), period: PeriodInputSchema }),
    argsShape: "{ projectPseudonym: string, period: Period }",
    run: (ctx, args: { projectPseudonym: string; period: PeriodInput }) =>
      crossTool.timeVsCompletionCorrelation(ctx, args.projectPseudonym, args.period, (period, boardId) => (skylight.cardsCompletedInPeriod(ctx, period, { boardId }).data ?? []).length),
  }),
  tool({
    name: "list_projects_and_boards",
    description: "Lists every Desk project and Skylight board pseudonym in the snapshot — use this to check whether a name the user mentioned actually exists before answering.",
    argsSchema: z.object({}),
    argsShape: "{}",
    run: (ctx) =>
      ({
        data: { projects: ctx.desk.projects.map((p) => p.pseudonym), boards: ctx.skylight.boards.map((b) => b.pseudonym) },
        sourceTool: "both",
        caveats: [],
        outOfSnapshot: false,
      }) satisfies QueryResult<unknown>,
  }),
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}
