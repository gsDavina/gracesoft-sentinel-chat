import { describe, expect, it } from "vitest";
import { IngestSourceSchema } from "./ingest-config.js";
import { buildMetadata, recordId, renderText } from "./render.js";

const source = IngestSourceSchema.parse({
  name: "skylight-card",
  sql: "SELECT ...",
  idColumn: "id",
  text: ["Skylight card: {{title}}", "Board: {{board}} / Column: {{column_name}}", "Due: {{due_date}}", "Labels: {{labels}}"],
  metadata: ["board", "due_date", "estimate", "done"],
});

describe("renderText", () => {
  it("fills placeholders line by line", () => {
    const text = renderText(source, { id: 7, title: "Fix login", board: "Project 4", column_name: "Doing", due_date: "2026-08-12", labels: "bug" });
    expect(text).toBe("Skylight card: Fix login\nBoard: Project 4 / Column: Doing\nDue: 2026-08-12\nLabels: bug");
  });

  it("drops a line whose placeholders are all empty, but keeps one that is partly filled", () => {
    const text = renderText(source, { id: 7, title: "Fix login", board: "Project 4", column_name: null, due_date: null, labels: "" });
    expect(text).toBe("Skylight card: Fix login\nBoard: Project 4 / Column:");
  });

  it("returns undefined when nothing renders", () => {
    expect(renderText(source, { id: 7 })).toBeUndefined();
  });

  it("keeps literal lines with no placeholders", () => {
    const withHeader = { ...source, text: ["Source: Skylight", "{{title}}"] };
    expect(renderText(withHeader, { title: "" })).toBe("Source: Skylight");
  });
});

describe("buildMetadata", () => {
  it("copies listed columns, omits nulls, drops unsupported values, and adds source/text", () => {
    const metadata = buildMetadata(source, { board: "Project 4", due_date: null, estimate: 3, done: false, secret: "not listed" }, "body");
    expect(metadata).toEqual({ board: "Project 4", estimate: 3, done: false, source: "skylight-card", text: "body" });
  });

  it("stringifies bigints and dates", () => {
    const metadata = buildMetadata(source, { board: 12n, due_date: new Date("2026-08-12T00:00:00Z") }, "body");
    expect(metadata).toMatchObject({ board: "12", due_date: "2026-08-12T00:00:00.000Z" });
  });

  it("truncates very long text", () => {
    const metadata = buildMetadata(source, {}, "x".repeat(10_000));
    expect((metadata.text as string).length).toBe(8001);
  });
});

describe("recordId", () => {
  it("prefixes the source name", () => {
    expect(recordId(source, { id: 42 })).toBe("skylight-card:42");
  });

  it("throws when the id column is empty", () => {
    expect(() => recordId(source, { id: null })).toThrow(/idColumn "id"/);
  });
});
