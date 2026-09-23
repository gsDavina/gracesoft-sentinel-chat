import { parseArgs } from "node:util";
import { OpenAIProvider } from "@gracesoft-sentinel/provider-ai-openai";
import { createPineconeClient } from "@gracesoft-sentinel/provider-recipe-pinecone";
import { loadIngestConfig, type IngestSource } from "./ingest-config.js";
import { createMysqlClient, describeTables, type MysqlClient } from "./mysql-client.js";
import { renderSource, syncMysqlToPinecone } from "./sync-mysql-to-pinecone.js";

/**
 * Out-of-band MySQL→Pinecone ingestion, not invoked by any service.
 *
 *   pnpm --filter @gracesoft-sentinel/ingest-mysql-pinecone run sync -- --inspect
 *   pnpm --filter @gracesoft-sentinel/ingest-mysql-pinecone run sync -- --config configs/desk-skylight.json --dry-run
 *   pnpm --filter @gracesoft-sentinel/ingest-mysql-pinecone run sync -- --config configs/desk-skylight.json [--source skylight-card]
 *
 * Env (read from the package's .env if present): MYSQL_URL (or whatever
 * `connectionEnv` names), plus for a real run PINECONE_API_KEY,
 * PINECONE_INDEX_NAME, OPENAI_API_KEY, and optionally PINECONE_NAMESPACE /
 * OPENAI_EMBEDDING_MODEL. The index's dimension must match the embedding
 * model (1536 for the default text-embedding-3-small).
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // `pnpm run sync -- --flag` forwards the literal "--" too.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      config: { type: "string" },
      source: { type: "string", multiple: true },
      "dry-run": { type: "boolean", default: false },
      inspect: { type: "boolean", default: false },
      /** Which env var --inspect connects with. */
      "connection-env": { type: "string", default: "MYSQL_URL" },
      "sample-size": { type: "string", default: "3" },
    },
  });

  if (values.inspect) {
    const client = await createMysqlClient(requireEnv(values["connection-env"]));
    try {
      for (const { table, columns } of await describeTables(client)) {
        console.log(`${table}: ${columns.map((c) => `${c.name} ${c.type}`).join(", ")}`);
      }
    } finally {
      await client.end();
    }
    return;
  }

  if (!values.config) throw new Error("Pass --config <path to ingest config JSON> (or --inspect to list tables)");
  const config = await loadIngestConfig(values.config);
  const sources = values.source?.length ? config.sources.filter((s) => values.source!.includes(s.name)) : config.sources;
  if (sources.length === 0) throw new Error(`No sources matched ${values.source?.join(", ")}`);

  const clients = new Map<string, MysqlClient>();
  const envFor = (source: IngestSource) => source.connectionEnv ?? config.connectionEnv;
  try {
    for (const source of sources) {
      const env = envFor(source);
      if (!clients.has(env)) clients.set(env, await createMysqlClient(requireEnv(env)));
    }
    const mysqlClientFor = (source: IngestSource) => clients.get(envFor(source))!;

    if (values["dry-run"]) {
      const sampleSize = Number(values["sample-size"]);
      for (const source of sources) {
        const { rows, documents } = await renderSource(source, mysqlClientFor(source));
        console.log(`\n=== ${source.name}: ${documents.length} document(s) from ${rows} row(s) ===`);
        for (const doc of documents.slice(0, sampleSize)) {
          console.log(`\n[${doc.id}]\n${doc.text}\nmetadata: ${JSON.stringify({ ...doc.metadata, text: undefined })}`);
        }
      }
      return;
    }

    const pineconeClient = createPineconeClient({
      apiKey: requireEnv("PINECONE_API_KEY"),
      indexName: requireEnv("PINECONE_INDEX_NAME"),
      namespace: process.env.PINECONE_NAMESPACE ?? config.namespace,
    });
    const aiProvider = new OpenAIProvider({ apiKey: requireEnv("OPENAI_API_KEY"), embeddingModel: process.env.OPENAI_EMBEDDING_MODEL });

    const results = await syncMysqlToPinecone({ sources, mysqlClientFor, aiProvider, pineconeClient, onProgress: console.log });
    const total = results.reduce((sum, r) => sum + r.synced, 0);
    console.log(`Done — ${total} record(s) upserted across ${results.length} source(s).`);
  } finally {
    await Promise.all([...clients.values()].map((c) => c.end()));
  }
}

main().catch((err: unknown) => {
  console.error("Sync failed:", err);
  process.exitCode = 1;
});
