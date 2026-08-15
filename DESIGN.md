---
name: AgentOS
description: The control room for agents that work while you are not watching.
colors:
  surface: "oklch(0.17 0.01 260)"
  surface-raised: "oklch(0.22 0.012 260)"
  surface-sunken: "oklch(0.13 0.01 260)"
  edge: "oklch(0.32 0.015 260)"
  edge-strong: "oklch(0.44 0.02 260)"
  ink: "oklch(0.97 0.005 260)"
  ink-muted: "oklch(0.72 0.02 260)"
  ink-faint: "oklch(0.58 0.02 260)"
  live: "oklch(0.78 0.16 165)"
  gate: "oklch(0.83 0.14 85)"
  danger: "oklch(0.72 0.17 25)"
  link: "oklch(0.80 0.10 230)"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
  machine:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.edge}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.edge-strong}"
  button-danger:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
    typography: "{typography.body}"
  badge-gate:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.gate}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
    typography: "{typography.label}"
---

# Design System: AgentOS

## Overview

**Creative North Star: "The Night Shift Control Room"**

AgentOS is looked at in two states and no others: a glance on a phone at 23:00 to answer one
question, and a long sit at a desk reading what the machines did overnight. Both are low-light,
both are about *state*, and neither is browsing. The interface is a control room — dim, dense,
instrument-like, with almost no chrome and no decoration competing with the readouts. Nothing here
is trying to be delightful. It is trying to be **unambiguous at a glance and honest under stress**.

The visual system is therefore near-monochrome by default. Colour is not styling; it is signal.
Four hues exist, each owns exactly one meaning, and any screen where more than one of them appears
is telling you something is happening. Type is small and tight because density is the point: the
operator is scanning for the one row that changed. Surfaces are flat and separated by a single
hairline, because a control room reads as panels, not as floating cards.

The anti-reference is the modern SaaS dashboard: gradient hero cards, pastel status pills on
white, generous rounding, an illustration in every empty state. That language flatters the product
and slows the operator down. AgentOS is closer to a terminal that grew a Kanban board.

**Key Characteristics:**
- Dark, flat, hairline-separated panels — no shadows, no gradients, no glass
- Near-monochrome; the four signal hues are rare and each means one thing
- Small type, tight rhythm, machine-monospace for anything an operator might copy
- State is always visible without a click — status, spend, and gate live on the card
- Irreversible and blocked things look different from everything else

## Colors

A near-black blue-grey field with four signal hues that are rationed on purpose.

### Primary
- **Signal Green** (`live`): a session that is *running right now*, and nothing else. The live badge
  on the session viewer, an active goal. Never used for "success" or "saved".
- **Hold Amber** (`gate`): something is waiting on the human and cannot proceed without them —
  an approval gate, an unapproved definition of done, an open inbox question. The colour of a stop,
  not a warning.

### Secondary
- **Fault Red** (`danger`): a failed session, a rejected webhook delivery, a missing secret, a
  destructive control. Reserved for things that are broken or that break things.
- **Trace Blue** (`link`): a link out of AgentOS into a runtime trace or an external system. The
  only colour that means "this leaves the app".

### Neutral
- **Field** (`surface`): the page ground. Everything sits on it.
- **Panel** (`surface-raised`): sidebar, cards, columns, forms. One step up from the field.
- **Well** (`surface-sunken`): input backgrounds and log surfaces — one step *down*, so a place you
  type into and a place the machine writes into read as recessed.
- **Hairline** (`edge`): the only separator in the system. Borders do the work shadows would do.
- **Hairline Strong** (`edge-strong`): hover and focus state of an interactive edge.
- **Ink / Ink Muted / Ink Faint**: primary text, secondary text and labels, timestamps and ids.

### Named Rules

**The One Meaning Rule.** Each signal hue owns exactly one meaning across the whole app: green =
running, amber = waiting on you, red = broken, blue = leaves the app. A hue may never be reused
decoratively, and a status may never be shown in two hues.

**The Rationing Rule.** On a screen at rest, signal hues cover under 5% of the pixels. If a board
looks colourful, something is wrong — and that is exactly the intent.

## Typography

**Interface Font:** system sans (`ui-sans-serif, system-ui, -apple-system, Segoe UI`)
**Machine Font:** system mono (`ui-monospace, SFMono-Regular, Menlo`)

**Character:** Utilitarian and unbranded. The operator's own system font disappears; the monospace
does the signalling, marking every value that came from a machine rather than a person. There is no
display face because there is no marketing surface — the largest text in the product is a page title.

### Hierarchy
- **Title** (600, 18px, 1.3): one per screen, top-left. Names the section and the active project.
- **Body** (400, 14px, 1.5): everything the operator reads — task names, prompts, progress logs.
- **Label** (600, 11px, 0.08em, uppercase): column headers, table headers, section eyebrows. The
  only uppercase in the system.
- **Machine** (400, 12px, mono): ids, tool-call logs, cron expressions, paths, YAML, signing keys,
  spend figures. If a person did not type it, it is monospace.

### Named Rules

**The Machine Voice Rule.** Anything an operator might copy, diff, or paste into a terminal is set
in the machine font: session ids, tool names, file paths, cron strings, secrets. This is a
correctness feature, not a stylistic one — it makes `l` and `1` distinguishable at 12px.

