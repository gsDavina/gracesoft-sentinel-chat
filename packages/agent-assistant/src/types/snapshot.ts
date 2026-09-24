import type { DeskSnapshot } from "./desk.js";
import type { SkylightSnapshot } from "./skylight.js";

export const SNAPSHOT_START_DATE = "2026-07-10";
export const SNAPSHOT_END_DATE = "2026-09-10";
export const SNAPSHOT_TIMEZONE = "Asia/Singapore";

export interface LoadWarning {
  code: string;
  message: string;
}

export interface LoadSummary {
  asOfDate: string;
  snapshotStart: string;
  snapshotEnd: string;
  recordCounts: Record<string, number>;
  warnings: LoadWarning[];
}

export interface Snapshot {
  desk: DeskSnapshot;
  skylight: SkylightSnapshot;
  summary: LoadSummary;
}

/**
 * A project and a board are the same underlying piece of work when they
 * share a pseudonym (M1's cross-tool mapping rule) — this index is built
 * once at load time so the query layer never re-scans both tables.
 */
export interface CrossToolIndex {
  projectByPseudonym: Map<string, string>;
  boardByPseudonym: Map<string, string>;
}
