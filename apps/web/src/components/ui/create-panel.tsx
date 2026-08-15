import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "./button";
import { FormActions } from "./form";
import { Panel, PanelHeader, PanelTitle } from "./panel";

/**
 * The create surface for the configuration screens.
 *
 * Deliberately not a modal: adding a repo or an MCP connection is done while
 * reading the table right underneath it, and a dialog would cover exactly the
 * rows the operator is copying values from. It stays closed until asked for, so
 * the resting screen is just the table.
 */
export function CreatePanel({
  open,
  onClose,
  title,
  description,
  submitLabel,
  pending,
  disabled,
  error,
  onSubmit,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  pending?: boolean;
  disabled?: boolean;
  error?: ReactNode;
  onSubmit: () => void;
  children: ReactNode;
}): React.JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <Panel className="rise overflow-hidden">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!disabled) {
            onSubmit();
          }
        }}
      >
        <PanelHeader className="border-b border-edge">
          <div className="min-w-0">
            <PanelTitle accent="violet">{title}</PanelTitle>
            {description ? (
              <p className="mt-1 text-xs text-ink-muted">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </PanelHeader>

        <div className="space-y-4 p-4">{children}</div>

        <div className="border-t border-edge px-4 py-3.5">
          <FormActions message={error ? <span className="text-danger">{error}</span> : null}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="solid" disabled={disabled || pending}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </FormActions>
        </div>
      </form>
    </Panel>
  );
}
