import type { QueryContext } from "../query/types.js";
import { cashPosition, categorySpendForPeriod, pendingAndOutstanding } from "../query/finance.js";
import { hoursForPeriod, currentStage } from "../query/time.js";
import { cardsDueOn, overdueCards } from "../query/skylight.js";
import { projectHealth } from "../query/cross-tool.js";

export interface FallbackAnswer {
  /** Matched against the incoming question after `normalize()` — exact match only, since this only ever needs to cover the fixed demo-script questions, not general paraphrasing. */
  normalizedQuestion: string;
  text: string;
}

const CACHED_LABEL = "[cached demo answer — the live model is unavailable right now]";

function normalize(question: string): string {
  return question.trim().toLowerCase().replace(/[?.!]+$/, "");
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Pre-computed answers for exactly the M7 demo script's questions
 * (`08-assistant-demo-script.md`), for when the live model is down mid-
 * demo. Deliberately not LLM-authored — every figure comes straight from
 * the query layer, same as the golden set, so there's nothing here that
 * can hallucinate or go stale independently of the fixture.
 */
export function buildDemoFallbackAnswers(ctx: QueryContext): FallbackAnswer[] {
  const answers: FallbackAnswer[] = [];
  const add = (question: string, text: string) => answers.push({ normalizedQuestion: normalize(question), text: `${text} ${CACHED_LABEL}` });

  const overdue = overdueCards(ctx).data ?? [];
  add(
    "What's overdue?",
    overdue.length > 0
      ? `${overdue.length} card${overdue.length === 1 ? " is" : "s are"} overdue: ${overdue.map((c) => `"${c.title}" on ${c.boardPseudonym}`).join(", ")}.`
      : "Nothing is overdue."
  );

  const dueToday = cardsDueOn(ctx, ctx.asOfDate).data ?? [];
  add(
    "What's due today?",
    dueToday.length > 0 ? `Due today (${ctx.asOfDate}): ${dueToday.map((c) => `"${c.title}" on ${c.boardPseudonym}`).join(", ")}.` : `Nothing is due today (${ctx.asOfDate}).`
  );

  const augustHours = hoursForPeriod(ctx, { kind: "month", month: "August" }).data;
  add("How many billable hours did I log in August?", `You logged ${augustHours?.billableHours ?? 0} billable hours in August (${augustHours?.totalHours ?? 0} total).`);

  const stage4 = currentStage(ctx, "project-4").data;
  add("Which stage is Project 4 in?", `Project 4 is in ${stage4?.stage ?? "an unknown stage"} — based on its most recent time entry (${stage4?.asOfEntryDate ?? "unknown date"}).`);

  const balances = cashPosition(ctx).data ?? [];
  add(
    "What's my cash position now?",
    `As of ${ctx.asOfDate}: ${balances.map((b) => `${b.accountPseudonym} ${formatDollars(b.balanceCents)}`).join(", ")}.`
  );

  const saas = categorySpendForPeriod(ctx, { kind: "month", month: "August" }, "category-saas").data;
  add(
    "What did I spend on SaaS last month?",
    `You spent ${formatDollars(saas?.totalCents ?? 0)} on Software & SaaS in August${saas?.byVendor.length ? `, mostly with ${saas.byVendor.map((v) => v.label).join(", ")}` : ""}.`
  );

  const health4 = projectHealth(ctx, "Project 4").data;
  add(
    "How is Project 4 performing?",
    `Project 4: ${health4?.desk?.hoursToDate ?? 0} hours logged, ${formatDollars(health4?.desk?.billableValueToDateCents ?? 0)} billable value, currently in ${health4?.desk?.currentStage ?? "an unknown stage"}. On Skylight: ${health4?.skylight?.openCount ?? 0} open, ${health4?.skylight?.overdueCount ?? 0} overdue, ${health4?.skylight?.doneCount ?? 0} done.`
  );

  const pending = pendingAndOutstanding(ctx).data ?? [];
  add(
    "Is anything pending or outstanding?",
    pending.length > 0 ? `${pending.length} item${pending.length === 1 ? "" : "s"}: ${pending.map((p) => `${p.status} ${formatDollars(p.amountCents)} (${p.date})`).join(", ")}.` : "Nothing pending or outstanding."
  );

  add("How many hours did I log in June?", "June isn't in the snapshot — it only covers 10 Jul 2026 to 10 Sep 2026, so there's no data for June.");

  add("Who is User 1?", "\"User 1\" is a redacted pseudonym — the real name behind it isn't in the snapshot, and I won't guess at it.");

  return answers;
}

export function findFallbackAnswer(answers: FallbackAnswer[], question: string): string | undefined {
  const needle = normalize(question);
  return answers.find((a) => a.normalizedQuestion === needle)?.text;
}
