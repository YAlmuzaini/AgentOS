import { createSign } from "node:crypto";

/**
 * The App's own credential, as a signed assertion.
 *
 * A GitHub App never authenticates with a password. It signs a short-lived
 * RS256 JWT with its private key, and trades that for an installation token.
 * `node:crypto` signs it directly — a JWT library would be a dependency for
 * thirty lines of base64.
 *
 * `iat` is backdated a minute because GitHub rejects a token issued in its
 * future, and a host clock a few seconds fast is common enough that Coolify
 * ships an explicit clock-skew check for exactly this failure. Ten minutes is
 * GitHub's hard ceiling for `exp`; eight leaves room for the same skew on the
 * other side.
 */
export function appJwt(appId: string, privateKeyPem: string, nowMs: number = Date.now()): string {
  const issued = Math.floor(nowMs / 1000) - 60;
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: issued, exp: issued + 8 * 60, iss: appId };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem).toString("base64url");

  return `${signingInput}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Is this string plausibly a PEM private key?
 *
 * Checked before signing so a misconfigured `GITHUB_APP_PRIVATE_KEY` — the
 * common one being the *path* to the .pem rather than its contents — fails with
 * a sentence the operator can act on, instead of an OpenSSL error.
 */
export function looksLikePem(value: string): boolean {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value);
}

/**
 * Restores a PEM that lost its line breaks.
 *
 * A private key pasted into a `.env` file arrives as one line with literal
 * `\n` sequences, and OpenSSL will not parse that. Env-var secret stores make
 * this the normal case rather than the exception.
 */
export function normalisePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}
