import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A grant that is also a way in.
 *
 * An agent's skills and its collaboration list are the two grants that name
 * *other things in this project*, and an operator reading them is usually one
 * question away from the thing itself: what is in that skill, what can that
 * agent do. Printed as plain text they were a dead end — the name was there,
 * the way to it was the sidebar and a scan.
 *
 * Same 8px control radius and hairline as everything else you can press. It
 * stays quiet: a grant list is a wall of facts, and fourteen blue links would
 * be reading it as a menu.
 */
export function LinkChip({
  icon,
  children,
  onClick,
  title,
  machine,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  /** The long form — what this skill does, or where the chip lands. */
  title?: string;
  /** For slugs and ids, which are copied and typed rather than read. */
  machine?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-6.5 max-w-full items-center gap-1.5 rounded-control border border-edge",
        "bg-panel px-2 text-xs text-ink transition-colors",
        "hover:border-edge-strong hover:bg-sunken",
        "[&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:text-ink-faint",
      )}
    >
      {icon}
      <span className={cn("truncate", machine ? "machine text-[11px]" : null)}>{children}</span>
    </button>
  );
}

/**
 * The same badge for something this project does not have.
 *
 * A collaboration list can name an agent that was never created, and a skill
 * can be detached after it was granted. That is a real state and worth seeing,
 * so it renders — flat, unpressable, and saying so on hover.
 */
export function DeadChip({
  icon,
  children,
  title,
  machine,
}: {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  machine?: boolean;
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6.5 max-w-full items-center gap-1.5 rounded-control border border-dashed",
        "border-edge px-2 text-xs text-ink-faint",
        "[&_svg]:size-3 [&_svg]:shrink-0",
      )}
    >
      {icon}
      <span className={cn("truncate", machine ? "machine text-[11px]" : null)}>{children}</span>
    </span>
  );
}
