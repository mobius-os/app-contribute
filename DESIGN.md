---
name: Contribute
description: Compact project switching, stable work inventory, and one contextual task.
colors:
  accent: "var(--accent)"
  action: "var(--accent-hover, var(--accent))"
  accent-foreground: "var(--accent-fg)"
  accent-muted: "var(--accent-dim)"
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
    fontSize: "30px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "var(--font)"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  section:
    fontFamily: "var(--font)"
    fontSize: "18px"
    fontWeight: 700
  body:
    fontFamily: "var(--font)"
    fontSize: "16px"
    lineHeight: 1.5
  explanation:
    fontFamily: "var(--font)"
    fontSize: "15px"
    lineHeight: 1.6
  label:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 650
  button:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 500
  mono:
    fontFamily: "var(--mono, var(--font))"
    fontSize: "14px"
rounded:
  state: "5px"
  field: "8px"
  control: "10px"
  summary: "12px"
spacing:
  compact: "8px"
  group: "12px"
  row: "18px"
  section: "24px"
  room: "28px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "8px 2px"
  project-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.summary}"
    padding: "10px 13px"
  local-summary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.summary}"
    padding: "18px"
  work-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.state}"
    padding: "2px 7px"
---

# Design System: Contribute

## Overview

**Creative North Star: "Project · Work · Task"**

Contribute is a task-first project workspace: project context, a compact project switcher, a stable inventory of work, and one contextual action pane. Its character is quiet and practical, with comfortable hierarchy, visible actions, and restrained iconography. The selected workspace uses the available app width rather than the superseded centered-detail composition.

The shell supplies the theme and font. This design changes Contribute, not the Möbius shell or chat Changes view. Implementation authority is `workspace-theme.js`, appended after `theme.js`, with behavior owned by `ui/SourceMap.jsx`, `ProjectControls.jsx`, `PullRequests.jsx`, `Feed.jsx`, and `TaskPane.jsx`.

**Key Characteristics:**
- A compact project switcher replaces a permanently open second sidebar.
- AI preparation is the primary local-work action; updating is a separate journey.
- Private preparation, prepared work, and public contributions remain visibly distinct.
- Selection collects work; explicit task opening changes context.
- Phone tasks replace the inventory rather than squeezing columns.

## Colors

### Primary
The inherited accent identifies actions, selected projects, links, and working states. Primary buttons use the shell’s action shade with its matching foreground; selected controls use the muted accent surface.

### Neutral
Background holds the inventory; surface differentiates the task pane. Muted text carries explanation and metadata; borders divide regions and rows. Success, caution, and danger describe outcomes, not decoration. Caution is the existing app-owned amber for advisory states; danger remains for actual failures or destructive actions. State labels must work without color.

**The Inherited Theme Rule.** Use the shell’s semantic colors and font; do not freeze its accent into a named hue or a fabricated tonal ramp.

## Typography

Use the inherited shell/system font, with no additional display family. The frontmatter records the wide-workspace hierarchy: project headline, task title, section heading, body, explanation, and control labels. Project-list names use a slightly larger working title (18px, 650); rail and contribution titles use compact but readable emphasis (15px, 600–700). Metadata stays at 14px. Monospace belongs to source paths, versions, and diffs, not the main workflow.

At the phone breakpoint, the project headline becomes 27px, task titles 25px, and contribution titles 16px. The task remains comfortable to read rather than becoming a miniature desktop. Inputs retain 16px text.

## Layout

- **Project index:** actual local projects are searchable and filtered by All projects / Local changes / Updates. GitHub permissions never add a repository by themselves. Existing external contribution work and deliberately followed repositories remain under collapsed **Other repositories**. **Add repository** explicitly follows a GitHub project without installing it.
- **Selected project, desktop:** one compact All projects / project-switcher row; then the project header and a flexible work inventory beside a 350px contextual task. No persistent project rail. The work inventory and task scroll independently.
- **At 1150px and below:** task narrows to 310px; inventory/task padding becomes 22px.
- **At 680px and below:** document-style vertical scrolling. Inventory padding is 20px. The task is hidden until explicitly opened, then replaces inventory/header/switcher with a Back to project control. Back restores inventory and its scroll position.
- **Approval links:** a focused, maximum-760px decision page displays the exact selected versions and one approval. Opening or checking the link is read-only; an existing approved selection links to its owning conversation instead of asking again.

