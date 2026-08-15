import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Status is a tinted pill, and each tone owns exactly one meaning:
 *
 *   live    a session is running right now
 *   gate    it is waiting on you and cannot proceed without you
 *   danger  it broke, or it breaks things
 *   idle    a resting, uneventful state — no attention needed
 *   neutral a fact with no state at all (a kind, a count, a mode)
 *
 * Reusing a tone for a second meaning is the fastest way to make a status
 * board unreadable, so the tone list is deliberately short.
 */
const pill = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        live: "border-live-line bg-live-soft text-live",
        gate: "border-gate-line bg-gate-soft text-gate",
        danger: "border-danger-line bg-danger-soft text-danger",
        idle: "border-link-line bg-link-soft text-link",
        neutral: "border-edge bg-sunken text-ink-muted",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const DOT: Record<NonNullable<VariantProps<typeof pill>["tone"]>, string> = {
  live: "bg-live",
  gate: "bg-gate",
  danger: "bg-danger",
  idle: "bg-link",
  neutral: "bg-ink-faint",
};

export function StatusPill({
  children,
  tone = "neutral",
  dot,
  pulse,
  title,
  className,
}: {
  children: ReactNode;
  tone?: VariantProps<typeof pill>["tone"];
  /** Show the leading state dot. Off by default — a text-only pill is quieter. */
  dot?: boolean;
  /** Only a genuinely running thing pulses. */
  pulse?: boolean;
  /** The long form, for a label that has more to say than it can show. */
  title?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span title={title} className={cn(pill({ tone }), className)}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            DOT[tone ?? "neutral"],
            pulse ? "breathe" : null,
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

/** A bare state dot for table rows, where a full pill would be too loud. */
export function Dot({
  tone = "neutral",
  pulse,
  className,
}: {
  tone?: VariantProps<typeof pill>["tone"];
  pulse?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT[tone ?? "neutral"],
        pulse ? "breathe" : null,
        className,
      )}
    />
  );
}

/**
 * The small count chip beside a heading — a column head, a section title. It is
 * a quantity, never a state, so it stays neutral whatever it is counting.
 */
export function CountChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "tnum rounded bg-sunken px-1.5 text-[11px] leading-5 font-medium text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
