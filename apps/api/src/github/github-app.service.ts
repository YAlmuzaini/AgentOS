import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import { registerSecret } from "../observability/secret-registry";
import { SECRETS_PROVIDER, type SecretsProvider } from "../secrets/secrets.provider";
import { appJwt, looksLikePem, normalisePem } from "./github-jwt";

/** Minted tokens live an hour; stop using one well before that. */
const TOKEN_TTL_MARGIN_MS = 5 * 60 * 1000;

/** 1000 repositories. Beyond this the listing says so rather than truncating in silence. */
const MAX_REPO_PAGES = 10;

export interface InstallationSummary {
  installationId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
}

export interface RemoteRepo {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
}

/**
 * Everything that needs the App's private key.
 *
 * The key itself never leaves this class, and neither does a minted token
 * except to the session provisioner. Both are registered with the secret
 * registry the moment they exist, so any log line or error report that quotes
 * one is redacted before it leaves the process.
 */
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SECRETS_PROVIDER) private readonly secrets: SecretsProvider,
  ) {}

  /** Whether an App is configured at all. The UI asks before offering to connect. */
  configured(): boolean {
    return Boolean(this.config.GITHUB_APP_ID && this.config.GITHUB_APP_PRIVATE_KEY);
  }

  get slug(): string {
    return this.config.GITHUB_APP_SLUG;
  }

  get htmlUrl(): string {
    return this.config.GITHUB_HTML_URL.replace(/\/+$/, "");
  }

  private get apiUrl(): string {
    return this.config.GITHUB_API_URL.replace(/\/+$/, "");
  }

  /**
   * The App's private key, resolved through the secret store.
   *
   * `GITHUB_APP_PRIVATE_KEY` is a providerRef, so under the env driver it names
   * an environment variable and under GCP it names a Secret Manager resource.
   * The PEM is therefore never in the app database, matching every other
   * credential in the system (SPEC §5.8).
   */
  private async privateKey(): Promise<string> {
    if (!this.configured()) {
      throw new ServiceUnavailableException(
        "no GitHub App is configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY",
      );
    }
    const resolved = await this.secrets.resolve(this.config.GITHUB_APP_PRIVATE_KEY);
    if (!resolved) {
      throw new ServiceUnavailableException(
        `the GitHub App private key (${this.config.GITHUB_APP_PRIVATE_KEY}) did not resolve`,
      );
    }
    registerSecret(resolved);
    const pem = normalisePem(resolved);
    if (!looksLikePem(pem)) {
      throw new ServiceUnavailableException(
        "the GitHub App private key is not a PEM — it should be the contents of the .pem file, not its path",
      );
    }
    registerSecret(pem);
    return pem;
  }

  /** Authenticated as the App itself: used to read installations, never repos. */
  private async appRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const jwt = appJwt(this.config.GITHUB_APP_ID, await this.privateKey());
    registerSecret(jwt);
    return this.request<T>(path, jwt, init);
  }

  private async request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "AgentOS",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = safeMessage(body) ?? response.statusText;
      // 401 from a well-formed request is almost always clock skew or the
      // wrong key, and both are worth naming rather than passing through.
      throw new ServiceUnavailableException(
        response.status === 401
          ? `GitHub rejected the App credentials (${message}). Check GITHUB_APP_ID, the private key, and this host's clock.`
          : `GitHub ${path} failed: ${response.status} ${message}`,
      );
    }
    return (await response.json()) as T;
  }

  /**
   * Confirms an installation id really belongs to *this* App.
   *
   * The setup callback is an unauthenticated GET whose query string an attacker
   * controls, so `installation_id` is a claim until GitHub confirms it. Coolify
   * shipped this check as a security fix; skipping it lets someone bind a
   * stranger's installation — or their own — into this operator's project.
   */
  async describeInstallation(installationId: string): Promise<InstallationSummary | null> {
    if (!/^\d+$/.test(installationId)) {
      return null;
    }
    try {
      const data = await this.appRequest<{
        id: number;
        app_id: number;
        account?: { login?: string; type?: string };
        repository_selection?: string;
      }>(`/app/installations/${installationId}`);

      if (String(data.app_id) !== String(this.config.GITHUB_APP_ID)) {
        this.logger.warn(
          `installation ${installationId} belongs to app ${data.app_id}, not ${this.config.GITHUB_APP_ID}`,
        );
        return null;
      }
      return {
        installationId: String(data.id),
        accountLogin: data.account?.login ?? "",
        accountType: data.account?.type ?? "",
        repositorySelection: data.repository_selection ?? "",
      };
    } catch (error) {
      this.logger.warn(`could not verify installation ${installationId}: ${String(error)}`);
      return null;
    }
  }

  /**
   * A token for one installation, cached until shortly before it expires.
   *
   * Cached because a session with three granted repos would otherwise mint
   * three tokens, and GitHub rate-limits App authentication separately from
   * everything else.
   */
  async installationToken(installationId: string): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_TTL_MARGIN_MS > Date.now()) {
      return cached.token;
    }

    const data = await this.appRequest<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      { method: "POST" },
    );
    // Registered before it is returned, so a clone failure that echoes the URL
    // cannot ship the token to the error reporter.
    registerSecret(data.token);
    this.tokens.set(installationId, {
      token: data.token,
      expiresAt: Date.parse(data.expires_at) || Date.now() + 60 * 60 * 1000,
    });
    return data.token;
  }

  /** What the operator picked on github.com, for the repo picker. */
  async listRepositories(installationId: string): Promise<RemoteRepo[]> {
    const token = await this.installationToken(installationId);
    const repos: RemoteRepo[] = [];

    for (let page = 1; page <= MAX_REPO_PAGES; page++) {
      const data = await this.request<{
        total_count: number;
        repositories: Array<{
          full_name: string;
          clone_url: string;
          default_branch: string;
          private: boolean;
        }>;
      }>(`/installation/repositories?per_page=100&page=${page}`, token);

      repos.push(
        ...data.repositories.map((repo) => ({
          fullName: repo.full_name,
          cloneUrl: repo.clone_url,
          defaultBranch: repo.default_branch,
          private: repo.private,
        })),
      );
      if (repos.length >= data.total_count || data.repositories.length === 0) {
        return repos;
      }
      if (page === MAX_REPO_PAGES) {
        // Said out loud rather than returned quietly: a picker that is missing
        // repositories looks identical to an installation that was not granted
        // them, and the operator would go and re-grant something they already
        // had.
        this.logger.warn(
          `installation ${installationId} has ${data.total_count} repositories; listing stopped at ${repos.length}`,
        );
      }
    }
    return repos;
  }

  /** Forgets any cached token for an installation that is being disconnected. */
  forget(installationId: string): void {
    this.tokens.delete(installationId);
  }
}

/** GitHub's error bodies are JSON with a `message`; anything else is not quoted back. */
function safeMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}
