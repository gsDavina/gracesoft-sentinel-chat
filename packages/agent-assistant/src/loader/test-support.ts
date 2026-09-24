import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VALID_SNAPSHOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/snapshot/valid");

/**
 * Copies the valid fixture into a fresh temp dir and applies `mutate` to
 * one table file before any test calls `loadSnapshot` on it — this lets
 * negative-path tests exercise a single deliberate defect without hand
 * authoring a whole parallel "broken" fixture per case.
 */
export function buildMutatedSnapshotDir(mutations: Array<{ file: string; mutate: (rows: unknown[]) => unknown[] }>): string {
  const dir = mkdtempSync(join(tmpdir(), "gracesoft-assistant-snapshot-"));
  const files = [
    "projects.json",
    "time-entries.json",
    "accounts.json",
    "payment-methods.json",
    "categories.json",
    "vendors.json",
    "services.json",
    "transactions.json",
    "documents.json",
    "boards.json",
    "columns.json",
    "cards.json",
    "checklists.json",
    "checklist-items.json",
    "comments.json",
    "notes.json",
    "activity-log.json",
  ];

  for (const file of files) {
    const mutation = mutations.find((m) => m.file === file);
    const rows: unknown[] = JSON.parse(readFileSync(resolve(VALID_SNAPSHOT_DIR, file), "utf-8"));
    const out = mutation ? mutation.mutate(rows) : rows;
    writeFileSync(resolve(dir, file), JSON.stringify(out), "utf-8");
  }

  return dir;
}

/** Same as `buildMutatedSnapshotDir`, but drops a file entirely instead of mutating it. */
export function buildSnapshotDirMissingFile(missingFile: string): string {
  const dir = buildMutatedSnapshotDir([]);
  rmSync(resolve(dir, missingFile));
  return dir;
}
