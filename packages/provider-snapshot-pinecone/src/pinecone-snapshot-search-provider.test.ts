import { describe, expect, it } from "vitest";
import { PineconeSnapshotSearchProvider } from "./pinecone-snapshot-search-provider.js";
import { FakeEmbeddingAiProvider, FakePineconeClient, fakeEmbed } from "./test-support.js";

async function seed(client: FakePineconeClient, docs: { id: string; text: string; metadata?: Record<string, unknown> }[]) {
  await client.upsert(docs.map((doc) => ({ id: doc.id, values: fakeEmbed(doc.text), metadata: { ...doc.metadata, text: doc.text } })));
}

describe("PineconeSnapshotSearchProvider", () => {
  it("embeds the query and returns the closest-matching indexed document", async () => {
    const client = new FakePineconeClient();
    await seed(client, [
      { id: "desk-project:4", text: "Project 4: 27 hours logged, billable value $2700." },
      { id: "skylight-board:6", text: "Board 6: 1 card, 1 completed." },
    ]);

    const provider = new PineconeSnapshotSearchProvider({ client, aiProvider: new FakeEmbeddingAiProvider() });
    const results = await provider.search({ query: "project hours billable" });

    expect(results[0]!.id).toBe("desk-project:4");
    expect(results[0]!.text).toContain("27 hours logged");
  });

  it("returns an empty array when the index has no matches", async () => {
    const provider = new PineconeSnapshotSearchProvider({ client: new FakePineconeClient(), aiProvider: new FakeEmbeddingAiProvider() });
    expect(await provider.search({ query: "anything" })).toEqual([]);
  });

  it("respects a per-call topK over the configured default", async () => {
    const client = new FakePineconeClient();
    await seed(client, [
      { id: "1", text: "project hours billable" },
      { id: "2", text: "project overdue card" },
      { id: "3", text: "vendor saas finance" },
    ]);
    const provider = new PineconeSnapshotSearchProvider({ client, aiProvider: new FakeEmbeddingAiProvider(), topK: 5 });

    const results = await provider.search({ query: "project", topK: 1 });
    expect(results).toHaveLength(1);
    expect(client.queryCalls[0]).toMatchObject({ topK: 1 });
  });

  it("skips a match whose metadata has no text field, rather than throwing", async () => {
    const client = new FakePineconeClient();
    await client.upsert([{ id: "no-text", values: fakeEmbed("project"), metadata: { source: "desk-project" } }]);
    const provider = new PineconeSnapshotSearchProvider({ client, aiProvider: new FakeEmbeddingAiProvider() });
    expect(await provider.search({ query: "project" })).toEqual([]);
  });

  it("passes each match's full metadata through, not just the text field", async () => {
    const client = new FakePineconeClient();
    await seed(client, [{ id: "1", text: "project hours", metadata: { source: "desk-project", code: "P4" } }]);
    const provider = new PineconeSnapshotSearchProvider({ client, aiProvider: new FakeEmbeddingAiProvider() });
    const results = await provider.search({ query: "project" });
    expect(results[0]!.metadata).toMatchObject({ source: "desk-project", code: "P4" });
  });
});
