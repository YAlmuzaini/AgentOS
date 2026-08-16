import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * The reference's signature object: a rounded square holding one Lucide glyph,
 * filled with a soft tint (design-refs/agents/07.jpg — every agent card opens
 * with one). It is what turns a list of names into a set of things.
 *
 * The tone is a *category*, never a status. A tile therefore only ever wears a
 * data hue or the neutral sunken fill — putting `live` or `danger` in here
 * would break The One Meaning Rule, since a tile appears on every row whether
 * or not anything is happening.
 */
const tile = cva(
  "inline-flex shrink-0 items-center justify-center rounded-control border",
  {
    variants: {
      tone: {
        neutral: "border-edge bg-sunken text-ink-muted",
        violet: "border-data-violet-soft bg-data-violet-soft text-data-violet-ink",
        sky: "border-data-sky-soft bg-data-sky-soft text-data-sky-ink",
        amber: "border-data-amber-soft bg-data-amber-soft text-data-amber-ink",
        emerald: "border-data-emerald-soft bg-data-emerald-soft text-data-emerald-ink",
      },
      size: {
        sm: "size-7 [&_svg]:size-3.5",
        md: "size-9 [&_svg]:size-4",
        lg: "size-11 [&_svg]:size-5",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export type TileTone = NonNullable<VariantProps<typeof tile>["tone"]>;

export function IconTile({
  children,
  tone,
  size,
  className,
}: {
  children: ReactNode;
  tone?: TileTone;
  size?: VariantProps<typeof tile>["size"];
  className?: string;
}): React.JSX.Element {
  return (
    <span aria-hidden className={cn(tile({ tone, size }), className)}>
      {children}
    </span>
  );
}

const CATEGORY_TONES: TileTone[] = ["violet", "sky", "amber", "emerald"];

/**
 * A stable tone for a thing that has no tone of its own.
 *
 * Two neighbours should not be the same colour, and the same thing should not
 * change colour between renders or between screens — so the choice is a hash of
 * its id rather than its index in whatever list is on screen. This is
 * decoration with a job: it makes a row findable again.
 *
 * FNV-1a with murmur3's final avalanche, rather than the obvious `h * 31 + c`.
 * The simple version is uniform over random uuids in bulk and quietly terrible
 * on a real screenful of them: across this project's fourteen seeded agents it
 * produced 5 violet, 3 sky, 6 amber and *no* emerald, with five neighbouring
 * pairs sharing a tone — which defeats the only thing the colour is for. The
 * avalanche step mixes the high bits down and turns that into 2/2/6/4 with two
 * such pairs. Bulk uniformity was never the property this needed.
 */
export function toneFor(key: string): TileTone {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return CATEGORY_TONES[hash % CATEGORY_TONES.length]!;
}
