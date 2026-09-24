import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies LINE's `X-Line-Signature` header — a base64 HMAC-SHA256 of the
 * raw request body, keyed by the channel secret. Needs the raw bytes, like
 * WhatsApp's and Slack's.
 */
export function verifyLineSignature(rawBody: Buffer | string, signatureHeader: string | undefined, channelSecret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader, "base64");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Test/tooling helper: produces the header value LINE itself would send for this body. */
export function signLineRequest(rawBody: string, channelSecret: string): string {
  return createHmac("sha256", channelSecret).update(rawBody).digest("base64");
}
