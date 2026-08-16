import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { CreateProjectDialog } from "../../pages/create-project-dialog";
import { selectProject, useProjects } from "../../hooks/use-project";

/**
 * Which project everything below is about (SPEC §4).
 *
 * It sits at the top of the rail and above the nav on purpose: the rows under
 * it — every task, agent, repo, secret and session in the app — change when
 * this changes, and the ones under the hairline near the bottom do not. That
 * split is the only thing in the shell that teaches the operator what a project
 * actually owns, so the card and the divider are doing real work, not
 * decoration.
 *
 * The gear beside it is deliberately a *sibling* rather than a menu item.
 * "Configure this project" and "go to a different project" are different
 * intents, and burying the first inside the second is what made an operator
 * unsure which of the two they were about to do.
 */
export function ProjectSwitcher({
  onNavigate,
}: {
  /** Closes the mobile drawer after a jump; unset on the permanent rail. */
  onNavigate?: () => void;
}): React.JSX.Element | null {
  const { projects, active } = useProjects();
  const [creating, setCreating] = useState(false);

  if (!active) {
    return null;
  }

  return (
    <>
      <div className="flex items-stretch gap-1.5">
        <Menu>
          <MenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-panel border border-edge bg-panel p-2 text-left shadow-lift transition-colors hover:border-edge-strong"
              aria-label={`Project: ${active.name}. Switch project`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-sunken text-[11px] font-semibold text-ink-muted uppercase">
                {active.name.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {active.name}
                </span>
                <span className="machine block truncate text-[11px] text-ink-faint">
                  {active.slug}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-ink-faint" />
            </button>
          </MenuTrigger>

          <MenuContent align="start" className="min-w-56">
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
              Projects
            </p>
            {projects.map((project) => (
              <MenuItem
                key={project.id}
                onSelect={() => {
                  selectProject(project.id);
                  onNavigate?.();
                }}
              >
                {project.id === active.id ? (
                  <Check />
                ) : (
                  // A blank of the same size, so the names form one column
                  // instead of shifting by an icon width as the tick moves.
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="machine shrink-0 text-[11px] text-ink-faint">{project.slug}</span>
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem onSelect={() => setCreating(true)}>
              <Plus />
              New project
            </MenuItem>
          </MenuContent>
        </Menu>

        <Link
          to="/project"
          onClick={onNavigate}
          aria-label={`Settings for ${active.name}`}
          title={`Settings for ${active.name}`}
          // 44px wide: in the mobile drawer this is a thumb target, and it was
          // the narrowest control in the rail at 36.
          className="flex w-11 shrink-0 items-center justify-center rounded-panel border border-edge bg-panel text-ink-faint shadow-lift transition-colors hover:border-edge-strong hover:text-ink"
          activeProps={{
            className:
              "flex w-11 shrink-0 items-center justify-center rounded-panel border border-edge bg-panel text-ink shadow-lift",
          }}
        >
          <Settings2 className="size-4" />
        </Link>
      </div>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
