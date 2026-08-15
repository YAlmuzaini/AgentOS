import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A panel is a 1px border and nothing else. The whole depth system is: chrome
 * sits back, canvas is the page, a panel sits on the canvas, a well is cut into
 * the panel. Four steps, no shadows between them.
 */
export function Panel({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("rounded-panel border border-edge bg-panel", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn("flex items-center justify-between gap-3 px-4 py-3", className)}
      {...props}
    />
  );
}

/** The accent hues a panel title can carry. Decoration only — never status. */
type Accent = "violet" | "sky" | "amber" | "emerald";

const ACCENT_BAR: Record<Accent, string> = {
  violet: "bg-data-violet",
  sky: "bg-data-sky",
  amber: "bg-data-amber",
  emerald: "bg-data-emerald",
};

/**
 * The title of a panel, optionally with the small upright accent mark the
 * reference uses to tell one metric card from the next at a glance. The mark is
 * a 3px glyph beside the text, never a border on the card itself.
 */
export function PanelTitle({
  children,
  accent,
  icon,
  className,
}: {
  children: ReactNode;
  accent?: Accent;
  icon?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {/* The accent mark and an icon are two ways of saying the same thing, so
          a title never wears both. */}
      {accent && !icon ? (
        <span
          aria-hidden
          className={cn("h-3.5 w-[3px] shrink-0 rounded-full", ACCENT_BAR[accent])}
        />
      ) : null}
      {icon ? <span className="shrink-0 text-ink-faint [&_svg]:size-4">{icon}</span> : null}
      <h2 className="truncate text-[13px] font-medium text-ink">{children}</h2>
    </div>
  );
}

/**
 * A read-only well cut into a panel: descriptions, instruction lists, logs,
 * resolved values. If the operator cannot edit it, it belongs in here.
 */
export function Well({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn("rounded-control bg-sunken px-3.5 py-3", className)} {...props} />
  );
}

/** The small grey caption that names a group of fields or a table section. */
export function SectionLabel({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-[13px] font-medium text-ink", className)} {...props} />;
}

/** The 11px all-caps caption used for sidebar groups and table-adjacent meta. */
export function MicroLabel({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return (
    <p
      className={cn(
        "text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase",
        className,
      )}
      {...props}
    />
  );
}
