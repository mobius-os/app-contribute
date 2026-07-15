# app-contribute — Contribute

See what your agent has proposed upstream — pull requests, issues, and
comments across the Möbius ecosystem, from prepared to merged.

A [Möbius](https://github.com/mobius-os) catalog mini-app. Install it from
the in-app App Store.

## What it does

Möbius apps and the platform itself are open source. When your agent fixes
a bug or adds a feature, it can offer to share that change upstream so it
ships to every Möbius user — but only with your explicit go-ahead on each
contribution. This app is the dashboard for that loop:

- **Sources** — a fetch-free map of the platform and every installed app.
  Each project keeps two relationships separate: the recorded update source
  versus your live `main`, and the ready/open contribution branches attached
  to that project. Tree-delta counts avoid treating installation bookkeeping
  commits as source changes; staged, unstaged, untracked, and conflicted files
  are shown independently. Filters surface attention, different trees, working
  files, active PRs, or aligned projects.
- **Stat tiles** — Merged / Open / Ready at a glance.
- **Connection card** — connect GitHub right here, in the app. Two paths to
  the same server-side credential: the GitHub **device flow** (shown when the
  platform has an OAuth client configured — tap Connect, then enter the
  one-time code at github.com/login/device) and a **classic personal access
  token** fallback (`public_repo` scope). Once connected it shows "Connected
  as <login>" with a Disconnect button. On an older platform the card says an
  update is needed instead.
- **Feed**, grouped:
  - **Ready for review** — staged and waiting on your go-ahead. Each card
    shows high-level review context first: repo, branch, diff stat, summary,
    and the Möbius Agent co-author tag. Open the card to review exactly what
    would go public: the action ("New PR to…", "Comment on…"), the full
    markdown-rendered body draft, and a structured diff only when you ask for
    the excerpt or full patch. **Send PR for review** calls the platform submit
    endpoint directly; the server recomputes the reviewed branch diff, safely
    fast-forwards a stale reusable fork, pushes the reviewed branch, opens the
    PR on GitHub, and records the URL. A diverged fork is left untouched and the
    send stops with an actionable error. Non-PR records are
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
    reusable-fork path.
  - **Open** — PRs and issues live on GitHub, plus anything the agent is
    submitting right now. State is refreshed on open; the daily background job
    also checks for comments, reviews, and failing checks that need follow-up.
  - **History** — merged, closed, commented, and abandoned.

When a tracked PR becomes merged or closed, Contribute removes only its
disposable local staging checkout. The ledger record, reviewed diff, reusable
GitHub fork, and GitHub topic branch remain available.

The GitHub token stays server-side and never reaches this app. The app can read
GitHub state and can call the single prepared-contribution submit endpoint after
you approve a specific PR; it is not a general GitHub write proxy.

The repo also ships `contributing.md`, the agent-side skill for the whole
loop — studying existing upstream work, staging a reviewable plan here, the
approval gate, and the exact command sequences. The manifest declares it
under `skills`, and the platform installs it into the shared skills folder
on install and update, so the skill always matches the app version.

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
  "status": "prepared | submitting | draft | open | merged | closed | commented | abandoned",
  "branch": "fix/notes-reorder",
  "chat_id": "…",
  "created_at": "2026-07-06T09:00:00Z",
  "updated_at": "2026-07-06T09:00:00Z",
  "summary": "One-line, partner-facing description.",
  "last_submit_error": "optional partner-actionable submit failure",
  "last_pushed_branch_url": "optional branch URL if push succeeded before PR creation failed",
  "needs_attention": true,
  "attention": {
    "type": "checks_failed | changes_requested | github_activity",
    "title": "Checks failed",
    "message": "The latest GitHub checks are failing.",
    "url": "https://github.com/…"
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

`submitting` means the platform submit endpoint has claimed the record and the
action is in flight; `commented` is the terminal status for comment actions.
The daily job also adds `needs_attention` + `attention` when GitHub activity,
changes requested, or failing checks need agent follow-up. The daily job and
the dismiss flow both write with `If-Match` (compare-and-swap) when the runtime
returns a version, so concurrent writers — the agent, the cron refresh, the
Dismiss button — avoid silently overwriting each other. On older runtimes that
don't return a version, Dismiss re-reads and re-checks the record before
writing, while the cron refresh falls back to a plain best-effort write.

## License

MIT — see [LICENSE](LICENSE).
