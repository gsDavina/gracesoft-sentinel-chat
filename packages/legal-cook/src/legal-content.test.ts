import { describe, expect, it } from "vitest";
import { loadPrivacyPolicy, loadTerms } from "./legal-content.js";

describe("Cook privacy policy", () => {
  const doc = loadPrivacyPolicy();

  it("has an effective date and version parsed from the document", () => {
    expect(doc.effectiveDate).toBe("24 September 2026");
    expect(doc.version).toBe("1.1.0");
  });

  it("tells the chatter they can delete their own data from the chat", () => {
    expect(doc.markdown).toContain("/deletemydata");
  });

  it("states what data is collected, including uploaded photos", () => {
    expect(doc.markdown).toMatch(/phone number/i);
    expect(doc.markdown).toMatch(/photo/i);
    expect(doc.markdown).toMatch(/message/i);
  });

  it("states the purpose of collection", () => {
    expect(doc.markdown).toContain("Why we collect it");
  });

  it("states a retention period, and that photos specifically are not retained", () => {
    expect(doc.markdown).toContain("Retention");
    expect(doc.markdown).toMatch(/not retained/i);
  });

  it("states a contact method for data access/deletion requests", () => {
    expect(doc.markdown).toContain("hello@gracesoft.dev");
  });
});

describe("Cook terms & conditions", () => {
  const doc = loadTerms();

  it("has an effective date and version parsed from the document", () => {
    expect(doc.effectiveDate).toBe("13 August 2026");
    expect(doc.version).toBe("1.0.0");
  });

  it("includes the not-for-medical-use nutrition disclaimer", () => {
    expect(doc.markdown).toMatch(/not intended for medical/i);
  });

  it("states the governing law", () => {
    expect(doc.markdown).toMatch(/Singapore/);
  });
});
