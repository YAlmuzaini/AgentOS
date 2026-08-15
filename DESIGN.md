---
name: AgentOS
description: The lit operations desk for agents that work while you are not watching.
colors:
  chrome: "oklch(0.9838 0.0018 106.42)"
  canvas: "oklch(1 0 0)"
  panel: "oklch(1 0 0)"
  sunken: "oklch(0.9761 0.002 106.42)"
  edge: "oklch(0.9219 0.0025 106.42)"
  edge-strong: "oklch(0.8574 0.0032 106.42)"
  ink: "oklch(0.2178 0.004 106.42)"
  ink-muted: "oklch(0.5178 0.0043 106.42)"
  ink-faint: "oklch(0.6621 0.0043 106.42)"
  solid: "oklch(0.2178 0.004 106.42)"
  on-solid: "oklch(1 0 0)"
  live: "oklch(0.5905 0.1264 158.6)"
  gate: "oklch(0.5623 0.1416 52.2)"
  danger: "oklch(0.5271 0.1738 27.3)"
  link: "oklch(0.5083 0.1852 264.4)"
  data-violet: "#6155F5"
  data-sky: "#47C2FF"
  data-amber: "#F6B51E"
  data-emerald: "#1FC16B"
typography:
  title:
    fontFamily: "Inter Tight Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter Tight Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter Tight Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
  metric:
    fontFamily: "Inter Tight Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Inter Tight Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1
  machine:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "8px"
  panel: "10px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
shadow:
  lift: "0 1px 2px 0 oklch(0.2178 0.004 106.42 / 0.05)"
  pop: "0 4px 12px -2px oklch(0.2178 0.004 106.42 / 0.1), 0 2px 4px -2px oklch(0.2178 0.004 106.42 / 0.06)"
components:
  button-solid:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.on-solid}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
    typography: "{typography.body}"
  button-outline:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.edge}"
    shadow: "{shadow.lift}"
    rounded: "{rounded.control}"
  button-danger:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.danger}"
    border: "1px solid {colors.danger}"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.panel}"
    border: "1px solid {colors.edge}"
    rounded: "{rounded.panel}"
  well:
    backgroundColor: "{colors.sunken}"
    rounded: "{rounded.control}"
    padding: "12px 14px"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.edge}"
    rounded: "{rounded.control}"
    height: "34px"
    typography: "{typography.body}"
  pill-gate:
    backgroundColor: "{colors.gate}"
    textColor: "{colors.gate}"
    border: "1px solid {colors.gate}"
    rounded: "6px"
    padding: "2px 6px"
    typography: "{typography.label}"
---

# Design System: AgentOS

## Overview

**Creative North Star: "The Daylit Operations Desk"**

AgentOS is a control plane for agents that run while nobody is watching. The operator's real
job is not browsing — it is answering three questions fast: *what ran, what broke, and what is
parked on me.* This system is built so those three answers are legible in one pass of the eye,
on a lit surface, at a desk or one-handed on a phone.

The interface is a warm off-white frame around white working panels. Depth is four tonal steps
and a single hairline: **chrome** sits back, **canvas** is the page, a **panel** sits on the
canvas, a **well** is cut into the panel. There is one shadow in the system and it is 1px — the
only things that lift are the active nav row, the operator card, and the top-bar icon buttons.
Nothing floats to look important.

Colour is rationed and typed. **Signal hues** carry state and nothing else, one meaning each.
**Data hues** carry categories and charts and are forbidden from carrying state. That split is
the load-bearing rule of the whole system: it is what stops a failed session from rendering in
the same green as a healthy one.

**This replaced a previous identity.** AgentOS was formerly "The Night Shift Control Room" —
dark, flat, near-monochrome, with colour riding on text and no filled pills. That world was
retired deliberately, at the operator's direction, in favour of the reference world in
`design-refs/`. Anything in the codebase still reaching for `surface`, `surface-raised`, or
`surface-sunken` is from the old world and is a bug.

**Key characteristics:**
- Warm off-white chrome, white panels, one hairline, and a 1px lift used sparingly
- Two radii: 8px controls, 10px panels
- Status is a tinted pill — soft fill, matching border, saturated text
- Exactly one near-black `solid` button per screen
- Signal hues for state, data hues for category; never swapped
- Small type and tight rhythm: the operator is scanning for the row that changed

