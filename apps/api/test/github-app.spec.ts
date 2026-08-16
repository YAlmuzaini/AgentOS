import { generateKeyPairSync } from "node:crypto";
import { normaliseRemote, remoteAcceptsInstallationToken } from "@agentos/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config";
import { appJwt, looksLikePem, normalisePem } from "../src/github/github-jwt";
import { InstallStateStore } from "../src/github/install-state";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/**
 * The GitHub App credential path (SPEC §4 Repo, §5.8).
 *
 * A PAT is a long-lived credential with whatever scopes its owner ticked. An
 * installation token expires in an hour and reaches only the repositories the
 * operator selected. These cover the two pieces that have to be right for that
 * swap to be safe: the assertion we sign, and the single thing authenticating
 * GitHub's unauthenticated callback.
 */
describe("github app jwt", () => {
  it("signs an RS256 assertion GitHub will accept", () => {
    const token = appJwt("123456", privateKey, Date.UTC(2026, 0, 1, 12, 0, 0));
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims.iss).toBe("123456");
    expect(signature).toBeTruthy();
  });

  it("backdates iat and stays inside GitHub's ten-minute ceiling", () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const claims = JSON.parse(
      Buffer.from(appJwt("1", privateKey, now).split(".")[1]!, "base64url").toString(),
    );

    // A host clock a few seconds fast makes GitHub reject a token issued in
    // its future, which is the single most common setup failure.
    expect(claims.iat).toBe(Math.floor(now / 1000) - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60);
  });

  it("restores a PEM that lost its newlines in an env var", () => {
    const flattened = privateKey.replace(/\n/g, "\\n");
    expect(looksLikePem(flattened)).toBe(true);
    expect(normalisePem(flattened)).toBe(privateKey);
  });

  it("rejects a path where a PEM was expected", () => {
    expect(looksLikePem("/etc/agentos/github.pem")).toBe(false);
  });
});

describe("github install state", () => {
  it("round-trips a state token once and only once", () => {
    const store = new InstallStateStore();
    const token = store.issue({ projectId: "p1" });

    expect(store.consume(token)).toEqual({ projectId: "p1" });
    // Replay is the attack: the callback is an unauthenticated GET, so a state
    // that survives its first use is a state someone else can present.
    expect(store.consume(token)).toBeNull();
  });

  it("refuses a missing, empty or unknown state", () => {
    const store = new InstallStateStore();
    store.issue({ projectId: "p1" });

    expect(store.consume(undefined)).toBeNull();
    expect(store.consume("")).toBeNull();
    expect(store.consume("not-a-real-state")).toBeNull();
  });

  it("issues unguessable, non-repeating tokens", () => {
    const store = new InstallStateStore();
    const tokens = new Set(Array.from({ length: 16 }, () => store.issue({ projectId: "p" })));

    expect(tokens.size).toBe(16);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(43);
    }
  });

  it("keeps each project's state to itself", () => {
    const store = new InstallStateStore();
    const first = store.issue({ projectId: "project-a" });
    const second = store.issue({ projectId: "project-b" });

    expect(store.consume(second)).toEqual({ projectId: "project-b" });
    expect(store.consume(first)).toEqual({ projectId: "project-a" });
  });
});

/**
 * Where a clone credential is allowed to go.
 *
 * Host equality is the wall that stops an installation token being posted to a
 * host the operator does not own, so the parser behind it has to agree with
 * git and with a browser about what the host of a URL actually is.
 */
