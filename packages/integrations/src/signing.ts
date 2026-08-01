import { createHmac, timingSafeEqual } from "node:crypto";

export const DEFAULT_SIGNATURE_HEADER = "x-zts-signature";
const SIGNATURE_PREFIX = "sha256=";

/** Computes an HMAC-SHA256 signature for outbound webhook payloads. */
export function signPayload(
  secret: string,
  body: string,
  signatureHeader = DEFAULT_SIGNATURE_HEADER,
): { header: string; value: string; digest: string } {
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return {
    header: signatureHeader,
    value: `${SIGNATURE_PREFIX}${digest}`,
    digest,
  };
}

/** Verifies an inbound webhook signature using constant-time comparison. */
export function verifyInboundSignature(
  headers: Record<string, string>,
  rawBody: string,
  secret: string,
  signatureHeader = DEFAULT_SIGNATURE_HEADER,
): boolean {
  const provided =
    headers[signatureHeader] ??
    headers[signatureHeader.toLowerCase()] ??
    headers[signatureHeader.toUpperCase()];

  if (!provided || !provided.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expected = signPayload(secret, rawBody, signatureHeader).value;
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
