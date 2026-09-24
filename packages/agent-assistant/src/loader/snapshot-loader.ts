import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType } from "zod";
import {
  AccountSchema,
  CategorySchema,
  DeskDocumentSchema,
  DeskSnapshotSchema,
  PaymentMethodSchema,
  ProjectSchema,
  ServiceSchema,
  TimeEntrySchema,
  TransactionSchema,
  VendorSchema,
  type DeskSnapshot,
} from "../types/desk.js";
import {
  ActivityLogEntrySchema,
  BoardSchema,
  CardSchema,
  ChecklistItemSchema,
  ChecklistSchema,
  ColumnSchema,
  CommentSchema,
  NoteSchema,
  SkylightSnapshotSchema,
  type SkylightSnapshot,
} from "../types/skylight.js";
import { SNAPSHOT_END_DATE, SNAPSHOT_START_DATE, type CrossToolIndex, type LoadSummary, type LoadWarning, type Snapshot } from "../types/snapshot.js";
import { scanDeskForRedactions, scanSkylightForRedactions } from "./redaction-scan.js";

export class SnapshotLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotLoadError";
  }
}

interface TableSpec<T> {
  file: string;
  table: string;
  rowSchema: ZodType<T>;
}

const DESK_TABLES = {
  projects: { file: "projects.json", table: "projects", rowSchema: ProjectSchema },
  timeEntries: { file: "time-entries.json", table: "timeEntries", rowSchema: TimeEntrySchema },
  accounts: { file: "accounts.json", table: "accounts", rowSchema: AccountSchema },
  paymentMethods: { file: "payment-methods.json", table: "paymentMethods", rowSchema: PaymentMethodSchema },
  categories: { file: "categories.json", table: "categories", rowSchema: CategorySchema },
  vendors: { file: "vendors.json", table: "vendors", rowSchema: VendorSchema },
  services: { file: "services.json", table: "services", rowSchema: ServiceSchema },
  transactions: { file: "transactions.json", table: "transactions", rowSchema: TransactionSchema },
  documents: { file: "documents.json", table: "documents", rowSchema: DeskDocumentSchema },
} as const;

const SKYLIGHT_TABLES = {
  boards: { file: "boards.json", table: "boards", rowSchema: BoardSchema },
  columns: { file: "columns.json", table: "columns", rowSchema: ColumnSchema },
  cards: { file: "cards.json", table: "cards", rowSchema: CardSchema },
  checklists: { file: "checklists.json", table: "checklists", rowSchema: ChecklistSchema },
  checklistItems: { file: "checklist-items.json", table: "checklistItems", rowSchema: ChecklistItemSchema },
  comments: { file: "comments.json", table: "comments", rowSchema: CommentSchema },
  notes: { file: "notes.json", table: "notes", rowSchema: NoteSchema },
  activityLog: { file: "activity-log.json", table: "activityLog", rowSchema: ActivityLogEntrySchema },
} as const;

function readTable<T>(dir: string, spec: TableSpec<T>): T[] {
  const path = resolve(dir, spec.file);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new SnapshotLoadError(`Missing snapshot file: ${spec.file} (expected at ${path})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new SnapshotLoadError(`${spec.file} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new SnapshotLoadError(`${spec.file} must contain a JSON array (table: ${spec.table})`);
  }

  const rows: T[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i];
    const result = spec.rowSchema.safeParse(row);
    if (!result.success) {
      const rowId = typeof row === "object" && row !== null && "id" in row ? String((row as { id: unknown }).id) : `index ${i}`;
      const issues = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new SnapshotLoadError(`Malformed row in ${spec.table} (id: ${rowId}): ${issues}`);
    }
    rows.push(result.data);
  }
  return rows;
}

