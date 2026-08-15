import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Every screen opens the same way: an icon, the screen's name, and — pinned to
 * the right — the one live fact that screen is about. The reference calls that
 * right-hand slot "AI Agents Running"; here it is whatever the operator would
 * otherwise have to go and count.
 */
export function PageHeader({
  icon,
  title,
  meta,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="shrink-0 text-ink-faint [&_svg]:size-4">{icon}</span> : null}
        <h1 className="truncate text-[15px] font-semibold text-ink">{title}</h1>
        {meta ? <span className="truncate text-[13px] text-ink-faint">{meta}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The standard page shell: one column, one rhythm, one max width. */
export function Page({
  children,
  className,
  width = "full",
  fill,
}: {
  children: ReactNode;
  className?: string;
  /** `reading` narrows to a comfortable measure for text-led screens. */
  width?: "full" | "reading" | "form";
  /**
   * Make the page exactly as tall as the viewport and let its own regions
   * scroll, instead of growing the main scroller.
   *
   * Screens whose content is a list of unknown length need this: with a seeded
   * database the Kanban board ran to 25 cards in one column and the session
   * list to 32 rows, which pushed every column heading and every detail pane
   * off the screen. Fixtures never showed it because fixtures were small.
   */
  fill?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rise",
        // Only from lg up. On a phone the whole page scrolling is correct —
        // turning a single stacked column into its own little scroller is not.
        fill ? "space-y-5 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:space-y-0 lg:gap-5" : "space-y-5",
        width === "reading" ? "mx-auto max-w-3xl" : null,
        width === "form" ? "max-w-2xl" : null,
        className,
      )}
    >
      {children}
    </div>
  );
}
