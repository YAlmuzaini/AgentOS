import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus } from "lucide-react";
import { useRef } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { PanelTitle, Well } from "../components/ui/panel";
import { DownloadButton, formatSize } from "./file-viewer";

/**
 * The files a card carries (SPEC §9.2, §10).
 *
 * Attachments are how the chain hands work forward: the spec written in step 1
 * is what the plan agent in step 2 reads, and a reviewer that cannot see the
 * plan is reviewing nothing. Agents attach through their own tool; this is the
 * operator's half — see what is there, add one, take one away.
 */
export function TaskAttachments(props: {
  projectId: string;
  taskId: string;
  attachmentIds: string[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);

  const attachments = useQuery({
    queryKey: ["task-attachments", props.projectId, props.taskId, props.attachmentIds.join(",")],
    queryFn: () => api.taskAttachments(props.projectId, props.taskId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", props.projectId] });
    void queryClient.invalidateQueries({ queryKey: ["task-attachments", props.projectId] });
  };

  /** Upload, then attach: the file has to exist on the disk before it is linked. */
  const add = useMutation({
    mutationFn: async (file: File) => {
      const entry = await api.uploadFile(
        props.projectId,
        `/tasks/${props.taskId}/${file.name}`,
        file,
      );
      const { id } = await api.fileId(props.projectId, entry.path);
      return api.patchTask(props.projectId, props.taskId, {
        attachmentIds: [...props.attachmentIds, id],
      });
    },
    onSuccess: invalidate,
  });

  const detach = useMutation({
    mutationFn: (path: string) =>
      api.fileId(props.projectId, path).then(({ id }) =>
        api.patchTask(props.projectId, props.taskId, {
          attachmentIds: props.attachmentIds.filter((candidate) => candidate !== id),
        }),
      ),
    onSuccess: invalidate,
  });

  const entries = attachments.data ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>Attachments</PanelTitle>
        <input
          ref={picker}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              add.mutate(file);
            }
            event.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => picker.current?.click()}
          disabled={add.isPending}
        >
          <Plus />
          {add.isPending ? "Attaching…" : "Attach"}
        </Button>
      </div>

      {add.isError ? (
        <InlineError>
          {add.error instanceof ApiError ? add.error.message : "Unable to attach the file."}
        </InlineError>
      ) : null}

      {/* Detaching failed silently before: the row stayed on screen and the
          operator had no way to tell whether the file was still on the card. */}
      {detach.isError ? (
        <InlineError>
          {detach.error instanceof ApiError ? detach.error.message : "Unable to detach the file."}
        </InlineError>
      ) : null}

      {entries.length === 0 ? (
        <Well>
          <p className="text-[13px] text-ink-faint">
            No attachments. Added files are available to later tasks and authorized agents.
          </p>
        </Well>
      ) : (
        <ul className="divide-y divide-edge rounded-control border border-edge">
          {entries.map((entry) => (
            <li
              key={entry.path}
              className="flex items-center gap-2 px-3 py-2 transition-colors first:rounded-t-control last:rounded-b-control hover:bg-sunken"
            >
              <Paperclip aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
              <span className="machine min-w-0 flex-1 truncate text-xs text-ink" title={entry.path}>
                {entry.path}
              </span>
              <span className="tnum shrink-0 text-xs text-ink-faint">{formatSize(entry.size)}</span>
              <DownloadButton projectId={props.projectId} path={entry.path} variant="ghost" />
              <Button
                size="sm"
                variant="ghost"
                title={`Detach ${entry.path}`}
                onClick={() => detach.mutate(entry.path)}
                disabled={detach.isPending}
              >
                Detach
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
