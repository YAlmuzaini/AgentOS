import type { ProjectDto } from "@agentos/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { Field, FormActions, Input } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";

/**
 * What this project is called, here and from the CLI.
 *
 * The slug is not cosmetic: it is how `agentos push` and `agentos pull` address
 * the project, so renaming it repoints a YAML file that may be committed in a
 * repo somewhere. The panel says that rather than letting an operator find out
 * from a failed sync.
 */
export function ProjectIdentity({ project }: { project: ProjectDto }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [slug, setSlug] = useState(project.slug);

  // Switching projects with this page open swaps the subject underneath the
  // form; without this the fields keep the previous project's values and the
  // next save renames the wrong workspace.
  useEffect(() => {
    setName(project.name);
    setSlug(project.slug);
  }, [project.id, project.name, project.slug]);

  const save = useMutation({
    mutationFn: () => api.updateProject(project.id, { name: name.trim(), slug: slug.trim() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const changed = name.trim() !== project.name || slug.trim() !== project.slug;

  // Said out loud on the field rather than only expressed as a dead button. An
  // operator who pasted "Todo App" into the slug was previously left with a
  // greyed-out Rename and nothing telling them which of the two fields it was
  // waiting on. Only complained about once the operator has typed something,
  // so an empty field is not scolded before it has been used.
  const nameError = name.trim().length === 0 ? "Project name is required." : null;
  const slugError =
    slug.trim().length === 0
      ? "Project slug is required for CLI commands."
      : /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())
        ? null
        : "Lowercase letters, digits and single hyphens only.";
  const valid = !nameError && !slugError;

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="emerald">Identity</PanelTitle>
      </PanelHeader>
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={nameError}>
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Slug" required error={slugError}>
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={slug}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setSlug(event.target.value)}
              />
            )}
          </Field>
        </div>

        <Well className="space-y-1">
          <p className="text-xs text-ink-muted">
            The CLI addresses this project by slug. Renaming it changes the command:
          </p>
          <p className="machine text-xs text-ink">agentos pull --project {slug.trim() || "…"}</p>
        </Well>

        <FormActions
          message={
            save.isError ? (
              <span className="text-danger">
                {save.error instanceof ApiError
                  ? save.error.message
                  : "Unable to save project details."}
              </span>
            ) : changed ? (
              // Dirty is worth saying: this panel sits above two more panels and
              // an operator who edits it and scrolls past has no other cue that
              // the rename has not happened yet.
              <span className="text-ink-muted">Unsaved changes.</span>
            ) : save.isSuccess ? (
              <span className="text-ink-faint">Saved.</span>
            ) : null
          }
        >
          <Button type="submit" variant="outline" disabled={!changed || !valid || save.isPending}>
            {save.isPending ? "Saving…" : "Rename"}
          </Button>
        </FormActions>
      </form>
    </Panel>
  );
}