**The One Title Rule.** A screen has exactly one Title. Sub-sections use Label, never a second
title size. Hierarchy comes from weight and colour, not from a scale of headings.

## Layout

A fixed 208px sidebar and a single scrolling content column with 24px padding. The sidebar is the
whole navigation model: thirteen destinations, always visible, no nesting, no collapse. There is
one operator and they memorise it in a day.

Content is laid out on a 12px rhythm (`spacing.md`) with 24px between major blocks. Density is
deliberate: forms are single-line inline rows, not stacked field groups, because every form in this
product is short and the operator fills it repeatedly.

The Kanban board is four equal columns on desktop and one column stacked on mobile. Everything else
is either a table (fixed columns, hairline row separators) or a two-pane split (a 320px list beside
a detail pane) — the split is the pattern whenever an operator needs to move between items without
losing their place.

**The Phone Rule.** The Inbox is the only screen with a real mobile contract: it must be fully
usable at 380px with no horizontal scroll, because that is where it gets used. Every other screen
degrades to a single column and is allowed to be cramped.

## Elevation & Depth

**There are no shadows in AgentOS.** Depth is tonal and comes from exactly three steps: sunken
well, field, raised panel — separated by a single hairline border. A control room is lit flatly;
floating elements imply importance that the data has not earned.

Hover raises the *border*, not the surface: `edge` becomes `edge-strong`. This keeps motion out of
a screen that is already updating on a timer.

**The Flat Field Rule.** No `box-shadow`, no gradient, no blur, no glass. If something needs to
stand apart, it gets a hairline and a tonal step — never a lift.

## Shapes

Two radii and no more: 4px for controls (buttons, inputs, badges, rows) and 8px for panels (cards,
columns, dialogs). Everything is a rectangle with the corners just taken off — square enough to read
as instrumentation, soft enough not to feel like a spreadsheet.

Borders are always 1px and always `edge`. There is no double border, no inset, no divider that is
not also a container edge.

## Components

### Buttons
- **Shape:** 4px radius, 6px × 12px padding, body type.
- **Primary:** `edge` fill, `ink` text. Hover lifts the fill to `edge-strong`.
- **Ghost:** transparent, `ink-muted` text, hover fills to `edge`. Used for anything reversible.
- **Danger:** panel fill with `danger` text, never a filled red button. A destructive action should
  read as serious, not as the most attractive thing on screen.
- **Focus:** a 1px `edge-strong` ring. Never remove the focus ring; this app is used one-handed on a
  phone and keyboard-first at a desk.

### Cards (Kanban)
- 8px radius, `surface-raised` on `surface`, 1px `edge`, 12px padding.
- The card carries state without a click: name in body, gate badge if gated, and at most two
  actions. Anything more goes to the detail pane.

### Inputs
- `surface-sunken` fill, 1px `edge`, 4px radius, 6px × 8px padding.
- **Focus:** border to `edge-strong`. No glow.
- Placeholder is `ink-faint` and describes the value, never repeats the label.

### Tables
- No vertical rules. Rows separated by a top `edge` hairline. Header row in Label type, `ink-faint`.
- Ids and machine values in the machine font, `ink-faint`.

### Badges
- 4px radius, Label type, panel fill, coloured text. Never a filled coloured pill.
- **Gate badge** is the canonical one: amber text reading `approval gate — only you can close this`.

### Log / Progress surfaces
- `surface-sunken`, machine font, one entry per line, timestamp in `ink-faint` then the actor then
  the message. Never truncated with an ellipsis in the middle — an operator reading a log at 2am
  needs the whole line.

### Signature component — the Gate
The approval gate is the one place the product's core promise becomes visible: an agent moved a
card to review and *cannot* close it. It is rendered as an amber badge on the card plus an
explicit "Approve → done" button that only the operator sees. It is never styled as a warning
triangle or an error — it is a normal, expected, everyday stop.

## Do's and Don'ts

### Do:
- **Do** show state on the card. Status, gate, and spend belong where the operator is already
  looking, not behind a click.
- **Do** use the machine font for anything copyable — ids, paths, cron, YAML, tool names.
- **Do** keep signal hues under 5% of a resting screen (**The Rationing Rule**).
- **Do** separate with a 1px `edge` hairline and a tonal step.
- **Do** make the Inbox work at 380px (**The Phone Rule**).
- **Do** show a secret exactly once, in a panel that says it will never be shown again, in the
  machine font, with a copy affordance.

### Don't:
- **Don't** add a shadow, gradient, blur, or glass surface (**The Flat Field Rule**).
- **Don't** reuse a signal hue decoratively, or show one status in two hues (**The One Meaning Rule**).
- **Don't** introduce a third radius, a second title size, or a second border colour.
- **Don't** use filled coloured buttons or pills. Colour rides on text, on a neutral panel.
- **Don't** animate anything that polls. The board and the session viewer refresh on a timer;
  motion on refresh reads as a change that did not happen.
- **Don't** write an empty state that apologises or illustrates. Say what would put something here
  ("No sessions yet. Run a task."), in `ink-muted` body type.
