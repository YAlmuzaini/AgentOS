import { useState } from "react";

/**
 * Selection that the URL can drive and a click can override.
 *
 * The command palette navigates with `?id=`, and the naive version — copy it
 * into `useState` once — meant picking a second search result while already on
 * the page changed the address bar and nothing else. Reading the URL alone is
 * the opposite mistake: an ordinary row click would then need a navigation to
 * take effect.
 *
 * So the URL wins whenever it *changes*, and a click wins in between.
 */
export function useUrlSelection(
  idFromUrl: string | undefined,
): [string | null, (next: string | null) => void] {
  const [picked, setPicked] = useState<string | null>(idFromUrl ?? null);
  const [lastUrlId, setLastUrlId] = useState<string | null>(idFromUrl ?? null);

  if ((idFromUrl ?? null) !== lastUrlId) {
    setLastUrlId(idFromUrl ?? null);
    setPicked(idFromUrl ?? null);
  }

  return [picked, setPicked];
}
