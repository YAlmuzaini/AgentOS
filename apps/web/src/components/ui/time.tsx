import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";

/**
 * When something happened, in the two forms an operator needs.
 *
 * The screen reads "4 minutes ago", because that is the question being asked —
 * is this recent? — and the exact stamp is on hover for the moment it matters,
 * which is usually when correlating a run against a bill or a log elsewhere.
 * The machine font is for the exact form only; a relative phrase is prose.
 */
export function Time(props: {
  iso: string | null | undefined;
  /** Show the absolute stamp inline instead of only on hover. */
  absolute?: boolean;
  className?: string;
  /** Rendered when there is no timestamp at all. */
  fallback?: string;
}): React.JSX.Element {
  if (!props.iso) {
    return <span className={cn("text-ink-faint", props.className)}>{props.fallback ?? "—"}</span>;
  }
  const exact = exactTime(props.iso);
  return (
    <span
      className={cn(props.absolute ? "machine text-xs" : "text-xs", props.className)}
      title={exact}
    >
      {props.absolute ? exact : relativeTime(props.iso)}
    </span>
  );
}

/**
 * How long a run took, or has been running.
 *
 * A live session ticks: the number is the answer to "is this stuck?", and one
 * that froze at 3 minutes while the container kept going answers it wrongly.
 * Everything else is static, because a finished run's duration never changes.
 */
export function Duration(props: {
  startedAt: string;
  endedAt?: string | null;
  className?: string;
}): React.JSX.Element {
  const live = !props.endedAt;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const start = Date.parse(props.startedAt);
  const end = props.endedAt ? Date.parse(props.endedAt) : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return <span className={props.className}>—</span>;
  }
  return (
    <span className={cn("tnum", props.className)}>{formatDuration(Math.max(0, end - start))}</span>
  );
}

/** `2026-08-16 11:04:22` — sortable, unambiguous, and copyable. */
export function exactTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ` +
    `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
  );
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
