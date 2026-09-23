import type { AIProvider, ChatCompleteResult, EmbedInput, EmbedResult, TranscribeAudioResult, VisionAnalyzeResult } from "@gracesoft-sentinel/core";
import type { PineconeClient, PineconeMatch, PineconeRecord, PineconeUpsertRecord } from "@gracesoft-sentinel/provider-recipe-pinecone";
import type { MysqlClient } from "./mysql-client.js";
import type { MysqlRow } from "./render.js";

/** Returns canned rows per SQL string — no live MySQL. */
export class FakeMysqlClient implements MysqlClient {
  public queries: string[] = [];
  constructor(private readonly rowsBySql: Record<string, MysqlRow[]>) {}

  async query(sql: string): Promise<MysqlRow[]> {
    this.queries.push(sql);
    const rows = this.rowsBySql[sql];
    if (!rows) throw new Error(`FakeMysqlClient: no rows for ${sql}`);
    return rows;
  }
  async end(): Promise<void> {}
}

/** Records upserts; `query` is unused by this package. */
export class FakePineconeClient implements PineconeClient {
  public upsertCalls: PineconeUpsertRecord[][] = [];

  async upsert(records: PineconeUpsertRecord[]): Promise<void> {
    this.upsertCalls.push(records);
  }
  async query(): Promise<{ matches: PineconeMatch[] }> {
    return { matches: [] };
  }
  async listAll(): Promise<PineconeRecord[]> {
    return this.upsertCalls.flat().map((r) => ({ id: r.id, metadata: r.metadata }));
  }
}

/** Embeds each text as `[length]`, or `[]` for texts containing "EMPTY" (to exercise the skip path). */
export class FakeEmbeddingAiProvider implements AIProvider {
  public embedCalls: string[][] = [];

  async embed(input: EmbedInput): Promise<EmbedResult> {
    const inputs = Array.isArray(input.input) ? input.input : [input.input];
    this.embedCalls.push(inputs);
    return { vectors: inputs.map((text) => (text.includes("EMPTY") ? [] : [text.length])) };
  }
  async chatComplete(): Promise<ChatCompleteResult> {
    throw new Error("FakeEmbeddingAiProvider: chatComplete not used by this package");
  }
  async visionAnalyze(): Promise<VisionAnalyzeResult> {
    throw new Error("FakeEmbeddingAiProvider: visionAnalyze not used by this package");
  }
  async transcribeAudio(): Promise<TranscribeAudioResult> {
    throw new Error("FakeEmbeddingAiProvider: transcribeAudio not used by this package");
  }
}
