import { Slot } from "@radix-ui/react-slot";
import { ChevronRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A panel that is also a target — the reference's agent card
 * (design-refs/agents/07.jpg). The whole surface opens the thing, not just its
 * title, because a card that is 240px wide and only clickable on one line of
 * text is a card the operator has to aim at.
 *
 * Depth stays tonal: hover raises the hairline and warms the fill, exactly as
 * a table row does. It does not lift, and it does not scale — this app has two
 * authored motions and neither of them is a card growing under the pointer.
 */
export function CardButton({
  className,
  asChild,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }): React.JSX.Element {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      type={asChild ? undefined : "button"}
      className={cn(
        "group flex flex-col gap-3 rounded-panel border border-edge bg-panel p-4 text-left transition-colors",
        "hover:border-edge-strong hover:bg-sunken/50",
        // The ring sits outside the border rather than replacing it, so a
        // focused card does not change size against the ones beside it.
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid",
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * The top line of a card: tile, title, and the one thing worth knowing about it
 * pinned right. Kept as its own component so every card grid in the app puts
 * the status in the same place.
 */
export function CardHead({
  tile,
  title,
  subtitle,
  trailing,
  className,
}: {
  tile?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      {tile}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{title}</p>
        {subtitle ? (
          <p className="machine mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </div>
  );
}

/**
 * The card's own description. Clamped rather than truncated on one line: the
 * reference gives a description three lines and lets the third fade out, which
 * is the difference between "this agent does something" and knowing what.
 */
export function CardBody({
  children,
  lines = 3,
  className,
}: {
  children: ReactNode;
  lines?: 2 | 3;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn(
        "text-[13px] leading-relaxed text-ink-muted",
        lines === 2 ? "line-clamp-2" : "line-clamp-3",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** The chevron a card grows on hover, so it reads as somewhere to go. */
export function CardGo({ className }: { className?: string }): React.JSX.Element {
  return (
    <ChevronRight
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
        className,
      )}
    />
  );
}
