import { describe, expect, it } from "vitest";
import { loadPrivacyPolicy } from "@gracesoft-sentinel/legal-concierge";
import { renderLegalPage } from "./render.js";

describe("renderLegalPage", () => {
  const html = renderLegalPage("Sentinel Concierge — Privacy Policy", loadPrivacyPolicy());

  it("renders as a self-contained HTML document with the given title", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Sentinel Concierge — Privacy Policy</title>");
  });

  it("renders the effective date and version from the document", () => {
    expect(html).toContain("24 September 2026");
    expect(html).toContain("1.1.0");
  });

  it("renders the markdown content as HTML, not raw markdown", () => {
    expect(html).toContain("<h1");
    expect(html).not.toContain("# Sentinel Concierge");
  });

  it("links the favicon in the document head", () => {
    expect(html).toContain('<link rel="icon" href="/favicon.png" type="image/png">');
  });

  it("escapes the title against HTML injection", () => {
    const malicious = renderLegalPage('<script>alert(1)</script>', loadPrivacyPolicy());
    expect(malicious).not.toContain("<script>alert(1)</script>");
    expect(malicious).toContain("&lt;script&gt;");
  });
});
