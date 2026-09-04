---
name: Contribute
description: One quiet contribution run from local work to accepted change.
colors:
  accent: "var(--accent)"
  accent-foreground: "var(--accent-fg)"
  background: "var(--bg)"
  surface: "var(--surface)"
  surface-muted: "var(--surface2, var(--surface))"
  text: "var(--text)"
  text-muted: "var(--muted)"
  border: "var(--border)"
  success: "var(--green)"
  caution: "#cf9526"
  danger: "var(--danger)"
typography:
  headline:
    fontFamily: "var(--font)"
    fontSize: "clamp(22px, 3vw, 26px)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  title:
    fontFamily: "var(--font)"
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  body:
    fontFamily: "var(--font)"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "var(--font)"
    fontSize: "11.5px"
    fontWeight: 650
    lineHeight: 1.35
  micro-label:
    fontFamily: "var(--font)"
    fontSize: "10.5px"
    fontWeight: 650
    lineHeight: 1.35
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  chip: "5px"
  control: "8px"
  compact-surface: "10px"
  surface: "15px"
spacing:
  compact: "7px"
  item: "12px"
  section: "20px"
  room: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.compact-surface}"
    padding: "9px 12px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.control}"
    padding: "6px 2px"
    height: "36px"
  content-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.surface}"
    padding: "14px"
---

# Design System: Contribute

## Overview

**Creative North Star: "One Quiet Run"**

Contribute feels like a calm handoff between finished work and accepted change,
not a Git client, project tracker, or administrative dashboard. There is one
owner-facing run. It leads with the exact decisions that can move now, then
shows private/public work already moving and a short outcome trail.

The source chat is the natural start and return point. Contribute is the wider
snapshot for several chats and projects at once. A project name or icon gives
orientation and can filter the run, but no one must navigate through Projects,
Pull requests, Issues, or internal stages before acting.

The interface leads with a plain-language outcome and the smallest meaningful
action. Technical detail remains one selection away. Accent color is rare and
functional: the current public approval or the one private action that unlocks
the run.

**Key Characteristics:**
- Centered responsive canvas with compact, intentional spacing.
- One run header and one decision stream; wide screens keep that stream beside
  the focused review, while phones replace it with the focused view.
- A quiet progress line may summarize private, reviewed, public, and accepted
  work, but it never becomes navigation.
- Project icons and concise state labels carry recognition without extra chrome.
- Public and destructive actions remain explicit and local to the selected item.

## Colors

The palette inherits the owner's Möbius theme and uses one violet accent, muted tonal surfaces, green confirmation, amber caution, and red only for genuine destructive or failed states.

**The Rare Accent Rule.** Accent identifies current location or the single next decision; it does not decorate every card.

**The Honest State Rule.** State is always named in text. Color reinforces meaning but never carries it alone.

## Typography

**Display Font:** The owner's Möbius interface family with its configured fallback.
**Body Font:** The same interface family.
**Label/Mono Font:** The owner's configured monospace family, only for source paths and commit details.

**Character:** Quiet, compact, and direct. Weight and spacing establish hierarchy; large type is reserved for room titles rather than card decoration.

### Hierarchy
- **Headline:** Fluid 22–26px, bold, tightly tracked; one per room.
- **Title:** 16px, semibold; stage and focused-object titles.
- **Body:** 12.5px with a relaxed 1.55 line height; explanations stay below roughly 58 characters per line.
- **Label:** 11.5px, semibold; navigation, actions, and compact state language.
- **Micro label:** 10.5px, semibold; terse file and project metadata.
- **Mono:** 12px; source paths, commits, file names, and diff statistics only.

**The One Headline Rule.** The run has one headline; nested surfaces step down
rather than competing at the same size.

## Layout

The shared canvas is centered at a maximum width of 1120px. Run header, primary
action, decisions, work in motion, and recent outcomes form one vertical
sequence. At wide widths, selection keeps a compact run list on the left and
opens the review on the right so several decisions can be handled without
losing place. On phones, selection replaces the sequence and owns a real Back
entry.

When several reviewed units share the same public outcome, one batch action is
the default. Its confirmation names every standalone pull request and every
layer in the ordered stack's current public phase, states whether each opens
ready or as a draft or updates an existing pull request, and says that nothing
merges. An existing-PR update prefix and new unpublished suffix remain one
reviewed stack but require separate confirmations. The batch dispatcher
preserves stack semantics and partial success; completed units leave
immediately while a failed unit remains actionable.

On phones, decisions stay dense enough to scan: title, project, honest state,
and one compact action. Supporting prose yields before the action does.

**The One Run Rule.** The same work must never be projected into competing
owner queues. Detail views and project filters may refine the run; they may not
reclassify it independently.

## Elevation & Depth

The system is flat by default. Depth comes from tonal surfaces, one-pixel borders, and occasional very subtle hover lift on standalone request cards. Shadows are reserved for transient overlays such as settings menus.

**The Flat-by-Default Rule.** Persistent content surfaces use borders and tone, not floating trays or ambient dashboard shadows.

## Shapes

Large task surfaces use gently curved 15px corners; compact controls use 8–10px corners; small state labels are pill-shaped. Borders are thin and quiet. Icons sit in softly tinted rounded squares when they identify a project or request type.

## Components

### Buttons
- Primary buttons are reserved for a selected item's meaningful next action.
- Quiet actions are borderless, content-width, and muted until hover or focus.
- Focus uses the shared two-pixel accent ring; active presses contract slightly.

### Run Summary
- A short sentence names the most important current outcome.
- Compact counts may show reviewed, moving, and accepted work.
- Counts are status, not tabs; the first actionable item follows immediately.

### Project Index
- Related projects share one bordered surface and may be divided by small project-family headers.
- Each row uses a project icon, name, plain-language next state, and a small status dot.
- Opening a row replaces the index with one focused project surface.

### Decision Stream
- Exact public approvals come first, followed by private review or true human attention.
- A complete stack is one unit in the stream and expands to its exact ordered layers at approval.
- Each row shows title, project, named state, and one direct action.
- Review, feedback, diff, discard, and advanced publication choices live in the focused record.

### Work in Motion
- Healthy public work and agent-owned private work are deliberately quiet.
- Active work uses a compact status row; human-required events move back into Decisions.
- Recent outcomes are collapsed by default and never compete with current intent.

## Do's and Don'ts

### Do:
- **Do** show the current run and its exact next action before supporting detail.
- **Do** put complete diffs and technical metadata one selection away.
- **Do** keep project and request language understandable without Git terminology.
- **Do** preserve practical touch targets and visible focus states.

### Don't:
- **Don't** make Projects, Pull requests, Issues, or lifecycle stages top-level rooms.
- **Don't** create a second queue in chat, Contribute, or a background worker.
- **Don't** exclude stacks from the common batch merely because they need a stronger dispatcher.
- **Don't** turn status counts into navigation homework.
- **Don't** use red for drafts, uncertainty, or caution; reserve it for genuine failure or destruction.
