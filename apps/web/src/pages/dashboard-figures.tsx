import type { MeterSegment } from "../components/ui/stat";
import { Link } from "@tanstack/react-router";
import { cn } from "../lib/cn";

/** The small presentational pieces the overview is assembled from. */
export function BoardMeter(props: { segments: MeterSegment[] }): React.JSX.Element {
  const total = props.segments.reduce((sum, s) => sum + s.value, 0);
  const fill: Record<string, string> = {
    violet: "bg-data-violet",
    sky: "bg-data-sky",
    amber: "bg-data-amber",
    emerald: "bg-data-emerald",
  };

  return (
    <div className="space-y-2">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunken">
        {total === 0
          ? null
          : props.segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.label}
                  className={`h-full rounded-full ${fill[s.accent]}`}
                  style={{ width: `${Math.max((s.value / total) * 100, 2)}%` }}
                />
              ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {props.segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden className={`size-1.5 rounded-full ${fill[s.accent]}`} />
            {s.label}
            <span className="tnum font-medium text-ink">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Figure(props: {
  icon: React.ReactNode;
  value: number;
  label: string;
  to: string;
}): React.JSX.Element {
  return (
    <Link
      to={props.to}
      className="rounded-control p-2 transition-colors hover:bg-sunken [&_svg]:size-3.5"
    >
      <dt className="flex items-center gap-1.5 text-xs text-ink-faint">
        {props.icon}
        {props.label}
      </dt>
      <dd className="tnum mt-1 text-[22px] leading-none font-semibold text-ink">{props.value}</dd>
    </Link>
  );
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Session states that still hold a runtime container.
 *
 * `waiting-inbox` is the one worth naming: it holds its container on purpose,
 * for as long as the operator takes to answer, and that is exactly the case
 * where "idle" would be the most expensive word on the screen.
 */
const HOLDS_CONTAINER = new Set(["starting", "running", "committing", "waiting-inbox"]);
