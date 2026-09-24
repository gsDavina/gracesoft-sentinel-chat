import type { AIProvider } from "@gracesoft-sentinel/core";
import { runAssistant } from "../orchestrator/orchestrator.js";
import type { QueryContext } from "../query/types.js";
import type { GoldenQuestion } from "./golden-set.js";

export interface GoldenResult {
  id: number;
  question: string;
  category: string;
  pass: boolean;
  answer: string;
  missingFragments: string[];
  forbiddenFragmentsFound: string[];
  latencyMs: number;
  steps: number;
  gracefulFailure: boolean;
}

export interface EvalReport {
  results: GoldenResult[];
  passRate: number;
  passCount: number;
  totalCount: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  passRateByCategory: Record<string, number>;
}

function containsFragment(haystack: string, fragment: string): boolean {
  return haystack.toLowerCase().includes(fragment.toLowerCase());
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx]!;
}

/**
 * Runs every golden question through the real tool-use loop and grades the
 * answer by substring match — zero-tolerance, per M6: a question passes
 * only if every `mustIncludeAll` fragment is present, no `mustNotIncludeAny`
 * fragment leaked in, and the loop didn't have to fall back to a graceful
 * failure message. Needs a real `AIProvider` to be meaningful; a scripted
 * fake proves the grading logic itself (see `eval-runner.test.ts`), not
 * real model behavior.
 */
export async function runGoldenSet(params: { aiProvider: AIProvider; ctx: QueryContext; questions: GoldenQuestion[] }): Promise<EvalReport> {
  const results: GoldenResult[] = [];

  for (const q of params.questions) {
    const startedAt = Date.now();
    const outcome = await runAssistant({ aiProvider: params.aiProvider, ctx: params.ctx, question: q.question, history: q.history });
    const latencyMs = Date.now() - startedAt;

    const missingFragments = q.mustIncludeAll.filter((fragment) => fragment.length > 0 && !containsFragment(outcome.answer, fragment));
    const forbiddenFragmentsFound = (q.mustNotIncludeAny ?? []).filter((fragment) => containsFragment(outcome.answer, fragment));
    const pass = missingFragments.length === 0 && forbiddenFragmentsFound.length === 0 && !outcome.gracefulFailure;

    results.push({
      id: q.id,
      question: q.question,
      category: q.category,
      pass,
      answer: outcome.answer,
      missingFragments,
      forbiddenFragmentsFound,
      latencyMs,
      steps: outcome.steps,
      gracefulFailure: outcome.gracefulFailure,
    });
  }

  const sortedLatencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const passCount = results.filter((r) => r.pass).length;

  const byCategory = new Map<string, { pass: number; total: number }>();
  for (const r of results) {
    const entry = byCategory.get(r.category) ?? { pass: 0, total: 0 };
    entry.total += 1;
    if (r.pass) entry.pass += 1;
    byCategory.set(r.category, entry);
  }
  const passRateByCategory: Record<string, number> = {};
  for (const [category, entry] of byCategory) passRateByCategory[category] = entry.pass / entry.total;

  return {
    results,
    passRate: results.length === 0 ? 0 : passCount / results.length,
    passCount,
    totalCount: results.length,
    medianLatencyMs: percentile(sortedLatencies, 50),
    p95LatencyMs: percentile(sortedLatencies, 95),
    passRateByCategory,
  };
}
