import { describe, expect, it } from "vitest";
import type { SearchSnapshotInput, SnapshotSearchMatch, SnapshotSearchProvider } from "@gracesoft-sentinel/core";
import { buildSearchTools } from "./search-tools.js";

class FakeSearchProvider implements SnapshotSearchProvider {
  public calls: SearchSnapshotInput[] = [];
  constructor(private readonly results: SnapshotSearchMatch[]) {}
  async search(input: SearchSnapshotInput): Promise<SnapshotSearchMatch[]> {
    this.calls.push(input);
    return this.results;
  }
}

describe("buildSearchTools", () => {
  it("builds exactly one tool, search_snapshot", () => {
    const tools = buildSearchTools(new FakeSearchProvider([]));
    expect(tools.map((t) => t.name)).toEqual(["search_snapshot"]);
  });

  it("validates required arguments", () => {
    const tools = buildSearchTools(new FakeSearchProvider([]));
    expect(tools[0]!.validate({}).success).toBe(false);
    expect(tools[0]!.validate({ query: "overdue cards" }).success).toBe(true);
  });

  it("forwards the query and topK to the provider and shapes the results", async () => {
    const provider = new FakeSearchProvider([{ id: "desk-project:4", text: "Project 4: 27 hours logged.", score: 0.91, metadata: { source: "desk-project" } }]);
    const tools = buildSearchTools(provider);
    const validated = tools[0]!.validate({ query: "project 4 hours", topK: 3 });
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const result = await tools[0]!.run({} as never, validated.data);
    expect(provider.calls).toEqual([{ query: "project 4 hours", topK: 3 }]);
    expect(result.data).toEqual([{ text: "Project 4: 27 hours logged.", score: 0.91, source: "desk-project" }]);
    expect(result.caveats).toEqual([]);
  });

  it("adds a caveat, not an error, when nothing matches", async () => {
    const tools = buildSearchTools(new FakeSearchProvider([]));
    const validated = tools[0]!.validate({ query: "something obscure" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const result = await tools[0]!.run({} as never, validated.data);
    expect(result.data).toEqual([]);
    expect(result.caveats[0]).toMatch(/No matching snapshot data/);
  });

  it("falls back to the match id as the source when metadata has no source field", async () => {
    const provider = new FakeSearchProvider([{ id: "desk-project:4", text: "Project 4 summary." }]);
    const tools = buildSearchTools(provider);
    const validated = tools[0]!.validate({ query: "project 4" });
    expect(validated.success).toBe(true);
    if (!validated.success) return;

    const result = (await tools[0]!.run({} as never, validated.data)) as { data: { source: string }[] };
    expect(result.data[0]!.source).toBe("desk-project:4");
  });
});
