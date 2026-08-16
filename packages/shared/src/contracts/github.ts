/**
 * Connecting a project to GitHub through a GitHub App rather than a personal
 * access token (SPEC §4 Repo, §5.8).
 *
 * Nothing in these shapes is a credential. An installation id is a public
 * identifier; it only becomes useful in combination with the App's private key,
 * which lives in the secret store and never reaches the browser.
 */
export interface GithubInstallationDto {
  id: string;
  projectId: string;
  /** GitHub's own numeric id for the installation, as text. */
  installationId: string;
  accountLogin: string;
  accountType: string;
  /** "all" or "selected" — which repositories the operator granted. */
  repositorySelection: string;
  createdAt: string;
}

export interface GithubStatusDto {
  /** False when this installation has no GitHub App configured in env. */
  configured: boolean;
  appSlug: string;
  installations: GithubInstallationDto[];
}

/** A repository the installation can reach, for the picker. */
export interface RemoteRepoDto {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  private: boolean;
}
