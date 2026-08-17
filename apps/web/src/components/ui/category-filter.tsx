import { CATEGORY_HINTS, CATEGORY_LABELS, type Category } from "@agentos/shared";
import { cn } from "../../lib/cn";

/**
 * A row of category chips for a library screen.
 *
 * It only renders the categories that are actually populated, and only when
 * there is more than one of them — a filter offering a single choice is
 * furniture. Each chip carries its own count, because the useful question is
 * "is there anything in security" rather than "does security exist".
 *
 * Selection changes the *surface*, not the opacity: a dimmed chip reads as
 * disabled, and `DESIGN.md` reserves the near-black slab for the screen's one
 * primary action, which a filter is not. So the selected chip is the sunken
 * surface with full-strength ink, and the rest sit on the panel.
 */
export function CategoryFilter({
  counts,
  value,
  onChange,
  total,
}: {
  /** How many items sit in each category. Empty categories are not offered. */
  counts: Map<Category, number>;
  /** The selected category, or null for "everything". */
  value: Category | null;
  onChange: (next: Category | null) => void;
  total: number;
}): React.JSX.Element | null {
  const present = [...counts.entries()].filter(([, count]) => count > 0);
  if (present.length < 2) {
    return null;
  }

  return (
    <div
      className={cn(
        "-mx-1 flex gap-1.5 px-1",
        // Thirteen chips wrap to seven rows on a phone, which spends a quarter
        // of a 390×844 viewport before the first card. Below `sm` they are one
        // scrolling line instead — the container scrolls, the page never does,
        // which is the rule wide content follows everywhere else in this app.
        "snap-x snap-mandatory flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "sm:flex-wrap sm:overflow-visible",
      )}
      role="group"
      aria-label="Filter by category"
    >
      <Chip
        selected={value === null}
        count={total}
        onClick={() => onChange(null)}
        label="All"
        hint="Everything in this project, regardless of category."
      />
      {present.map(([category, count]) => (
        <Chip
          key={category}
          selected={value === category}
          count={count}
          onClick={() => onChange(value === category ? null : category)}
          label={CATEGORY_LABELS[category]}
          hint={CATEGORY_HINTS[category]}
        />
      ))}
    </div>
  );
}

function Chip({
  selected,
  count,
  label,
  hint,
  onClick,
}: {
  selected: boolean;
  count: number;
  label: string;
  hint: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 shrink-0 snap-start items-center gap-1.5 rounded-control border px-2 text-xs",
        "font-medium whitespace-nowrap transition-colors",
        selected
          ? "border-edge-strong bg-sunken text-ink"
          : "border-edge bg-panel text-ink-muted hover:bg-sunken hover:text-ink",
      )}
    >
      {label}
      <span className={cn("machine text-[11px]", selected ? "text-ink-muted" : "text-ink-faint")}>
        {count}
      </span>
    </button>
  );
}

/** Counts per category, in the catalogue's own order rather than by size. */
export function countByCategory<T extends { category: Category }>(
  items: T[],
  order: readonly Category[],
): Map<Category, number> {
  const counts = new Map<Category, number>();
  for (const category of order) {
    const count = items.filter((item) => item.category === category).length;
    if (count > 0) {
      counts.set(category, count);
    }
  }
  return counts;
}
