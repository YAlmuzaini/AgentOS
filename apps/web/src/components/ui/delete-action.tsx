import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { ApiError } from "../../api";
import { Button } from "./button";
import { useConfirm } from "./confirm";

/**
 * Removing one row, with the confirmation the row deserves.
 *
 * Every configuration screen could create things and none could remove them,
 * so the first typo was permanent. The control is deliberately a quiet ghost
 * icon at the end of a row rather than a red button: deleting is available,
 * not encouraged, and DESIGN.md keeps filled red out of the system entirely.
 *
 * The server is the authority on whether a removal is allowed — an agent with
 * sessions on record and a session still running both refuse — so a rejection
 * is surfaced as the sentence the API sent rather than a generic failure.
 */
export function DeleteAction({
  what,
  body,
  onDelete,
  invalidate,
  label = "Delete",
  disabled,
}: {
  /** Names the thing, e.g. `senior-dev`. Used in the dialog title. */
  what: string;
  /** What else goes when this goes. */
  body: ReactNode;
  onDelete: () => Promise<unknown>;
  /** Query keys to refetch afterwards. */
  invalidate: unknown[][];
  label?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      for (const key of invalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  return (
    <span className="inline-flex items-center gap-2">
      {remove.isError ? (
        <span className="text-xs text-danger">
          {remove.error instanceof ApiError ? remove.error.message : "Could not delete it."}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${label} ${what}`}
        title={`${label} ${what}`}
        disabled={disabled || remove.isPending}
        onClick={() =>
          confirm({
            kind: "destroy",
            title: `${label} ${what}?`,
            body,
            confirmLabel: label,
            onConfirm: () => remove.mutate(),
          })
        }
      >
        <Trash2 />
      </Button>
    </span>
  );
}
