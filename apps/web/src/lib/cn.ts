import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class joiner for the component layer. `twMerge` is what lets a caller pass
 * `className="px-6"` to a component whose base is `px-3.5` and actually win —
 * without it every override needs a `!important` or a new variant.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
