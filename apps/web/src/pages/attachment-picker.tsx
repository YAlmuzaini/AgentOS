import { useMutation } from "@tanstack/react-query";
import { Paperclip, Plus, X } from "lucide-react";
import { useRef } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { MicroLabel } from "../components/ui/panel";

export interface PickedAttachment {
  id: string;
  path: string;
}

/**
 * Attachments on the create form (SPEC §9.2).
 *
 * The file is uploaded when it is picked, not when the form is submitted, and
 * the card is created with the ids already on it. The other order looks
 * simpler and is wrong: a task scheduled to run "now" starts the moment it is
 * created, and an attachment that arrives a second later arrives after the
 * agent has already read its manifest.
 */
export function AttachmentPicker(props: {
  projectId: string;
  value: PickedAttachment[];
  onChange: (value: PickedAttachment[]) => void;
}): React.JSX.Element {
  const picker = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: async (file: File) => {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const entry = await api.uploadFile(props.projectId, `/uploads/${stamp}-${file.name}`, file);
      return api.fileId(props.projectId, entry.path);
    },
    onSuccess: (attachment) => props.onChange([...props.value, attachment]),
  });

  return (
    <div>
      <MicroLabel className="mb-1.5">Attachments</MicroLabel>
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

      {props.value.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {props.value.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-2 rounded-control border border-edge px-2.5 py-1.5"
            >
              <Paperclip className="size-3.5 shrink-0 text-ink-faint" />
              <span className="machine min-w-0 flex-1 truncate text-xs text-ink">
                {attachment.path}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${attachment.path}`}
                onClick={() =>
                  props.onChange(props.value.filter((entry) => entry.id !== attachment.id))
                }
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => picker.current?.click()}
          disabled={add.isPending}
        >
          <Plus />
          {add.isPending ? "Uploading…" : "Add a file"}
        </Button>
        {add.isError ? (
          <span className="text-[13px] text-danger">
            {add.error instanceof ApiError ? add.error.message : "could not upload that file"}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">
            Text files the agent can read; every step after it inherits them.
          </span>
        )}
      </div>
    </div>
  );
}
