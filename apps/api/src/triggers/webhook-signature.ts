import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-agentos-signature";
export const TIMESTAMP_HEADER = "x-agentos-timestamp";

/** Deliveries older than this are rejected, so a captured POST cannot be replayed. */
const MAX_SKEW_MS = 5 * 60_000;

/**
 * Per-trigger signing keys are *derived*, never stored.
 *
 * The database holds a random salt; the key is HMAC(masterSecret, salt). That
 * keeps SPEC §5.8 honest for webhooks too: a stolen database yields salts, and
 * salts alone sign nothing.
 */
export function newSalt(): string {
  return randomBytes(24).toString("hex");
}

/**
 * The signing key for one trigger.
 *
 * Falls back to the operator token so a fresh install works, but production
 * should set the dedicated secret: otherwise rotating your login silently
 * rotates every webhook.
 */
export function signingKeyFor(
  config: { WEBHOOK_MASTER_SECRET: string; AGENTOS_OPERATOR_TOKEN: string },
  row: { secretSalt: string },
): string {
  return deriveSigningKey(config.WEBHOOK_MASTER_SECRET || config.AGENTOS_OPERATOR_TOKEN, row.secretSalt);
}

export function deriveSigningKey(masterSecret: string, salt: string): string {
  return createHmac("sha256", masterSecret).update(`webhook:${salt}`).digest("hex");
}

export interface VerifyInput {
  signingKey: string;
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  now?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * One spelling per signature, so the replay record cannot be sidestepped by
 * re-sending the same digest with the prefix added, removed, or recased.
 */
export function normaliseSignature(signature: string): string {
  const bare = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;
  return bare.trim().toLowerCase();
}

export function verifySignature(input: VerifyInput): VerifyResult {
  if (!input.signature) {
    return { ok: false, reason: `missing ${SIGNATURE_HEADER}` };
  }
  if (!input.timestamp) {
    return { ok: false, reason: `missing ${TIMESTAMP_HEADER}` };
  }

  const sent = Number(input.timestamp);
  if (!Number.isFinite(sent)) {
    return { ok: false, reason: "timestamp is not a number" };
  }
  const now = input.now ?? Date.now();
  if (Math.abs(now - sent) > MAX_SKEW_MS) {
    return { ok: false, reason: "timestamp is outside the accepted window" };
  }

  const expected = sign(input.signingKey, sent, input.rawBody);
  const provided = normaliseSignature(input.signature);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature does not match" };
  }
  return { ok: true };
}

/** The timestamp is inside the signed material, so it cannot be swapped. */
export function sign(signingKey: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", signingKey).update(`${timestamp}.${rawBody}`).digest("hex");
}
