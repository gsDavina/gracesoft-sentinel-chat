import type { AIProvider } from "@gracesoft-sentinel/core";
import type { PineconeClient, PineconeUpsertRecord } from "@gracesoft-sentinel/provider-recipe-pinecone";
import type { IngestSource } from "./ingest-config.js";
import type { MysqlClient } from "./mysql-client.js";
import { buildMetadata, recordId, renderText, type MetadataValue } from "./render.js";

export interface RenderedDocument {
  id: string;
  text: string;
  metadata: Record<string, MetadataValue>;
}

export interface SourceResult {
  source: string;
  rows: number;
  synced: number;
  /** Rows whose template rendered to nothing, or whose embedding came back empty. */
  skipped: number;
}

export interface SyncMysqlToPineconeParams {
  sources: IngestSource[];
  /** One client per source — lets Desk and Skylight live on different servers/databases. */
  mysqlClientFor: (source: IngestSource) => MysqlClient;
  aiProvider: AIProvider;
  pineconeClient: PineconeClient;
  /** Texts per embeddings call. */
  embedBatchSize?: number;
  /** Records per Pinecone upsert call (Pinecone's own limit is 1000 / 2MB). */
  upsertBatchSize?: number;
  onProgress?: (message: string) => void;
}

const DEFAULT_EMBED_BATCH_SIZE = 64;
const DEFAULT_UPSERT_BATCH_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Runs a source's query and renders every row — no embedding or Pinecone calls, so it also backs `--dry-run`. */
export async function renderSource(source: IngestSource, client: MysqlClient): Promise<{ rows: number; documents: RenderedDocument[] }> {
  const rows = await client.query(source.sql);
  const documents: RenderedDocument[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const text = renderText(source, row);
    if (!text) continue;
    const id = recordId(source, row);
    if (seen.has(id)) throw new Error(`Source "${source.name}": duplicate id ${id} — does the query JOIN fan out rows? Aggregate with GROUP_CONCAT instead.`);
    seen.add(id);
    documents.push({ id, text, metadata: buildMetadata(source, row, text) });
  }
  return { rows: rows.length, documents };
}

/**
 * Generic MySQL → Pinecone ingestion: for each configured source, SELECT its
 * rows, render each to an LLM-readable document, embed, and upsert keyed by
 * `${source}:${id}`. Safe to re-run — an unchanged row overwrites itself.
 * Rows deleted from MySQL are not removed from Pinecone; re-create the
 * namespace for a clean rebuild.
 */
export async function syncMysqlToPinecone(params: SyncMysqlToPineconeParams): Promise<SourceResult[]> {
  const embedBatchSize = params.embedBatchSize ?? DEFAULT_EMBED_BATCH_SIZE;
  const upsertBatchSize = params.upsertBatchSize ?? DEFAULT_UPSERT_BATCH_SIZE;
  const log = params.onProgress ?? (() => {});
  const results: SourceResult[] = [];

  for (const source of params.sources) {
    const { rows, documents } = await renderSource(source, params.mysqlClientFor(source));
    const records: PineconeUpsertRecord[] = [];

    for (const batch of chunk(documents, embedBatchSize)) {
      const { vectors } = await params.aiProvider.embed({ input: batch.map((doc) => doc.text) });
      batch.forEach((doc, i) => {
        const values = vectors[i];
        if (values && values.length > 0) records.push({ id: doc.id, values, metadata: doc.metadata });
      });
    }

    for (const batch of chunk(records, upsertBatchSize)) {
      await params.pineconeClient.upsert(batch);
    }

    const result = { source: source.name, rows, synced: records.length, skipped: rows - records.length };
    log(`${source.name}: ${result.synced} upserted, ${result.skipped} skipped (of ${rows} rows)`);
    results.push(result);
  }

  return results;
}
