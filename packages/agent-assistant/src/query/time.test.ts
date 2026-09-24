import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "./types.js";
import {
  billableValueForPeriod,
  commitVsManualForPeriod,
  currentStage,
  hoursForPeriod,
  projectSummary,
  projectWithMostTimeInPeriod,
  stageBreakdown,
} from "./time.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("hoursForPeriod", () => {
  it("matches hand-calculated total/billable/non-billable hours for August", () => {
    const r = hoursForPeriod(ctx, { kind: "month", month: "August" });
    expect(r.data).toMatchObject({ totalHours: 16, billableHours: 16, nonBillableHours: 0 });
  });

  it("splits billable and non-billable hours for Project 3's full history", () => {
    const r = hoursForPeriod(ctx, { kind: "explicit", start: "2026-07-10", end: "2026-09-10" }, { projectId: "project-3" });
    expect(r.data).toMatchObject({ totalHours: 7, billableHours: 5, nonBillableHours: 2 });
  });

  it("returns zero hours with a no-entries note for a project with nothing in the period, not an error", () => {
    const r = hoursForPeriod(ctx, { kind: "keyword", keyword: "this_month" }, { projectId: "project-3" });
    expect(r.data).toMatchObject({ totalHours: 0, billableHours: 0, nonBillableHours: 0, byProject: [] });
    expect(r.outOfSnapshot).toBe(false);
  });

  it('says "outside the snapshot" for June, not zero', () => {
    const r = hoursForPeriod(ctx, { kind: "month", month: "June" });
    expect(r.outOfSnapshot).toBe(true);
    expect(r.data).toBeNull();
  });
});

describe("billableValueForPeriod", () => {
  it("matches hand-calculated billable value by project for July (clipped from 10 Jul)", () => {
    const r = billableValueForPeriod(ctx, { kind: "month", month: "July" });
    const byProject = Object.fromEntries((r.data ?? []).map((p) => [p.projectPseudonym, p]));
    expect(byProject["Project 1"]).toMatchObject({ billableHours: 6, billableValueCents: 48000 });
    expect(byProject["Project 2"]).toMatchObject({ billableHours: 3, billableValueCents: 18000 });
    expect(byProject["Project 3"]).toMatchObject({ billableHours: 5, billableValueCents: 35000 });
    expect(byProject["Project 4"]).toMatchObject({ billableHours: 8, billableValueCents: 80000 });
    expect(r.dateRange).toMatchObject({ clipped: true });
  });
});

describe("stageBreakdown", () => {
  it("adds up to the project total and returns SDLC order for Project 4", () => {
    const r = stageBreakdown(ctx, "project-4");
    expect(r.data?.map((s) => s.stage)).toEqual(["Discovery", "Design", "Development", "Testing"]);
    const total = (r.data ?? []).reduce((sum, s) => sum + s.hours, 0);
    expect(total).toBe(27);
    expect(r.data).toEqual([
      { stage: "Discovery", hours: 4, billableValueCents: 40000 },
      { stage: "Design", hours: 3, billableValueCents: 30000 },
      { stage: "Development", hours: 16, billableValueCents: 160000 },
      { stage: "Testing", hours: 4, billableValueCents: 40000 },
    ]);
  });

  it("reports a Maintenance project that also logged Development time correctly", () => {
    const r = stageBreakdown(ctx, "project-1");
    expect(r.data).toEqual([
      { stage: "Development", hours: 6, billableValueCents: 48000 },
      { stage: "Maintenance", hours: 1, billableValueCents: 8000 },
    ]);
  });
});

describe("currentStage", () => {
  it("returns Development for Project 4, which went back from Testing to Development", () => {
    const r = currentStage(ctx, "project-4");
    expect(r.data).toMatchObject({ stage: "Development", asOfEntryDate: "2026-08-20" });
  });

  it("returns Maintenance for Project 1 (its most recent entry)", () => {
    const r = currentStage(ctx, "project-1");
    expect(r.data?.stage).toBe("Maintenance");
  });

  it("returns a no-such-project caveat for an unknown pseudonym", () => {
    const r = currentStage(ctx, "project-99");
    expect(r.data).toBeNull();
    expect(r.caveats[0]).toMatch(/No such project/);
  });
});

describe("commitVsManualForPeriod", () => {
  it("finds commit-derived hours only within 1-3 Aug 2026 for Project 4 in August", () => {
    const r = commitVsManualForPeriod(ctx, { kind: "month", month: "August" }, { projectId: "project-4" });
    expect(r.data).toMatchObject({ commitHours: 6, manualHours: 9 });
  });
});

describe("projectSummary", () => {
  it("summarizes Project 4 with hours, billable value, stage and last activity", () => {
    const r = projectSummary(ctx, "project-4");
    expect(r.data).toMatchObject({ hoursToDate: 27, billableValueToDateCents: 270000, currentStage: "Development", lastActivityDate: "2026-08-20" });
  });

  it("summarizes a project with no time entries without erroring", () => {
    const r = projectSummary(ctx, "project-5");
    expect(r.data).toMatchObject({ hoursToDate: 0, currentStage: null });
    expect(r.caveats[0]).toMatch(/no time entries/);
  });
});

describe("projectWithMostTimeInPeriod", () => {
  it("finds Project 4 for the last 30 days (12 Aug-10 Sep)", () => {
    const r = projectWithMostTimeInPeriod(ctx, { kind: "keyword", keyword: "last_30_days" });
    expect(r.data).toMatchObject({ projectPseudonym: "Project 4", totalHours: 5 });
  });
});
