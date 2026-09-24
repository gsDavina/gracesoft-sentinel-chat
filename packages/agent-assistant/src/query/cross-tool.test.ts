import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "./types.js";
import { projectHealth, timeVsCompletionCorrelation } from "./cross-tool.js";
import { cardsCompletedInPeriod } from "./skylight.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("projectHealth", () => {
  it('joins Desk "Project 4" with Skylight board "Project 4"', () => {
    const r = projectHealth(ctx, "Project 4");
    expect(r.data?.desk).toMatchObject({ hoursToDate: 27, billableValueToDateCents: 270000, currentStage: "Development" });
    expect(r.data?.skylight).toMatchObject({ openCount: 2, overdueCount: 1, doneCount: 1 });
    expect(r.caveats).toHaveLength(0);
  });

  it("returns Skylight data only, with a caveat, for a board with no matching Desk project", () => {
    const r = projectHealth(ctx, "Project 6");
    expect(r.data?.desk).toBeUndefined();
    expect(r.data?.skylight).toMatchObject({ openCount: 0, overdueCount: 0, doneCount: 1 });
    expect(r.caveats[0]).toMatch(/No Desk project matches/);
  });

  it("returns Desk data only, with a caveat, for a project with no matching Skylight board", () => {
    const r = projectHealth(ctx, "Project 5");
    expect(r.data?.skylight).toBeUndefined();
    expect(r.data?.desk).toMatchObject({ hoursToDate: 0 });
    expect(r.caveats[0]).toMatch(/No Skylight board matches/);
  });

  it("declines to invent a project that doesn't exist in either tool", () => {
    const r = projectHealth(ctx, "Project 99");
    expect(r.data).toBeNull();
    expect(r.caveats[0]).toMatch(/No such project/);
  });
});

describe("timeVsCompletionCorrelation", () => {
  it("always carries the no-automatic-sync caveat", () => {
    const r = timeVsCompletionCorrelation(ctx, "Project 4", { kind: "month", month: "August" }, (period, boardId) => (cardsCompletedInPeriod(ctx, period, { boardId }).data ?? []).length);
    expect(r.data).toMatchObject({ hoursInPeriod: 15, cardsCompletedInPeriod: 1 });
    expect(r.caveats.some((c) => c.includes("don't sync"))).toBe(true);
  });
});
