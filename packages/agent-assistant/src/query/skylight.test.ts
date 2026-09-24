import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "./types.js";
import { cardsCompletedInPeriod, cardsDueOn, checklistProgress, overdueCards, recentActivity, searchBoards, searchCards } from "./skylight.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("overdueCards", () => {
  it("returns cards past due, not in Done, excluding a Done card with a past due date and a card due exactly today", () => {
    const r = overdueCards(ctx);
    const ids = (r.data ?? []).map((c) => c.cardId).sort();
    expect(ids).toEqual(["card-b3-1", "card-b4-1"]);
  });
});

describe("cardsDueOn", () => {
  it('treats a card due on the as-of date as "due today", not overdue', () => {
    const r = cardsDueOn(ctx, "2026-09-10");
    expect((r.data ?? []).map((c) => c.cardId)).toEqual(["card-b2-1"]);
  });
});

describe("checklistProgress", () => {
  it('reports "3 of 5" done with the two remaining items named', () => {
    const r = checklistProgress(ctx, "card-b4-1");
    expect(r.data).toEqual([{ checklistId: "checklist-1", name: "Checklist 1", done: 3, total: 5, remaining: ["Item 4", "Item 5"] }]);
  });
});

describe("cardsCompletedInPeriod", () => {
  it("counts a card moved into Done in August and left there", () => {
    const r = cardsCompletedInPeriod(ctx, { kind: "month", month: "August" }, { boardId: "board-4" });
    expect((r.data ?? []).map((c) => c.cardId)).toEqual(["card-b4-2"]);
  });

  it("excludes a card moved into Done and then back out within the same period", () => {
    const r = cardsCompletedInPeriod(ctx, { kind: "month", month: "August" }, { boardId: "board-4" });
    expect((r.data ?? []).map((c) => c.cardId)).not.toContain("card-b4-3");
  });

  it("counts completions across boards when no board filter is given", () => {
    const r = cardsCompletedInPeriod(ctx, { kind: "month", month: "August" });
    const ids = (r.data ?? []).map((c) => c.cardId).sort();
    expect(ids).toEqual(["card-b1-2", "card-b4-2"]);
  });
});

describe("recentActivity", () => {
  it("includes a deleted card's activity history even though it's gone from current-state queries", () => {
    const r = recentActivity(ctx, { boardId: "board-4" }, 20);
    expect((r.data ?? []).some((e) => e.cardId === "card-b4-4")).toBe(true);
  });

  it("includes comments alongside activity-log entries", () => {
    const r = recentActivity(ctx, { boardId: "board-4" }, 20);
    expect((r.data ?? []).some((e) => e.kind === "comment" && e.cardId === "card-b4-1")).toBe(true);
  });
});

describe("search", () => {
  it("finds boards case-insensitively by partial match", () => {
    const r = searchBoards(ctx, "project 4");
    expect((r.data ?? []).map((b) => b.pseudonym)).toEqual(["Project 4"]);
  });

  it("finds cards case-insensitively by partial match, excluding deleted cards", () => {
    const r = searchCards(ctx, "CARD 9");
    expect((r.data ?? []).map((c) => c.cardId)).toEqual(["card-b4-3"]);
  });
});
