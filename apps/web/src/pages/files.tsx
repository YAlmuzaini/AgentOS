import type { FileEntryDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerLeftUp, File, Folder, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

function parentPath(path: string): string {
  if (path === "/") return "/";
  const trimmed = path.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx <= 0 ? "/" : trimmed.slice(0, idx);
}

export function FilesPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const [path, setPath] = useState("/");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");

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
    if (file.data) {
      setContent(file.data.content);
    }
  }, [file.data]);

  const save = useMutation({
    mutationFn: () =>
      api.writeFileContent(projectId!, {
        path: selected!,
        content,
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
      setContent("");
      void queryClient.invalidateQueries({ queryKey: ["files", projectId, path] });
    },
  });

  if (!project) {
    return <NoProject />;
  }

  const list = entries.data ?? [];

  return (
    <Page>
      <PageHeader icon={<Folder />} title="Files" meta={path} />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Panel className="h-fit overflow-hidden">
          {entries.isLoading ? (
            <SkeletonRows rows={5} />
          ) : (
            <ul>
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

        <Panel className="min-w-0">
          {selected ? (
            <>
              <PanelHeader className="border-b border-edge">
                <PanelTitle icon={<File />}>
                  <span className="machine text-xs">{selected}</span>
                </PanelTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                    <Save />
                    {save.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </PanelHeader>
              <div className="p-4">
                <textarea
                  className="machine h-[60vh] w-full resize-none rounded-control bg-sunken p-3.5 text-xs leading-relaxed text-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-solid"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
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
