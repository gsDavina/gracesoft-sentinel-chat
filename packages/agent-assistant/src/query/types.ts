import type { DeskSnapshot } from "../types/desk.js";
import type { SkylightSnapshot } from "../types/skylight.js";
import type { CrossToolIndex } from "../types/snapshot.js";
import type { PeriodResolution } from "./period.js";

export interface QueryContext {
  desk: DeskSnapshot;
  skylight: SkylightSnapshot;
  crossTool: CrossToolIndex;
  asOfDate: string;
}

/**
 * Every query function returns this envelope, never a bare value — M2's
 * exit criteria and the M3 system prompt both depend on every answer
 * carrying its source tool, the date range actually used, and any
 * caveats (clipped range, no data, unmatched board) rather than the
 * model having to infer them.
 */
export interface QueryResult<T> {
  data: T | null;
  sourceTool: "desk" | "skylight" | "both";
  dateRange?: { start: string; end: string; clipped: boolean; partial: boolean };
  caveats: string[];
  outOfSnapshot: boolean;
}

export function outOfSnapshotResult<T>(sourceTool: QueryResult<T>["sourceTool"], period: PeriodResolution): QueryResult<T> {
  return {
    data: null,
    sourceTool,
    dateRange: { start: period.start, end: period.end, clipped: period.clipped, partial: period.partial },
    caveats: [`"${period.label}" is outside the snapshot (10 Jul 2026 to 10 Sep 2026) — there's no data for it.`],
    outOfSnapshot: true,
  };
}

export function okResult<T>(sourceTool: QueryResult<T>["sourceTool"], period: PeriodResolution | undefined, data: T, caveats: string[] = []): QueryResult<T> {
  const periodCaveats = [...caveats];
  if (period?.clipped) periodCaveats.push(`Clipped to the snapshot window: ${period.start} to ${period.end}.`);
  if (period?.partial) periodCaveats.push(`"${period.label}" hasn't finished yet as of the as-of date — this is a partial period.`);
  return {
    data,
    sourceTool,
    dateRange: period ? { start: period.start, end: period.end, clipped: period.clipped, partial: period.partial } : undefined,
    caveats: periodCaveats,
    outOfSnapshot: false,
  };
}