## Colors

### Surfaces

Four steps, no more. `chrome` is the frame (sidebar, and the page ground behind the working
sheet). `canvas` and `panel` are both pure white — a panel is distinguished by its border, not
its fill. `sunken` is the well: anything read-only lives in it.

### Signal — one meaning each

- **Live** (emerald): a session that is *running right now*, a goal that is active, a resolvable
  secret, an enabled trigger. Never "success" in the abstract.
- **Gate** (amber): something is waiting on the human and cannot proceed without them — an
  approval gate, an unapproved definition of done, an open inbox question, an unassigned env
  binding. The colour of a stop, not a warning.
- **Danger** (red): a failed session, a missing secret, a rejected webhook delivery, a tripped
  goal rail. Broken, or breaks things.
- **Link** (blue): leaves the app, or is idle information with no state attached.

**The One Meaning Rule.** A tone owns one meaning. If a value is a *category* rather than a
state — the kind of an activity entry, the operation a connection grants — it does not get a
signal hue. It gets a neutral pill with a data-hue dot.

### Data — never status

`data-violet` `#6155F5`, `data-sky` `#47C2FF`, `data-amber` `#F6B51E`, `data-emerald` `#1FC16B`.
These are for meter segments, panel accent marks, and category dots. A data hue must never be the
thing that tells an operator something is wrong.

**These four are not approximations.** They are the reference's own published palette, read off its
spec sheet at `design-refs/agents/05.jpg`, which also names the typeface as **Inter Tight**. An
earlier pass matched both by eye and got both slightly wrong; when a reference states its tokens,
use the stated values.

**The Rationing Rule.** On a resting screen, signal hues stay under about 5% of the surface. A
screen showing three colours is telling you three things are happening.

## Typography

Inter Tight Variable, self-hosted via `@fontsource-variable/inter-tight`; monospace for machine
values. The face is the one the reference names on its own spec sheet, not a lookalike. The ramp is
deliberately short and small — density is the point.

| Step | Size | Use |
|---|---|---|
| metric | 28px / 600 | the one number a metric card is about |
| figure | 22px / 600 | a supporting count beside others, never the headline |
| title | 15px / 600 | page titles, dialog titles |
| body | 13px / 400 | everything the operator reads and every control label |
| label | 11px / 500, 0.06em, uppercase | sidebar group captions, day headings |
| machine | 12px mono | ids, paths, cron, URLs, keys, logs |

**The Machine Voice Rule.** Anything an operator might copy — an id, a path, a cron expression,
a URL, a signing key, a log line — is set in the machine font. Numbers that stack in a column
get `tnum` so they align.

## Layout & Spacing

The shell is a fixed 240px rail beside a white working sheet that is inset from the chrome on
desktop (`lg:m-2`, 10px radius, 1px border) — that inset is what makes the rail read as a frame
rather than as a column. Below `lg` the rail becomes a drawer and the sheet goes edge to edge.

Screens use one of three widths: full, `reading` (max 3xl, for Activity and Inbox), and `form`
(max 2xl, for Settings). Page rhythm is a 20px stack; panels are 16px inside.

Two-pane screens — Goals, Sessions, Files — are a 300–340px list beside a detail pane. That is
the pattern whenever the operator moves between items without wanting to lose their place.

**The Phone Rule.** The Inbox is the only screen with a real mobile contract: fully usable at
390px, every control at least 44px tall, no horizontal scroll. Every other screen degrades to a
single column and is allowed to be cramped. Wide tables scroll inside their own panel so the
page body never scrolls sideways.

## Elevation & Depth

Depth is tonal, not spatial. Four steps and one hairline. `--shadow-lift` (0 1px 2px, 5% ink) is
the only shadow on a resting screen and is reserved for elements that sit on the chrome: the
active nav row, the operator card, top-bar icon buttons, outline buttons. `--shadow-pop` exists
only for things that genuinely float above the page — dialogs, dropdown menus, the mobile drawer.

Hover raises the *border* (`edge` → `edge-strong`) or tints the fill to `sunken`. It never
lifts a panel. Panels do not animate on poll: the board and the session viewer refresh on a
timer, and motion on refresh reads as a change that did not happen.

## Shapes

