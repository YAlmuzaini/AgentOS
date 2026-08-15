import { Injectable, Logger } from "@nestjs/common";

export const SECRETS_PROVIDER = Symbol("SECRETS_PROVIDER");

/**
 * Program to the interface, not the vendor (RECIPE A2). Secret values are
 * resolved at session-provision time and handed straight to the runtime; they
 * are never written to the app database and never logged.
 */
export interface SecretsProvider {
  readonly name: string;
  /** Returns null when the reference cannot be resolved. */
  resolve(providerRef: string): Promise<string | null>;
}

/**
 * Development driver: `providerRef` is the name of an environment variable.
 *
 * The production driver (Google Secret Manager / Cloud KMS per SPEC §23) plugs
 * in here unchanged — nothing above this interface knows where a value came
 * from.
 */
@Injectable()
export class EnvSecretsProvider implements SecretsProvider {
  readonly name = "env";

  private readonly logger = new Logger(EnvSecretsProvider.name);

  async resolve(providerRef: string): Promise<string | null> {
    const value = process.env[providerRef];
    if (!value) {
      // Loud about the miss, silent about the value.
      this.logger.warn(`secret ${providerRef} is not set in the environment`);
      return null;
    }
    return value;
  }
}
