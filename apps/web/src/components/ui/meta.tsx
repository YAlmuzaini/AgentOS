import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * The reference's card footer: a run of small facts, each an optional glyph
 * beside a value, separated by a hairline dot (design-refs/agents/07.jpg —
 * "Finance Agent · 24 task runs · 1m ago").
 *
 * It was hand-rolled at four call sites, each with its own separator markup
 * and its own idea of the gap, which is how a row of metadata ends up looking
 * different on every screen. The separator is inserted here so it is never a
 * character an operator can select or a screen reader can read out.
 */
export function MetaRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  const items = flatten(children);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted",
        className,
      )}
    >
      {items.map((item, index) => (
        <span key={index} className="flex min-w-0 items-center gap-2">
          {index > 0 ? (
            <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-edge-strong" />
          ) : null}
          {item}
        </span>
      ))}
    </div>
  );
}

/**
 * One fact inside a `MetaRow`. The glyph is decoration for a value that already
 * reads on its own, so it never carries the meaning by itself.
 */
export function Meta({
  icon,
  children,
  machine,
  className,
  title,
}: {
  icon?: ReactNode;
  children: ReactNode;
  /** Ids, paths, models, cron — The Machine Voice Rule. */
  machine?: boolean;
  className?: string;
  title?: string;
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        "flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-faint",
        machine ? "machine" : null,
        className,
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Drops the nullish children a conditional `{x ? <Meta/> : null}` leaves behind. */
function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const walk = (node: ReactNode): void => {
    if (node === null || node === undefined || node === false || node === true) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    out.push(node);
  };
  walk(children);
  return out;
}