describe("git remote parsing", () => {
  it("normalises the forms that name the same repository", () => {
    for (const url of [
      "https://github.com/almuzaini/app.git",
      "https://github.com/almuzaini/app",
      "https://github.com/almuzaini/app/",
      "https://github.com:443/almuzaini/app.git",
      "https://x-access-token:ghs_secret@github.com/almuzaini/app.git",
      "https://GitHub.com/almuzaini/App.git",
    ]) {
      expect(normaliseRemote(url)).toBe("https://github.com:443/almuzaini/app");
    }
  });

  it("keeps a different scheme from claiming the same repository", () => {
    // http and ssh name real, different things. Treating them as the https
    // clone URL is what let a token be sent in plaintext.
    expect(normaliseRemote("http://github.com/a/b.git")).not.toBe(
      normaliseRemote("https://github.com/a/b.git"),
    );
    expect(normaliseRemote("git@github.com:a/b.git")).not.toBe(
      normaliseRemote("https://github.com/a/b.git"),
    );
  });

  it("accepts an https remote on the App's own origin", () => {
    expect(remoteAcceptsInstallationToken("https://github.com/a/b.git", "https://github.com")).toBe(
      true,
    );
    expect(remoteAcceptsInstallationToken("https://GitHub.com/a/b.git", "https://github.com")).toBe(
      true,
    );
    expect(
      remoteAcceptsInstallationToken("https://github.com:443/a/b.git", "https://github.com"),
    ).toBe(true);
  });

  it("refuses a scheme that cannot carry the token", () => {
    // An installation token is HTTP Basic auth. Over http it crosses the wire
    // in the clear; over ssh git has no way to present it at all.
    expect(remoteAcceptsInstallationToken("http://github.com/a/b.git", "https://github.com")).toBe(
      false,
    );
    expect(remoteAcceptsInstallationToken("git@github.com:a/b.git", "https://github.com")).toBe(
      false,
    );
    expect(remoteAcceptsInstallationToken("ssh://git@github.com/a/b.git", "https://github.com")).toBe(
      false,
    );
    expect(remoteAcceptsInstallationToken("ftp://github.com/a/b.git", "https://github.com")).toBe(
      false,
    );
  });

  it("refuses a different port on the right host", () => {
    expect(
      remoteAcceptsInstallationToken(
        "https://git.acme.internal:9443/a/b.git",
        "https://git.acme.internal:8443",
      ),
    ).toBe(false);
    expect(
      remoteAcceptsInstallationToken("https://github.com:8443/a/b.git", "https://github.com"),
    ).toBe(false);
  });

  it("refuses the lookalikes a sloppier check would accept", () => {
    // A suffix test accepts the first, a prefix test the second, and a
    // credentials-blind reader the third.
    for (const remote of [
      "https://evil-github.com/a/b.git",
      "https://github.com.attacker.example/a/b.git",
      "https://github.com@attacker.example/a/b.git",
      "https://user@github.com@attacker.example/a/b.git",
      "https://github.com\\@attacker.example/a/b",
      "https://attacker.example/a/b.git",
    ]) {
      expect(remoteAcceptsInstallationToken(remote, "https://github.com")).toBe(false);
    }
  });

  it("keeps a GitHub Enterprise host distinct from github.com", () => {
    expect(
      remoteAcceptsInstallationToken(
        "https://git.acme.internal/a/b.git",
        "https://git.acme.internal",
      ),
    ).toBe(true);
    expect(
      remoteAcceptsInstallationToken("https://github.com/a/b.git", "https://git.acme.internal"),
    ).toBe(false);
  });

  it("handles an IPv6 literal without confusing its colons for a port", () => {
    expect(normaliseRemote("https://[2606:50c0:8000::153]/a/b.git")).toBe(
      "https://[2606:50c0:8000::153]:443/a/b",
    );
    expect(
      remoteAcceptsInstallationToken(
        "https://[2606:50c0:8000::153]:8443/a/b.git",
        "https://[2606:50c0:8000::153]",
      ),
    ).toBe(false);
  });

  it("refuses a bracketed host whose port is not a number", () => {
    // The bracketed branch used to skip the digit check the plain branch ran,
    // so a port that is not one has to fail here rather than be trimmed away.
    for (const remote of ["https://[::1]:8443x/a/b", "https://[::1]:x/a/b", "https://[::1]x/a/b"]) {
      expect(normaliseRemote(remote)).toBeNull();
      expect(remoteAcceptsInstallationToken(remote, "https://[::1]")).toBe(false);
    }
  });

  it("returns null rather than guessing at what it cannot parse", () => {
    expect(normaliseRemote("")).toBeNull();
    expect(normaliseRemote("not a url")).toBeNull();
    expect(normaliseRemote("https://github.com")).toBeNull();
    expect(normaliseRemote("https://[2606:50c0::153/a/b")).toBeNull();
  });
});

/**
 * The GitHub URLs a credential is sent to.
 *
 * `GITHUB_API_URL` receives an `Authorization: Bearer` header carrying the App
 * JWT and every minted installation token, so a plaintext value there puts live
 * credentials on the wire — the same failure as an http clone remote, arriving
 * by configuration instead of by data.
 */
describe("github config", () => {
  const base = {
    DATABASE_URL: "postgres://x/y",
    REDIS_URL: "redis://x",
    AGENTOS_OPERATOR_TOKEN: "0".repeat(32),
  };

  it("defaults to github.com over https", () => {
    const config = loadConfig({ ...base } as NodeJS.ProcessEnv);
    expect(config.GITHUB_API_URL).toBe("https://api.github.com");
    expect(config.GITHUB_HTML_URL).toBe("https://github.com");
  });

  it("accepts a GitHub Enterprise host over https", () => {
    const config = loadConfig({
      ...base,
      GITHUB_API_URL: "https://ghe.internal/api/v3",
      GITHUB_HTML_URL: "https://ghe.internal",
    } as NodeJS.ProcessEnv);
    expect(config.GITHUB_API_URL).toBe("https://ghe.internal/api/v3");
  });

  it("refuses a plaintext GitHub API URL at startup", () => {
    expect(() =>
      loadConfig({ ...base, GITHUB_API_URL: "http://ghe.internal/api/v3" } as NodeJS.ProcessEnv),
    ).toThrow(/https/);
  });

  it("refuses a plaintext GitHub HTML URL at startup", () => {
    expect(() =>
      loadConfig({ ...base, GITHUB_HTML_URL: "http://ghe.internal" } as NodeJS.ProcessEnv),
    ).toThrow(/https/);
  });

  it("refuses a value that is not a URL at all", () => {
    expect(() =>
      loadConfig({ ...base, GITHUB_HTML_URL: "ghe.internal" } as NodeJS.ProcessEnv),
    ).toThrow(/GITHUB_HTML_URL/);
  });
});
