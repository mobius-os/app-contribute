---
name: Contribute
description: A continuous project workspace with a PR-first inventory, inline decisions, and exact review actions.
colors:
  accent: "var(--accent)"
  action: "var(--accent-hover, var(--accent))"
  accent-foreground: "var(--accent-fg)"
  accent-muted: "var(--accent-dim)"
  background: "var(--bg)"
  surface: "var(--surface)"
  surface-muted: "var(--surface-2, var(--surface))"
  text: "var(--text)"
  text-muted: "var(--muted)"
  border: "var(--border)"
  success: "var(--green)"
  caution: "#cf9526"
  danger: "var(--danger)"
typography:
  title:
    fontFamily: "var(--font)"
    fontSize: "28px"
    fontWeight: 680
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  section:
    fontFamily: "var(--font)"
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "var(--font)"
    fontSize: "16px"
    lineHeight: 1.6
  meta:
    fontFamily: "var(--font)"
    fontSize: "14px"
    fontWeight: 600
  mono:
    fontFamily: "var(--mono, var(--font))"
    fontSize: "14px"
    lineHeight: 1.6
rounded:
  pill: "6px"
  field: "8px"
  control: "10px"
  panel: "12px"
  round: "999px"
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
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.meta}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "44px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.meta}"
    padding: "8px"
    height: "44px"
  directory-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "8px 12px"
    height: "44px"
  compact-position:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "4px 0"
  work-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
  pr-action-toolbar:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "6px 0"
  pr-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    padding: "12px 6px"
  prompt-editor:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "12px"
  inline-confirmation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "18px"
---

# Design System: Contribute

## Overview

**Creative North Star: "The Continuous Project Desk"**

