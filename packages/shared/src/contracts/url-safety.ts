/**
 * Whether a URL carries a credential in itself.
 *
 * Lives in its own module because two contracts need it and neither may import
 * the other: `resources.ts` already imports `provenance.ts`, so the provenance
 * URLs — which are stored, returned by the API and rendered as links exactly
 * like an MCP endpoint is — could not reuse the rule without a cycle. One copy,
 * imported by both.
 *
 * The limitation is the same in both places and is documented rather than
 * pretended away: a credential hidden in a *path* segment cannot be recognised
 * by name, and no list of parameter names is ever finished. This is defence in
 * depth, not a boundary. Put credentials in a secret reference.
 */

/**
 * Words that make a parameter name a credential, wherever they appear in it.
 *
 * A fixed list of exact names was the wrong shape: it accepted `api-key`,
 * `client_secret`, `key`, and `exaApiKey` — every real spelling except the ones
 * that happened to be written down. Substring matching catches the family, and
 * the catalogue's own parameters (`tools`, `telemetry-enabled`) contain none of
 * these words, so legitimate configuration keeps working.
 */
const CREDENTIAL_WORDS: string[] = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
  "signature",
];

/**
 * Names that are a credential in themselves, matched whole.
 *
 * `auth` alone is one; `authMode`, `author` and `authority` are not, and
 * substring matching rejected all four. Kept separate so the strong words
 * above can stay aggressive without taking ordinary configuration with them.
 */
const CREDENTIAL_EXACT: string[] = ["auth", "authorization", "sig"];

/**
 * Credential names written as one word, which tokenising cannot split.
 *
 * `apiKey` splits to `api` + `key`; `apikey` does not, and real APIs use both
 * spellings. Compared against the name with its separators removed, so
 * `api_key`, `api-key`, `apiKey` and `apikey` all land here.
 */
/**
 * Words that end a credential's name.
 *
 * Enumerating compounds — `apikey`, `clientsecret`, `accesstoken` — was a list
 * that could never be finished: `refreshtoken`, `idtoken` and `jwttoken` are
 * all real and none of them were on it. A **suffix** rule catches the family
 * instead, because these names are built the same way: something, then the
 * kind of credential it is.
 *
 * Suffix rather than substring is what keeps `keyspace` and `keyboardLayout`
 * usable — they *start* with the word, and a parameter named for what it holds
 * ends with it.
 */
const CREDENTIAL_SUFFIXES: string[] = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
  "signature",
];

/**
 * Splits a parameter name into the words a human would read in it.
 *
 * `api-key` → `api`, `key`. `exaApiKey` → `exa`, `api`, `key`. `keyspace`
 * stays one word, which is why it is allowed: matching on *tokens* rather than
 * substrings is what tells a key from a keyspace.
 */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

/**
 * Parsed by hand rather than with `URL`, because this module is shared with the
 * browser bundle and the CLI and carries no lib assumptions. The two shapes it
 * looks for are simple enough that a parser is not warranted.
 */
export function hasUrlCredential(value: string): boolean {
  // Userinfo, judged by scheme. Over http(s) *any* userinfo is HTTP Basic —
  // `https://ghp_live_token@host/mcp` is a bearer credential with no colon in
  // sight — so all of it is refused. Over ssh a bare username is the
  // transport's user rather than anybody's secret, which is why
  // `ssh://git@host:2222/org/repo.git` has to keep working; a password there
  // is still refused.
  const parsed = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)@/.exec(value);
  if (parsed) {
    const scheme = parsed[1]!.toLowerCase();
    const userinfo = parsed[2]!;
    if (scheme === "http" || scheme === "https" || userinfo.includes(":")) {
      return true;
    }
  }

  // Query *and* fragment: `#access_token=…` is the OAuth implicit-flow shape,
  // and it reaches the database exactly like a query parameter does.
  const afterScheme = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const beforeFragment = afterScheme.split("#")[0]!;
  const parts = [beforeFragment.split("?")[1], afterScheme.split("#")[1]];

  for (const part of parts) {
    if (!part) {
      continue;
    }
    for (const pair of part.split("&")) {
      const raw = pair.split("=")[0] ?? "";
      // A malformed escape threw a `URIError` straight out of `safeParse`,
      // turning a validation question into an internal error. The raw name is
      // a perfectly good thing to match on when decoding is impossible.
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {
        name = raw;
      }
      const lower = name.toLowerCase();
      const squashed = lower.replace(/[^a-z0-9]/g, "");
      const parts = words(name);
      if (
        CREDENTIAL_EXACT.includes(lower) ||
        CREDENTIAL_SUFFIXES.some((word) => squashed.endsWith(word)) ||
        parts.some((part) => CREDENTIAL_WORDS.includes(part))
      ) {
        return true;
      }
    }
  }
  return false;
}

