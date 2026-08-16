/**
 * Where a clone credential is allowed to be sent.
 *
 * A repo row carries a remote URL and, separately, a GitHub App installation.
 * Nothing structurally stops those two from disagreeing — the URL is free text
 * from the operator's form, and `agentos push` can rewrite it on a row whose
 * installation stays put. If they are allowed to disagree, the session hands a
 * live installation token to whatever the URL names, and that token opens every
 * repository the installation covers.
 *
 * The comparison is the whole **origin** — scheme, host and port — not the host
 * alone. A review proved why: with only the host compared,
 * `http://github.com/owner/repo.git` passed as github.com, and git then sent
 * the installation token over plaintext HTTP to anything answering on port 80.
 * `https://host:9443` and `https://host:8443` were likewise equal.
 */

interface Parsed {
  scheme: string;
  host: string;
  port: string;
  path: string;
}

/** Schemes that can carry an installation token, which is HTTP Basic auth. */
const TOKEN_BEARING_SCHEMES = new Set(["https"]);

const DEFAULT_PORTS: Record<string, string> = {
  https: "443",
  http: "80",
  ssh: "22",
  git: "9418",
};

/**
 * A repository's identity: `https://github.com/owner/repo`.
 *
 * The scheme is part of it on purpose, so an `http://` remote never matches the
 * `https://` clone URL GitHub reported for the same repository. Returns null
 * when the value is not a remote this can read.
 */
export function normaliseRemote(remoteUrl: string): string | null {
  const parsed = parse(remoteUrl);
  if (!parsed || !parsed.path) {
    return null;
  }
  return `${origin(parsed)}/${parsed.path}`;
}

/**
 * May an installation token be sent to this remote?
 *
 * Requires the same origin as the configured GitHub *and* a scheme that can
 * actually carry the token. An `ssh://` or scp-style remote is refused rather
 * than quietly minting a credential git would have no way to present.
 */
export function remoteAcceptsInstallationToken(
  remoteUrl: string,
  githubHtmlUrl: string,
): boolean {
  const remote = parse(remoteUrl);
  const github = parse(githubHtmlUrl);
  if (!remote || !github) {
    return false;
  }
  return TOKEN_BEARING_SCHEMES.has(remote.scheme) && origin(remote) === origin(github);
}

function origin(parsed: Parsed): string {
  return `${parsed.scheme}://${parsed.host}:${parsed.port}`;
}

/**
 * Parses both remote forms git accepts, with any embedded credentials dropped.
 *
 * By hand rather than with `URL`, for two reasons. This package compiles
 * against ES2023 with no DOM and no Node types, deliberately — it is the one
 * place both the API and the browser import from, and it stays free of either
 * environment. And scp-style remotes (`git@github.com:owner/repo.git`) are not
 * URLs at all; `URL` rejects them, and they need to normalise to the same
 * identity as their https form.
 *
 * A backslash anywhere is a refusal rather than something to normalise, and
 * that is deliberate. A browser folds `\` into `/`, so it reads
 * `https://github.com\@attacker.example/x` as host `github.com` with a path;
 * git does not, and reads the same string as userinfo `github.com\` on host
 * `attacker.example`. Either reading alone is defensible — agreeing with the
 * wrong one hands the token to the host git actually dials. No legitimate git
 * remote contains a backslash, so neither reading is needed.
 */
function parse(value: string): Parsed | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\\")) {
    return null;
  }

  // scp-style: `[user@]host:path`, where what follows the colon is neither a
  // port nor an absolute path. Git treats these as ssh.
  const scp = /^(?:[^/@]+@)?([^/:]+):(?!\/|\d+(?:\/|$))(.+)$/.exec(trimmed);
  if (scp) {
    const host = scp[1]!.trim().toLowerCase();
    return host
      ? { scheme: "ssh", host, port: DEFAULT_PORTS.ssh!, path: cleanPath(scp[2]!) }
      : null;
  }

  const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(trimmed);
  if (!withScheme) {
    return null;
  }
  const scheme = withScheme[1]!.toLowerCase();
  const rest = withScheme[2]!;
  const pathStart = rest.search(/[/?#]/);
  const authority = pathStart === -1 ? rest : rest.slice(0, pathStart);
  const rawPath = pathStart === -1 ? "" : rest.slice(pathStart);

  // Credentials are everything before the *last* `@`: `a@b@host` has host
  // `host`, which is also how git and every browser read it.
  const at = authority.lastIndexOf("@");
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  const split = splitHostPort(hostPort);
  if (!split) {
    return null;
  }
  return {
    scheme,
    host: split.host,
    port: split.port || DEFAULT_PORTS[scheme] || "",
    path: cleanPath(rawPath.split(/[?#]/)[0] ?? ""),
  };
}

/** Splits `host[:port]`, leaving an IPv6 literal's own colons alone. */
function splitHostPort(hostPort: string): { host: string; port: string } | null {
  const value = hostPort.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close === -1) {
      return null;
    }
    const host = value.slice(0, close + 1);
    const after = value.slice(close + 1);
    if (after && !after.startsWith(":")) {
      return null;
    }
    const port = after.slice(1);
    // The same rule as the non-bracketed branch, which this used to skip: a
    // port that is not digits is not something to guess at.
    if (!/^\d*$/.test(port)) {
      return null;
    }
    return { host, port };
  }
  const colon = value.indexOf(":");
  if (colon === -1) {
    return { host: value, port: "" };
  }
  const port = value.slice(colon + 1);
  // A second colon on a non-bracketed host is not something to guess at.
  if (!/^\d*$/.test(port)) {
    return null;
  }
  return { host: value.slice(0, colon), port };
}

function cleanPath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}
