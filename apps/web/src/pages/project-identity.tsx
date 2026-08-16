import type { ProjectDto } from "@agentos/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { Field, Input } from "../components/ui/form";
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
  const valid =
    name.trim().length > 0 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim());

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
          <Field label="Name">
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Slug">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={slug}
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

        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" disabled={!changed || !valid || save.isPending}>
            {save.isPending ? "Saving…" : "Rename"}
          </Button>
          {save.isError ? (
            <span className="text-[13px] text-danger">
              {save.error instanceof ApiError ? save.error.message : "Unable to save project details."}
            </span>
          ) : null}
          {save.isSuccess && !changed ? (
            <span className="text-[13px] text-ink-faint">Saved.</span>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
