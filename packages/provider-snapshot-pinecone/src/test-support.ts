import type { AIProvider, ChatCompleteInput, ChatCompleteResult, EmbedInput, EmbedResult, TranscribeAudioInput, TranscribeAudioResult, VisionAnalyzeInput, VisionAnalyzeResult } from "@gracesoft-sentinel/core";
import type { PineconeClient, PineconeMatch, PineconeRecord, PineconeUpsertRecord } from "@gracesoft-sentinel/provider-recipe-pinecone";

/** In-memory `PineconeClient` — cosine-similarity search over whatever's been upserted, no real Pinecone/HTTP calls. Same approach as `provider-recipe-pinecone`'s own test double; not imported from there since test doubles aren't shared across the package boundary in this monorepo. */
export class FakePineconeClient implements PineconeClient {
  private readonly records: PineconeUpsertRecord[] = [];
  public queryCalls: { vector: number[]; topK: number }[] = [];

  async upsert(records: PineconeUpsertRecord[]): Promise<void> {
    for (const record of records) {
      const existingIndex = this.records.findIndex((r) => r.id === record.id);
      if (existingIndex >= 0) this.records[existingIndex] = record;
      else this.records.push(record);
    }
  }

  async query(params: { vector: number[]; topK: number }): Promise<{ matches: PineconeMatch[] }> {
    this.queryCalls.push(params);
    const matches = this.records
      .map((record) => ({ record, score: cosineSimilarity(record.values, params.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.topK)
      .map(({ record, score }) => ({ id: record.id, score, metadata: record.metadata }));
    return { matches };
  }

  async listAll(): Promise<PineconeRecord[]> {
    return this.records.map((record) => ({ id: record.id, metadata: record.metadata }));
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** A tiny deterministic "embedding" — a fixed-vocabulary bag-of-words count, good enough for meaningful similarity ranking in tests without a live embeddings API. */
const VOCABULARY = ["project", "hours", "billable", "overdue", "cash", "saas", "vendor", "board", "card", "finance"];

export function fakeEmbed(text: string): number[] {
  const lower = text.toLowerCase();
  return VOCABULARY.map((word) => (lower.includes(word) ? 1 : 0));
}

export class FakeEmbeddingAiProvider implements AIProvider {
  async chatComplete(_input: ChatCompleteInput): Promise<ChatCompleteResult> {
    throw new Error("FakeEmbeddingAiProvider: chatComplete not used by this package");
  }
  async visionAnalyze(_input: VisionAnalyzeInput): Promise<VisionAnalyzeResult> {
    throw new Error("FakeEmbeddingAiProvider: visionAnalyze not used by this package");
  }
  async transcribeAudio(_input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    throw new Error("FakeEmbeddingAiProvider: transcribeAudio not used by this package");
  }
  async embed(input: EmbedInput): Promise<EmbedResult> {
    const inputs = Array.isArray(input.input) ? input.input : [input.input];
    return { vectors: inputs.map(fakeEmbed) };
  }
}
