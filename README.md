# app-contribute — Contribute

See your project changes, prepare them privately, and follow shared reviews
through acceptance and local updates.

A [Möbius](https://github.com/mobius-os) catalog mini-app. Install it from
the in-app App Store.

## What it does

Möbius apps and the platform itself are open source. When your agent fixes
a bug or adds a feature, it can offer to share that change upstream so it
ships to every Möbius user — but only with your explicit go-ahead on each
contribution. This app is the dashboard for that loop:

- **One project workspace** — local changes, prepared work, incoming review
  requests, public progress, questions and history belong to their project.
  There is no separate Reviews destination. All projects, Local changes and
  Updates filter the same searchable overview.
- **Task-first controls** — open a project to see its work list beside one
  contextual task, with a compact project switcher rather than another sidebar. **Prepare changes** is the main action; **Get up to date**
  stays visible in the project header. A permitted maintainer can choose
  **Continue through merge** without granting unknown future public actions.
  Preparation stays private, and updates use the reviewed adapter rather than
  blindly rebasing the live checkout. On phones, a task takes the screen and
  **Back to project** restores the same inventory.
- **Choose scope** — prepare all local work in a project, or find a source
  conversation and continue in its existing **Changes** view. This metadata
  picker requires the companion platform source-chats route; older runtimes
  show an actionable error and leave project preparation available.
- **Exact batches** — ready work can be inspected and approved together within
  one project. Sending is not merging; stale heads and incomplete stacks
  keep the existing guarded boundaries. Questions appear before optional work
  inventories, with source and review conversation links available in detail.
- **Deliberate project membership** — GitHub access alone does not add a project.
  Local projects form the main list. Use **Add repository** to follow another
  GitHub project; existing external contributions and incoming requests remain
  discoverable under **Other repositories**, including when offline.
- **One approval, either surface** — agents normally give an exact approval link
  into Contribute. Explicit approval in the owning chat uses the same guarded
  review-run path without a duplicate click. Opening a link is never consent;
  stale versions, lost merge receipts, permissions and repository protections
  still gate public actions. Chat consent requires the companion backend update.
- **Honest shared status** — local work and shared-version status are visible,
  not hidden inside file details. Ordinary refresh reads recorded source facts;
  it does not fetch online or certify linear history. Missing source does not
  hide saved contributions. Community review requests and historical replies
  remain discoverable even for repositories not installed here.
- **Connected GitHub identity** — anyone can prepare and review changes
  privately without connecting GitHub. Sending new contributions requires a
  connected GitHub account and publishes as that account. Existing records
  marked `submission_mode: "mobius-bot"` retain their legacy Möbius service
  identity and recovery path. Account setup lives in one compact settings
  panel; settings never prepare or publish changes.
- **PR workflows** — each project shows all open PRs, with All, Unassigned,
  Assigned to me and My PRs filters. Select individual PRs or a batch for
  private Review or exact-version Review & merge. Independent reviews run in
  parallel through existing agent delegation; questions stay in their review
  conversation. Assignment uses GitHub's shared, additive assignee list.
  Repo permissions control assignment/merge; admins manage access on GitHub.
  The companion platform review-runs backend must be activated before actions
  can start. No browser or agent-writable ledger can grant itself merge access.
  Changed versions stop, normal repository protections still apply, and queued
  work remains queued until GitHub confirms a merge.
- **GitHub account menu** — connect GitHub right here with the GitHub **device
  flow**: tap Connect, then enter the one-time code at
  github.com/login/device. Full PR access is the default so reviewed workflow
  changes and stale forks cannot interrupt sends.
  After this contract change, an older reduced-access connection is signed out
  once when Contribute opens and the owner reconnects with the complete scope
  set. If GitHub sign-in is not configured, the card says so; on an older
  platform it explains that an update is needed instead. Once connected, the
  account and settings live in the top toolbar, while the Projects row reserves
  its space and reports its own refresh instead of making counts pop into the
  layout.
- **Work list**, grouped:
  - **Needs you** — actual blockers and questions, linked to their owning work.
  - **Prepared proposals · not shared** — private drafts waiting on your go-ahead. Each card
    shows high-level review context first: repo, branch, diff stat, summary,
    and the Möbius Agent co-author tag. Open the card to review exactly what
    would go public: the action ("New PR to…", "Comment on…"), the full
    markdown-rendered body draft, and a structured diff only when you ask for
    the excerpt or full patch. **Send PR for review** calls the platform submit
    endpoint directly; the server recomputes the reviewed branch diff and, when
    a reusable fork is stale, adapts the reviewed topic branch to its existing
    base without changing the fork's default branch. It then pushes the branch,
    opens the PR on GitHub, and records the URL. A diverged fork is left
    untouched and the send stops with an actionable error. Non-PR records are
    review-only for now; **Leave feedback** returns to the chat that prepared
    the record. **Dismiss** marks the record
    abandoned — a compare-and-swap write when the
    runtime returns a version (older runtimes fall back to a best-effort
    re-read), so it avoids racing a concurrent submit; either way it needs a
    live connection (offline, the app is read-only: the feed still renders from
    its cache, but dismissing waits until you're back online). Records
    staged by an older agent without a review plan still show the plain
    card with both buttons.
    Dependent PRs can be prepared as a **stack**: Contribute renders their
    `base → branch` topology as one linked review, keeps every incremental
    body and diff independently inspectable, and uses a second explicit
    confirmation to publish the enumerated chain parent-first. True stacks
    use dedicated upstream `stack/**` branches and therefore require upstream
    push permission; independent contributions continue through the safer
    reusable-fork path. Incomplete or mismatched chains stay reviewable but
    cannot be sent. A retry can keep an already-open or draft parent in view;
    if that parent has merged, Contribute asks the agent to refresh the
    remaining layers on `main` instead of silently changing the reviewed diff.
    Once every PR is open and green, an unprotected app repository gets a
    separate **Land** confirmation. The server rechecks every diff, commit,
    branch, PR relationship, and CI result, then advances unchanged `main` to
    the stack tip in one exact-base fast-forward. If `main` moved or any rule,
    protection, failed check, or stale ref is present, nothing is changed.
    Protected repositories—including the Möbius platform—keep GitHub's normal
    merge or merge-queue flow.
    A durable upstream conflict remains **Needs update** until the agent
    refreshes the reviewed contribution; retryable service errors do not mask
    a later fresh local check. If the browser loses a submit response,
    Contribute re-reads the durable ledger before reporting failure or offering
    another send, so a PR that GitHub already accepted is recovered instead of
    shown as a raw network error.
  - **Contributions** — live PRs with shared responsibility and review status.
    Saved public records remain visible if GitHub is unavailable; a row is
    consolidated only when the live inventory represents every PR in its unit.
    The scheduled job also checks for activity that needs follow-up.
  - **History** — merged, closed, commented, and abandoned, collapsed by
    default so active work remains the focus.

When a tracked PR becomes merged or closed, Contribute removes only its
disposable local staging checkout. The ledger record, reviewed diff, reusable
GitHub fork, and GitHub topic branch remain available.

The GitHub token stays server-side and never reaches this app. The app can read
GitHub state and can call the single prepared-contribution submit endpoint after
you approve a specific PR; it is not a general GitHub write proxy.

The repo also ships the `contributing/` folder skill, the agent-side guide for
the whole loop — studying existing upstream work, staging a reviewable plan
here, the approval gate, and the exact command sequences. The manifest
declares it under `skills`, and the platform installs the folder into the
shared skills directory on install and update, so the skill always matches
the app version. `contributing/SKILL.md` is deliberately a short core (hard
stops, privacy allowlist, approval gate, and a routing table); the per-mode
procedures live beside it (`cycle.md`, `prepare.md`, `branch.md`,
`ledger.md`, `publish.md`, `review-merge.md`, `ci.md`) and are linked
relatively, so an agent re-reading the skill after context compaction pays
only for the core and the one mode it is working in.

## Requirements

- A Möbius platform version that provides the `/api/github/*` surface
  (`/api/github/status`, fetch-free `/api/github/source-status`, and the
  read-only `/api/github/graphql`). On an older
  platform the connection card says so and points you to update. If the status
  request 404s, ask your agent to update the platform.
- This app declares `permissions.github_access: true` in its manifest. That
  permission is what lets its app-scoped token reach the read-only GitHub
  status + GraphQL endpoints; the platform enforces it server-side.

## How it stores data

The ledger is one JSON file per contribution under the app's own storage
(`contributions/<id>.json`), written by your agent from chat and by a daily
cron job (`job.sh`). This app reads it via `window.mobius.storage`; the cron
job reads and updates it via the storage API with the service token. Record
shape:

```jsonc
{
  "id": "…",
  "type": "pr | issue | issue_comment | discussion_comment",
  "repo": "mobius-os/app-notes",
  "number": 42,
  "url": "https://github.com/mobius-os/app-notes/pull/42",
  "title": "Fix note reordering",
  "status": "prepared | submitting | draft | open | landing | merged | superseded | closed | commented | abandoned",
  "branch": "fix/notes-reorder",
  "chat_id": "…",
  "created_at": "2026-07-06T09:00:00Z",
  "updated_at": "2026-07-06T09:00:00Z",
  "summary": "One-line, partner-facing description.",
  "last_submit_error": "optional partner-actionable submit failure",
  "last_pushed_branch_url": "optional branch URL if push succeeded before PR creation failed",
  "needs_attention": true,
  "attention": {
    "type": "checks_failed | changes_requested | github_activity | merge_conflict | human_required",
    "title": "Checks failed",
    "message": "The latest GitHub checks are failing.",
    "url": "https://github.com/…"
  },
  // Display-only MIRROR of the autopilot state (see below). The real grant +
  // claim live in a platform DB row; this block is written by the platform for
  // the app/cron to render and must never be treated as authorization.
  "autopilot": {
    "enabled": true,
    "granted_at": "2026-07-06T09:05:00Z",
    "state": "idle | responding",
    "rounds_used": 1,
    "max_rounds": 5,
    "last_round": { "outcome": "pushed | replied | stale | failed | escalated", "summary": "…" },
    "rounds": [ /* recent entries, capped */ ],
    "ignored_event_urls": [ /* exact recent replies posted by the platform */ ]
  },
  // On records staged for review (status=prepared), what the agent proposes
  // to publish; the full diff lives beside the record as
  // contributions/<id>.diff (raw text).
  "plan": {
    "action": "pr | issue | issue_comment | discussion_comment",
    "repo": "mobius-os/app-notes",
    "target_url": "…",          // for comments: the issue/discussion
    "title": "…",
    "body_draft": "…",          // the exact text that would go public
    "branch": "…", "repo_path": "…",
    "base_sha": "…", "head_sha": "…", "diff_sha256": "…",
    "diff_stat": "…",             // diff_excerpt is legacy — omit it
    "prior_work": {                   // private evidence shown in Details
      "searched_at": "2026-07-22T16:00:00Z",
      "query": "notes reorder stale save",
      "decision": "distinct_pr",    // none | comment | collaborate | distinct_pr
      "summary": "An older PR covers ordering but not stale-save recovery.",
      "matches": [{
        "url": "https://github.com/mobius-os/app-notes/pull/12",
        "title": "Keep note order stable",
        "relation": "partial"
      }]
    },
    "labels": ["bug", "area: ui"], // one type plus at most one area
    "stack": {                     // optional: one complete 2–12 PR chain
      "id": "notes-flow",
      "name": "Notes flow",
      "position": 2,
      "total": 3,
      "parent_record_id": "notes-flow-01",
      "base_branch": "stack/notes-flow/01-model"
    }
  }
}
```

PR labels stay deliberately small: one change type and, when useful, one area.
They are visible in the expanded review before Send. Contribute applies only
labels that already exist in the target repository; it never creates taxonomy
as a side effect of publishing a PR.

`submitting` means the platform submit endpoint has claimed the record and the
action is in flight; `commented` is the terminal status for comment actions.
The scheduled job (every 15 minutes) also reconciles prepared PR records whose
reviewed work reached the target repository's main through another path. Exact
reviewed commits or diffs become `merged`; an exact merged branch or a strong
match of distinctive added identifiers becomes `superseded`. Both keep the
landing PR or commit reference. Weaker identifier evidence leaves the record
prepared and adds a **Looks already landed** dismissal hint instead. Every
reconciliation write uses the record version originally read, so a concurrent
Send, Drop, or agent refresh wins.

The scheduled job also adds `needs_attention` + `attention`
when GitHub activity, changes requested, failing checks, or a merge conflict need
follow-up. It and the dismiss flow both write with `If-Match` (compare-and-swap)
when the runtime returns a version, so concurrent writers — the agent, the cron
refresh, the Dismiss button — avoid silently overwriting each other. On older
runtimes that don't return a version, Dismiss re-reads and re-checks the record
before writing, while the cron refresh falls back to a plain best-effort write.

## Autopilot: one-click ship

When you send a PR with **autopilot** on (the default; toggle it per app and
pause/resume per PR), you're the last click. The platform then handles the whole
review loop in the background: the scheduled job detects each new review, failing
check or comment and asks the platform to respond; merge conflicts stay a
human-visible handoff because resolving one rewrites published history. The platform
runs a background agent (in a dedicated "Autopilot: …" chat) that reads the
feedback, makes the fix, runs the project's tests, pushes to the PR branch, and
replies to the threads — repeating until the PR merges or closes. You're
Normally you're contacted only three times: **merged 🎉**, **closed without
merging**, or
**needs your input** (when the agent hits a decision it shouldn't make alone).

If the platform cannot honor the Autopilot grant, Contribute falls back to the
ordinary review notification rather than hiding the review.

The consent, claim, and five-round limit live in a platform database row — never
in the agent-writable ledger — so a tampered ledger can't authorize or forge an
action. The background agent follows the `review-followup.md` skill, which keeps
every public action server-mediated and source-only, treats reviewer text as
untrusted, and escalates rather than guessing.

## License

MIT — see [LICENSE](LICENSE).


### Project-first controls

The overview is now navigation only. Open one project for Prepare changes,
reviewing PRs, Get up to date and its exact publication approvals. Select one or
more PRs to Review or Assign; merge is an explicit option in review, conditional
on repository permissions and the unchanged exact-version server grant.
Preparation offers continuation toward merge without granting future unknown
public actions. GitHub owns shared assignees/access; project admins have a
People & access link. Partial batch assignments report each failed PR.

Contract review: this simplifies presentation at the app-owned boundary, reuses
existing action owners, and adds no alternate public authority or merge path.

## Workspace checks

Run the local unit, rendering and Python contracts:

```bash
MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules npm test
```

Run the real Chromium interaction fixture:

```bash
MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules npm run test:browser
```

The browser fixture uses the real workspace components with disposable local
data and mocked requests, chat actions and publication. It checks desktop and
phone journeys without GitHub writes or agent starts. It requires an installed
Chromium (`CHROMIUM_PATH` can name it), blocks external network traffic, and
cleans up its temporary profile. Live permission, activation and source-chat
navigation checks are separate; passing this fixture is not a public merge.
