import type { FileEntryDto } from "@agentos/shared";
import { isTextual } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerLeftUp, File, Folder, Save, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { useProjectGate } from "../hooks/use-project";
import { Time } from "../components/ui/time";
import { Breadcrumb } from "./file-breadcrumb";
import { DownloadButton, entryName, FileBody, formatSize } from "./file-viewer";
import { NoProject, ProjectPending } from "./project-states";

function parentPath(path: string): string {
  if (path === "/") return "/";
  const trimmed = path.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

export function FilesPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const picker = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState("/");
  const [selected, setSelected] = useState<string | null>(null);
  // The editor buffer is stamped with the path it was loaded from. Holding the
  // text alone let a slow read leave the *previous* file's contents in the box
  // while the new path was selected — and Save wrote them to the new path.
  const [draft, setDraft] = useState<{ path: string; content: string } | null>(null);
  const confirm = useConfirm();

  const entries = useQuery({
    queryKey: ["files", projectId, path],
    queryFn: () => api.files(projectId!, path),
    enabled: Boolean(projectId),
  });

  const selectedEntry = (entries.data ?? []).find((entry) => entry.path === selected);
  const editable = selected ? isTextual(selectedEntry?.mime ?? "", selected) : false;

  const save = useMutation({
    mutationFn: () =>
      api.writeFileContent(projectId!, {
        // The path the buffer was loaded from, never the currently highlighted
        // one: they differ for exactly as long as a read is in flight.
        path: draft!.path,
        content: draft!.content,
        mime: selectedEntry?.mime ?? "text/plain",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["file-content", projectId, selected] });
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, path] });
    },
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) =>
      api.uploadFile(projectId!, `${path.replace(/\/$/, "")}/${file.name}`, file),
    onSuccess: (entry) => {
      setSelected(entry.path);
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, path] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteFileContent(projectId!, selected!),
    onSuccess: () => {
      setSelected(null);
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, path] });
    },
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = entries.data ?? [];

  return (
    <Page fill>
      <PageHeader
        icon={<Folder />}
        title="Files"
        meta={<Breadcrumb path={path} onNavigate={setPath} />}
        actions={
          <>
            <input
              ref={picker}
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  uploadFile.mutate(file);
                }
                // Cleared so choosing the same file twice fires again.
                event.target.value = "";
              }}
            />
            <Button
              variant="solid"
              onClick={() => picker.current?.click()}
              disabled={uploadFile.isPending}
            >
              <Upload />
              {uploadFile.isPending ? "Uploading…" : "Upload"}
            </Button>
          </>
        }
      />

      {uploadFile.isError ? (
        <InlineError>
          {uploadFile.error instanceof ApiError
            ? uploadFile.error.message
            : "Unable to upload the file."}
        </InlineError>
      ) : null}

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_1fr]">
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {entries.isLoading ? (
            <SkeletonRows rows={5} />
          ) : (
            <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {path !== "/" ? (
                <li className="border-b border-edge">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-ink-muted transition-colors hover:bg-sunken"
                    onClick={() => setPath(parentPath(path))}
                  >
                    <CornerLeftUp className="size-4 shrink-0 text-ink-faint" />
                    Up one level
                  </button>
                </li>
              ) : null}

              {list.map((entry: FileEntryDto) => (
                <li key={entry.path} className="border-b border-edge last:border-0">
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors ${
                      selected === entry.path ? "bg-sunken" : "hover:bg-sunken/70"
                    }`}
                    onClick={() => {
                      if (entry.kind === "folder") {
                        setPath(entry.path);
                      } else {
                        setSelected(entry.path);
                      }
                    }}
                    aria-current={selected === entry.path}
                  >
                    {entry.kind === "folder" ? (
                      <Folder className="size-4 shrink-0 text-data-sky" />
                    ) : (
                      <File className="size-4 shrink-0 text-ink-faint" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {entryName(entry.path)}
                    </span>
                    {entry.kind === "file" ? (
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="tnum text-xs text-ink-faint">{formatSize(entry.size)}</span>
                        <Time iso={entry.updatedAt} className="text-ink-faint" />
                      </span>
                    ) : (
                      // A folder that holds nothing looked identical to one
                      // holding forty, so the operator had to click to find out.
                      <span className="tnum shrink-0 text-xs text-ink-faint">
                        {entry.childCount ?? 0} file{(entry.childCount ?? 0) === 1 ? "" : "s"}
                      </span>
                    )}
                  </button>
                </li>
              ))}

              {list.length === 0 ? (
                <EmptyState
                  icon={<Folder />}
                  title={path === "/" ? "No files yet" : "This folder is empty"}
                  hint={
                    path === "/"
                      ? "Upload a file or allow an agent to create one through its filesystem tools."
                      : "Upload a file or allow an agent to create one in this folder."
                  }
                />
              ) : null}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
          {selected ? (
            <>
              <PanelHeader className="shrink-0 border-b border-edge">
                <PanelTitle icon={<File />}>
                  <span className="machine text-xs">{selected}</span>
                </PanelTitle>
                <div className="flex gap-2">
                  {editable ? (
                    <Button
                      size="sm"
                      onClick={() => save.mutate()}
                      disabled={save.isPending || draft?.path !== selected}
                    >
                      <Save />
                      {save.isPending ? "Saving…" : "Save"}
                    </Button>
                  ) : (
                    <DownloadButton projectId={project.id} path={selected} />
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      confirm({
                        kind: "destroy",
                        title: "Delete this file?",
                        body: (
                          <>
                            <span className="machine text-ink">{selected}</span> will be removed
                            from object storage. Agents that read it will stop finding it. This
                            cannot be undone.
                          </>
                        ),
                        confirmLabel: "Delete file",
                        onConfirm: () => remove.mutate(),
                      })
                    }
                    disabled={remove.isPending}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </PanelHeader>
              <FileBody
                projectId={project.id}
                path={selected}
                entry={selectedEntry}
                draft={draft}
                onDraft={setDraft}
              />
            </>
          ) : (
            <EmptyState
              icon={<File />}
              title="Select a file"
              hint="Text files can be edited, images can be previewed, and other files can be downloaded."
            />
          )}
        </Panel>
      </div>
    </Page>
  );
}
