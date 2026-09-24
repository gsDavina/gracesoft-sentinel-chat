import { SNAPSHOT_END_DATE, SNAPSHOT_START_DATE } from "../types/snapshot.js";

export type PeriodKeyword = "today" | "this_week" | "this_month" | "last_month" | "last_30_days" | "q3";

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export type PeriodInput = { kind: "keyword"; keyword: PeriodKeyword } | { kind: "month"; month: string; year?: number } | { kind: "explicit"; start: string; end: string };

export interface PeriodResolution {
  /** null when the period has no meaningful overlap with the snapshot at all (e.g. "June"). */
  start: string;
  end: string;
  label: string;
  /** True when the period's natural bounds were cut down to fit the snapshot window. */
  clipped: boolean;
  /** True when the period hasn't finished yet as of the as-of date ("this month", "this week", "Q3 so far"). */
  partial: boolean;
  /** True when the period has no overlap with 10 Jul-10 Sep 2026 at all — callers must not report zero, they must say "outside the snapshot". */
  outOfSnapshot: boolean;
}

function toUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function fromUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = toUtcDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

function lastDayOfMonth(year: number, month1based: number): number {
  return new Date(Date.UTC(year, month1based, 0)).getUTCDate();
}

function clampToSnapshot(start: string, end: string): { start: string; end: string; clipped: boolean; outOfSnapshot: boolean } {
  if (end < SNAPSHOT_START_DATE || start > SNAPSHOT_END_DATE) {
    return { start, end, clipped: false, outOfSnapshot: true };
  }
  const clippedStart = start < SNAPSHOT_START_DATE ? SNAPSHOT_START_DATE : start;
  const clippedEnd = end > SNAPSHOT_END_DATE ? SNAPSHOT_END_DATE : end;
  return { start: clippedStart, end: clippedEnd, clipped: clippedStart !== start || clippedEnd !== end, outOfSnapshot: false };
}

function resolveMonth(monthName: string, year: number, asOfDate: string): PeriodResolution {
  const monthIndex = MONTH_NAMES.indexOf(monthName.trim().toLowerCase());
  if (monthIndex === -1) throw new Error(`Unknown month name: ${monthName}`);
  const month1based = monthIndex + 1;
  const naturalStart = `${year}-${String(month1based).padStart(2, "0")}-01`;
  const naturalEnd = `${year}-${String(month1based).padStart(2, "0")}-${String(lastDayOfMonth(year, month1based)).padStart(2, "0")}`;
  const clamped = clampToSnapshot(naturalStart, naturalEnd);
  const isCurrentMonth = asOfDate >= naturalStart && asOfDate <= naturalEnd;
  const end = isCurrentMonth && !clamped.outOfSnapshot ? (asOfDate < clamped.end ? asOfDate : clamped.end) : clamped.end;
  return {
    start: clamped.start,
    end,
    label: `${monthName[0]!.toUpperCase()}${monthName.slice(1).toLowerCase()} ${year}`,
    clipped: clamped.clipped || end !== clamped.end,
    partial: isCurrentMonth && end < naturalEnd,
    outOfSnapshot: clamped.outOfSnapshot,
  };
}

export function resolvePeriod(input: PeriodInput, asOfDate: string): PeriodResolution {
  if (input.kind === "explicit") {
    const outOfSnapshot = input.end < SNAPSHOT_START_DATE || input.start > SNAPSHOT_END_DATE;
    return { start: input.start, end: input.end, label: `${input.start} to ${input.end}`, clipped: false, partial: false, outOfSnapshot };
  }

  if (input.kind === "month") {
    return resolveMonth(input.month, input.year ?? 2026, asOfDate);
  }

  switch (input.keyword) {
    case "today": {
      return { start: asOfDate, end: asOfDate, label: "today", clipped: false, partial: false, outOfSnapshot: asOfDate < SNAPSHOT_START_DATE || asOfDate > SNAPSHOT_END_DATE };
    }
    case "this_week": {
      const date = toUtcDate(asOfDate);
      const dayOfWeek = date.getUTCDay() === 0 ? 7 : date.getUTCDay(); // ISO: Monday=1..Sunday=7
      const naturalStart = addDays(asOfDate, -(dayOfWeek - 1));
      const naturalEnd = addDays(naturalStart, 6);
      const clamped = clampToSnapshot(naturalStart, naturalEnd);
      const end = clamped.outOfSnapshot ? clamped.end : asOfDate < clamped.end ? asOfDate : clamped.end;
      return { start: clamped.start, end, label: "this week", clipped: clamped.clipped, partial: end < naturalEnd && !clamped.outOfSnapshot, outOfSnapshot: clamped.outOfSnapshot };
    }
    case "this_month": {
      const date = toUtcDate(asOfDate);
      return resolveMonth(MONTH_NAMES[date.getUTCMonth()]!, date.getUTCFullYear(), asOfDate);
    }
    case "last_month": {
      const date = toUtcDate(asOfDate);
      const month0based = date.getUTCMonth() - 1;
      const year = month0based < 0 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
      const month = ((month0based % 12) + 12) % 12;
      return resolveMonth(MONTH_NAMES[month]!, year, asOfDate);
    }
    case "last_30_days": {
      const naturalStart = addDays(asOfDate, -29);
      const clamped = clampToSnapshot(naturalStart, asOfDate);
      return { start: clamped.start, end: clamped.end, label: "last 30 days", clipped: clamped.clipped, partial: false, outOfSnapshot: clamped.outOfSnapshot };
    }
    case "q3": {
      const year = toUtcDate(asOfDate).getUTCFullYear();
      const naturalStart = `${year}-07-01`;
      const naturalEnd = `${year}-09-30`;
      const clamped = clampToSnapshot(naturalStart, naturalEnd);
      const isCurrent = asOfDate >= naturalStart && asOfDate <= naturalEnd;
      const end = isCurrent && !clamped.outOfSnapshot ? (asOfDate < clamped.end ? asOfDate : clamped.end) : clamped.end;
      return { start: clamped.start, end, label: "Q3", clipped: clamped.clipped || end !== clamped.end, partial: isCurrent && end < naturalEnd, outOfSnapshot: clamped.outOfSnapshot };
    }
  }
}
