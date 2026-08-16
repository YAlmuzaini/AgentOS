import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { cn } from "../../lib/cn";
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
const GEAR =
  "flex shrink-0 items-center justify-center rounded-control border border-edge bg-panel shadow-lift transition-colors";

export function ProjectSwitcher({
  onNavigate,
}: {
  /** Closes the mobile drawer after a jump; unset on the permanent rail. */
  onNavigate?: () => void;
}): React.JSX.Element | null {
  const { projects, active } = useProjects();
  const [creating, setCreating] = useState(false);
  // Only the mobile drawer passes `onNavigate`, so it is also what tells this
  // control it is being operated by a thumb rather than a pointer.
  const touch = Boolean(onNavigate);

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
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-control border border-edge bg-panel px-2 text-left shadow-lift transition-colors hover:border-edge-strong",
                touch ? "min-h-11" : "h-9",
              )}
              aria-label={`Project: ${active.name} (${active.slug}). Switch project`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-sunken text-[11px] leading-none font-semibold text-ink-muted uppercase">
                {active.name.slice(0, 2)}
              </span>
              {/* Name and slug on one line rather than stacked. Two lines plus
                  padding made this 54px tall in a rail whose every other row is
                  30px, so the first thing the eye landed on was the one control
                  the operator touches least. The slug stays — it is how the CLI
                  addresses the project — but it is a trailing detail, not a
                  second line of heading. */}
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {active.name}
                <span className="machine ml-1.5 text-[11px] font-normal text-ink-faint">
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
          // 44px in the drawer, where it is a thumb target. On the desk rail it
          // matches the switcher beside it instead — a 44px square next to a
          // 36px row made the pair read as two unrelated controls.
          className={cn(GEAR, "text-ink-faint hover:border-edge-strong hover:text-ink", touch ? "size-11" : "size-9")}
          activeProps={{
            className: cn(GEAR, "text-ink", touch ? "size-11" : "size-9"),
          }}
        >
          <Settings2 className="size-4" />
        </Link>
      </div>

      <CreateProjectDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