Contribute is one calm project workspace, not a separate agent dashboard or Reviews room. A project page opens on its tabs; the open pull-request list becomes the principal working surface. What waits on the owner across projects lives in the Needs you destination, not on the project page. Every control names its result in plain words ("Make PRs from local changes", "Sync with GitHub", "Open for review"); none is an unlabeled icon. Titles, authors, labels, check counts and assignment are scannable before detail is opened. The Send and Mark ready bars sit above the tabs, one per job: **All PRs** (the default), **Prepared PRs** (private PRs waiting for you; one row each, counted by rows, shown only while there are some), **Review requests** and **Agent runs** (the project's agent runs, the reviews you started and finished work). Saved public work the live list cannot show stays on All PRs. Old work is never restarted merely by opening it.

Selection belongs to the list: native checkboxes change a stable, in-flow action toolbar. An agent handoff is a choice in the **Actions ▾** menu that opens the review window for exact confirmation; it is not a direct action on selection. Details open inside the row, with a reserved scrolling body below stable actions and tabs. Settings is flat: Review, Fix and Merge guidance share a tabbed editor, with account management first. Model and effort are chosen per launch. Version, consent and safety checks remain implementation contracts, not routine settings content. The Möbius shell owns theme colors, typography, and icons.

**Key Characteristics:**
- One continuous project workspace with three tabs (All PRs, Review requests, Agent runs); no persistent split pane or second review room.
- Immediate PR inventory; what differs from GitHub lives in the Local changes tab, and the project screen carries no status row.
- Separate PR selection, detail, assignment, and agent action, each a labelled control.
- An Actions ▾ choice, then a review window (agent jobs) or a confirm sheet (your own Merge and Open for review) with exact confirmation before anything starts.
- Stable row detail actions and tabs above a bounded, scrolling context region.
- Named paused work and saved history remain reachable below current work.

## Colors

The palette is semantic and theme-responsive. Accent identifies actions, selection, links, and active controls. Neutral borders and surfaces separate rows and temporary in-flow tasks. Success, caution, and danger reinforce written outcomes; checks and agent state are never conveyed by hue alone.

**The Inherited Theme Rule.** Use shell semantic color and font variables in light and dark modes. Do not pin a purple hex, manufacture a tonal ramp, or introduce an app-owned theme.

**The Written State Rule.** Text such as “✓ 18/18”, “2 failing”, “Merge blocked” and “Prepared · not shared” carries meaning independently of color. Passing checks are not a review verdict.

**The GitHub Label Rule.** PR labels and the PR page's state pill (Open, Draft, Merged, Closed) are filled with their GitHub color, 30% less intense: 70% of the color mixed into the page surface, in both themes, with white, GitHub's dark ink or black text, whichever first reaches 4.5:1. A fill that would vanish into the page keeps a hairline. Rows use the same label pill as the PR page. PR state icons follow GitHub: open green, draft grey, merged purple, closed red.

## Typography

Use the inherited shell font and monospace stack. There are four sizes: 28px titles, 22px section headings, 16px body and row titles, and 14px for metadata, controls, chips and tags. A phone (680px and below) takes the compact set instead, the owner's choice on 2026-11-11: 22px titles, 20px section headings, 15px body and row titles, 13px metadata and controls, and 12px chips, tags and counts (`--co-text-chip`). Text you type is 16px on every screen (`--co-text-entry`), because an iPhone zooms the page on a smaller field. A PR's description on a phone is 13px text and 12px code (`--co-text-reading`, `--co-text-code`, the owner's choice on 2026-11-06), and nothing else may use those two. Long titles, labels, versions, and paths wrap rather than forcing the viewport wider.

**The Compact Phone Rule.** A phone shows more by being one step smaller everywhere, never by shrinking one crowded line to make it fit: the sizes change only as the phone set of the token sheet, so every screen moves together. The floor is 12px, and only chips, tags, counts and code go that low. Icons are drawn an eighth smaller (`--co-icon-scale`), rows take less air, and controls are drawn 38px tall. Smaller to look at is never harder to use: every control still takes a 44px tap: a box `--co-tap-height` tall, centred on the control (an icon button is 44px wide too), reaches 3px past its drawn edge (`--co-tap-reach`), and whatever holds controls keeps twice that between them, so two tap boxes meet and never cross and no control's drawn face is another's tap. A browser test taps every edge to prove it (`runTapBoxChecks`). Prompt tabs are 48px tall. This replaces the earlier Readable Floor Rule (nothing under 14px on a phone), which matched the platform defaults but showed three PRs on a first screen that now shows five.

## Layout

- **Project directory:** Search and factual All / With local changes / Behind GitHub filters narrow actual local and shared project conditions. Each project carries a Platform or App tag and says what waits on the owner ("8 PRs wait for your review. 2 things need you."). Apps with nothing to do fold into one collapsed group that a search opens. A row whose line is about a GitHub update, a conflict or a missing comparison ends in a quiet link to the one place that deals with it (**Open Settings** for Möbius, **Open App Store** for an app), lined up under the row's text and never inside its button. A remembered GitHub repository is not treated as an installed local project.
- **Selected project:** A continuous workspace contains the Send and Mark ready bars, then the tabs. When there are local changes the **Local changes** tab (with its file count) holds the plain-language summary, **Make PRs from local changes** and the edited files. The project screen carries no status row about local changes or GitHub: an update from GitHub that is waiting, or conflicts with local changes, is flagged on the project's row on the Repositories list. Contribute starts no update of its own, because Settings → Updates applies them for Möbius and the App Store for apps.
- **PR inventory:** Laid out like GitHub's PR list: search and a **Show** menu (all, unassigned, assigned, opened by me) above one bordered list box. The Review requests tab shows the same list narrowed to PRs that ask for the owner's review; the list stays one mounted component across tabs, so its pages, runs and selection survive a switch. The box header shows select-all and “N open”; Assign and Actions ▾ appear there only once PRs are selected. Each row has a native checkbox, the GitHub state icon, and four lines: the title; the facts “#123 · author opened 2 days ago · ✓ 18/18 · +a −d” (a check mark for passing, a yellow dot while checks run, an × for failing; additions green, deletions red); the labels, always their own line; then the pills (whose turn it is, agent state, GitHub's decision) on a line of their own. A draft is told by its icon alone: no Draft word in the facts line and no Draft pill (owner's choice, 2026-11-12). A filter above the list whose count is zero stays pressable but steps back, so the ones with PRs stand out. Comments, then the quiet text actions **Assign** (or the assignee avatars) and **Actions ▾** sit on the right; they brighten when the row is in use. Check counts treat skipped and neutral runs as passing, as GitHub does.
- **Selection and confirmation:** Selection only changes selection. Choosing a job in Actions ▾ opens the review window, a modal dialog with protected focus. A review asks first who sees the result (**Only me**, **Draft for me**, and **Agent posts** only where the Möbius allows it; on someone else's PR it opens on Draft for me where it can, and Agent posts is never a default) and offers **Merge after I approve**, a switch that stays drawn, off and dimmed, with its reason, where it cannot be turned on. Merging only follows a verdict you sent yourself. An assignment or run opened from one PR appears directly under that PR. The window names the job and each selected PR, lists numbered "What happens" steps, states what GitHub will see (green and private, or amber with the exact public effects), offers per-run model/effort, and labels its start button with exactly what is allowed. Private-review autopilot lives inside its choice; repair-and-merge continues automatically within its approved scope. Exact versions and frozen instructions remain checked underneath, without a second routine preview panel. Assigning a person is separate and does not start review.
- **Detail:** Follows GitHub's PR page: title with #number, colored labels, then actions (**Actions ▾** with its text, then Assign, View on GitHub and the chat links as 44px icon buttons that name themselves in a tooltip: after the pointer rests 2 seconds, at once on keyboard focus, and while a finger holds it; on a touch screen, which has no hover, each also says its word beside the icon: Assign, GitHub, and Chat, or Chats and how many), the state pill and “by author”, and Conversation / Files changed / Checks tabs. Conversation shows the description and comments as bordered comment boxes. The body below has a bounded scroll region so delayed data, long patches, empty states, and errors do not move those controls. Files, checks, and activity load on request; available patches may be incomplete.
- **Settings:** One on-demand workspace groups Review / Fix / Merge decision tabs above a single editor. GitHub account comes first; Agent prompts follows with the same section heading. No Model or Automation settings sections. Preset changes affect new runs only; admitted-run instructions remain inspectable in deliberate run details.
- **One left edge:** the header and the repository view start at the same left edge on every screen, and opening a PR page never moves them (owner's choice, 2026-11-12; the old centred rail is gone). The lists and the PR page's reading tabs share one reading column of about 960px (the view is capped at 1400px); only Files changed uses the whole width, growing to the right.
- **Responsive:** Current workspace content on a narrower screen has 24px horizontal padding; at 640px padding becomes 16px. At 680px and below, local position remains compact, PR metadata wraps, side statuses move under the title, search becomes an explicit 44px control, and the action uses its short phone label. The settings workspace stacks at 650px. No horizontal viewport overflow or hidden primary action.

**The Stable Inventory Rule.** Checkbox selection neither navigates nor opens detail, changes a filter, steals focus, or scrolls the page.

**The Continuous Context Rule.** Inline decisions and detail may focus attention, but they do not replace the project or revive paused work.

## Elevation & Depth

Persistent project content is mostly flat and line-separated. Muted surfaces and borders distinguish selected rows, inline tasks, and the on-demand settings workspace; do not resurrect a bottom selection tray as the primary PR action. Small shadows are reserved for transient popovers or selected detail tabs. Brief state transitions and reduced-motion handling follow the incumbent shell/component rules.

**The Temporary Lift Rule.** Elevation clarifies transient controls, not every PR row or project section.

## Shapes

Rows remain line-separated rather than floating cards. Controls and selected rows use gentle corners; label chips are pill-shaped. Inline task/detail surfaces use modest rounding. Native checkboxes remain native, and avatar/identity marks retain the shell’s treatment.

**The Purposeful Radius Rule.** Grouping and interaction earn a radius; repeated project sections do not become decorative cards.

## Components

### Actions and fields

The primary button marks the next step, an agent handoff or a confirmation; secondary and quiet actions carry assignment, cancel, navigation, and sync. Disabled actions stay visible. Focus uses a clear accent outline. Search fields keep 16px entry text and a semantic border. Model and effort are chosen at task launch, not in Settings, with an app-owned copy of the chat composer's picker: a compact Agent trigger that opens monochrome provider rows and the same effort track. The default row names the model the launch will actually use (background-agent setting for PR runs, chat default for prepare/pull/cycle). Contribute never restyles the shell's own picker.

### Compact project position

Two concise lines show local and upstream facts with adjacent prepare/pull paths. Inspection reveals branch, versions, repository, and comparison detail without occupying the PR-first viewport by default.

### PR list and action toolbar

The in-flow toolbar keeps select-all, count, Assign and Actions ▾ beside the rows. Individual checkboxes have a 44px target. A row title opens detail independently; author, labels, change totals, check count, meaningful work state, and assignment remain scannable. Actions ▾ carries its word. GitHub domain states use official Octicons; generic chrome keeps the shell icon vocabulary. A selected state is tonal, not the only indication of selection.

**The Repository List Rule.** A repository's list of open PRs is kept like the desk: it opens from what was last known of it, at once and with no placeholder rows, and updates in place under one quiet line under the filters (“Updating… · last synced 3 hours ago”, then “Last synced just now”). Rows change where they stand; Sync and a change in the owner's own sent PRs read the list again the same way, and a list known to have no open PRs says so at once. A repository nothing is known of (a first visit) shows its titles and status first, about a second, and the checks, labels, reviewers and comment counts fill into the same rows behind them: until then a row shows only what is known (no badge, no checkbox that can be ticked, no Actions, Assign or Request review) and nothing reads “couldn't read”. Every PR the owner acts on from a list is read again as the action starts, so a copy of a row is never the thing acted on. The platform's repository is always loaded in the background, the owner's other active repositories after it, and one **Always load** switch under a repository's name keeps any repository loaded: a preference of this workspace that grants nothing on GitHub.

### Agent review window and progress

Every agent and confirm window opens with the same centred lines (one shared head): the repository and number in purple capitals, then the job (Review, Finish it for me or Take over), then the PR's name and, under it, the branch it merges from, an arrow and the branch it merges into. Steps added by a switch are marked; the start button follows the same choice. What GitHub sees is a label with one icon, the first line of the foot, right above the buttons (amber when something reaches GitHub, green when nothing does; owner's choice, 2026-11-12, it was the first line of the head). It pulses slowly so it reads as something to open, and its themed card, opened above it by hover, keyboard focus or a tap, says it in words. An agent window in a dialog keeps one size whatever is open inside it: the head and the foot stay put and the middle scrolls, with a fade at its foot while more is below. Who sees the result sits on one row, the question left and the three choices right. The agent picker starts on the agent saved in Settings → Default agent. Scroll areas around the picker (the list, the Settings panel, the dialog) never show a scrollbar. The window explains public effects and Stop when relevant; exact versions stay in a collapsed detail. On a saved review link the same content renders inline on its page. A takeover never marks a draft ready or merges: every push waits for the owner's Push, and the owner opens and merges it themselves. Take over asks for a reason, posted with the start. Exact head/base binding and prompt/model freeze are checked underneath, not repeated as routine disclosures. A run carries its own owning conversation and named remaining state; queued is not merged, and green checks do not imply independent approval.

### Actions menu, confirm sheets and review answers

**Actions ▾** opens one head box that says where the PR stands (on the PR's own page: its number, the machine's short label and the checks on one line; anywhere else the machine's sentence follows, because the row is covered), then a **You** group (only when there is something of the owner's own to do) above an **Agent** group; with nothing of the owner's own, it is the plain agent list with no group names. The next step is first and tinted; a choice is dimmed in place with its reason only when it is stopped (the PR cannot be read, is closed or merged, an agent is working on it, or a send is unconfirmed) or has nothing to act on (no draft). A row that would change nothing is left out: Open for review shows only on a draft, Back to draft only on an open PR, and the two Asks only once someone can be asked. About six rows show; the rest scroll under the head with no scrollbar and a fade at the foot. The confirm sheet reuses the review window's shell: the head above, a short list of facts in the inset box (a tick, a warning or a cross, each in words, never colour alone), an optional how-it-lands choice or, for the two Ask actions, a checklist of who to ask with a line of what is true of each person, and two equal buttons: Cancel and one primary button that names the result. Cancel is the window's one way out, and so it is for the Review and Respond to feedback windows, whose shell it shares: there is never an X beside it (owner's choice, 2026-11-12; it replaced the X). A window with no main button (Ignore this review) keeps its X. On success both buttons go and a single Done remains. Where Möbius confirms the owner's taps on its own sheet (outside the app, drawn by Möbius), that sheet replaces this one for Merge and the status changes: the app shows only a line ("Waiting for your confirmation in Möbius…" until the owner has confirmed, then its working line) and then the same outcome, and **Merge options…** (a second, smaller choice on the Merge row, only where the repository allows more than one way) opens this sheet's how-it-lands choice before Möbius's sheet.

The Review tab picks its buttons by what happened: **Fix these findings** is the one tinted button on the owner's own PR, then **Set aside…**, **Review again** and **Ask the reviewer something**, all plain buttons. The row beside a PR in the list carries one chip for whose turn it is: amber only for the owner's own move, quiet grey for "Waiting on <author>" or "Ignored".

A saved Respond-to-feedback answer sits first on the Review tab in the same amber frame while it waits on the owner: each point wears a Desk chip for how it ended (green Fixed, plain Not valid, amber Out of scope), the replies show word for word, **Post** is the one tinted button with **Reply in chat** and **Discard** plain (without the host's owner grant it is disabled, the card says why in one plain sentence and offers **Copy replies**, and the Respond window says so before it starts), and the steps Post will take are numbered, then ticked (a check in a ring, never colour alone) as the chat does them. Right after Post the card is "Sent to the chat" with a spinner and the travelling frame, and only Open chat; **Send again** is the main button only if the chat has not started after 30 seconds, or at once when the message to it failed. Its box goes plain while the conversation's own box above it asks first, and once posted it is a quiet summary with links.

**Agent runs** is a desk view like Needs you: project cards in the desk's order, three tabs named for what they hold (Waiting on you, Running, Finished; it opens on the first with rows), rows that open the PR on its Review tab. Finished holds only what is over. A run that waits on the owner is listed under Waiting on you and counts in Needs you; in the rail only a small spinner and “N running” show agents at work. Merged PRs are a filter on My PRs, and local changes are a banner on each project page.

### Contribution detail

Actions and Conversation / Files changed / Checks tabs remain in place above a bounded scrolling body. Conversation opens first. Delayed success or failure changes content in that body without shifting the title, actions, or tabs.

**The Checks Rule.** The Checks tab opens with one summary line: a small ring of the four states, the counts in words (“1 running · 13 passed · 6 skipped”), the commit they are for, when they were read, and **Check again** at the top right. Skipped and neutral checks count as passing, as in the tab's badge and the PR list. Under it sit one quiet note (checks are not an all-clear review) and the PR list's chips (All, Failing, Running, Passed, Skipped; a state with no checks steps back, and on a phone the chips wrap instead of scrolling). The checks are grouped by what needs the owner: Failing, Running, Passed, Skipped. A failing check is open with its reason (the failed step and the note the check wrote); passed and skipped checks fold behind **Show N more** once there are more than four. A check is one line: an icon and GitHub's own word for its result (never colour alone), its name, how long it took or when it started, and a GitHub icon that names itself in a tooltip. A commit status is a row like any check run. A check GitHub has not settled, or reports in a way the list does not know, reads Pending and never counts as passed; a read that failed says the checks could not be read, never that there are none.

### Settings and prompt editor

A single flat prompt editor groups Review, Fix and Merge decision. Tabs have generous targets and a genuine textarea; Save and Restore are explicit. A prior run’s saved prompts are inspectable in its own detail, without duplicating a full prompt in Settings or launch. A preset edit does not mutate a previously admitted run.

## Names, tokens and counts

**The One Name Rule.** One name for one meaning, everywhere. Every button, menu row, hint, pill and test reads its words from `names.js`; to rename something, change it there. A pill says what is true, a hint is one sentence, a button says what you do. Three agent jobs stay separate on purpose (Fix these findings, Finish it for me, Respond to feedback); Finish it for me is in the Actions menu only on a Möbius that cannot follow a PR after it was sent, and **Follow this PR** takes its place elsewhere; a stopped fix job starts again as Run it again, a stopped review as Review again. `test/names.test.mjs` keeps retired names out of screen text.

**Following.** Following is a standing permission, not a job, so it has its own words: **Follow this PR** (the menu row that starts it), **Follow** (the button), **Following** and **Following paused** (what is true), **Pause**, **Resume** and **Change**. The window is the shared confirm sheet: the facts of what the agent may do, a two-way choice drawn like Merge's "How should it land?" (**Ask me before each push** first, **Push on its own** second, one sentence each), and one button. For a PR that is already followed the same choice gains **Pause** as a third way, the way things are now is marked as current and its button stays off, and the button reads Change, Pause or Resume for the way picked. On the PR page following is one quiet line under the facts line (the cycle icon, **Following**, a middle dot and what the agent last did, for example "a fix is ready for you: press Update PR"), with Pause or Resume as a quiet button at its end; it is never a pill or a flag, because it asks nothing of the owner. All of it is drawn only where Möbius advertises `follow_after_send`.

**The Token Sheet Rule.** Six corner radii (6, 8, 10, 12, round and the window's 24, which is 20 on a phone) and four type sizes (14, 16, 22, 28) with a compact phone set (13, 15, 20, 22, chips at 12), plus 16 for text you type and 13 and 12 for the phone PR description only, named as custom properties in `theme.js`; no rule carries a raw value (`test/style-tokens.test.mjs`). Buttons come in three types: primary (filled), secondary (bordered) and quiet (text), plus a danger modifier and an icon-only shape, all one control tall: 44px, or 38px drawn with a 44px tap on a phone (`button-theme.js`). A class that only adds layout may sit beside them; none sets its own border, fill, colour, corner or height. Purple text on its tinted fill is mixed toward the text colour so it reads at 4.5:1 and above.

**The Window Rule.** Every pop-up over the page is one window (owner's choice, 2026-11-12, after Möbius's own confirm window): a darkened, blurred backdrop and one round card (the window radius, a faint accent edge, a deep soft shadow), its words centred over a body that reads left to right. The head is the repository and number in purple capitals, the title (the section size), the PR's name and the branches it merges from and into; facts, steps and the people to ask sit in inset boxes; the foot is one muted line and two equal buttons, Cancel and the action (a window with no action keeps a small X). On a phone the card floats above the bottom edge with the main button on top and Cancel under it, scrolls inside itself, and keeps its foot in view at every width. Every window is the browser's own modal dialog (the shared one is `ui/ReviewDialog.jsx`, opened with `showModal()`; the picture viewer has its own): the page behind is inert and does not scroll, Tab stays inside, Escape closes it, a click outside closes it (`closedby="any"`, with a small fallback for a browser that lacks it), and in Chrome the Android Back gesture closes it too; focus goes in and returns to what opened it. The windows are the agent and confirm windows, Set this review aside, the Send to GitHub and Mark ready panes, and Withdraw and Discard (a question that cannot be taken back: Keep has focus, the action is the danger button), and the picture viewer; the phone Actions menu keeps being a bottom sheet because it is a menu, with the same backdrop and round top. Settings and Add repository are panels you work in, not windows. Möbius's own confirm window is the same family; it still draws a small purple bar above the capitals, which these windows leave out.

**The Under-Way Rule.** Words for something under way (“Merging…”, “Sending…”, “Loading changes…”) carry one motion everywhere: a light passes over them (`ui/Shine.jsx`, the sweep the Send button always had), on button labels, loading lines and the window's own line alike. It stands still with reduced motion and in forced colours, and error and warning lines never move: they are read, not watched. Once you press an action its window stops asking and says what is happening (“Merging #162 into main”), the line sits in the middle, and the result arrives once: the check draws itself, the line rises in, the PR number is bold and a branch is a chip (`**#9**` and `` `main` `` in the words, `Words` in `ui/Shine.jsx`). Menu rows that end in an ellipsis because they open more (“Set aside…”) are not under way and do not move.

**The Sync Rule.** The header's time says when everything on screen was last read ("Last synced"). The app shown again after five minutes or more catches up with one quiet full sync (no progress, no line, never inside the GitHub cooldown, never when the account runs low; its GitHub reads go through the sync hub's automatic path, so the 55-point review-request read is made once, never queued twice, and only the owner's Sync forces it; the sync waits for that read and the header's time follows its outcome), and a failed quiet sync leaves the last good time to age. The owner's own press of Sync ends with one quiet line under the header that says what changed on the desk ("Synced. 1 new review request · 1 more thing needs you", or "Synced. Nothing new for you."): a check that draws itself, the numbers bold, six seconds on screen, then it fades and folds away. It speaks for the desk only (Needs you, Review requests and the repositories' GitHub updates), never for each repository's PR list, so it never says that nothing changed (`sync-summary.js`).

**The Four Views Rule.** The rail has four views: Needs you, Review requests, My PRs and Agent runs, then Repositories as a block of its own (a heading, a divider, More repositories folded, Add repository last; its form opens in flow under that row, because the rail scrolls and would clip a floating panel). Older places live inside them (`deskViewKey`). “Projects” is the Möbius shell's own word, so the app's list is Repositories and its settings popover is Contribute settings.

**The One Count Rule.** A badge counts what waits on the owner and is the sum of the chips beside it. The Needs you chips (To look at, Review, Merge, Fix, Review again) filter the list below them; a PR with a feedback card counts once, as that card. Drafts ready to open are a quiet line and local files a project banner; neither enters a number.

**The One Row Rule.** Every desk row, whichever list holds it (Needs you, Review requests, My PRs, Agent runs, merged), is one layout (`ui/DeskRow.jsx`): the title, then “#number · who · when”, then the status pills, then at most one line of reason with Show more when text is cut. The status is the shared decision's word (`pr-standing.js`), the same on the desk, the repository list and the PR page, and a PR counts once. A merged row opens its PR page.

**The One Icon Rule.** An icon means one thing: the eye is Needs you and Review, the sparkle marks agent work only (not the Actions menu, which also holds the owner's own steps), a draft icon marks a prepared PR, each of the four views has its own mark.

## The PR page's next step

The PR page opens on its number and title, then one facts line: the state badge, the author, the branch it merges from and into, and its labels (owner's choice, 2026-11-12: the branch left the Description fold and the four-step state line went). On a phone the title comes first, then one facts line of the state badge, the number and the author, and the branches and labels sit in the folded Description row's head, where they stay in sight without opening it (owner's choice, 2026-11-13). An open PR's badge adds where it stands: Approved (an approval counts only for this exact version, or for an older commit whose added and removed lines are proved the same), the machine's own label while it rests ("Waiting on reviewers"), or In review. Under the actions sits one panel: a pill for what is true, the PR machine's own sentence, and one filled button for the next step it names. A resting state (nothing for anyone here to do, no agent at work) draws no panel, because the badge already says it. The button runs the same handler as the Actions menu (a stopped job starts again through the same window), opens the Review tab, or Syncs; it is absent when the step is not the owner's, is refused, or this Möbius cannot run it. On a phone the button pins to the foot of the page and leaves the panel, so one next step is on screen, never two. The Commits tab follows Comments: grouped by day, each commit with its title (which opens that commit's changes; when the commit has more to say, a bordered chevron beside the title opens the rest of the message at the card's full width), authors (the agent's commits marked), time, the checks' result in words, the short hash (pressing it copies the full hash and the icon says when it has) and one GitHub icon that names itself in a tooltip; a line shows where the last review stopped and a Review again banner offers the machine's own review action for newer commits. Close pull request is red, apart and last in Actions, and the menu never starts its focus on it.

## On a phone

The four views are one segmented bar with every segment on screen, the word first and its count after it (two by two on the narrowest phones, never overlapping). The repository list is a button of its own under the bar, with a few project icons, a count and a chevron, so it reads as a place you go to and never as a search. Needs you and Repositories share one layout: a filter line (plain text, the count first in the accent colour, the chosen word underlined), then the same search field with its magnifier, then the list. The Actions button has the strong edge (`--co-edge`) on every width, with the same icon, and its menu has the same edge; on a phone that menu is a sheet from the bottom edge, with a grab handle and its head fixed on top, a dimmed page behind it, rows of at least 48px (a title and one line of hint) that scroll in the middle, Merge's second choice named Options, and a Cancel row pinned at the foot above the safe area, so it can never run off a side and Cancel is never below the fold. Sync and Settings keep a word. The review window's footer stays on screen so Start is never below the fold. The opening screen names its five reads with a progress bar and real counts, from the same conditions the app waits on. That screen is for a first visit only, and ends as soon as what concerns the owner (their review requests and own PRs) has answered. Every later open shows the desk at once from its last-known copy and updates quietly: the header reads Updating… with how old the copy is, then Last synced just now. A status that changes is replaced in its own pill with one soft highlight, and a row that arrives fades in once. No spinner sits in a list and no Retry shows during the normal wait; a failed update says so in plain words, and Sync with GitHub is the way out.

## Do's and Don'ts

### Do:
- **Do** preserve the plain local and GitHub status above PR work, and send updates to Settings or the App Store.
- **Do** lead with visible PR title, colored labels, author and GitHub-style check counts; omit empty agent state.
- **Do** keep selection independent from row detail and route agent action through the review window.
- **Do** name every control by its result, from `names.js`; an icon-only button always carries an accessible name and the same words in its tooltip.
- **Do** distinguish assignment, private review, legacy merge scope, and scoped takeover.
- **Do** use the one search field (`ui/SearchField.jsx`) for every search: filled surface, thin edge, magnifier, Clear while there is text, one purple edge and soft ring on focus, 44px tall, a 16px input so phones do not zoom. Never draw a screen's own search input.
- **Do** open a repository from the rounded button that holds its icon and name on a card header (`co-btn-chip`, button-theme.js): a faint fill so it reads as pressable, the accent while pressed, a long name ending in an ellipsis. There is no separate Open word.
- **Do** keep detail controls stable while context loads and scrolls below them.
- **Do** show paused work by name and preserve its remaining steps without automatic restart.
- **Do** keep editable prompts separate from frozen run snapshots and immutable safety instructions.
- **Do** identify selected PRs and explain actual public effects before approval; retain exact-version binding underneath.

### Don't:
- **Don't** restore a split-pane workspace, parallel Reviews room, or bottom tray as the primary PR action.
- **Don't** equate passing checks with a review verdict or queued work with merged work.
- **Don't** start agent work merely from selecting a PR or assigning a person.
- **Don't** use assignment to ask someone for a review, or assign the owner to a PR they only review: an assignee is the person responsible for the PR; a review request is a separate GitHub action.
- **Don't** hide changed-version removal, scope drift, or ambiguous outcomes.
- **Don't** shrink one line, row or control to make it fit a phone. A phone's sizes are the compact set of the token sheet and nothing else (The Compact Phone Rule): 12px is the floor, text you type stays 16px, and a control keeps its 44px tap.
- **Don't** invent fixed colors, fonts, icons, approval states, or product permissions outside the shell and implemented contract.
