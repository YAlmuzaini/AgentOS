import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

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
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-1 flex size-9 items-center justify-center rounded-control border border-edge bg-sunken text-ink-faint [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {hint ? <p className="max-w-sm text-[13px] text-ink-muted">{hint}</p> : null}
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