Two radii and no more: **8px** for controls (buttons, inputs, wells, pills-as-rows) and **10px**
for panels (cards, tables, dialogs, the working sheet). Status pills use 6px because they are
smaller than a control. Borders are always 1px and always `edge`.

## Motion

Two authored moments, and they are the whole budget:

- **`rise`** — a panel arriving: 4px up, 240ms, exponential ease-out. Route changes and newly
  opened create panels and dialogs.
- **`breathe`** — a 2s opacity pulse on the state dot of a session that is *running right now*.
  It is the only thing in the app that repeats, and it earns it: it is the difference between
  "this is live" and "this is a stale screenshot".

Everything else is a colour transition. `prefers-reduced-motion` collapses all of it.

## Components

### Buttons
- **Solid** — near-black fill. Exactly one per screen, on that screen's primary action.
- **Outline** — white, hairline, 1px lift. The default for everything reversible.
- **Ghost** — transparent, muted text. Row-level and tertiary actions.
- **Danger** — white fill, red border, red text. Never a filled red button; a destructive action
  should read as serious, not as the most attractive thing on screen.
- **Disabled** is a lighter surface (`sunken` fill, `ink-faint` text), never the same slab at
  reduced opacity — a dimmed near-black button still pulls the eye to the one control that
  cannot be used.

### Panels
1px `edge`, 10px radius, white. A `PanelHeader` carries a `PanelTitle`, which may wear **either**
a 3px accent mark **or** an icon — never both; they say the same thing twice.

### Status pills
6px radius, label type, `-soft` fill with `-line` border and saturated text. An optional leading
dot, which pulses only for a genuinely running thing. The canonical one is the gate badge: amber,
reading `approval gate`.

**A pill is a label, not a sentence.** It holds one or two words and never wraps. When the state
has more to say than it can show, the long form goes in `title` — the gate badge carries "an agent
cannot mark this done. Only you can close it." there. A pill that wraps has become a paragraph
wearing a border, and at narrow column widths it runs edge to edge and stops reading as a badge.

### Tables
Live inside their own panel and scroll horizontally within it. Header is a `sunken` band in
12px muted text; rows are hairline-separated and tint to `sunken` on hover. Ids, paths and URLs
in the machine font.

### Fields
White fill with a hairline — not a grey well, because the working surface is already white and a
grey input would read as disabled. Every field has a real `<label>` tied to it; a placeholder is
not a label. Focus darkens the border and adds the 2px `solid` ring. Focus is never removed.

### Create surfaces
Two shapes, chosen by whether the operator needs what is underneath:
- **Dialog** — Tasks and Goals. Creating these runs something immediately and deserves protected
  focus.
- **`CreatePanel`** — the configuration screens. A disclosure panel that opens under the page
  header, because adding a repo or an MCP connection is done while reading the table right below
  it, and a modal would cover the rows being copied from.

### Empty states
Say what would put something here, and offer the control that does it. No apology, no
illustration. "No sessions yet. Run a task."

### Signature component — the Gate
The approval gate is where the product's core promise becomes visible: an agent moved a card to
review and *cannot* close it. It is an amber pill on the card plus an "Approve → done" button
only the operator sees. It is never a warning triangle and never an error — it is a normal,
expected, everyday stop.

## Do's and Don'ts

### Do
- **Do** show state on the row. Status, gate, and spend belong where the operator is already
  looking, not behind a click.
- **Do** use the machine font for anything copyable.
- **Do** keep signal hues under 5% of a resting screen (**The Rationing Rule**).
- **Do** give a category a neutral pill with a data-hue dot, never a signal hue.
- **Do** make the Inbox work at 390px (**The Phone Rule**).
- **Do** show a secret exactly once, in a panel that says so, with a copy button.

### Don't
- **Don't** put two primary actions on one screen, or repeat a top-bar fact in the page header.
- **Don't** reuse a signal hue for a second meaning (**The One Meaning Rule**).
- **Don't** introduce a third radius, a second shadow on a resting screen, or a second border
  colour.
- **Don't** dim a solid button to disable it — change its surface.
- **Don't** animate anything that polls.
- **Don't** invent a metric. There is no time series in this product, so there are no trend
  lines; meters show real counts or they are not drawn.
- **Don't** stand an emoji in for an icon. Icons are Lucide, one stroke weight.
