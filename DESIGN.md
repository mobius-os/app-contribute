---
name: Contribute
description: A continuous project workspace with calm inventory, bottom-stacking selection, and exact review actions.
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
    fontSize: "32px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline-phone:
    fontFamily: "var(--font)"
    fontSize: "28px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  task-title:
    fontFamily: "var(--font)"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  section:
    fontFamily: "var(--font)"
    fontSize: "20px"
    fontWeight: 700
  row-title:
    fontFamily: "var(--font)"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "var(--font)"
    fontSize: "16px"
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
    fontSize: "13px"
    lineHeight: 1.6
rounded:
  state: "5px"
  tab: "7px"
  field: "8px"
  control: "10px"
  panel: "12px"
  dock-phone: "16px"
  dock: "18px"
spacing:
  micro: "4px"
  compact: "8px"
  control: "10px"
  group: "12px"
  row: "18px"
  phone: "20px"
  panel: "24px"
  section: "32px"
  desktop-gutter: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "8px 2px"
    height: "44px"
  directory-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "44px"
  local-work-summary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "22px"
  work-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.state}"
    padding: "3px 8px"
  selection-tray:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dock}"
    padding: "12px"
    width: "calc(100% - 48px)"
  task-dock:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.dock}"
    padding: "24px"
    width: "calc(100% - 48px)"
---

# Design System: Contribute

## Overview

**Creative North Star: "The Continuous Project Desk"**

Contribute is one calm, project-shaped workspace rather than a dashboard of competing panes. A project directory leads into a continuous vertical document: project position, local work, decisions that need attention, saved private proposals, public contributions, and history appear in one readable flow. Technical depth stays available without displacing the next meaningful action.

Selection is a temporary working layer at the bottom of that document. Native checkboxes collect contributions without navigating; a compact stack of selected cards can expand, remove individual items, and launch review or assignment. Those workflows reuse the same bottom position as a focused, nonmodal dock while the project remains behind it. The shell owns both light and dark appearance, typography, icons, and semantic color.

**Key Characteristics:**
- One continuous workspace per project; no persistent split pane or second review room.
- Directory filters reflect real local-change and update facts.
- Selection accumulates independently from contribution detail.
- Review and assignment occupy a fixed bottom dock without resetting project scroll.
- Description leads; Files and Activity load only when opened.
- Exact contribution versions remain the unit of approval and refresh safety.

## Colors

The palette is entirely semantic and theme-responsive. Accent marks action, selection, links, and active controls; neutral surfaces separate temporary work from the continuous document. Success, caution, and danger communicate outcomes, and every state also has a written label.

**The Inherited Theme Rule.** Use the shell’s semantic color and font variables in both light and dark modes. Do not freeze the accent into a named hue, manufacture a tonal ramp, or introduce an app-owned light/dark palette.

**The Written State Rule.** Color may reinforce a state, but labels such as “Ready for review,” “Needs you,” and “Prepared · not shared” carry the meaning.

## Typography

Use the inherited shell/system font throughout; source versions, paths, and patches use the inherited monospace stack. The working hierarchy is deliberately readable rather than dense: labels and metadata are 14px, body and detail copy are 16px, and the project headline is 32px on desktop and 28px at the phone breakpoint. Task headings are 22px and contribution titles are 17px.

**The Readable Floor Rule.** Do not shrink workflow copy below the established 14px label and 16px body sizes to fit more controls. Let controls wrap and layouts stack instead.

## Layout

- **Project directory:** Search and the native All projects / Local changes / Updates filter narrow the same real project inventory. Local changes means work that is ready to prepare or needs sorting; Updates means incoming, behind, comparison-required, or conflicting work. External repositories remain under Other repositories.
- **Selected project:** A compact All projects control and native project switcher precede one continuous, maximum-1192px workspace. Project position, local work, contribution runs, public contributions, and technical detail flow vertically; there is no desktop inventory/task split.
- **Local work:** One bordered summary presents the current file count and primary Prepare changes action. Stored prepared records appear below as written summaries with source freshness, file totals, and date.
- **Needs you:** Grouped work reports groups, individual decisions, and total contributions; a single item keeps the simpler count. These counts describe the same project-scoped run rather than a separate ledger.
- **Contribution inventory:** Search and assignment/authorship filters narrow the existing rows. Each row keeps a 44px checkbox target separate from its title/detail button. Opening a row reveals detail in place and does not change selection.
- **Bottom selection:** Any nonempty selection creates a fixed, nonmodal tray within the app, inset 24px on wide screens and 8px on phones. Selected cards stack horizontally by default, expand into a vertical list, and may be opened or removed individually. Measured bottom padding and scroll padding keep the final rows reachable above the tray.
- **Review and assignment dock:** Review or assignment replaces the visible tray with a fixed bottom task dock while preserving the selected items in the document state. The dock scrolls internally, preserves the project’s scroll position, and moves keyboard focus to its action region. Closing it restores the tray and returns to the same project context.
- **Contribution detail:** Description is the default tab. Files and Activity fetch only when chosen; files disclose patches per path, while Activity lists written review and comment events.
- **Refresh safety:** A refresh retains only selections whose repository, pull request, head version, base version, and base branch still match. Changed or closed items are removed with a status announcement that asks the owner to select the current version again.
- **Exact approvals:** The focused approval page remains a maximum 760px and enumerates the exact head and base versions. Changed versions require fresh approval.

