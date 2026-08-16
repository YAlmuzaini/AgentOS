import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Skeleton } from "../components/ui/feedback";
import { Panel } from "../components/ui/panel";

/** The small presentational pieces the overview is assembled from. */

/**
 * What a metric card prints when it has nothing to count.
 *
 * The success-rate card used to render a bare "—" at the 28px metric step: a
 * stray glyph standing where a number goes, which reads as a rendering fault
 * rather than as an answer. A card with nothing to say says so in words, in the
 * body voice, and lets the number step stay reserved for actual numbers.
 */
export function NoFigure({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="block text-[13px] leading-5 font-normal tracking-normal text-ink-faint">
      {children}
    </span>
  );
}

/**
 * One count in the Fleet panel.
 *
 * The number leads and its name sits under it. It used to be the other way
 * round — three captions in a row with three numbers beneath them — which
 * inverts the metric treatment every other card on this page uses and makes the
 * counts read as footnotes to their own labels. The DOM order is unchanged so
 * the label is still announced before the value; only the paint order flips.
 */
export function Figure(props: {
  icon: ReactNode;
  value: number;
  label: string;
  to: string;
}): React.JSX.Element {
  return (
    <Link
      to={props.to}
      className="group flex flex-col-reverse gap-1.5 rounded-control p-2 transition-colors hover:bg-sunken [&_svg]:size-3.5"
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-faint transition-colors group-hover:text-ink-muted">
        {props.icon}
        <span className="min-w-0 truncate">{props.label}</span>
      </span>
      <span className="tnum text-[22px] leading-none font-semibold text-ink">{props.value}</span>
    </Link>
  );
}

/**
 * The overview's figures while the control plane is still answering.
 *
 * Shaped like the cards it stands in for — accent mark, metric, meter, footnote
 * — because the alternative was painting real zeroes into every card for the
 * length of the first request, and "0 waiting on you" is a claim rather than a
 * loading state.
 */
export function FiguresSkeleton(): React.JSX.Element {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Panel key={index} className="space-y-3 p-4">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-1.5 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="space-y-3 p-4 lg:col-span-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </Panel>
        <Panel className="space-y-3 p-4">
          <Skeleton className="h-3.5 w-16" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
            <Skeleton className="h-11" />
          </div>
        </Panel>
      </div>
    </>
  );
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
