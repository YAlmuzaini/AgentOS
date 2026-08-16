import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, DollarSign, ShieldAlert, Trash2 } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Button } from "./button";

/**
 * Confirmation for actions that spend money, cannot be undone, or close a gate
 * the whole product exists to hold shut.
 *
 * The rule for using this: an action needs confirmation when repeating it is
 * not free. Running a task dispatches a real agent against real credits;
 * approving a gated task is the one thing an agent is forbidden to do and
 * cannot be walked back; rotating a signing key breaks every caller still
 * using the old one. Reversible, cheap actions do not get a dialog — a
 * confirmation on everything trains the operator to dismiss them unread.
 */
export type ConfirmKind = "spend" | "destroy" | "gate" | "warn";

export interface ConfirmRequest {
  kind: ConfirmKind;
  title: string;
  body: ReactNode;
  /** The button that performs it. Names the action, never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
}

const ConfirmContext = createContext<((request: ConfirmRequest) => void) | null>(null);

const ICON: Record<ConfirmKind, ReactNode> = {
  spend: <DollarSign />,
  destroy: <Trash2 />,
  gate: <ShieldAlert />,
  warn: <AlertTriangle />,
};

const TONE: Record<ConfirmKind, string> = {
  spend: "border-gate-line bg-gate-soft text-gate",
  destroy: "border-danger-line bg-danger-soft text-danger",
  gate: "border-gate-line bg-gate-soft text-gate",
  warn: "border-gate-line bg-gate-soft text-gate",
};

export function ConfirmProvider(props: { children: ReactNode }): React.JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => setRequest(next), []);
  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {props.children}

      <Dialog.Root open={request !== null} onOpenChange={(open) => !open && setRequest(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
          <Dialog.Content className="rise fixed top-1/2 left-1/2 z-[61] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-panel border border-edge bg-panel shadow-pop outline-none">
            {request ? (
              <>
                <div className="p-5">
                  <span
                    className={`mb-4 flex size-9 items-center justify-center rounded-control border [&_svg]:size-4 ${TONE[request.kind]}`}
                  >
                    {ICON[request.kind]}
                  </span>
                  <Dialog.Title className="text-[15px] font-semibold text-ink">
                    {request.title}
                  </Dialog.Title>
                  <Dialog.Description asChild>
                    <div className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
                      {request.body}
                    </div>
                  </Dialog.Description>
                </div>

                <div className="flex justify-end gap-2 border-t border-edge px-5 py-3.5">
                  <Dialog.Close asChild>
                    <Button variant="ghost" autoFocus={request.kind === "destroy"}>
                      Cancel
                    </Button>
                  </Dialog.Close>
                  <Button
                    variant={request.kind === "destroy" ? "danger" : "solid"}
                    // Everything but a delete opens with its action focused, so
                    // Enter confirms. A delete does not: the dialog exists to
                    // put a beat between the intent and the loss, and a
                    // pre-focused destructive button hands that beat back to
                    // whoever was already holding Enter down.
                    autoFocus={request.kind !== "destroy"}
                    onClick={() => {
                      request.onConfirm();
                      setRequest(null);
                    }}
                  >
                    {request.confirmLabel}
                  </Button>
                </div>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ConfirmContext.Provider>
  );
}

/**
 * Returns a function that asks first and runs the action only if the operator
 * agrees. Throws when used outside the provider, which is a wiring bug rather
 * than something to degrade around: silently skipping the confirmation is the
 * one failure mode this component must never have.
 */
export function useConfirm(): (request: ConfirmRequest) => void {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return confirm;
}
