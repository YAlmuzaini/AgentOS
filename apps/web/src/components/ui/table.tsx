import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../lib/cn";
import { Panel } from "./panel";

/**
 * Tables live inside their own panel and scroll horizontally inside it, so a
 * wide column set never widens the page. The header is a tinted band; rows are
 * separated by the same hairline as everything else.
 */
export function TableCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <Panel className={cn("overflow-hidden", className)} {...props}>
      <div className="overflow-x-auto">{children}</div>
    </Panel>
  );
}

export function Table({
  className,
  ...props
}: HTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <table className={cn("w-full border-collapse text-left text-[13px]", className)} {...props} />
  );
}

export function THead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return <thead className={cn("bg-sunken", className)} {...props} />;
}

export function TH({
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      className={cn(
        "border-b border-edge px-3 py-2.5 text-xs font-medium whitespace-nowrap text-ink-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TR({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>): React.JSX.Element {
  return (
    <tr
      className={cn(
        "border-b border-edge transition-colors last:border-0 hover:bg-sunken/70",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return <td className={cn("px-3 py-2.5 align-middle text-ink", className)} {...props} />;
}
