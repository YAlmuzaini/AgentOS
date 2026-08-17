import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { cn } from "../../lib/cn";
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
 *
 * It is a floating sheet rather than a full-height column welded to the right
 * edge: a five-field form in a 900px column put its own Cancel and Create four
 * hundred pixels below the last input, and the operator had to cross an empty
 * white field to finish what they were doing. Sized to its content, inset from
 * the edge, and scrolling only once the form is genuinely taller than the
 * viewport.
 */
export function CreatePanel({
  open,
  onClose,
  title,
  description,
  submitLabel,
  pending,
  disabled,
  incomplete,
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
  /** Why the submit is disabled, in the operator's words. */
  incomplete?: ReactNode;
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
          className={cn(
            "rise fixed top-2 right-2 z-50 flex w-[min(32rem,calc(100vw-1rem))] flex-col",
            "rounded-panel border border-edge bg-panel shadow-pop outline-none",
            // Tall enough for its own form and no taller. It used to be
            // `inset-y-0`: a full-height column with a 400px form in it, which
            // put Cancel and Create some 450px below the last field the
            // operator typed in, across an expanse of white. The panel now
            // ends where the form ends and only starts scrolling once it runs
            // out of viewport, and it is inset from the edge like the working
            // sheet rather than welded to it.
            "max-h-[calc(100vh-1rem)]",
          )}
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

            <div className="shrink-0 border-t border-edge px-5 py-3.5">
              <FormActions
                message={
                  error ? (
                    <span className="text-danger">{error}</span>
                  ) : disabled && incomplete ? (
                    // A greyed-out submit with no reason beside it is the most
                    // common way a form stops an operator without telling them
                    // anything. If the caller can name what is missing, it is
                    // said here rather than left to be guessed at.
                    <span className="text-ink-faint">{incomplete}</span>
                  ) : null
                }
              >
                {/* A panel that only presents choices — the catalogue packs,
                    each with its own install button — has nothing to submit,
                    and rendering both "Cancel" and "Close" asked the operator
                    to tell two identical actions apart. It gets one. */}
                {submitLabel ? (
                  <>
                    <Button type="button" variant="ghost" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="solid" disabled={disabled || pending}>
                      {pending ? "Saving…" : submitLabel}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                )}
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
