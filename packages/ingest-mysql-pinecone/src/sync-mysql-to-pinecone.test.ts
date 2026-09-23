import { describe, expect, it } from "vitest";
import { IngestConfigSchema } from "./ingest-config.js";
import { renderSource, syncMysqlToPinecone } from "./sync-mysql-to-pinecone.js";
import { FakeEmbeddingAiProvider, FakeMysqlClient, FakePineconeClient } from "./test-support.js";

const config = IngestConfigSchema.parse({
  sources: [
    { name: "desk-project", sql: "SELECT projects", idColumn: "id", text: ["Desk project: {{name}}"], metadata: ["name"] },
    { name: "skylight-card", sql: "SELECT cards", idColumn: "id", text: ["Card: {{title}}"], metadata: [] },
  ],
});

describe("syncMysqlToPinecone", () => {
  it("renders, embeds and upserts every source, keyed by source:id", async () => {
    const mysql = new FakeMysqlClient({
      "SELECT projects": [{ id: 1, name: "Project 4" }],
      "SELECT cards": [{ id: 10, title: "Fix login" }, { id: 11, title: "Ship it" }],
    });
    const pinecone = new FakePineconeClient();

    const results = await syncMysqlToPinecone({ sources: config.sources, mysqlClientFor: () => mysql, aiProvider: new FakeEmbeddingAiProvider(), pineconeClient: pinecone });

    expect(results).toEqual([
      { source: "desk-project", rows: 1, synced: 1, skipped: 0 },
      { source: "skylight-card", rows: 2, synced: 2, skipped: 0 },
    ]);
    expect(pinecone.upsertCalls.flat()).toEqual([
      { id: "desk-project:1", values: [23], metadata: { name: "Project 4", source: "desk-project", text: "Desk project: Project 4" } },
      { id: "skylight-card:10", values: [15], metadata: { source: "skylight-card", text: "Card: Fix login" } },
      { id: "skylight-card:11", values: [13], metadata: { source: "skylight-card", text: "Card: Ship it" } },
    ]);
  });

  it("batches embed and upsert calls", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: i, title: `Card ${i}` }));
    const mysql = new FakeMysqlClient({ "SELECT cards": rows });
    const ai = new FakeEmbeddingAiProvider();
    const pinecone = new FakePineconeClient();

    await syncMysqlToPinecone({ sources: [config.sources[1]!], mysqlClientFor: () => mysql, aiProvider: ai, pineconeClient: pinecone, embedBatchSize: 2, upsertBatchSize: 3 });

    expect(ai.embedCalls.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(pinecone.upsertCalls.map((c) => c.length)).toEqual([3, 2]);
  });

  it("counts rows that render empty or get no embedding as skipped, and never upserts an empty batch", async () => {
    const mysql = new FakeMysqlClient({ "SELECT cards": [{ id: 1, title: null }, { id: 2, title: "EMPTY" }] });
    const pinecone = new FakePineconeClient();

    const [result] = await syncMysqlToPinecone({ sources: [config.sources[1]!], mysqlClientFor: () => mysql, aiProvider: new FakeEmbeddingAiProvider(), pineconeClient: pinecone });

    expect(result).toEqual({ source: "skylight-card", rows: 2, synced: 0, skipped: 2 });
    expect(pinecone.upsertCalls).toHaveLength(0);
  });

  it("uses the per-source MySQL client", async () => {
    const desk = new FakeMysqlClient({ "SELECT projects": [{ id: 1, name: "Project 4" }] });
    const skylight = new FakeMysqlClient({ "SELECT cards": [] });

    await syncMysqlToPinecone({
      sources: config.sources,
      mysqlClientFor: (source) => (source.name.startsWith("desk") ? desk : skylight),
      aiProvider: new FakeEmbeddingAiProvider(),
      pineconeClient: new FakePineconeClient(),
    });

    expect(desk.queries).toEqual(["SELECT projects"]);
    expect(skylight.queries).toEqual(["SELECT cards"]);
  });
});

describe("renderSource", () => {
  it("rejects duplicate ids, which usually means a JOIN fanned out rows", async () => {
    const mysql = new FakeMysqlClient({ "SELECT cards": [{ id: 1, title: "A" }, { id: 1, title: "B" }] });
    await expect(renderSource(config.sources[1]!, mysql)).rejects.toThrow(/duplicate id skylight-card:1/);
  });
});

describe("IngestConfigSchema", () => {
  it("rejects duplicate source names", () => {
    const source = { name: "a", sql: "SELECT 1", idColumn: "id", text: ["{{x}}"] };
    expect(() => IngestConfigSchema.parse({ sources: [source, source] })).toThrow(/duplicate source name/);
  });

  it("defaults connectionEnv to MYSQL_URL", () => {
    expect(config.connectionEnv).toBe("MYSQL_URL");
  });
});
