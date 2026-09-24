import { beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../loader/snapshot-loader.js";
import { VALID_SNAPSHOT_DIR } from "../loader/test-support.js";
import type { QueryContext } from "../query/types.js";
import { findTool, TOOLS } from "./definitions.js";

let ctx: QueryContext;

beforeAll(() => {
  const snapshot = loadSnapshot(VALID_SNAPSHOT_DIR);
  ctx = { desk: snapshot.desk, skylight: snapshot.skylight, crossTool: snapshot.crossTool, asOfDate: "2026-09-10" };
});

describe("tool catalog", () => {
  it("has a unique name for every tool", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("finds a tool by name", () => {
    expect(findTool("get_hours_for_period")).toBeDefined();
    expect(findTool("no_such_tool")).toBeUndefined();
  });
});

describe("get_hours_for_period", () => {
  const t = findTool("get_hours_for_period")!;

  it("resolves a project pseudonym to real hours", async () => {
    const validated = t.validate({ period: { kind: "month", month: "August" }, projectPseudonym: "Project 4" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;
    const result = await t.run(ctx, validated.data);
    expect(result.data).toMatchObject({ totalHours: 15 });
  });

  it("returns a no-such-project caveat for an unknown pseudonym, rather than a made-up answer", async () => {
    const validated = t.validate({ period: { kind: "month", month: "August" }, projectPseudonym: "Project 99" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;
    const result = await t.run(ctx, validated.data);
    expect(result.data).toBeNull();
    expect(result.caveats[0]).toMatch(/No such project/);
  });

  it("rejects malformed arguments before running", () => {
    const validated = t.validate({ projectPseudonym: "Project 4" }); // missing required `period`
    expect(validated.success).toBe(false);
  });
});

describe("get_project_health", () => {
  it("joins Desk and Skylight data for Project 4", async () => {
    const t = findTool("get_project_health")!;
    const validated = t.validate({ projectPseudonym: "Project 4" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;
    const result = await t.run(ctx, validated.data);
    expect(result.data).toMatchObject({ desk: { currentStage: "Development" }, skylight: { doneCount: 1 } });
  });
});

describe("get_category_spend", () => {
  it("resolves a category name case-insensitively", async () => {
    const t = findTool("get_category_spend")!;
    const validated = t.validate({ period: { kind: "month", month: "August" }, categoryName: "software & saas" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;
    const result = await t.run(ctx, validated.data);
    expect(result.data).toMatchObject({ totalCents: 8000 });
  });
});

describe("list_projects_and_boards", () => {
  it("lists every pseudonym so the model can check existence before answering", async () => {
    const t = findTool("list_projects_and_boards")!;
    const validated = t.validate({});
    expect(validated.success).toBe(true);
    if (!validated.success) return;
    const result = (await t.run(ctx, validated.data)) as { data: { projects: string[]; boards: string[] } };
    expect(result.data.projects).toContain("Project 4");
    expect(result.data.boards).toContain("Project 6");
  });
});
