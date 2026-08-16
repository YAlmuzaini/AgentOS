/**
 * What can be read, edited and shown as text, and what has to be downloaded.
 *
 * One source of truth (RECIPE A2): the API refuses a text read of a binary
 * object, the file browser decides between an editor and a preview, and both
 * have to agree or the operator gets an editor full of mojibake.
 */
const TEXTUAL_PREFIXES = ["text/"];

const TEXTUAL_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/toml",
  "image/svg+xml",
]);

/** Extensions that are text whatever the stored mime claims. */
const TEXTUAL_EXTENSIONS = new Set([
  "md", "markdown", "txt", "json", "yml", "yaml", "toml", "ini", "env",
  "csv", "tsv", "log", "sql", "sh", "bash", "zsh", "py", "rb", "go", "rs",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "html", "xml",
  "svg", "gitignore", "dockerfile", "conf", "diff", "patch",
]);

export function isTextual(mime: string, path = ""): boolean {
  const extension = path.split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
  if (TEXTUAL_EXTENSIONS.has(extension)) {
    return true;
  }
  if (TEXTUAL_TYPES.has(mime)) {
    return true;
  }
  return TEXTUAL_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

/** Images the browser can render inline; everything else gets a download. */
export function isPreviewableImage(mime: string): boolean {
  return (
    mime.startsWith("image/") &&
    ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/avif"].includes(
      mime,
    )
  );
}

/** Best-effort mime for an uploaded name, when the browser does not say. */
export function mimeForPath(path: string, fallback = "application/octet-stream"): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, string> = {
    md: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yml: "application/yaml",
    yaml: "application/yaml",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/plain",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    zip: "application/zip",
  };
  return known[extension] ?? fallback;
}
