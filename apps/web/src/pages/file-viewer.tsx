import type { FileEntryDto } from "@agentos/shared";
import { isPreviewableImage, isTextual } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { Well } from "../components/ui/panel";

/**
 * The right-hand pane of the file browser (SPEC §7, §18: open, edit, download,
 * preview).
 *
 * Three shapes, decided by the file rather than by the operator: text opens in
 * the editor, an image renders, and anything else says what it is and offers
 * the only thing that can be done with it. The alternative — one editor for
 * everything — showed mojibake and let a save corrupt the object.
 */
export function FileBody(props: {
  projectId: string;
  path: string;
  entry: FileEntryDto | undefined;
  draft: { path: string; content: string } | null;
  onDraft: (draft: { path: string; content: string }) => void;
}): React.JSX.Element {
  const mime = props.entry?.mime ?? "";
  const textual = isTextual(mime, props.path);

  if (textual) {
    return <TextBody {...props} />;
  }
  if (isPreviewableImage(mime)) {
    return <ImageBody projectId={props.projectId} path={props.path} entry={props.entry} />;
  }
  return (
    <div className="p-4">
      <Well className="space-y-3">
        <p className="text-[13px] text-ink">
          <span className="machine">{mime || "unknown type"}</span> ·{" "}
          <span className="tnum">{formatSize(props.entry?.size ?? 0)}</span>
        </p>
        <p className="text-[13px] text-ink-muted">
          This file type cannot be edited in AgentOS. Download it to view or modify it externally.
        </p>
        <DownloadButton projectId={props.projectId} path={props.path} />
      </Well>
    </div>
  );
}

function TextBody(props: {
  projectId: string;
  path: string;
  draft: { path: string; content: string } | null;
  onDraft: (draft: { path: string; content: string }) => void;
}): React.JSX.Element {
  const file = useQuery({
    queryKey: ["file-content", props.projectId, props.path],
    queryFn: () => api.fileContent(props.projectId, props.path),
  });

  useEffect(() => {
    if (file.data) {
      props.onDraft({ path: props.path, content: file.data.content });
    }
    // The draft callback is stable enough for this: it only ever stamps the
    // buffer with the path it was loaded from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.data, props.path]);

  const loaded = props.draft && props.draft.path === props.path ? props.draft : null;

  return (
    <div className="space-y-3 p-4 lg:min-h-0 lg:flex-1">
      {/* A read that failed must say so. Leaving the box editable and empty
          invited the operator to "fix" the file by saving over it with nothing. */}
      {file.isError ? (
        <InlineError>
          {file.error instanceof ApiError ? file.error.message : "Unable to read this file."}
        </InlineError>
      ) : null}
      <textarea
        className="machine h-[60vh] w-full resize-none rounded-control bg-sunken p-3.5 text-xs leading-relaxed text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-solid disabled:opacity-50 lg:h-full"
        value={loaded?.content ?? ""}
        disabled={!loaded}
        onChange={(event) =>
          loaded ? props.onDraft({ path: loaded.path, content: event.target.value }) : undefined
        }
        aria-label={`Contents of ${props.path}`}
        spellCheck={false}
      />
    </div>
  );
}

function ImageBody(props: {
  projectId: string;
  path: string;
  entry: FileEntryDto | undefined;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    api
      .fileBytes(props.projectId, props.path)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof ApiError ? cause.message : "Unable to read this file."),
      );
    // The blob URL holds the bytes in memory until it is revoked, and a browse
    // through a folder of screenshots would otherwise keep every one of them.
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [props.projectId, props.path]);

  return (
    <div className="space-y-3 p-4">
      {error ? <InlineError>{error}</InlineError> : null}
      <div className="flex items-center justify-center rounded-control bg-sunken p-4">
        {url ? (
          <img
            src={url}
            alt={props.path}
            className="max-h-[60vh] max-w-full rounded-control object-contain"
          />
        ) : (
          <span className="text-[13px] text-ink-faint">Loading the preview…</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="machine text-xs text-ink-faint">
          {props.entry?.mime} · {formatSize(props.entry?.size ?? 0)}
        </span>
        <DownloadButton projectId={props.projectId} path={props.path} />
      </div>
    </div>
  );
}

/**
 * Downloads through the API with the operator's token, then hands the browser
 * a blob. A plain link cannot carry the token, and the object store's own
 * credential is the one thing that must never reach this bundle.
 */
export function DownloadButton(props: {
  projectId: string;
  path: string;
  size?: "sm" | "md";
  /** `ghost` for a row-level action; the default suits a panel header. */
  variant?: "outline" | "ghost";
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={props.variant ?? "outline"}
      size={props.size ?? "sm"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await api.fileBytes(props.projectId, props.path);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = entryName(props.path);
          link.click();
          URL.revokeObjectURL(url);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Download />
      {busy ? "Preparing…" : "Download"}
    </Button>
  );
}

/**
 * The display name of a directory entry.
 *
 * Folders come back with a trailing slash (`/agents/`), so taking the last
 * segment of a split gives the empty string after it — which is exactly what
 * the browser rendered: a row of folder icons with no names beside them.
 */
export function entryName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "/";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
