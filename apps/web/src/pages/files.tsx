import type { FileEntryDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerLeftUp, File, Folder, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { useProjectGate } from "../hooks/use-project";
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

  const file = useQuery({
    queryKey: ["file-content", projectId, selected],
    queryFn: () => api.fileContent(projectId!, selected!),
    enabled: Boolean(projectId && selected),
  });

  useEffect(() => {
    if (file.data && selected) {
      setDraft({ path: selected, content: file.data.content });
    }
  }, [file.data, selected]);

  // Only ever the text that belongs to the open path. Anything else is either
  // still loading or failed, and both must leave the editor empty and disabled
  // rather than showing a neighbouring file's contents.
  const loaded = draft && draft.path === selected ? draft : null;

  const save = useMutation({
    mutationFn: () =>
      api.writeFileContent(projectId!, {
        // The path the buffer was loaded from, never the currently highlighted
        // one: they differ for exactly as long as a read is in flight.
        path: loaded!.path,
        content: loaded!.content,
        mime: file.data?.mime ?? "text/plain",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["file-content", projectId, selected] });
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
      <PageHeader icon={<Folder />} title="Files" meta={path} />

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
                      {entry.path.split("/").pop()}
                    </span>
                    {entry.kind === "file" ? (
                      <span className="tnum shrink-0 text-xs text-ink-faint">{entry.size}b</span>
                    ) : null}
                  </button>
                </li>
              ))}

              {list.length === 0 ? (
                <EmptyState icon={<Folder />} title="No files here yet" />
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
                  <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending || !loaded}>
                    <Save />
                    {save.isPending ? "Saving…" : "Save"}
                  </Button>
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
              <div className="space-y-3 p-4 lg:min-h-0 lg:flex-1">
                {/* A read that failed must say so. Leaving the box editable and
                    empty invited the operator to "fix" the file by saving over
                    it with nothing. */}
                {file.isError ? (
                  <InlineError>
                    {file.error instanceof ApiError
                      ? file.error.message
                      : "could not read this file"}
                  </InlineError>
                ) : null}
                <textarea
                  className="machine h-[60vh] w-full resize-none rounded-control bg-sunken p-3.5 text-xs leading-relaxed text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-solid disabled:opacity-50 lg:h-full"
                  value={loaded?.content ?? ""}
                  disabled={!loaded}
                  onChange={(event) =>
                    loaded ? setDraft({ path: loaded.path, content: event.target.value }) : undefined
                  }
                  aria-label={`Contents of ${selected}`}
                  spellCheck={false}
                />
              </div>
            </>
          ) : (
            <EmptyState
              icon={<File />}
              title="Select a file"
              hint="Its contents open here, editable in place."
            />
          )}
        </Panel>
      </div>
    </Page>
  );
}
