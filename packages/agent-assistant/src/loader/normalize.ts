import { SNAPSHOT_TIMEZONE } from "../types/snapshot.js";

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

export function sumCents(amounts: number[]): number {
  // Plain integer addition — cents are already whole numbers, so this
  // never touches floating-point division/multiplication and can't drift.
  return amounts.reduce((total, cents) => total + cents, 0);
}

/**
 * Resolves a UTC instant to its Asia/Singapore calendar date (SGT is
 * UTC+8, no DST), matching the "day boundaries use SGT" rule: an entry
 * logged at 23:30 SGT on 31 Aug is 15:30 UTC, still 31 Aug; one at 00:30
 * SGT on 1 Sep is 16:30 UTC the day before, and must resolve to 1 Sep.
 */
export function resolveSgtCalendarDate(utcIso: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SNAPSHOT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(utcIso));
}