The default desktop task is Prepare for a local project and Review contributions for an external project. Merely showing that default does not take keyboard focus. Explicitly opening a task focuses its content; task content changes alone do not refocus it.

**The Stable Inventory Rule.** Checkbox selection changes only the selection. It never opens the task pane, scrolls to it, or steals keyboard focus.

## Elevation & Depth

**The Flat Workspace Rule.** Use borders, tone, and spacing to separate persistent regions; do not turn the work inventory into floating nested cards.

The task pane is differentiated by surface color and a single-pixel border. Workspace contribution rows, prepared-work disclosures, and focused detail cards are flattened. Rounded boundaries remain useful for the local-work summary, fields, and controls. The existing small settings-help popover is a transient exception with a soft shadow; it is not a model for persistent work content.

Motion is limited to short state transitions: background and borders (140ms ease), button press (100ms ease, scale 0.97), and disclosure icons. Reduced-motion preferences collapse transitions and animation to effectively instant.

## Shapes

Small rounded controls and summaries coexist with square, line-separated inventory regions. Use the frontmatter’s established state, field, control, and summary radii. Project glyphs are compact rounded squares; the project switcher uses a native select for keyboard and phone accessibility. Public work-state labels use small corners, while existing contribution-detail status chips remain pills. Do not make every container a card.

## Components

### Actions and fields

Primary, secondary, and quiet buttons have minimum 44px targets. The task’s primary action spans its width and wraps long labels. Primary buttons use the inherited action shade; secondary buttons use surface and border; quiet actions use muted text. Disabled buttons are half-opacity. Interactive controls have a 2px accent focus outline with a 2px offset; explicitly focused task content uses a 4px offset.

Project-index search uses a surface fill and rounded border, with a minimum 46px height. Rail search is smaller in composition, not text size: minimum 44px height, background fill, and field-radius corners. Both use visible labels or accessible names. Hover affects color and border, not task ownership.

### Project navigation and work inventory

The compact project switcher groups local projects separately from other repositories. Work sections retain Needs you, Prepared · not shared, Contributions and History where relevant; secondary inventories remain collapsed.

Local work has one summary opening the preparation task. That task contains a short description, a single scope choice and one **Prepare changes** button. **Options & process** contains maintainer continuation and explanatory detail. Files & technical details remains a separate task. No duplicated Prepare or scope controls in the work inventory.

### Contribution selection and review

A contribution row has a dedicated checkbox target (minimum 44px; visible checkbox 18px) beside a separate title/details button. Title, authorship/assignment, and a written status remain visible. Filters narrow the same inventory and clear selection.

Selecting checkboxes keeps the inventory and keyboard focus in place. The explicit **N selected · Review or assign** action opens the batch task. Clicking the row’s main button instead opens that individual contribution and replaces the selection with it. These rules apply on desktop and phone. The task then offers private review, eligible assignment, and optional versions/history without adding action clutter to every row.

### Contextual tasks and exact approvals

One task outlet hosts preparation, review, assignment, update, technical detail, and existing contribution decisions. It reuses the owning workflow and navigation, not a second stateful review room. Preparation, progress, real owner questions, and errors have distinct written states.

Private review says nothing is posted or merged. Publication confirmation lists exact actions and keeps a safe Keep private / Keep drafts choice. Optional merge permission names exact PR versions and is separate from ordinary private review. Assignment explicitly says it is shared on GitHub. Get up to date remains its own reviewed return journey, with the recorded comparison clearly distinguished from a fresh check.

## Do's and Don'ts

### Do:
- **Do** keep project identity, work inventory, and the current task distinct.
- **Do** keep Prepare prominent and Get up to date separate.
- **Do** label private, prepared, public, queued, and accepted states in words.
- **Do** enumerate exact public effects and versions before the owner approves.
- **Do** preserve checkbox focus and open batch work only through the explicit selected-work action.
- **Do** preserve readable phone text, visible focus, and practical touch targets.

### Don't:
- **Don’t** restore the centered selected-project layout or spread reading copy across the whole workspace.
- **Don’t** hide essential actions in a catch-all menu or shrink type to fit more columns.
- **Don’t** treat a row checkbox as navigation; row opening is a separate control.
- **Don’t** imply preparation is public, publication is merge, a queue entry is merged, or a recorded comparison is a fresh check.
- **Don’t** invent fixed theme colors, tonal ramps, workflow states, or capabilities from a preview.
