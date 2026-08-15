import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Panel, PanelTitle } from "./panel";

type Accent = "violet" | "sky" | "amber" | "emerald";

const SEGMENT: Record<Accent, string> = {
  violet: "bg-data-violet",
  sky: "bg-data-sky",
  amber: "bg-data-amber",
  emerald: "bg-data-emerald",
};

/**
 * The reference's metric card: accent mark, name, one large number, and a
 * meter underneath that shows what the number is a share of.
 *
 * Every value that reaches this component is a real count from the control
 * plane. There is no trend line here because AgentOS does not keep a time
 * series to draw one from, and a decorative sparkline would be a claim.
 */
export function StatCard({
  label,
  value,
  suffix,
  accent = "violet",
  footer,
  meter,
  className,
}: {
  label: string;
  value: ReactNode;
  /** The denominator, rendered small beside the value. */
  suffix?: ReactNode;
  accent?: Accent;
  footer?: ReactNode;
  meter?: MeterSegment[];
  className?: string;
}): React.JSX.Element {
  return (
    <Panel className={cn("flex flex-col gap-3 p-4", className)}>
      <PanelTitle accent={accent}>{label}</PanelTitle>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-[28px] leading-none font-semibold tracking-tight text-ink">
          {value}
        </span>
        {suffix ? <span className="tnum text-[13px] text-ink-faint">{suffix}</span> : null}
      </div>
      {meter ? <Meter segments={meter} /> : null}
      {footer ? <div className="text-xs text-ink-muted">{footer}</div> : null}
    </Panel>
  );
}

export interface MeterSegment {
  label: string;
  /** Drives the bar width only. */
  value: number;
  /** What the legend prints. Defaults to `value` — set it whenever the value
   *  is a scaled integer (cents, seconds) rather than the number to show. */
  display?: ReactNode;
  accent: Accent;
}

/**
 * A proportional bar. Segments that round to nothing still get a visible sliver,
 * because "one failed session" disappearing into the rail is exactly the fact an
 * operator opened this screen to find.
 */
export function Meter({
  segments,
  className,
}: {
  segments: MeterSegment[];
  className?: string;
}): React.JSX.Element {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunken">
        {total === 0
          ? null
          : segments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <div
                  key={segment.label}
                  className={cn("h-full rounded-full", SEGMENT[segment.accent])}
                  style={{ width: `${Math.max((segment.value / total) * 100, 2)}%` }}
                />
              ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", SEGMENT[segment.accent])}
            />
            {segment.label}
            <span className="tnum font-medium text-ink">{segment.display ?? segment.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
