import { overdueCards } from "./skylight.js";
import { hoursForPeriod, projectSummary } from "./time.js";
import { resolvePeriod, type PeriodInput } from "./period.js";
import { okResult, type QueryContext, type QueryResult } from "./types.js";

export interface ProjectHealth {
  pseudonym: string;
  desk?: {
    projectId: string;
    hoursToDate: number;
    billableValueToDateCents: number;
    currentStage: string | null;
  };
  skylight?: {
    boardId: string;
    openCount: number;
    overdueCount: number;
    doneCount: number;
  };
}

/** Joins Desk hours/billable value with Skylight open/overdue/done counts for the same pseudonym — the cross-tool join key. */
export function projectHealth(ctx: QueryContext, pseudonym: string): QueryResult<ProjectHealth> {
  const project = ctx.desk.projects.find((p) => p.pseudonym === pseudonym);
  const board = ctx.skylight.boards.find((b) => b.pseudonym === pseudonym);

  if (!project && !board) {
    return { data: null, sourceTool: "both", caveats: [`No such project in the snapshot: ${pseudonym}`], outOfSnapshot: false };
  }

  const caveats: string[] = [];
  let desk: ProjectHealth["desk"];
  let skylight: ProjectHealth["skylight"];

  if (project) {
    const summary = projectSummary(ctx, project.id).data;
    desk = {
      projectId: project.id,
      hoursToDate: summary?.hoursToDate ?? 0,
      billableValueToDateCents: summary?.billableValueToDateCents ?? 0,
      currentStage: summary?.currentStage ?? null,
    };
  } else {
    caveats.push(`No Desk project matches Skylight board "${pseudonym}" — Skylight data only.`);
  }

  if (board) {
    const boardCards = ctx.skylight.cards.filter((c) => c.boardId === board.id && !c.deletedAt);
    const overdueIds = new Set((overdueCards(ctx).data ?? []).filter((c) => c.boardId === board.id).map((c) => c.cardId));
    const doneColumnIds = new Set(ctx.skylight.columns.filter((c) => c.boardId === board.id && c.isDoneColumn).map((c) => c.id));
    skylight = {
      boardId: board.id,
      openCount: boardCards.filter((c) => !doneColumnIds.has(c.columnId)).length,
      overdueCount: overdueIds.size,
      doneCount: boardCards.filter((c) => doneColumnIds.has(c.columnId)).length,
    };
  } else {
    caveats.push(`No Skylight board matches Desk project "${pseudonym}" — Desk data only.`);
  }

  return okResult("both", undefined, { pseudonym, desk, skylight }, caveats);
}

export interface TimeVsCompletionResult {
  hoursInPeriod: number;
  cardsCompletedInPeriod: number;
}

/** Correlates Desk time in a period with Skylight cards completed in the same period — always caveated, since the two tools don't sync automatically. */
export function timeVsCompletionCorrelation(ctx: QueryContext, pseudonym: string, period: PeriodInput, cardsCompleted: (period: PeriodInput, boardId: string) => number): QueryResult<TimeVsCompletionResult> {
  const project = ctx.desk.projects.find((p) => p.pseudonym === pseudonym);
  const board = ctx.skylight.boards.find((b) => b.pseudonym === pseudonym);
  if (!project || !board) {
    return { data: null, sourceTool: "both", caveats: [`Cross-tool correlation needs both a Desk project and a Skylight board named "${pseudonym}".`], outOfSnapshot: false };
  }

  const resolved = resolvePeriod(period, ctx.asOfDate);
  const hours = hoursForPeriod(ctx, period, { projectId: project.id });

  return okResult(
    "both",
    resolved,
    { hoursInPeriod: hours.data?.totalHours ?? 0, cardsCompletedInPeriod: cardsCompleted(period, board.id) },
    ["Correlation only — Desk and Skylight don't sync automatically, so this isn't a causal link."]
  );
}
