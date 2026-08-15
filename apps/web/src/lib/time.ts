/**
 * Relative time for the "when did this last happen" columns.
 *
 * An operator scanning a schedule table wants to know whether something ran
 * recently, not to read an ISO string — so these columns say "2 hours ago" and
 * keep the exact timestamp on the element's `title` for when it matters.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return iso;
  }

  const elapsed = Date.now() - then;
  if (elapsed < 0) {
    return "scheduled";
  }
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    return plural(Math.floor(elapsed / MINUTE), "minute");
  }
  if (elapsed < DAY) {
    return plural(Math.floor(elapsed / HOUR), "hour");
  }
  return plural(Math.floor(elapsed / DAY), "day");
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}
