import { describe, expect, it } from "vitest";
import { minutesToHours, resolveSgtCalendarDate, sumCents } from "./normalize.js";

describe("minutesToHours", () => {
  it("converts 90 minutes to 1.5 hours", () => {
    expect(minutesToHours(90)).toBe(1.5);
  });
});

describe("sumCents", () => {
  it("sums 1,000 small amounts with no floating-point drift", () => {
    const amounts = Array.from({ length: 1000 }, () => 3); // 1,000 x $0.03
    expect(sumCents(amounts)).toBe(3000);
  });
});

describe("resolveSgtCalendarDate", () => {
  it("keeps 23:30 SGT on 31 Aug within August (15:30 UTC)", () => {
    expect(resolveSgtCalendarDate("2026-08-31T15:30:00Z")).toBe("2026-08-31");
  });

  it("rolls 00:30 SGT on 1 Sep into September even though it's still 31 Aug UTC", () => {
    expect(resolveSgtCalendarDate("2026-08-31T16:30:00Z")).toBe("2026-09-01");
  });
});
