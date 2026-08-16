import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/config";
import {
  GoogleSecretManagerProvider,
  type SecretVersionClient,
} from "../src/secrets/google-secrets.provider";

/**
 * The production secret driver (SPEC §4, §23).
 *
 * The value never enters the app database — the reference does — so what has
 * to be right here is the reference-to-resource translation and the failure
 * behaviour. A driver that throws on a missing secret takes a whole session
 * down with it; one that returns null lets the session say what is missing.
 */
describe("Google Secret Manager driver", () => {
  function provider(
    client: SecretVersionClient,
    projectId = "acme-prod",
  ): GoogleSecretManagerProvider {
    return new GoogleSecretManagerProvider({ GCP_PROJECT_ID: projectId } as AppConfig, client);
  }

  function clientReturning(payload: string | null): SecretVersionClient & { asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      async accessSecretVersion(request: { name: string }) {
        asked.push(request.name);
        return [
          { payload: payload === null ? null : { data: Buffer.from(payload, "utf8") } },
        ] as Awaited<ReturnType<SecretVersionClient["accessSecretVersion"]>>;
      },
    };
  }

  it("resolves a bare name against the configured project, newest version", async () => {
    const client = clientReturning("s3cret");
    expect(await provider(client).resolve("github-token")).toBe("s3cret");
    expect(client.asked).toEqual(["projects/acme-prod/secrets/github-token/versions/latest"]);
  });

  it("keeps a pinned version exactly as written", async () => {
    const client = clientReturning("s3cret");
    await provider(client).resolve("projects/p/secrets/s/versions/7");
    expect(client.asked).toEqual(["projects/p/secrets/s/versions/7"]);
  });

  it("adds the latest version to a secret path that has none", async () => {
    const client = clientReturning("s3cret");
    await provider(client).resolve("projects/p/secrets/s");
    expect(client.asked).toEqual(["projects/p/secrets/s/versions/latest"]);
  });

  it("returns null rather than throwing when the secret cannot be read", async () => {
    const failing: SecretVersionClient = {
      accessSecretVersion: () => Promise.reject(new Error("PERMISSION_DENIED")),
    };
    expect(await provider(failing).resolve("github-token")).toBeNull();
  });

  it("returns null for a bare name when no project is configured", async () => {
    const client = clientReturning("s3cret");
    expect(await provider(client, "").resolve("github-token")).toBeNull();
    expect(client.asked).toEqual([]);
  });

  it("returns null for a version with no payload", async () => {
    expect(await provider(clientReturning(null)).resolve("github-token")).toBeNull();
  });
});
