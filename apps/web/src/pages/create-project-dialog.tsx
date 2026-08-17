import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { Field, FormActions, Input } from "../components/ui/form";
import { selectProject } from "../hooks/use-project";
import { useNavigate } from "@tanstack/react-router";

/**
 * A second workspace (SPEC §4, §17).
 *
 * A project is the isolation boundary, not a folder: its agents, repos,
 * secrets, files, tasks and sessions are invisible to every other project, and
 * an agent working here cannot be granted anything that lives somewhere else.
 * The dialog says so, because "new project" otherwise reads like a label and
 * the operator has no way to know it is the thing keeping two clients' code
 * apart.
 */
export function CreateProjectDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  // Kept separately from `name` once touched, so an operator who wants
  // `todo-app` for "Todo App v2" is not fighting the auto-fill on every
  // keystroke.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  // Whether the operator has typed anything at all yet, which is what decides
  // when the fields are allowed to complain.
  const [touched, setTouched] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const create = useMutation({
    mutationFn: () => api.createProject({ name: name.trim(), slug: effectiveSlug }),
    onSuccess: (project) => {
      // Switch to it: creating a project and then still looking at the old one
      // is the kind of quiet no-op that gets an operator filing tasks in the
      // wrong workspace.
      selectProject(project.id);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      reset();
      props.onOpenChange(false);
      void navigate({ to: "/project" });
    },
  });

  function reset(): void {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setTouched(false);
    create.reset();
  }

  // Only complained about once the field has been touched — a dialog that opens
  // already scolding both of its empty fields reads as broken. Until then the
  // submit is simply not armed, and the hints say what it is waiting for.
  const nameError = touched && name.trim().length === 0 ? "Project name is required." : null;
  const slugError =
    touched && effectiveSlug.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effectiveSlug)
      ? "Lowercase letters, digits and single hyphens only."
      : null;
  const valid = name.trim().length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effectiveSlug);

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          reset();
        }
        props.onOpenChange(open);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">
                New project
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                Create an isolated workspace for agents, repositories, secrets, files, and history.
              </Dialog.Description>
            </div>

            <div className="space-y-4 px-5 py-4">
              <Field label="Name" required error={nameError}>
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(event) => {
                      setTouched(true);
                      setName(event.target.value);
                    }}
                    placeholder="Todo App"
                    autoFocus
                  />
                )}
              </Field>

              <Field
                label="Slug"
                required
                error={slugError}
                hint={
                  <>
                    How the CLI addresses it:{" "}
                    <span className="machine">agentos pull --project {effectiveSlug || "<slug>"}</span>
                  </>
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    className="machine"
                    value={effectiveSlug}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                      setTouched(true);
                      setSlugTouched(true);
                      setSlug(event.target.value);
                    }}
                    placeholder="todo-app"
                  />
                )}
              </Field>

              <p className="text-xs leading-relaxed text-ink-faint">
                Projects do not create a local code folder. Import configuration with{" "}
                <span className="machine text-ink-muted">agentos push</span>, then add repositories
                and agents as required.
              </p>
            </div>

            <div className="border-t border-edge px-5 py-3.5">
              <FormActions
                message={
                  create.isError ? (
                    <span className="text-danger">
                      {create.error instanceof ApiError
                        ? create.error.message
                        : "Project creation failed."}
                    </span>
                  ) : null
                }
              >
                <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="solid" disabled={!valid || create.isPending}>
                  {create.isPending ? "Creating…" : "Create project"}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
