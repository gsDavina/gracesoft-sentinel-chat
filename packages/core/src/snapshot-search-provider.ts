import { z } from "zod";

/**
 * Mirrors `recipe-source-provider.ts`'s shape exactly — same "minimal
 * future-facing contract, real implementation lives in its own provider
 * package" pattern, this time for semantic search over a pre-aggregated
 * business-data index (GraceSoft Assistant's Pinecone swap) rather than a
 * personal recipe corpus.
 */
export const SnapshotSearchMatchSchema = z.object({
  id: z.string(),
  text: z.string(),
  score: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SnapshotSearchMatch = z.infer<typeof SnapshotSearchMatchSchema>;

export const SearchSnapshotInputSchema = z.object({
  query: z.string(),
  topK: z.number().int().positive().optional(),
});
export type SearchSnapshotInput = z.infer<typeof SearchSnapshotInputSchema>;

export interface SnapshotSearchProvider {
  search(input: SearchSnapshotInput): Promise<SnapshotSearchMatch[]>;
}
