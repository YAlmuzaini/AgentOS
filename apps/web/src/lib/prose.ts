/**
 * Undo terminal-width line wrapping without destroying deliberate structure.
 *
 * Prompts, briefs and definitions of done are written in editors and YAML at
 * about 70 columns, so they arrive with a hard newline every ~70 characters.
 * Rendered with `whitespace-pre-wrap` — which is correct, because some of them
 * really do contain lists — those breaks are reproduced exactly, and a prompt
 * stops dead two-thirds of the way across a wide panel with white space after
 * every line. It reads as a layout bug rather than as the author's formatting.
 *
 * Unwrapping everything is the other wrong answer: a numbered list or an
 * indented block collapses into one run-on paragraph.
 *
 * So a line is joined to the one above only when the one above looks *soft
 * wrapped*: long enough to have hit the wrap column, and not followed by
 * something that is obviously structural. Blank lines, list markers, headings,
 * quotes, indentation and short lines all survive untouched.
 */

/** A line that starts a structure of its own and must keep its own line. */
const STRUCTURAL = /^\s*(?:[-*+•]\s|\d+[.)]\s|#{1,6}\s|>\s|\||```)/;

/**
 * Below this, a line ended because the author meant it to — a heading, a short
 * bullet, a closing sentence — not because it ran out of terminal.
 */
const WRAP_FLOOR = 55;

export function reflow(text: string): string {
  if (!text) {
    return text;
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const previous = out[out.length - 1];
    const joinable =
      previous !== undefined &&
      previous.trim().length >= WRAP_FLOOR &&
      !STRUCTURAL.test(previous) &&
      !STRUCTURAL.test(line) &&
      // An indented line is part of a block, not a continuation of prose.
      !/^\s/.test(line) &&
      line.trim().length > 0;

    if (joinable) {
      out[out.length - 1] = `${previous.trimEnd()} ${line.trim()}`;
    } else {
      out.push(line);
    }
  }

  return out.join("\n");
}
