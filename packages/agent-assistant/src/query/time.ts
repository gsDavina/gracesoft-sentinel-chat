import { STAGE_ORDER, type Project, type Stage, type TimeEntry } from "../types/desk.js";
import { minutesToHours } from "../loader/normalize.js";
import { resolvePeriod, type PeriodInput } from "./period.js";
import { okResult, outOfSnapshotResult, type QueryContext, type QueryResult } from "./types.js";

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function findProject(ctx: QueryContext, projectId: string): Project | undefined {
  return ctx.desk.projects.find((p) => p.id === projectId);
}

export interface HoursBreakdown {
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
}

export interface ProjectHours extends HoursBreakdown {
  projectId: string;
  projectPseudonym: string;
}

export interface HoursForPeriodResult extends HoursBreakdown {
  byProject: ProjectHours[];
}

function sumHours(entries: TimeEntry[]): HoursBreakdown {
  let billableHours = 0;
  let nonBillableHours = 0;
  for (const e of entries) {
    const hours = minutesToHours(e.minutes);
    if (e.billable) billableHours += hours;
    else nonBillableHours += hours;
  }
  return { totalHours: billableHours + nonBillableHours, billableHours, nonBillableHours };
}

/** Total, billable and non-billable hours for a period, optionally scoped to one project or stage. */
export function hoursForPeriod(ctx: QueryContext, period: PeriodInput, opts: { projectId?: string; stage?: Stage } = {}): QueryResult<HoursForPeriodResult> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("desk", resolved);

  const entries = ctx.desk.timeEntries.filter(
    (e) => inRange(e.date, resolved.start, resolved.end) && (!opts.projectId || e.projectId === opts.projectId) && (!opts.stage || e.stage === opts.stage)
  );

  const byProjectId = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    const list = byProjectId.get(e.projectId) ?? [];
    list.push(e);
    byProjectId.set(e.projectId, list);
  }
  const byProject: ProjectHours[] = [...byProjectId.entries()].map(([projectId, list]) => ({
    projectId,
    projectPseudonym: findProject(ctx, projectId)?.pseudonym ?? projectId,
    ...sumHours(list),
  }));

  return okResult("desk", resolved, { ...sumHours(entries), byProject });
}

export interface ProjectBillableValue {
  projectId: string;
  projectPseudonym: string;
  billableHours: number;
  billableValueCents: number;
}

/** Billable value = billable hours x that project's hourly rate, summed per project. Non-billable hours never contribute. */
export function billableValueForPeriod(ctx: QueryContext, period: PeriodInput, opts: { projectId?: string } = {}): QueryResult<ProjectBillableValue[]> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("desk", resolved);

  const byProjectId = new Map<string, TimeEntry[]>();
  for (const e of ctx.desk.timeEntries) {
    if (!inRange(e.date, resolved.start, resolved.end)) continue;
    if (opts.projectId && e.projectId !== opts.projectId) continue;
    if (!e.billable) continue;
    const list = byProjectId.get(e.projectId) ?? [];
    list.push(e);
    byProjectId.set(e.projectId, list);
  }

  const result: ProjectBillableValue[] = [...byProjectId.entries()].map(([projectId, entries]) => {
    const project = findProject(ctx, projectId);
    const billableHours = entries.reduce((sum, e) => sum + minutesToHours(e.minutes), 0);
    return {
      projectId,
      projectPseudonym: project?.pseudonym ?? projectId,
      billableHours,
      billableValueCents: Math.round(billableHours * (project?.hourlyRateCents ?? 0)),
    };
  });

  return okResult("desk", resolved, result);
}

export interface StageBreakdownEntry {
  stage: Stage;
  hours: number;
  billableValueCents: number;
}

/** Hours and billable value by stage, in SDLC order (Discovery to Maintenance). Always sums to the project total. */
export function stageBreakdown(ctx: QueryContext, projectId: string): QueryResult<StageBreakdownEntry[]> {
  const project = findProject(ctx, projectId);
  if (!project) return { data: null, sourceTool: "desk", caveats: [`No such project in the snapshot: ${projectId}`], outOfSnapshot: false };

  const byStage = new Map<Stage, TimeEntry[]>();
  for (const e of ctx.desk.timeEntries) {
    if (e.projectId !== projectId) continue;
    const list = byStage.get(e.stage) ?? [];
    list.push(e);
    byStage.set(e.stage, list);
  }

  const entries: StageBreakdownEntry[] = STAGE_ORDER.filter((stage) => byStage.has(stage)).map((stage) => {
    const list = byStage.get(stage)!;
    const hours = list.reduce((sum, e) => sum + minutesToHours(e.minutes), 0);
    const billableValueCents = Math.round(list.filter((e) => e.billable).reduce((sum, e) => sum + minutesToHours(e.minutes), 0) * project.hourlyRateCents);
    return { stage, hours, billableValueCents };
  });

  return okResult("desk", undefined, entries);
}

