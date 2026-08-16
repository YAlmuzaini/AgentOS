import { Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import type { SecretsProvider } from "./secrets.provider";

/** The shape this driver needs, so a test can stand in for the SDK. */
export interface SecretVersionClient {
  accessSecretVersion(request: { name: string }): Promise<
    [{ payload?: { data?: Uint8Array | string | null } | null }, ...unknown[]]
  >;
}

/**
 * Google Secret Manager (SPEC §3.4, §4, §23).
 *
 * The production driver behind the same interface as the development one: the
 * app database stores a resource name, the value lives encrypted in Google's
 * system, and a stolen database yields references that decrypt nothing.
 *
 * `providerRef` may be a full version path
 * (`projects/p/secrets/s/versions/latest`), a secret path without a version
 * (the latest is used), or a bare name resolved against `GCP_PROJECT_ID`.
 *
 * The SDK is imported lazily so an install that never uses this driver does
 * not pay for loading it, and so a missing credential fails on first use with
 * a message about secrets rather than at boot with a stack trace.
 */
@Injectable()
export class GoogleSecretManagerProvider implements SecretsProvider {
  readonly name = "gcp";

  private readonly logger = new Logger(GoogleSecretManagerProvider.name);
  private client: SecretVersionClient | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    /** Injected by tests; production resolves the real client on first use. */
    client: SecretVersionClient | null = null,
  ) {
    this.client = client;
  }

  async resolve(providerRef: string): Promise<string | null> {
    const name = this.qualify(providerRef);
    if (!name) {
      this.logger.warn(
        `secret reference "${providerRef}" is not a Secret Manager resource name and ` +
          "GCP_PROJECT_ID is not set",
      );
      return null;
    }
    try {
      const client = await this.resolveClient();
      const [version] = await client.accessSecretVersion({ name });
      const data = version.payload?.data;
      if (!data) {
        this.logger.warn(`secret ${name} has no payload`);
        return null;
      }
      // Loud about the miss, silent about the value.
      return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    } catch (error) {
      this.logger.warn(`could not read secret ${name}: ${String(error)}`);
      return null;
    }
  }

  /** Turns whatever the operator stored into a version resource name. */
  private qualify(providerRef: string): string | null {
    const ref = providerRef.trim();
    if (ref.includes("/versions/")) {
      return ref;
    }
    if (ref.startsWith("projects/")) {
      return `${ref}/versions/latest`;
    }
    if (!this.config.GCP_PROJECT_ID) {
      return null;
    }
    return `projects/${this.config.GCP_PROJECT_ID}/secrets/${ref}/versions/latest`;
  }

  private async resolveClient(): Promise<SecretVersionClient> {
    if (this.client) {
      return this.client;
    }
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    this.client = new SecretManagerServiceClient() as unknown as SecretVersionClient;
    return this.client;
  }
}
