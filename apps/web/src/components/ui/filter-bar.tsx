import type { Category } from "@agentos/shared";
import { Search, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { cn } from "../../lib/cn";
import { CategoryFilter } from "./category-filter";

/**
 * The one control that narrows a library screen: type a word, or press a kind.
 *
 * It is a single surface on purpose. Search and the category chips were two
 * separate objects sitting next to each other, at two different heights, each
 * with its own border — three floating parts above a card grid, which is what
 * an unfinished screen looks like. Here the panel is the control: the input has
 * no box of its own, the chips have no box of their own, and one hairline holds
 * the lot. Focus rings the whole bar, the way the ⌘K palette rings its dialog,
 * because inside this surface the input *is* the surface.
 *
 * It is not the ⌘K palette. The palette jumps across the app and closes; this
 * narrows the screen the operator is standing on and stays put.
 *
 * `/` puts the caret here — the one key a scanning operator reaches for without
 * looking. The listener steps aside for a modifier chord, for anything typed
 * into a real field, and for an open dialog: a `/` in the middle of a role
 * prompt is a slash, not a shortcut.
 */
export function FilterBar({
  query,
  onQueryChange,
  label,
  placeholder,
  counts,
  category,
  onCategoryChange,
  total,
  className,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  /** Announced to a screen reader. A placeholder is not a label. */
  label: string;
  placeholder: string;
  /** Populated categories. Under two, the chips are dropped and search stands alone. */
  counts: Map<Category, number>;
  category: Category | null;
  onCategoryChange: (next: Category | null) => void;
  total: number;
  className?: string;
}): React.JSX.Element {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable === true ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if (typing || document.querySelector("[role='dialog']")) {
        return;
      }
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // `CategoryFilter` decides for itself that one populated category is not a
  // choice worth offering. The bar has to know the same thing *before* it
  // renders, or it draws a divider against an empty half.
  const hasChips = [...counts.values()].filter((count) => count > 0).length >= 2;

  return (
    <div className={cn("space-y-2.5", className)}>
      {hasChips ? (
        <CategoryFilter
          counts={counts}
          value={category}
          onChange={onCategoryChange}
          total={total}
        />
      ) : null}

      <div
        className={cn(
          "flex items-center gap-2 rounded-control border border-edge bg-panel px-2.5 transition-colors",
          "has-[input:focus-visible]:border-edge-strong",
          "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-offset-1",
        )}
      >
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
        <Search aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
        <input
          id={id}
          ref={input}
          type="text"
          role="searchbox"
          value={query}
          placeholder={placeholder}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Stop here: Escape in a filter means "clear this", and the
              // drawers and dialogs above would otherwise take it as "close me".
              event.stopPropagation();
              onQueryChange("");
              input.current?.blur();
            }
          }}
          // The field draws the ring for it — see the class list above. This is
          // the documented opt-out: an input that *is* the surface it sits in.
          className="h-8 w-full min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:outline-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onQueryChange("");
              input.current?.focus();
            }}
            className={cn(
              "relative flex size-6 shrink-0 items-center justify-center rounded-control",
              "text-ink-faint transition-colors hover:bg-sunken hover:text-ink",
              // 24px is the size it should look; 44px is what a thumb has to
              // hit. Same trick the Switch uses, for the same reason.
              "before:absolute before:-inset-2.5 before:content-['']",
            )}
          >
            <X className="size-3.5" />
          </button>
        ) : (
          // A hint, not a control. Hidden where there is no keyboard to press it
          // with, and where the row is tight enough to need the space.
          <kbd
            aria-hidden
            className="machine hidden shrink-0 rounded border border-edge px-1 text-[11px] leading-4 text-ink-faint sm:block"
          >
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
