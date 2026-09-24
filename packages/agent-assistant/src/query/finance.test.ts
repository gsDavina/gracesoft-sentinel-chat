import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "./types.js";
import { billableValueForPeriod, hoursForPeriod } from "./time.js";
import { cashPosition, categorySpendForPeriod, financeForPeriod, incomeReceivedForProject, monthlySummary, pendingAndOutstanding } from "./finance.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

function findEntry(entries: { key: string; label: string; amountCents: number }[], label: string) {
  return entries.find((e) => e.label === label);
}

describe("financeForPeriod", () => {
  it("matches hand-calculated income, expenses and net over the full snapshot (posted only)", () => {
    const r = financeForPeriod(ctx, { kind: "explicit", start: "2026-07-10", end: "2026-09-10" });
    expect(r.data).toMatchObject({ incomeCents: 650000, expenseCents: 31000, netCents: 619000 });
  });

  it("breaks down by category, vendor, account and payment method, each summing to net", () => {
    const r = financeForPeriod(ctx, { kind: "explicit", start: "2026-07-10", end: "2026-09-10" });
    const data = r.data!;
    const sum = (entries: { amountCents: number }[]) => entries.reduce((s, e) => s + e.amountCents, 0);
    expect(sum(data.byCategory)).toBe(619000);
    expect(sum(data.byVendor)).toBe(619000);
    expect(sum(data.byAccount)).toBe(619000);
    expect(sum(data.byPaymentMethod)).toBe(619000);

    expect(findEntry(data.byAccount, "Account 1")?.amountCents).toBe(481000);
    expect(findEntry(data.byAccount, "Account 2")?.amountCents).toBe(138000);
    expect(findEntry(data.byVendor, "Vendor 3")?.amountCents).toBe(-12000);
    expect(findEntry(data.byCategory, "Software & SaaS")?.amountCents).toBe(-13000);
  });

  it("excludes billable value from income — the two are always separate fields", () => {
    const r = financeForPeriod(ctx, { kind: "explicit", start: "2026-07-10", end: "2026-09-10" });
    expect(r.data).not.toHaveProperty("billableValueCents");
  });
});

describe("cashPosition", () => {
  it("computes balances as opening balance + posted movements up to the as-of date", () => {
    const r = cashPosition(ctx);
    const byId = Object.fromEntries((r.data ?? []).map((a) => [a.accountId, a.balanceCents]));
    expect(byId["account-1"]).toBe(981000);
    expect(byId["account-2"]).toBe(238000);
  });

  it("computes a balance as of an earlier date, ignoring later movements", () => {
    const r = cashPosition(ctx, "2026-07-31");
    const byId = Object.fromEntries((r.data ?? []).map((a) => [a.accountId, a.balanceCents]));
    expect(byId["account-1"]).toBe(789000);
    expect(byId["account-2"]).toBe(100000);
  });
});

describe("pendingAndOutstanding", () => {
  it("lists the pending and outstanding items", () => {
    const r = pendingAndOutstanding(ctx);
    expect(r.data).toHaveLength(2);
    expect(r.data?.find((i) => i.id === "tx-4")).toMatchObject({ status: "pending", amountCents: 100000 });
    expect(r.data?.find((i) => i.id === "tx-9")).toMatchObject({ status: "outstanding", amountCents: 15000 });
  });
});

describe("categorySpendForPeriod", () => {
  it('counts only the "Software & SaaS" category for August spend', () => {
    const r = categorySpendForPeriod(ctx, { kind: "month", month: "August" }, "category-saas");
    expect(r.data).toMatchObject({ categoryName: "Software & SaaS", totalCents: 8000 });
    expect(findEntry(r.data?.byVendor ?? [], "Vendor 2")?.amountCents).toBe(8000);
  });
});

describe("monthlySummary", () => {
  it("matches the separately computed finance and project figures for August", () => {
    const r = monthlySummary(ctx, "August", (period) => {
      const billableValue = billableValueForPeriod(ctx, period);
      const hours = hoursForPeriod(ctx, period);
      return {
        totalBillableHours: hours.data?.billableHours ?? 0,
        totalBillableValueCents: (billableValue.data ?? []).reduce((sum, p) => sum + p.billableValueCents, 0),
      };
    });
    expect(r.data).toMatchObject({ incomeCents: 350000, expenseCents: 20000, netCents: 330000, totalBillableHours: 16, totalBillableValueCents: 158000 });
  });
});

describe("incomeReceivedForProject", () => {
  it("reports income received for Project 4, separately from billable value", () => {
    const r = incomeReceivedForProject(ctx, "project-4");
    expect(r.data).toMatchObject({ incomeCents: 450000 });
    expect(r.caveats[0]).toMatch(/not billable value/);
  });
});
