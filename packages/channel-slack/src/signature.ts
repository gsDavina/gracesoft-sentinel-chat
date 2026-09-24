import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_VERSION = "v0";
/** Slack's own recommendation: reject anything older than 5 minutes, which blocks replay of a captured request. */
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

/**
 * Verifies Slack's `X-Slack-Signature` header — `v0=` + an HMAC-SHA256,
 * keyed by the app's signing secret, over `v0:{timestamp}:{raw body}`.
 * Like WhatsApp's, it needs the *raw* body; unlike WhatsApp's, the signed
 * string also carries `X-Slack-Request-Timestamp`, so a stale timestamp is
 * rejected too.
 */
export function verifySlackSignature(params: {
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  timestampHeader: string | undefined;
  signingSecret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, signingSecret } = params;
  if (!signatureHeader || !timestampHeader) return false;

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const prefix = `${SIGNATURE_VERSION}=`;
  if (!signatureHeader.startsWith(prefix)) return false;

  const base = `${SIGNATURE_VERSION}:${timestampHeader}:${rawBody.toString()}`;
  const expected = Buffer.from(createHmac("sha256", signingSecret).update(base).digest("hex"), "hex");
  const provided = Buffer.from(signatureHeader.slice(prefix.length), "hex");
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

/** Test/tooling helper: produces the header value Slack itself would send for this body. */
export function signSlackRequest(rawBody: string, timestamp: number, signingSecret: string): string {
  return `${SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`).digest("hex")}`;
}