At 680px and below, workspace side padding becomes 18px, the project headline becomes 28px, filters and local work stack, in-row detail removes its left inset, and bottom surfaces use 8px side/bottom insets with 16px corners. This is one document adapted for touch, not a different information architecture.

**The Stable Inventory Rule.** Checkbox selection changes only selection. It never opens detail, changes filters, scrolls the page, or steals focus.

**The Continuous Context Rule.** Tasks may focus attention, but they do not replace the project with another room or discard its place in the document.

## Elevation & Depth

The project workspace is flat and line-separated. Borders, muted surfaces, spacing, and selected-row tone organize the persistent document. Only temporary bottom work surfaces use a broad ambient shadow, and only the active detail tab uses a very small lift. The existing settings popover remains a transient exception rather than a model for project content.

Motion stays brief and functional: background and border changes use 140ms, button press uses 100ms with a 0.97 scale, and disclosure rotation uses 160ms. Reduced-motion preferences collapse these transitions and animations to effectively instant.

**The Temporary Lift Rule.** Persistent project content stays flat; elevation belongs to the bottom selection/task surface or a transient control state.

## Shapes

Line-separated inventory rows sit inside a gently curved control language. Written state labels use 5px corners; tabs use 7px; fields use 8px; buttons and selected cards use 10px; summaries and inline task panels use 12px. Bottom work surfaces are the roundest elements at 18px, reducing to 16px on phones. Checkboxes remain native and avatars remain circular.

**The Purposeful Radius Rule.** Radius signals interaction and temporary grouping. Do not turn every project section or contribution row into a floating card.

## Components

### Actions and fields

Primary, secondary, and quiet actions all preserve practical 44px targets. Primary actions use the inherited action shade; secondary actions use surface and border; quiet actions keep muted text on a transparent background. Buttons press to 0.97 scale and disabled controls remain visible at half opacity. Keyboard focus uses a 2px accent outline with a 2px offset.

Directory and contribution search inputs use 16px text, semantic surface fill, and visible borders. Native selects preserve platform keyboard and phone behavior. Search stacks above its filter on phones rather than becoming narrower or smaller.

### Local work and saved summaries

The local-work summary is the project’s main preparation entry: current state and file facts on the left, Prepare changes on the right, then stacked on phones. Prepared work is preserved as expandable written summaries with title, description, source freshness, totals, and date; it is not reduced to an opaque count.

### Contribution rows and selection tray

Each contribution row has a native checkbox and a separate title button. Title, number, author, date, file totals, written review state, and assignment remain visible. Selected rows use the inherited muted accent, but the checkbox remains the authoritative selection control.

The bottom tray summarizes the count, previews selected contribution cards, and exposes Review, Review & merge when eligible, and Assign when eligible. Its disclosure changes card layout, not task ownership. The clear action empties the selection; each card also has its own remove action.

### Review and assignment dock

The dock is a scrollable bottom surface with a sticky close control. Review begins with a plain-language private/public consequence, lists every selected contribution, hides exact versions in an optional disclosure, and keeps merge permission as an explicit checkbox. Assignment leads with a searchable people list and states that it changes GitHub assignment but does not start review. Opening either dock moves keyboard focus into it without scrolling the project behind it.

### Contribution detail

Description, Files, and Activity form a segmented tab set with 48px targets and an active neutral surface. Description opens first. Files disclose one path at a time and retain the warning that an available patch may be incomplete. Activity shows written reviews and comments, with source-conversation navigation when stored local provenance exists.

## Do's and Don'ts

### Do:
- **Do** keep each project as one continuous document from position through history.
- **Do** make directory filters reflect the data conditions named by their labels.
- **Do** keep native checkbox selection independent from row detail and keyboard focus.
- **Do** preserve selected versions through refresh only when the exact head and base still match, and announce removals.
- **Do** place selected work and review actions in the fixed bottom tray/dock while keeping the final inventory rows reachable.
- **Do** preserve local-work and prepared-record summaries as readable text, not counts alone.
- **Do** lead contribution detail with Description and defer Files and Activity until requested.
- **Do** enumerate exact public effects and contribution versions before approval.

### Don't:
- **Don't** restore the discarded split-pane workspace, persistent task rail, or separate Reviews room.
- **Don't** treat a row checkbox as navigation or clear selection merely because detail opened.
- **Don't** make the bottom tray modal, reset project scroll, or discard selection while the review/assignment dock is open.
- **Don't** hide changed-version removal; announce that the current version must be selected again.
- **Don't** shrink labels below 14px or body copy below 16px to make the phone layout fit.
- **Don't** invent fixed colors, tonal ramps, icons, approval states, or workflow capabilities outside the implemented semantic theme and product contract.
