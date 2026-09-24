import type { AIProvider, SearchSnapshotInput, SnapshotSearchMatch, SnapshotSearchProvider } from "@gracesoft-sentinel/core";
import type { PineconeClient } from "@gracesoft-sentinel/provider-recipe-pinecone";

const DEFAULT_TOP_K = 5;

export interface PineconeSnapshotSearchProviderConfig {
  client: PineconeClient;
  aiProvider: AIProvider;
  /** Default `topK` when a search doesn't specify its own — defaults to 5. */
  topK?: number;
}

/**
 * `SnapshotSearchProvider` backed by a Pinecone index populated by
 * `ingest-mysql-pinecone`'s `syncMysqlToPinecone` job (out-of-band, not run
 * by this package) — same "pure query-time retrieval, ingestion is a
 * separate concern" split as `PineconeRecipeProvider`. Every match's
 * `metadata.text` is the pre-rendered, pre-aggregated document
 * `ingest-mysql-pinecone` wrote (its SQL already computes hours, billable
 * value, overdue flags, stage breakdowns, etc.) — this class only ever
 * embeds a query and asks Pinecone for the nearest vectors, never
 * recomputes anything from raw rows.
 */
export class PineconeSnapshotSearchProvider implements SnapshotSearchProvider {
  constructor(private readonly config: PineconeSnapshotSearchProviderConfig) {}

  async search(input: SearchSnapshotInput): Promise<SnapshotSearchMatch[]> {
    const { vectors } = await this.config.aiProvider.embed({ input: input.query });
    const queryVector = vectors[0];
    if (!queryVector) return [];

    const { matches } = await this.config.client.query({ vector: queryVector, topK: input.topK ?? this.config.topK ?? DEFAULT_TOP_K });

    const results: SnapshotSearchMatch[] = [];
    for (const match of matches) {
      const text = match.metadata?.text;
      if (typeof text !== "string" || !text) continue;
      results.push({ id: match.id, text, score: match.score, metadata: match.metadata });
    }
    return results;
  }
}
