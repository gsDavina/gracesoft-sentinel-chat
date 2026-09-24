import { describe, expect, it } from "vitest";
import { loadPrivacyPolicy, loadTerms } from "./legal-content.js";

describe("Demo privacy policy", () => {
  const doc = loadPrivacyPolicy();

  it("has an effective date and version parsed from the document", () => {
    expect(doc.effectiveDate).toBe("24 September 2026");
    expect(doc.version).toBe("1.1.0");
  });

  it("tells the chatter they can delete their own data from the chat", () => {
    expect(doc.markdown).toContain("/deletemydata");
  });

  // PDPA notice completeness (test-checklist §5) — automatable keyword checks;
  // full legal sufficiency review is manual, not automatable.
  it("states what data is collected", () => {
    expect(doc.markdown).toMatch(/phone number/i);
    expect(doc.markdown).toMatch(/message/i);
    expect(doc.markdown).toMatch(/booking/i);
    expect(doc.markdown).toMatch(/photo/i);
  });

  it("states the purpose of collection", () => {
    expect(doc.markdown).toContain("Why we collect it");
  });

  it("states a retention period", () => {
    expect(doc.markdown).toContain("Retention");
  });

  it("states a contact method for data access/deletion requests", () => {
    expect(doc.markdown).toContain("hello@gracesoft.dev");
  });

  it("discloses that the assistant is AI, not human", () => {
    expect(doc.markdown).toMatch(/AI/);
  });

  it("discloses that this is a demo, not a live business channel", () => {
    expect(doc.markdown).toMatch(/demonstration/i);
  });
});

describe("Demo terms & conditions", () => {
  const doc = loadTerms();

  it("has an effective date and version parsed from the document", () => {
    expect(doc.effectiveDate).toBe("24 August 2026");
    expect(doc.version).toBe("1.0.0");
  });

  it("states the governing law", () => {
    expect(doc.markdown).toMatch(/Singapore/);
  });

  it("discloses that this is a demo, not a live business channel", () => {
    expect(doc.markdown).toMatch(/demonstration environment/i);
  });
});
