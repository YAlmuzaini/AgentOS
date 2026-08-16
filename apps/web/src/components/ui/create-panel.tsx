import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "./button";
import { FormActions } from "./form";
import { PanelTitle } from "./panel";

/**
 * The create surface for the configuration screens.
 *
 * A right-hand drawer, matching the task sheet, so every "New …" in the app
 * opens the same way. It used to be a panel that pushed itself into the top of
 * the page: the table the operator was reading moved down as they typed, and a
 * long form (a skill's prompt body, an automation's cron and variables) scrolled
 * the list they were copying values from off the screen entirely.
 *
 * The drawer keeps the page still, gives the form its own scroll, and leaves
 * the table visible beside it on a wide screen.
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
  /**
   * May be async. A form that clears itself before the server answered
   * destroys the operator's input on a 400 — so the caller awaits, and only
   * resets when the create actually succeeded.
   */
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
}): React.JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(32rem,100vw)] flex-col border-l border-edge bg-panel shadow-pop outline-none"
        >
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!disabled) {
                // Swallowed here, not by the caller: the child awaits
                // `onSubmit` and a rejection must skip its reset, which only
                // works if the rejection actually reaches it first.
                void Promise.resolve(onSubmit()).catch(() => undefined);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
              <div className="min-w-0">
                <Dialog.Title asChild>
                  <PanelTitle accent="violet">{title}</PanelTitle>
                </Dialog.Title>
                {description ? (
                  <p className="mt-1 text-xs text-ink-muted">{description}</p>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X />
                </Button>
              </Dialog.Close>
            </div>

            {/* The form scrolls, not the page behind it. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">{children}</div>

            <div className="border-t border-edge px-5 py-3.5">
              <FormActions message={error ? <span className="text-danger">{error}</span> : null}>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="solid" disabled={disabled || pending}>
                  {pending ? "Saving…" : submitLabel}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
