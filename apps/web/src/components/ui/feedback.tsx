import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { IconTile } from "./icon-tile";

/**
 * An empty state says what would put something here, and gives the control that
 * does it when there is one. It never apologises and never illustrates — an
 * operator reading this wants the next action, not a drawing of a box.
 */
export function EmptyState({
  title,
  hint,
  action,
  icon,
  className,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        // `flex-1` is what stops an empty state from hugging the top of a
        // full-height panel with 500px of white under it — Sessions, Files and
        // the agent rail are all flex columns, so it claims the space and the
        // `justify-center` below finally has something to centre inside. In a
        // block parent it is inert, so every other call site is unaffected.
        "flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <IconTile size="lg" className="mb-1 text-ink-faint">
          {icon}
        </IconTile>
      ) : null}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** The failure surface for anything that reached the server and came back bad. */
export function InlineError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn(
        "rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** A loading placeholder shaped like the thing it is standing in for. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return <div className={cn("animate-pulse rounded-control bg-sunken", className)} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-8" />
      ))}
    </div>
  );
}
