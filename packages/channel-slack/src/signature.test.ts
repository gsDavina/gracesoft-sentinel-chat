import { describe, expect, it } from "vitest";
import { signSlackRequest, verifySlackSignature } from "./signature.js";

const SECRET = "signing-secret";
const NOW = 1_746_000_000;

describe("verifySlackSignature", () => {
  const body = JSON.stringify({ type: "event_callback" });

  it("accepts a correctly signed, fresh request", () => {
    const signature = signSlackRequest(body, NOW, SECRET);
    expect(verifySlackSignature({ rawBody: body, signatureHeader: signature, timestampHeader: String(NOW), signingSecret: SECRET, nowSeconds: NOW })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const signature = signSlackRequest(body, NOW, SECRET);
    expect(verifySlackSignature({ rawBody: `${body} `, signatureHeader: signature, timestampHeader: String(NOW), signingSecret: SECRET, nowSeconds: NOW })).toBe(false);
  });

  it("rejects a replayed request older than five minutes", () => {
    const stale = NOW - 301;
    const signature = signSlackRequest(body, stale, SECRET);
    expect(verifySlackSignature({ rawBody: body, signatureHeader: signature, timestampHeader: String(stale), signingSecret: SECRET, nowSeconds: NOW })).toBe(false);
  });

  it("rejects missing headers and malformed signatures without throwing", () => {
    expect(verifySlackSignature({ rawBody: body, signatureHeader: undefined, timestampHeader: String(NOW), signingSecret: SECRET, nowSeconds: NOW })).toBe(false);
    expect(verifySlackSignature({ rawBody: body, signatureHeader: "v0=abc", timestampHeader: String(NOW), signingSecret: SECRET, nowSeconds: NOW })).toBe(false);
    expect(verifySlackSignature({ rawBody: body, signatureHeader: "v0=abc", timestampHeader: "nope", signingSecret: SECRET, nowSeconds: NOW })).toBe(false);
  });
});
