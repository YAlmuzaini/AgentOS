import type { FileEntryDto } from "@agentos/shared";
import { isPreviewableImage, isTextual } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { Download, FileWarning, ImageOff, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, InlineError, Skeleton } from "../components/ui/feedback";

/**
 * Above this, the editor stops being an editor.
 *
 * Uploads are capped at 25MB, and a textarea holding a file that size freezes
 * the tab on every keystroke — the browser re-lays out the whole document. So a
 * file past this line gets an authored state instead of a box that appears to
 * work and then does not. Nothing is lost: the state offers the download, and
 * an operator who means it can still open the editor from there.
 */
const EDITABLE_LIMIT_BYTES = 2 * 1024 * 1024;

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
    // Keyed on the path so the size override below resets between files.
    return <TextBody key={props.path} {...props} size={props.entry?.size ?? 0} />;
  }
  if (isPreviewableImage(mime)) {
    return <ImageBody projectId={props.projectId} path={props.path} entry={props.entry} />;
  }
  return (
    <EmptyState
      icon={<FileWarning />}
      title="This file cannot be previewed"
      hint={
        <>
          <span className="machine">{mime || "unknown type"}</span> ·{" "}
          <span className="tnum">{formatSize(props.entry?.size ?? 0)}</span>. Download it to view or
          modify it outside AgentOS.
        </>
      }
      action={<DownloadButton projectId={props.projectId} path={props.path} />}
    />
  );
}

function TextBody(props: {
  projectId: string;
  path: string;
  size: number;
  draft: { path: string; content: string } | null;
  onDraft: (draft: { path: string; content: string }) => void;
}): React.JSX.Element {
  // The operator's own override of the size gate below, reset by `key` on the
  // path: deciding to open one 8MB log says nothing about the next one.
  const [openAnyway, setOpenAnyway] = useState(false);
  const tooLarge = props.size > EDITABLE_LIMIT_BYTES && !openAnyway;

  const file = useQuery({
    queryKey: ["file-content", props.projectId, props.path],
    queryFn: () => api.fileContent(props.projectId, props.path),
    // Not merely hidden — not fetched. The point of the gate is to keep the
    // bytes out of the tab, and a disabled textarea over a completed 20MB read
    // has already cost everything it was meant to save.
    enabled: !tooLarge,
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

  if (tooLarge) {
    return (
      <EmptyState
        icon={<Scale />}
        title="This file is too large to preview"
        hint={
          <>
            This <span className="tnum">{formatSize(props.size)}</span> file exceeds the{" "}
            <span className="tnum">{formatSize(EDITABLE_LIMIT_BYTES)}</span> preview limit.
            Download it or open it in the editor.
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <DownloadButton projectId={props.projectId} path={props.path} />
            <Button variant="ghost" size="sm" onClick={() => setOpenAnyway(true)}>
              Open in the editor anyway
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 lg:min-h-0 lg:flex-1">
      {/* A read that failed must say so. Leaving the box editable and empty
          invited the operator to "fix" the file by saving over it with nothing. */}
      {file.isError ? (
        <InlineError>
          {file.error instanceof ApiError ? file.error.message : "Unable to read this file."}
        </InlineError>
      ) : null}
      {/* The loading shape is the editor's shape, so the pane does not resize
          under the operator the moment the bytes land. */}
      {file.isLoading ? (
        <Skeleton className="h-[60vh] w-full lg:h-full lg:min-h-0 lg:flex-1" />
      ) : (
        <textarea
          className="machine h-[60vh] w-full resize-none rounded-control bg-sunken p-3.5 text-xs leading-relaxed text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-solid disabled:text-ink-faint lg:h-full lg:min-h-0 lg:flex-1"
          value={loaded?.content ?? ""}
          disabled={!loaded}
          onChange={(event) =>
            loaded ? props.onDraft({ path: loaded.path, content: event.target.value }) : undefined
          }
          aria-label={`Contents of ${props.path}`}
          spellCheck={false}
        />
      )}
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

  // A failed read has nothing to preview, so it gets the authored state rather
  // than an error banner above an empty grey box that says "Loading…" forever.
  if (error) {
    return (
      <EmptyState
        icon={<ImageOff />}
        title="Unable to load this image"
        hint={error}
        action={<DownloadButton projectId={props.projectId} path={props.path} />}
      />
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-center rounded-control bg-sunken p-4">
        {url ? (
          <img
            src={url}
            alt={`Preview of ${entryName(props.path)}`}
            className="max-h-[60vh] max-w-full rounded-control object-contain"
          />
        ) : (
          // Sized like the frame it is standing in for, so the pane does not
          // jump when the bytes arrive.
          <Skeleton className="h-64 w-full max-w-md" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          <span className="machine">{props.entry?.mime}</span> ·{" "}
          <span className="tnum">{formatSize(props.entry?.size ?? 0)}</span>
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
  // A download that fails used to do it in complete silence: the label went
  // back to "Download" and no file appeared, which reads as a browser that
  // swallowed it rather than as a request that came back bad.
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
      <Button
        variant={props.variant ?? "outline"}
        size={props.size ?? "sm"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(null);
          try {
            const blob = await api.fileBytes(props.projectId, props.path);
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = entryName(props.path);
            link.click();
            URL.revokeObjectURL(url);
          } catch (cause) {
            setFailed(cause instanceof ApiError ? cause.message : "Unable to download this file.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download />
        {busy ? "Preparing…" : "Download"}
      </Button>
      {failed ? <span className="min-w-0 text-xs break-words text-danger">{failed}</span> : null}
    </span>
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