function loadDesk(dir: string): DeskSnapshot {
  return DeskSnapshotSchema.parse({
    projects: readTable(dir, DESK_TABLES.projects),
    timeEntries: readTable(dir, DESK_TABLES.timeEntries),
    accounts: readTable(dir, DESK_TABLES.accounts),
    paymentMethods: readTable(dir, DESK_TABLES.paymentMethods),
    categories: readTable(dir, DESK_TABLES.categories),
    vendors: readTable(dir, DESK_TABLES.vendors),
    services: readTable(dir, DESK_TABLES.services),
    transactions: readTable(dir, DESK_TABLES.transactions),
    documents: readTable(dir, DESK_TABLES.documents),
  });
}

function loadSkylight(dir: string): SkylightSnapshot {
  return SkylightSnapshotSchema.parse({
    boards: readTable(dir, SKYLIGHT_TABLES.boards),
    columns: readTable(dir, SKYLIGHT_TABLES.columns),
    cards: readTable(dir, SKYLIGHT_TABLES.cards),
    checklists: readTable(dir, SKYLIGHT_TABLES.checklists),
    checklistItems: readTable(dir, SKYLIGHT_TABLES.checklistItems),
    comments: readTable(dir, SKYLIGHT_TABLES.comments),
    notes: readTable(dir, SKYLIGHT_TABLES.notes),
    activityLog: readTable(dir, SKYLIGHT_TABLES.activityLog),
  });
}

function checkDeskIntegrity(desk: DeskSnapshot): void {
  const projectIds = new Set(desk.projects.map((p) => p.id));
  const accountIds = new Set(desk.accounts.map((a) => a.id));
  const methodIds = new Set(desk.paymentMethods.map((m) => m.id));
  const categoryIds = new Set(desk.categories.map((c) => c.id));
  const vendorIds = new Set(desk.vendors.map((v) => v.id));

  for (const t of desk.timeEntries) {
    if (!projectIds.has(t.projectId)) {
      throw new SnapshotLoadError(`Time entry ${t.id} points to a missing project: ${t.projectId}`);
    }
    if (t.source === "commit" && (t.date < "2026-08-01" || t.date > "2026-08-03")) {
      throw new SnapshotLoadError(`Time entry ${t.id} is commit-derived but dated ${t.date}; commit tracking only exists 1-3 Aug 2026`);
    }
  }
  for (const tx of desk.transactions) {
    if (!accountIds.has(tx.accountId)) throw new SnapshotLoadError(`Transaction ${tx.id} points to a missing account: ${tx.accountId}`);
    if (!methodIds.has(tx.paymentMethodId)) throw new SnapshotLoadError(`Transaction ${tx.id} points to a missing payment method: ${tx.paymentMethodId}`);
    if (!categoryIds.has(tx.categoryId)) throw new SnapshotLoadError(`Transaction ${tx.id} points to a missing category: ${tx.categoryId}`);
    if (tx.vendorId && !vendorIds.has(tx.vendorId)) throw new SnapshotLoadError(`Transaction ${tx.id} points to a missing vendor: ${tx.vendorId}`);
    if (tx.projectId && !projectIds.has(tx.projectId)) throw new SnapshotLoadError(`Transaction ${tx.id} points to a missing project: ${tx.projectId}`);
  }
}

function checkSkylightIntegrity(skylight: SkylightSnapshot): void {
  const boardIds = new Set(skylight.boards.map((b) => b.id));
  const columnIds = new Set(skylight.columns.map((c) => c.id));
  const cardIds = new Set(skylight.cards.map((c) => c.id));
  const checklistIds = new Set(skylight.checklists.map((c) => c.id));

  for (const col of skylight.columns) {
    if (!boardIds.has(col.boardId)) throw new SnapshotLoadError(`Column ${col.id} points to a missing board: ${col.boardId}`);
  }
  for (const card of skylight.cards) {
    if (!boardIds.has(card.boardId)) throw new SnapshotLoadError(`Card ${card.id} points to a missing board: ${card.boardId}`);
    if (!columnIds.has(card.columnId)) throw new SnapshotLoadError(`Card ${card.id} points to a missing column: ${card.columnId}`);
  }
  for (const cl of skylight.checklists) {
    if (!cardIds.has(cl.cardId)) throw new SnapshotLoadError(`Checklist ${cl.id} points to a missing card: ${cl.cardId}`);
  }
  for (const item of skylight.checklistItems) {
    if (!checklistIds.has(item.checklistId)) throw new SnapshotLoadError(`Checklist item ${item.id} points to a missing checklist: ${item.checklistId}`);
  }
}

