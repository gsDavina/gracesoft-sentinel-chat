export const PACKAGE_NAME = "@gracesoft-sentinel/ingest-mysql-pinecone";

export { IngestConfigSchema, IngestSourceSchema, loadIngestConfig } from "./ingest-config.js";
export type { IngestConfig, IngestSource } from "./ingest-config.js";
export { createMysqlClient, describeTables } from "./mysql-client.js";
export type { MysqlClient, TableColumns } from "./mysql-client.js";
export { buildMetadata, recordId, renderText } from "./render.js";
export type { MetadataValue, MysqlRow } from "./render.js";
export { renderSource, syncMysqlToPinecone } from "./sync-mysql-to-pinecone.js";
export type { RenderedDocument, SourceResult, SyncMysqlToPineconeParams } from "./sync-mysql-to-pinecone.js";
