import type { FileEntryDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

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
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <section className="space-y-3">
        <h1 className="text-lg font-semibold">Files</h1>
        <div className="machine text-xs text-ink-muted">{path}</div>
        <ul className="space-y-1">
          {path !== "/" ? (
            <li>
              <button
                className="w-full rounded-sm border border-edge bg-surface-raised px-2 py-1.5 text-left text-sm text-ink-muted hover:bg-edge"
                onClick={() => setPath(parentPath(path))}
              >
                ..
              </button>
            </li>
          ) : null}
          {(entries.data ?? []).map((entry: FileEntryDto) => (
            <li key={entry.path}>
              <button
                className={`w-full rounded-sm border border-edge px-2 py-1.5 text-left text-sm ${
                  selected === entry.path ? "bg-edge" : "bg-surface-raised"
                }`}
                onClick={() => {
                  if (entry.kind === "folder") {
                    setPath(entry.path);
                  } else {
                    setSelected(entry.path);
                  }
                }}
              >
                <span>{entry.kind === "folder" ? "📁" : "📄"}</span>{" "}
                <span>{entry.path.split("/").pop()}</span>
                {entry.kind === "file" ? (
                  <span className="ml-2 machine text-xs text-ink-faint">{entry.size}b</span>
                ) : null}
              </button>
            </li>
          ))}
          {entries.data?.length === 0 ? (
            <li className="text-sm text-ink-muted">No files here yet.</li>
          ) : null}
        </ul>
      </section>

      <section>
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="machine text-sm">{selected}</h2>
              <div className="flex gap-2">
                <button
                  className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong"
                  onClick={() => save.mutate()}
                >
                  Save
                </button>
                <button
                  className="rounded-sm bg-surface-raised px-3 py-1.5 text-sm text-danger"
                  onClick={() => remove.mutate()}
                >
                  Delete
                </button>
              </div>
            </div>
            <textarea
              className="h-[60vh] w-full rounded-sm border border-edge bg-surface-sunken p-3 font-mono text-xs"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Select a file to view its contents.</p>
        )}
      </section>
    </div>
  );
}