function buildCrossToolIndex(desk: DeskSnapshot, skylight: SkylightSnapshot, warnings: LoadWarning[]): CrossToolIndex {
  const projectByPseudonym = new Map(desk.projects.map((p) => [p.pseudonym, p.id]));
  const boardByPseudonym = new Map(skylight.boards.map((b) => [b.pseudonym, b.id]));

  for (const board of skylight.boards) {
    if (!projectByPseudonym.has(board.pseudonym)) {
      warnings.push({ code: "unmatched-board", message: `Skylight board "${board.pseudonym}" has no matching Desk project` });
    }
  }
  for (const project of desk.projects) {
    if (!boardByPseudonym.has(project.pseudonym)) {
      warnings.push({ code: "unmatched-project", message: `Desk project "${project.pseudonym}" has no matching Skylight board` });
    }
  }

  return { projectByPseudonym, boardByPseudonym };
}

function checkDateRange(desk: DeskSnapshot, skylight: SkylightSnapshot, warnings: LoadWarning[]): void {
  const outOfRange = (date: string) => date < SNAPSHOT_START_DATE || date > SNAPSHOT_END_DATE;

  for (const t of desk.timeEntries) {
    if (outOfRange(t.date)) warnings.push({ code: "out-of-range-date", message: `Time entry ${t.id} is dated ${t.date}, outside the snapshot window` });
  }
  for (const tx of desk.transactions) {
    if (outOfRange(tx.date)) warnings.push({ code: "out-of-range-date", message: `Transaction ${tx.id} is dated ${tx.date}, outside the snapshot window` });
  }
  for (const card of skylight.cards) {
    if (card.dueDate && outOfRange(card.dueDate)) {
      warnings.push({ code: "out-of-range-date", message: `Card ${card.id} has a due date of ${card.dueDate}, outside the snapshot window` });
    }
  }
}

export interface LoadSnapshotOptions {
  asOfDate?: string;
}

export function loadSnapshot(dir: string, options: LoadSnapshotOptions = {}): Snapshot & { crossTool: CrossToolIndex } {
  const desk = loadDesk(dir);
  const skylight = loadSkylight(dir);

  checkDeskIntegrity(desk);
  checkSkylightIntegrity(skylight);

  const deskViolations = scanDeskForRedactions(desk);
  const skylightViolations = scanSkylightForRedactions(skylight);
  const violations = [...deskViolations, ...skylightViolations];
  if (violations.length > 0) {
    const details = violations.map((v) => `${v.table}.${v.id}.${v.field} looks like a ${v.reason} ("${v.excerpt}")`).join("; ");
    throw new SnapshotLoadError(`Redaction scan failed: ${details}`);
  }

  const warnings: LoadWarning[] = [];
  const crossTool = buildCrossToolIndex(desk, skylight, warnings);
  checkDateRange(desk, skylight, warnings);

  const recordCounts: Record<string, number> = {};
  for (const key of Object.keys(DESK_TABLES) as (keyof typeof DESK_TABLES)[]) recordCounts[key] = desk[key].length;
  for (const key of Object.keys(SKYLIGHT_TABLES) as (keyof typeof SKYLIGHT_TABLES)[]) recordCounts[key] = skylight[key].length;

  const summary: LoadSummary = {
    asOfDate: options.asOfDate ?? SNAPSHOT_END_DATE,
    snapshotStart: SNAPSHOT_START_DATE,
    snapshotEnd: SNAPSHOT_END_DATE,
    recordCounts,
    warnings,
  };

  return { desk, skylight, summary, crossTool };
}
