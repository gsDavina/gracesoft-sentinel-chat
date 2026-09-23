import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * One "kind of document" to index: a SELECT that returns one row per
 * document (with whatever JOINs give it enough surrounding context to be
 * understood on its own), plus how to turn each row into embeddable text.
 */
export const IngestSourceSchema = z.object({
  /** Short stable name, e.g. "skylight-card" — prefixes every record id and is stored as `metadata.source`. */
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i, "use letters, digits, '-' or '_' only"),
  sql: z.string().min(1),
  /** Column holding the row's primary key — `${name}:${row[idColumn]}` becomes the Pinecone record id, so re-runs overwrite in place. */
  idColumn: z.string().min(1),
  /**
   * Lines of the document text, with `{{column}}` placeholders. A line whose
   * placeholders are all null/empty is dropped (so "Due: {{due_date}}" just
   * disappears for an undated card, rather than reading "Due: ").
   */
  text: z.array(z.string()).min(1),
  /** Columns copied into Pinecone metadata as-is, for filtering (e.g. by project or date) at query time. */
  metadata: z.array(z.string()).default([]),
  /** Env var holding this source's MySQL connection URL — defaults to the config's own `connectionEnv`. */
  connectionEnv: z.string().optional(),
});
export type IngestSource = z.infer<typeof IngestSourceSchema>;

export const IngestConfigSchema = z
  .object({
    /** Default Pinecone namespace; `PINECONE_NAMESPACE` overrides it. */
    namespace: z.string().optional(),
    connectionEnv: z.string().default("MYSQL_URL"),
    sources: z.array(IngestSourceSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const [i, source] of config.sources.entries()) {
      if (seen.has(source.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sources", i, "name"], message: `duplicate source name "${source.name}"` });
      }
      seen.add(source.name);
    }
  });
export type IngestConfig = z.infer<typeof IngestConfigSchema>;

export async function loadIngestConfig(path: string): Promise<IngestConfig> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return IngestConfigSchema.parse(raw);
}
