import type { IngestSource } from "./ingest-config.js";

export type MysqlRow = Record<string, unknown>;

/** What Pinecone accepts as a metadata value — anything else is dropped or stringified. */
export type MetadataValue = string | number | boolean | string[];

/**
 * Pinecone caps metadata at 40KB per record; the rendered text is stored
 * there too (so a RAG caller gets the document back from a match without a
 * second lookup), so it's truncated well under that.
 */
const MAX_TEXT_METADATA_CHARS = 8000;

const PLACEHOLDER = /\{\{\s*([^}\s]+)\s*\}\}/g;

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "";
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

/**
 * Renders one row through a source's `text` template. Returns `undefined`
 * when every line dropped out (nothing worth embedding).
 */
export function renderText(source: IngestSource, row: MysqlRow): string | undefined {
  const lines: string[] = [];
  for (const template of source.text) {
    let placeholders = 0;
    let filled = 0;
    const line = template.replace(PLACEHOLDER, (_match, column: string) => {
      placeholders++;
      const value = toText(row[column]);
      if (value) filled++;
      return value;
    });
    if (placeholders > 0 && filled === 0) continue;
    lines.push(line.trimEnd());
  }
  const text = lines.join("\n").trim();
  return text || undefined;
}

function toMetadataValue(value: unknown): MetadataValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toText).filter(Boolean);
  const text = toText(value);
  return text || undefined;
}

export function buildMetadata(source: IngestSource, row: MysqlRow, text: string): Record<string, MetadataValue> {
  const metadata: Record<string, MetadataValue> = {};
  for (const column of source.metadata) {
    const value = toMetadataValue(row[column]);
    if (value !== undefined) metadata[column] = value;
  }
  metadata.source = source.name;
  metadata.text = text.length > MAX_TEXT_METADATA_CHARS ? `${text.slice(0, MAX_TEXT_METADATA_CHARS)}…` : text;
  return metadata;
}

export function recordId(source: IngestSource, row: MysqlRow): string {
  const id = toText(row[source.idColumn]);
  if (!id) throw new Error(`Source "${source.name}": row has no value in idColumn "${source.idColumn}"`);
  return `${source.name}:${id}`;
}
