import type { Transaction } from "../types/desk.js";
import { resolvePeriod, type PeriodInput } from "./period.js";
import { okResult, outOfSnapshotResult, type QueryContext, type QueryResult } from "./types.js";

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** Only settled money counts toward income/expense/net and account balances — pending and outstanding items are surfaced separately, never folded into a total that implies they've cleared. */
function isPosted(t: Transaction): boolean {
  return t.status === "posted";
}

function signedAmount(t: Transaction): number {
  return t.type === "income" ? t.amountCents : -t.amountCents;
}

export interface BreakdownEntry {
  key: string;
  label: string;
  amountCents: number;
}

function groupBy(transactions: Transaction[], keyOf: (t: Transaction) => { key: string; label: string } | undefined, fallback: { key: string; label: string }): BreakdownEntry[] {
  const totals = new Map<string, BreakdownEntry>();
  for (const t of transactions) {
    const { key, label } = keyOf(t) ?? fallback;
    const existing = totals.get(key);
    if (existing) existing.amountCents += signedAmount(t);
    else totals.set(key, { key, label, amountCents: signedAmount(t) });
  }
  return [...totals.values()];
}

export interface FinanceForPeriodResult {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  byCategory: BreakdownEntry[];
  byVendor: BreakdownEntry[];
  byAccount: BreakdownEntry[];
  byPaymentMethod: BreakdownEntry[];
}

/** Income, expenses and net for a period, broken down by category/vendor/account/payment method. Posted transactions only. */
export function financeForPeriod(ctx: QueryContext, period: PeriodInput): QueryResult<FinanceForPeriodResult> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("desk", resolved);

  const transactions = ctx.desk.transactions.filter((t) => inRange(t.date, resolved.start, resolved.end) && isPosted(t));
  const incomeCents = transactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amountCents, 0);
  const expenseCents = transactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amountCents, 0);

  const categoryById = new Map(ctx.desk.categories.map((c) => [c.id, c.name]));
  const vendorById = new Map(ctx.desk.vendors.map((v) => [v.id, v.pseudonym]));
  const accountById = new Map(ctx.desk.accounts.map((a) => [a.id, a.pseudonym]));
  const methodById = new Map(ctx.desk.paymentMethods.map((m) => [m.id, m.pseudonym]));

  return okResult("desk", resolved, {
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    byCategory: groupBy(transactions, (t) => ({ key: t.categoryId, label: categoryById.get(t.categoryId) ?? t.categoryId }), { key: "unknown", label: "Unknown category" }),
    byVendor: groupBy(transactions, (t) => (t.vendorId ? { key: t.vendorId, label: vendorById.get(t.vendorId) ?? t.vendorId } : undefined), { key: "none", label: "No vendor" }),
    byAccount: groupBy(transactions, (t) => ({ key: t.accountId, label: accountById.get(t.accountId) ?? t.accountId }), { key: "unknown", label: "Unknown account" }),
    byPaymentMethod: groupBy(transactions, (t) => ({ key: t.paymentMethodId, label: methodById.get(t.paymentMethodId) ?? t.paymentMethodId }), { key: "unknown", label: "Unknown payment method" }),
  });
}

export interface AccountBalance {
  accountId: string;
  accountPseudonym: string;
  balanceCents: number;
}

/** Account balance as of a date = opening balance + posted movements up to (and including) that date. */
export function cashPosition(ctx: QueryContext, asOfDate?: string): QueryResult<AccountBalance[]> {
  const cutoff = asOfDate ?? ctx.asOfDate;
  const balances = ctx.desk.accounts.map((account) => {
    const movements = ctx.desk.transactions.filter((t) => t.accountId === account.id && isPosted(t) && t.date <= cutoff);
    const balanceCents = account.openingBalanceCents + movements.reduce((sum, t) => sum + signedAmount(t), 0);
    return { accountId: account.id, accountPseudonym: account.pseudonym, balanceCents };
  });
  return okResult("desk", undefined, balances);
}

export interface PendingOrOutstandingItem {
  id: string;
  date: string;
  type: Transaction["type"];
  status: Transaction["status"];
  amountCents: number;
}

/** Pending and outstanding items — not yet settled, so excluded from income/expense/net and account balances. */
export function pendingAndOutstanding(ctx: QueryContext): QueryResult<PendingOrOutstandingItem[]> {
  const items = ctx.desk.transactions.filter((t) => t.status !== "posted").map((t) => ({ id: t.id, date: t.date, type: t.type, status: t.status, amountCents: t.amountCents }));
  return okResult("desk", undefined, items);
}

export interface MonthlySummaryResult extends FinanceForPeriodResult {
  totalBillableHours: number;
  totalBillableValueCents: number;
}

/** Mirrors Desk's own Monthly Summary report: finance for the month plus the same month's billable hours/value. */
export function monthlySummary(ctx: QueryContext, monthName: string, computeBillable: (period: PeriodInput) => { totalBillableHours: number; totalBillableValueCents: number }): QueryResult<MonthlySummaryResult> {
  const period: PeriodInput = { kind: "month", month: monthName };
  const finance = financeForPeriod(ctx, period);
  if (finance.outOfSnapshot || !finance.data) return finance as unknown as QueryResult<MonthlySummaryResult>;

  const billable = computeBillable(period);
  return okResult("desk", resolvePeriod(period, ctx.asOfDate), { ...finance.data, ...billable });
}

export interface CategorySpendResult {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  byVendor: BreakdownEntry[];
}

/** Spend for one category over a period, e.g. "What did I spend on SaaS last month?" — counts only that category. */
export function categorySpendForPeriod(ctx: QueryContext, period: PeriodInput, categoryId: string): QueryResult<CategorySpendResult> {
  const resolved = resolvePeriod(period, ctx.asOfDate);
  if (resolved.outOfSnapshot) return outOfSnapshotResult("desk", resolved);

  const category = ctx.desk.categories.find((c) => c.id === categoryId);
  const transactions = ctx.desk.transactions.filter((t) => inRange(t.date, resolved.start, resolved.end) && isPosted(t) && t.categoryId === categoryId && t.type === "expense");
  const vendorById = new Map(ctx.desk.vendors.map((v) => [v.id, v.pseudonym]));

  return okResult("desk", resolved, {
    categoryId,
    categoryName: category?.name ?? categoryId,
    totalCents: transactions.reduce((sum, t) => sum + t.amountCents, 0),
    byVendor: groupBy(transactions, (t) => (t.vendorId ? { key: t.vendorId, label: vendorById.get(t.vendorId) ?? t.vendorId } : undefined), { key: "none", label: "No vendor" }).map((e) => ({
      ...e,
      amountCents: Math.abs(e.amountCents),
    })),
  });
}

/** How much income a project has actually received — distinct from billable value, never described as the same thing. */
export function incomeReceivedForProject(ctx: QueryContext, projectId: string): QueryResult<{ incomeCents: number }> {
  const incomeCents = ctx.desk.transactions.filter((t) => t.projectId === projectId && t.type === "income" && isPosted(t)).reduce((sum, t) => sum + t.amountCents, 0);
  return okResult("desk", undefined, { incomeCents }, ["This is income actually received, not billable value — the two are tracked separately."]);
}
