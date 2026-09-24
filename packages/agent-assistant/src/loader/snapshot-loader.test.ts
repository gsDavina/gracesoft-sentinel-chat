import { describe, expect, it } from "vitest";
import { loadSnapshot, SnapshotLoadError } from "./snapshot-loader.js";
import { buildMutatedSnapshotDir, buildSnapshotDirMissingFile, VALID_SNAPSHOT_DIR } from "./test-support.js";

describe("loadSnapshot — happy path", () => {
  it("loads the full fixture without errors and reports record counts", () => {
    const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);

    expect(snapshot.summary.recordCounts.projects).toBe(5);
    expect(snapshot.summary.recordCounts.timeEntries).toBe(14);
    expect(snapshot.summary.recordCounts.transactions).toBe(9);
    expect(snapshot.summary.recordCounts.boards).toBe(5);
    expect(snapshot.summary.recordCounts.cards).toBe(11);
  });

  it("reports an empty table as empty, not an error", () => {
    const dir = buildMutatedSnapshotDir([{ file: "documents.json", mutate: () => [] }]);
    const snapshot = loadSnapshot(dir);
    expect(snapshot.summary.recordCounts.documents).toBe(0);
  });

  it("logs unmatched boards and projects as warnings, not errors", () => {
    const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
    const codes = snapshot.summary.warnings.map((w) => w.code);
    expect(codes).toContain("unmatched-board");
    expect(codes).toContain("unmatched-project");
    expect(snapshot.crossTool.boardByPseudonym.has("Project 6")).toBe(true);
    expect(snapshot.crossTool.projectByPseudonym.has("Project 5")).toBe(true);
  });

  it("flags a record dated outside the snapshot window as a warning, not an error", () => {
    const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
    const outOfRange = snapshot.summary.warnings.filter((w) => w.code === "out-of-range-date");
    expect(outOfRange.some((w) => w.message.includes("te-p4-1"))).toBe(true);
  });
});

describe("loadSnapshot — missing/malformed input", () => {
  it("fails fast with a clear message naming the missing file", () => {
    const dir = buildSnapshotDirMissingFile("accounts.json");
    expect(() => loadSnapshot(dir)).toThrowError(/accounts\.json/);
  });

  it("fails on a malformed row with the table name and row identifier", () => {
    const dir = buildMutatedSnapshotDir([
      {
        file: "transactions.json",
        mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "tx-1" ? { ...(r as object), amountCents: "not-a-number" } : r)),
      },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/transactions.*tx-1/s);
  });
});

describe("loadSnapshot — referential integrity", () => {
  it("fails when a time entry points to a missing project", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "time-entries.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "te-p1-1" ? { ...(r as object), projectId: "project-999" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrow(SnapshotLoadError);
    expect(() => loadSnapshot(dir)).toThrowError(/te-p1-1.*project-999/s);
  });

  it("fails when a time entry has an unknown stage", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "time-entries.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "te-p1-1" ? { ...(r as object), stage: "Not A Stage" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrow(SnapshotLoadError);
  });

  it("fails when a transaction points to a missing account, method, category or vendor", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "transactions.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "tx-5" ? { ...(r as object), vendorId: "vendor-999" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/tx-5.*vendor-999/s);
  });

  it("fails when a card points to a missing column, or a column to a missing board", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "cards.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "card-b1-1" ? { ...(r as object), columnId: "col-999" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/card-b1-1.*col-999/s);
  });

  it("fails when a checklist item points to a missing checklist", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "checklist-items.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "ci-1" ? { ...(r as object), checklistId: "checklist-999" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/ci-1.*checklist-999/s);
  });

  it("rejects a commit-derived entry dated outside 1-3 Aug 2026", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "time-entries.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "te-p4-4" ? { ...(r as object), date: "2026-08-10" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/commit-derived/);
  });
});

describe("loadSnapshot — redaction scan", () => {
  it("fails if a real-looking email appears in a note field", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "transactions.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "tx-5" ? { ...(r as object), note: "reach out to someone@example.com" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/Redaction scan failed/);
  });

  it("fails if a phone number appears in a comment", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "comments.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "comment-2" ? { ...(r as object), text: "call me at +65 9123 4567" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/Redaction scan failed/);
  });

  it("fails if a file path appears in a filename", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "documents.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "doc-1" ? { ...(r as object), filename: "/Users/realname/Documents/contract.pdf" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).toThrowError(/Redaction scan failed/);
  });

  it("passes [email]/[url]/[phone] placeholders and pseudonyms", () => {
    const dir = buildMutatedSnapshotDir([
      { file: "transactions.json", mutate: (rows) => rows.map((r) => ((r as { id: string }).id === "tx-5" ? { ...(r as object), note: "sent to [email], see [url], call [phone]" } : r)) },
    ]);
    expect(() => loadSnapshot(dir)).not.toThrow();
  });
});
