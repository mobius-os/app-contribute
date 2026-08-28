---
name: Contribute
description: A quiet, project-shaped collaboration workspace for moving local work into review.
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

**Creative North Star: "Four Quiet Rooms"**

Contribute feels like a calm collaboration workspace, not a Git client or an administrative dashboard. Its four top-level rooms share one restrained visual language while keeping distinct jobs: Overview orients, Projects maps local work, Reviews shows the contribution pipeline, and Requests holds owner decisions.

The interface leads with plain-language state and the next meaningful object. Technical detail is immediate after selection but does not compete with the first viewport. Accent color is rare and functional: active location, a private next step, or one high-value decision.

Overview may offer one private **Organize** action for all current work that
still needs judgment. It must say that status and reconciliation are automatic,
must exclude healthy public pull requests, and must reuse the same conversation
until the represented work changes. This is an orientation shortcut, not a
second queue or a permanent background agent.

**Key Characteristics:**
- Centered reading canvas with generous negative space.
- Thin stage rails instead of boxed filter bars or overflow menus.
- One coherent surface per task, followed by a full-width focus view.
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

**The One Headline Rule.** Every tab opens with one room title; nested surfaces step down rather than competing at the same size.

## Layout

The shared canvas is centered at a maximum width of 760px. Overview may use the narrower 680px reading measure. Room title, stage rail, explanation, and primary surface form one vertical sequence with roughly 20–26px between major layers.

Selection replaces the index with a focused view instead of opening a split pane. On phones, the same composition remains vertical; top-level tabs and stage rails scroll horizontally when needed, and secondary labels yield before content does.

When several rows in one review stage share an exact default, the stage intro
may offer that action once for the complete visible set. The copy must name
whether the action stays private or publishes to GitHub; public batches keep a
separate confirmation that names every included pull request. Ordered stacks
keep their own layer-and-branch confirmation instead of joining that stage
batch. Each row retains its own compact default, while opening the row reveals
information and secondary controls rather than becoming a prerequisite for the
action.

**The One Room Rule.** A tab may share tokens and navigation with another tab, but it must not inherit a generic page skeleton when its job is different.

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

### Stage Navigation
- Stages are text labels on one thin bottom rule.
- The selected stage receives a two-pixel accent underline.
- Counts are compact neutral pills; every stage remains visible through horizontal scrolling rather than a “More” menu.

### Project Index
- Related projects share one bordered surface and may be divided by small project-family headers.
- Each row uses a project icon, name, plain-language next state, and a small status dot.
- Opening a row replaces the index with one focused project surface.

### Review Pipeline
- Contributions group by project inside one contained list.
- Each contribution row shows its title, project, named review state, and navigation affordance.
- Review, feedback, diff, and discard controls live only in the focused record.

### Decision Inbox
- Requests use individual, airy cards rather than a grouped pull-request table.
- The stage begins with a softly tinted decision summary, then one card per request.
- Discard is a quiet text action; continuation in the source conversation is the dominant choice.

## Do's and Don'ts

### Do:
- **Do** show the current stage and its contents before offering action.
- **Do** put complete diffs and technical metadata one selection away.
- **Do** keep project and request language understandable without Git terminology.
- **Do** preserve practical touch targets and visible focus states.

### Don't:
- **Don't** add “More” menus for core stages; keep the stage rail horizontally scrollable.
- **Don't** place bulk “prepare all,” “review all,” or floating run trays inside Projects, Reviews, or Requests.
- **Don't** reuse one generic queue composition across tabs with different user journeys.
- **Don't** use red for drafts, uncertainty, or caution; reserve it for genuine failure or destruction.
