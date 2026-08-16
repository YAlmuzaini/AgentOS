import type { CreateEnvironmentInput, EnvironmentDto } from "@agentos/shared";
import { NETWORKING_MODES } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/feedback";
import { Field, FormActions, Input, Select } from "../components/ui/form";

/**
 * Editing the wall an agent runs behind.
 *
 * Split from the page because it is the one surface here with real rules: a
 * name that cannot change, and a host list that must be empty when networking
 * is open. Both were previously offered as if they were free.
 */
export function EditEnvironmentDialog(props: {
  environment: EnvironmentDto;
  pending: boolean;
  /**
   * A refused save. The dialog stays open on failure, so without this the
   * operator pressed Save, watched it say "Saving…", and got nothing back.
   */
  error?: ReactNode;
  onClose: () => void;
  onSave: (body: CreateEnvironmentInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState(props.environment.name);
  const [networking, setNetworking] = useState<CreateEnvironmentInput["networking"]>(
    props.environment.networking,
  );
  const [hosts, setHosts] = useState(props.environment.allowedHosts.join(", "));

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              props.onSave({
                name,
                networking,
                allowedHosts: hosts
                  .split(",")
                  .map((host) => host.trim())
                  .filter(Boolean),
              });
            }}
          >
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">
                Edit environment
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                Sessions already running keep the policy they started with.
              </Dialog.Description>
            </div>

            <div className="space-y-4 px-5 py-4">
              {/* Read-only: `updateEnvironmentSchema` omits `name`, so Zod
                  stripped any change and Save reported success while the old
                  name came straight back on the next refetch. An environment's
                  name is part of the runtime identity its policy is published
                  under, which is why the contract refuses to move it. */}
              <Field label="Name" hint="Environment names cannot be changed. Create a new environment if needed.">
                {(id) => <Input id={id} value={name} readOnly disabled className="machine" />}
              </Field>
              <Field label="Networking">
                {(id) => (
                  <Select
                    id={id}
                    value={networking}
                    onChange={(event) => {
                      const next = event.target.value as CreateEnvironmentInput["networking"];
                      setNetworking(next);
                      // The server refuses `open` carrying a host list, on the
                      // grounds that it reads as a restriction that is not
                      // enforced. Clearing here means the operator never sends
                      // that pair and never sees the 400.
                      if (next === "open") {
                        setHosts("");
                      }
                    }}
                  >
                    {NETWORKING_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Allowed hosts"
                hint={
                  networking === "open"
                    ? "Open networking reaches any host, so this list must be empty."
                    : "Comma separated. Only these hosts are reachable."
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    className="machine"
                    value={networking === "open" ? "" : hosts}
                    disabled={networking === "open"}
                    onChange={(event) => setHosts(event.target.value)}
                  />
                )}
              </Field>
              {/* Not a validation failure — a statement of what this setting
                  does. It wears the danger surface because taking the wall
                  down is the one change on this dialog that breaks something. */}
              {networking === "open" ? (
                <InlineError>
                  Open networking lets a session reach any host. The allowlist above stops applying.
                </InlineError>
              ) : null}
            </div>

            <div className="border-t border-edge px-5 py-3.5">
              <FormActions
                message={props.error ? <span className="text-danger">{props.error}</span> : null}
              >
                <Button variant="ghost" onClick={props.onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="solid" disabled={!name || props.pending}>
                  {props.pending ? "Saving…" : "Save"}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
