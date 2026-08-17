/**
 * The matching behind every on-page filter box.
 *
 * Deliberately dumb: lowercase substring, every word has to hit. No fuzzy
 * ranking — an operator typing "plan risk" is naming a thing they already know
 * exists, and a fuzzy matcher that also returns "plain-text writer" is worse at
 * that job than a plain one.
 */

/** Splits a typed query into the words a row has to satisfy. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * True when every term appears somewhere in the given fields.
 *
 * Pass only fields the operator can actually see on the row or card. A match in
 * text that is not on screen reads as a bug: the result looks unrelated to what
 * was typed.
 */
export function matchesAll(
  terms: string[],
  ...fields: (string | null | undefined)[]
): boolean {
  if (terms.length === 0) {
    return true;
  }
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