export interface CurrentStageResult {
  stage: Stage;
  rule: string;
  asOfEntryDate: string;
}

/**
 * The current-stage rule (M0 open question #3, resolved): the stage of the
 * project's most recent time entry by date — not most hours, not a stored
 * field. A project that bounced from Testing back to Development reports
 * Development, because that's the later entry.
 */
export function currentStage(ctx: QueryContext, projectId: string): QueryResult<CurrentStageResult> {
  const project = findProject(ctx, projectId);
  if (!project) return { data: null, sourceTool: "desk", caveats: [`No such project in the snapshot: ${projectId}`], outOfSnapshot: false };

  const entries = ctx.desk.timeEntries.filter((e) => e.projectId === projectId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = entries.at(-1);
  if (!latest) return okResult("desk", undefined, null as unknown as CurrentStageResult, ["This project has no time entries in the snapshot."]);

  return okResult("desk", undefined, {
    stage: latest.stage,
    rule: "The stage of the project's most recent time entry by date.",
    asOfEntryDate: latest.date,
  });
}

export interface CommitVsManualResult {
  commitHours: number;
  manualHours: number;
}

/** Commit-derived entries only exist 1-3 Aug 2026 — everything else is manual. */
export function commitVsManualForPeriod(ctx: QueryContext, period: PeriodInput, opts: { projectId?: string } = {}): QueryResult<CommitVsManualResult> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("desk", resolved);

  const entries = ctx.desk.timeEntries.filter((e) => inRange(e.date, resolved.start, resolved.end) && (!opts.projectId || e.projectId === opts.projectId));
  const commitHours = entries.filter((e) => e.source === "commit").reduce((sum, e) => sum + minutesToHours(e.minutes), 0);
  const manualHours = entries.filter((e) => e.source === "manual").reduce((sum, e) => sum + minutesToHours(e.minutes), 0);

  return okResult("desk", resolved, { commitHours, manualHours });
}

export interface ProjectSummary {
  projectId: string;
  projectPseudonym: string;
  status: Project["status"];
  startDate: string;
  endDate?: string;
  hourlyRateCents: number;
  hoursToDate: number;
  billableValueToDateCents: number;
  currentStage: Stage | null;
  stageBreakdown: StageBreakdownEntry[];
  lastActivityDate: string | null;
}

/** Status, dates, rate, hours to date, billable value, stage breakdown and last activity — the one-stop project card. */
export function projectSummary(ctx: QueryContext, projectId: string): QueryResult<ProjectSummary> {
  const project = findProject(ctx, projectId);
  if (!project) return { data: null, sourceTool: "desk", caveats: [`No such project in the snapshot: ${projectId}`], outOfSnapshot: false };

  const entries = ctx.desk.timeEntries.filter((e) => e.projectId === projectId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const hoursToDate = entries.reduce((sum, e) => sum + minutesToHours(e.minutes), 0);
  const billableValueToDateCents = Math.round(entries.filter((e) => e.billable).reduce((sum, e) => sum + minutesToHours(e.minutes), 0) * project.hourlyRateCents);
  const breakdown = stageBreakdown(ctx, projectId).data ?? [];
  const latest = entries.at(-1);

  const caveats = entries.length === 0 ? ["This project has no time entries in the snapshot."] : [];

  return okResult("desk", undefined, {
    projectId: project.id,
    projectPseudonym: project.pseudonym,
    status: project.status,
    startDate: project.startDate,
    endDate: project.endDate,
    hourlyRateCents: project.hourlyRateCents,
    hoursToDate,
    billableValueToDateCents,
    currentStage: latest?.stage ?? null,
    stageBreakdown: breakdown,
    lastActivityDate: latest?.date ?? null,
  }, caveats);
}

/** Which project took the most time in a period — used for "which project took the most time in the last 30 days?". */
export function projectWithMostTimeInPeriod(ctx: QueryContext, period: PeriodInput): QueryResult<ProjectHours | null> {
  const result = hoursForPeriod(ctx, period);
  if (result.outOfSnapshot || !result.data) return result as unknown as QueryResult<ProjectHours | null>;

  const top = [...result.data.byProject].sort((a, b) => b.totalHours - a.totalHours)[0] ?? null;
  return okResult("desk", resolvePeriod(period, ctx.asOfDate), top);
}
