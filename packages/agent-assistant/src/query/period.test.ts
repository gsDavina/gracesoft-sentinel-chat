import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./period.js";

const AS_OF = "2026-09-10";

describe("resolvePeriod", () => {
  it('resolves "August" to 1-31 Aug 2026', () => {
    const r = resolvePeriod({ kind: "month", month: "August" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-08-01", end: "2026-08-31", clipped: false, partial: false, outOfSnapshot: false });
  });

  it('resolves "last month" to 1-31 Aug 2026 (as-of 10 Sep)', () => {
    const r = resolvePeriod({ kind: "keyword", keyword: "last_month" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });

  it('resolves "this month" to 1-10 Sep 2026, flagged as partial', () => {
    const r = resolvePeriod({ kind: "keyword", keyword: "this_month" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-09-01", end: "2026-09-10", partial: true });
  });

  it('resolves "last 30 days" to 12 Aug-10 Sep 2026', () => {
    const r = resolvePeriod({ kind: "keyword", keyword: "last_30_days" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-08-12", end: "2026-09-10", clipped: false });
  });

  it('resolves "July" to 10-31 Jul 2026, flagged as clipped (snapshot starts 10 Jul)', () => {
    const r = resolvePeriod({ kind: "month", month: "July" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-07-10", end: "2026-07-31", clipped: true });
  });

  it('resolves "June" and "October" to outside-snapshot, not an empty range', () => {
    const june = resolvePeriod({ kind: "month", month: "June" }, AS_OF);
    const october = resolvePeriod({ kind: "month", month: "October" }, AS_OF);
    expect(june.outOfSnapshot).toBe(true);
    expect(october.outOfSnapshot).toBe(true);
  });

  it('clips "Q3" to 10 Jul-10 Sep and flags it', () => {
    const r = resolvePeriod({ kind: "keyword", keyword: "q3" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-07-10", end: "2026-09-10", clipped: true });
  });

  it("passes explicit ranges through unchanged", () => {
    const r = resolvePeriod({ kind: "explicit", start: "2026-07-15", end: "2026-08-20" }, AS_OF);
    expect(r).toMatchObject({ start: "2026-07-15", end: "2026-08-20", clipped: false, outOfSnapshot: false });
  });

  it("changes relative periods when the as-of date in config changes", () => {
    const r = resolvePeriod({ kind: "keyword", keyword: "last_month" }, "2026-08-20");
    expect(r).toMatchObject({ start: "2026-07-10", end: "2026-07-31" });
  });
});
