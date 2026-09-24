import type { Card, Column } from "../types/skylight.js";
import { resolvePeriod, type PeriodInput } from "./period.js";
import { okResult, outOfSnapshotResult, type QueryContext, type QueryResult } from "./types.js";

function isDeleted(card: Card): boolean {
  return card.deletedAt !== undefined;
}

function liveCards(ctx: QueryContext): Card[] {
  return ctx.skylight.cards.filter((c) => !isDeleted(c));
}

function columnOf(ctx: QueryContext, columnId: string): Column | undefined {
  return ctx.skylight.columns.find((c) => c.id === columnId);
}

function boardPseudonym(ctx: QueryContext, boardId: string): string {
  return ctx.skylight.boards.find((b) => b.id === boardId)?.pseudonym ?? boardId;
}

export interface CardSummary {
  cardId: string;
  boardId: string;
  boardPseudonym: string;
  title: string;
  columnName: string;
  dueDate?: string;
}

function toCardSummary(ctx: QueryContext, card: Card): CardSummary {
  return {
    cardId: card.id,
    boardId: card.boardId,
    boardPseudonym: boardPseudonym(ctx, card.boardId),
    title: card.title,
    columnName: columnOf(ctx, card.columnId)?.name ?? card.columnId,
    dueDate: card.dueDate,
  };
}

/** Overdue = due date before the as-of date and the card isn't in a Done column. A card due exactly on the as-of date is "due today", not overdue. Done cards and cards with no due date are never overdue. */
export function overdueCards(ctx: QueryContext): QueryResult<CardSummary[]> {
  const cards = liveCards(ctx).filter((card) => {
    if (!card.dueDate) return false;
    if (card.dueDate >= ctx.asOfDate) return false;
    const column = columnOf(ctx, card.columnId);
    return !column?.isDoneColumn;
  });
  return okResult("skylight", undefined, cards.map((c) => toCardSummary(ctx, c)));
}

export function cardsDueOn(ctx: QueryContext, date: string): QueryResult<CardSummary[]> {
  const cards = liveCards(ctx).filter((c) => c.dueDate === date);
  return okResult("skylight", undefined, cards.map((c) => toCardSummary(ctx, c)));
}

export interface CardFilter {
  boardId?: string;
  columnId?: string;
  label?: string;
  tag?: string;
}

export function cardsBy(ctx: QueryContext, filter: CardFilter): QueryResult<CardSummary[]> {
  const cards = liveCards(ctx).filter(
    (c) =>
      (!filter.boardId || c.boardId === filter.boardId) &&
      (!filter.columnId || c.columnId === filter.columnId) &&
      (!filter.label || c.labels.includes(filter.label)) &&
      (!filter.tag || c.tags.includes(filter.tag))
  );
  return okResult("skylight", undefined, cards.map((c) => toCardSummary(ctx, c)));
}

export interface ChecklistProgressResult {
  checklistId: string;
  name: string;
  done: number;
  total: number;
  remaining: string[];
}

export function checklistProgress(ctx: QueryContext, cardId: string): QueryResult<ChecklistProgressResult[]> {
  const checklists = ctx.skylight.checklists.filter((cl) => cl.cardId === cardId);
  const result = checklists.map((cl) => {
    const items = ctx.skylight.checklistItems.filter((i) => i.checklistId === cl.id);
    return {
      checklistId: cl.id,
      name: cl.name,
      done: items.filter((i) => i.done).length,
      total: items.length,
      remaining: items.filter((i) => !i.done).map((i) => i.text),
    };
  });
  return okResult("skylight", undefined, result);
}

/**
 * A card counts as "completed in period P" when it has a moved-into-a-
 * Done-column activity entry within P, and no later moved-out-of-that-
 * column entry — a card moved into Done and then back out doesn't count,
 * even if the move into Done itself happened inside the period.
 */
export function cardsCompletedInPeriod(ctx: QueryContext, period: PeriodInput, opts: { boardId?: string } = {}): QueryResult<CardSummary[]> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("skylight", resolved);

  const byCard = new Map<string, typeof ctx.skylight.activityLog>();
  for (const entry of ctx.skylight.activityLog) {
    if (opts.boardId && entry.boardId !== opts.boardId) continue;
    const list = byCard.get(entry.cardId) ?? [];
    list.push(entry);
    byCard.set(entry.cardId, list);
  }

  const completedCardIds = new Set<string>();
  for (const [cardId, entries] of byCard) {
    const sorted = [...entries].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    for (const entry of sorted) {
      if (entry.type !== "moved" || !entry.toColumnId) continue;
      const doneColumn = columnOf(ctx, entry.toColumnId);
      if (!doneColumn?.isDoneColumn) continue;
      if (entry.at < `${resolved.start}T00:00:00Z` || entry.at > `${resolved.end}T23:59:59Z`) continue;

      const movedOutLater = sorted.some((later) => later.at > entry.at && later.type === "moved" && later.fromColumnId === entry.toColumnId);
      if (!movedOutLater) completedCardIds.add(cardId);
    }
  }

  const cards = ctx.skylight.cards.filter((c) => completedCardIds.has(c.id));
  return okResult("skylight", resolved, cards.map((c) => toCardSummary(ctx, c)));
}

export interface ActivityFeedEntry {
  at: string;
  kind: "activity" | "comment" | "note";
  cardId: string;
  summary: string;
}

/** Recent activity on a board or card, including comments and notes — deliberately NOT filtered by deletedAt, since deleted cards still belong in activity history. */
export function recentActivity(ctx: QueryContext, filter: { boardId?: string; cardId?: string }, limit = 20): QueryResult<ActivityFeedEntry[]> {
  const cardIdsOnBoard = filter.boardId ? new Set(ctx.skylight.cards.filter((c) => c.boardId === filter.boardId).map((c) => c.id)) : undefined;
  const matches = (cardId: string) => (!filter.cardId || cardId === filter.cardId) && (!cardIdsOnBoard || cardIdsOnBoard.has(cardId));

  const entries: ActivityFeedEntry[] = [
    ...ctx.skylight.activityLog.filter((a) => matches(a.cardId)).map((a) => ({ at: a.at, kind: "activity" as const, cardId: a.cardId, summary: `${a.actor} ${a.type}${a.toColumnId ? ` -> ${columnOf(ctx, a.toColumnId)?.name}` : ""}` })),
    ...ctx.skylight.comments.filter((c) => matches(c.cardId)).map((c) => ({ at: c.createdAt, kind: "comment" as const, cardId: c.cardId, summary: c.text })),
    ...ctx.skylight.notes.filter((n) => matches(n.cardId)).map((n) => ({ at: n.createdAt, kind: "note" as const, cardId: n.cardId, summary: n.text })),
  ].sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));

  return okResult("skylight", undefined, entries.slice(0, limit));
}

export function searchBoards(ctx: QueryContext, query: string): QueryResult<{ boardId: string; pseudonym: string }[]> {
  const needle = query.toLowerCase();
  const matches = ctx.skylight.boards.filter((b) => b.pseudonym.toLowerCase().includes(needle));
  return okResult("skylight", undefined, matches.map((b) => ({ boardId: b.id, pseudonym: b.pseudonym })));
}

export function searchCards(ctx: QueryContext, query: string): QueryResult<CardSummary[]> {
  const needle = query.toLowerCase();
  const matches = liveCards(ctx).filter((c) => c.title.toLowerCase().includes(needle));
  return okResult("skylight", undefined, matches.map((c) => toCardSummary(ctx, c)));
}
