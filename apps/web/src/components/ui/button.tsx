import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/**
 * Exactly one `solid` button belongs on a screen — it is the near-black surface
 * the whole palette is built around, and a second one makes neither of them the
 * primary action. Everything reversible is `outline` or `ghost`; anything
 * destructive is `danger`, which is bordered rather than filled so it never
 * becomes the most attractive thing on the screen.
 */
const button = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Disabled is a lighter surface, never the same slab at low opacity: a
        // dimmed near-black button still reads as the heaviest thing on screen
        // and pulls the eye to the one control that cannot be used.
        solid:
          "bg-solid text-on-solid hover:bg-solid-hover disabled:bg-sunken disabled:text-ink-faint",
        outline:
          "border border-edge bg-panel text-ink shadow-lift hover:bg-sunken hover:border-edge-strong disabled:bg-sunken disabled:text-ink-faint",
        ghost: "text-ink-muted hover:bg-sunken hover:text-ink disabled:text-ink-faint",
        danger:
          "border border-danger-line bg-panel text-danger shadow-lift hover:bg-danger-soft disabled:border-edge disabled:bg-sunken disabled:text-ink-faint",
      },
      size: {
        sm: "h-7 px-2 text-xs [&_svg]:size-3.5",
        md: "h-8.5 px-3 text-[13px] [&_svg]:size-4",
        lg: "h-10 px-4 text-sm [&_svg]:size-4",
        icon: "size-8.5 [&_svg]:size-4",
        "icon-sm": "size-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  /** Render the styling onto the child instead of a <button> — for links. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  type,
  ...props
}: ButtonProps): React.JSX.Element {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      // A <button> inside a <form> submits unless told otherwise, which has
      // silently submitted more half-filled forms than any other default.
      type={asChild ? undefined : (type ?? "button")}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  );
}
