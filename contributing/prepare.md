# Contributing: prepare one contribution

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Branch recipes live in
[branch.md](branch.md); ledger writes in
[ledger.md](ledger.md).

## Study existing work before every contribution

Run this read-only preflight early enough to avoid duplicating work, and ALWAYS
run it again no later than before staging any PR, issue, or comment in
Contribute. This applies even when the code is already written or the change
looks novel. A contribution is not ready for review until you have searched by
the problem, subsystem, and visible symptoms, then inspected promising diffs
and discussion. Searching and studying are read-only: no approval needed.

```bash
gh search issues --owner mobius-os "<problem in a few words>" --limit 10
gh search prs --owner mobius-os "<same words>" --limit 10
curl -s https://raw.githubusercontent.com/mobius-os/app-store/main/catalog.json | python3 -m json.tool
```

gh search covers open+closed by default — don't pass `--state` (its search form
rejects `all`, and you want both). Know the repo? List it directly and keep
`-s all` (valid there):

```bash
gh issue list -R <owner>/<repo> -s all --search "<terms>"
gh pr list    -R <owner>/<repo> -s all --search "<terms>"
```

If the catalog already has the app, installing beats rebuilding; empty results
are normal, not a broken search.

On a hit, study it (`gh issue view <url> --comments`, `gh pr view <url> --json
title,body,state,comments`, `gh pr diff <url>`), compare correctness, scope,
tests, review state, and activity, then choose exactly ONE:

- **Same sound fix:** do not prepare a duplicate PR. Stage a review/comment only
  when you add evidence, a concrete suggestion, or a useful test result.
- **Promising but incomplete:** prefer a review with specific suggestions. The
  author's branch remains theirs; even when maintainer edits are enabled, do
  not push to it without the partner's explicit approval for that public action.
- **Your ready fix is materially stronger:** prepare a distinct PR that links
  the earlier work, credits anything it uses, and explains the concrete delta.
  Do not claim to deprecate or close someone else's PR; maintainers decide which
  path supersedes another.
- **No relevant hit:** prepare a fresh PR or issue plan normally.

Record the search evidence in `plan.prior_work` (below) so the partner can see
the decision inside Contribute. Every outcome is STAGED for review, never posted.

## Review the code before every PR

Review the branch after the code is written and **before** you build the review
commit, so the partner sees the cleaned-up version. Right-size the pass to the
change: a one-line or docs-only PR needs a careful reread, not a ritual audit;
a behavioral or structural change earns proportionally deeper review. Reading
and editing local source needs no approval and publishes nothing.

Use two passes over the branch diff, in order.

**Pass 1 — strip the slop.** Read your own diff as a hostile reviewer of
machine-written code and delete what a careful human would not have written:
comments restating what the line already says or breaking the file's existing
comment style, defensive `try`/`except` and existence checks on paths that are
already trusted, casts and broad types that only silence a complaint, nesting an
early return would flatten, and near-duplicates of a helper the codebase already
has. Behavior stays identical unless you are fixing a clear bug, and the edits
stay minimal and local.

**Pass 2 — audit the structure the change itself motivates.** Ask whether the
new behavior sits at the layer that owns it and whether a simpler framing can
remove branches, flags, helpers, or layers. These are review signals, not
context-free blockers:

- hand-written source crosses roughly 1000 lines because of the diff (generated
  files, fixtures, data, and long-form prose do not count);
- new ad-hoc conditionals or special cases are bolted into a flow that did not
  care about them before;
- feature-specific logic leaks into a shared or general-purpose path;
- an abstraction, wrapper, or layer of indirection is added without buying
  clarity;
- optionality, `Any`, or loosely shaped dict payloads paper over an invariant
  that should be explicit at the boundary;
- logic lands somewhere other than the layer that already owns the concept, or
  duplicates a canonical helper;
- related updates can leave state half-applied, or independent work is
  serialized for no reason.

Act on findings that are motivated by this change and make the agreed behavior
clearer or safer, then re-read the diff. Keep unrelated refactors out of the PR.
When an obvious signal is deliberately left alone, record one sentence in the
private `plan.prior_work.summary` review evidence — never in the public
`body_draft` merely to narrate internal process. A larger finding becomes a
follow-up for the partner rather than silent scope expansion.

If the instance has a richer code-quality or slop-removal skill installed,
apply it proportionally here too.

## Thoroughly review prepared work

Treat **review all**, **review this PR**, and **fix and review again** as complete
private review intents. The owner should not have to restate the usual rubric.

1. Refresh each named record, inspect its complete diff, and mark
   `quality_review.state` as `reviewing` with CAS before material review work.
2. Review correctness, maintainability, simplicity, tests, security/privacy,
   and avoidable technical debt. Expand into owning callers and invariants when
   the changed surface warrants it; do not turn this into unrelated cleanup.
3. For owner-authored work, fix every sound finding privately, update the
   prepared branch/plan/diff, and repeat the complete review on the new head.
   For someone else's work, do not change their branch: prepare concrete,
   actionable suggestions and leave them private until approved.
4. Set `changes_needed` while a sound finding remains. Set `all_clear` only
   after the complete current head passes. A changed head invalidates the old
   verdict even if the diff looks similar.
5. Stop with the durable verdict visible in Contribute. Review work does not
   authorize a push, PR, comment, review, merge, or other GitHub mutation.

## Prepare for review

Nothing goes public here. For a PR, create a durable branch under `/data`
(recipes in [branch.md](branch.md)), commit the exact
source you want reviewed, and stage that branch as a `prepared` ledger record
(endpoints in [ledger.md](ledger.md)) with a `plan`
object carrying everything Contribute needs to submit it directly after
approval:

```
plan: {action: pr|issue|issue_comment|discussion_comment,  # mirrors record.type
       repo, target_url?, title?, body_draft, branch?, repo_path?,
       base_sha?, head_sha?, source_repo_path?, source_sha?,
       diff_sha256?, diff_stat,
       prior_work?: {searched_at, query, decision, summary?, matches?},
       labels?: [type, area?],
       stack?: {id, name?, position, total, parent_record_id, base_branch},
       after_merge?: {action: connect_app, app_id, manifest_url},
       diff_excerpt?}         # diff_stat REQUIRED; diff_excerpt legacy (unused)
```

- Write `summary` for a person who does not know Git or the codebase: one short
  sentence about what becomes clearer, safer, faster, or easier. Do not put file
  names, branch names, implementation terms, or test counts in it. The app uses
  this as the card headline and keeps the GitHub title and source details behind
  **Details**.
- Keep `title` concise and suitable for GitHub. It may use the technical term
  needed by maintainers because it is shown inside the expanded details rather
  than as the primary owner-facing explanation.
- `body_draft` is the FULL text you propose to publish — PR body, issue body, or
  comment, word for word. The partner reviews exactly this; never publish
  anything that differs from what they approved.
- `prior_work` is private review evidence, not text that is published. Set
  `searched_at` to the UTC scan time, `query` to the concise terms used, and
  `decision` to exactly one of `none`, `comment`, `collaborate`, or
  `distinct_pr`. `summary` is one plain sentence explaining why. `matches` is
  the small relevant subset (normally at most five), each shaped as
  `{url, title?, relation?, note?}` with a GitHub URL. When the decision is
  `distinct_pr`, the public `body_draft` must also reference the relevant prior
  work and explain the improvement; the private evidence does not replace that.
- `labels` is the small, reviewed GitHub classification proposed for a PR. List
  **one type** and optionally **one area**—never more than two total. Prefer the
  repository's existing taxonomy: inspect it with
  `gh label list -R <owner>/<repo> --limit 100` before staging. For Möbius repos,
  use exactly one of `bug`, `enhancement`, `documentation`, or `maintenance`,
  plus at most one of `area: ui`, `area: backend`, `area: apps`, or
  `area: infrastructure`. A visual defect is `bug` + `area: ui`; a new interface
  is `enhancement` + `area: ui`. Do not use workflow/status labels such as
  `help wanted`, `duplicate`, or `wontfix` on an already-prepared PR. Contribute
  shows these labels in Details and only applies names that still exist in the
  target repository. Missing labels or insufficient permission leave the PR
  open and unlabelled rather than changing the reviewed body or failing send.
- For PRs, `repo_path` MUST be a durable git checkout under a staging root the
  platform accepts — `/data/contrib/<workspace>` (the primary durable staging
  root), `/data/apps/`, `/data/platform`, or the legacy `/data/contributions/`;
  a scratch clone under `$TMPDIR` does not survive restart and cannot be
  approved with one click.
- Commit the reviewed source before staging. If GitHub is connected, first set
  the checkout's repo-local `user.name`/`user.email` to the connected owner
  identity (`git config --global --get user.email` should already be the
  owner's no-reply address). The partner is the commit author; Möbius is only
  the co-author. The commit message MUST include:
  `Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>`.
- Store the full canonical diff as a sibling `contributions/<id>.diff`
  (raw-text PUT — see the ledger file): the review card renders its file list
  from this. `diff_stat` is REQUIRED — the card's diffline and its file-list
  fallback (when the `.diff` is missing) both parse it. `diff_excerpt` is legacy
  and no longer displayed; you may omit it. Record
  `base_sha`/`head_sha`/`diff_sha256` so the submit button can recompute the
  exact branch diff before pushing (Hard stop #3). Compute the hash from the
  exact `.diff` bytes you store.
- Publication reviews the exact committed candidate, not its installation.
  An ordinary PR may remain uninstalled, and unrelated live edits do not make
  that review stale. Never install private work or invent a source witness to
  make Send available. Older platforms may still require installation; leave
  the candidate private and report that platform limitation rather than bypass
  its guard.
- For work originating from an installed app or platform, record truthful
  `source_repo_path` and captured `source_sha` as provenance. After Send, the
  platform records an optional local equivalence witness only if the current
  clean source proves it contains the reviewed change. Missing proof means no
  witness; later local updates retain their ordinary conservative
  reconciliation/resolver path. Exact head, diff, approval, public target and
  retry checks remain mandatory regardless of installation.
- When the contribution publishes a local app into its own canonical
  `mobius-os/app-<id>` repository, add one reviewed `after_merge` handoff:
  `{"action":"connect_app","app_id":<live numeric app id>,
  "manifest_url":"https://raw.githubusercontent.com/mobius-os/app-<id>/main/mobius.json"}`.
  Use it only when `source_repo_path` is that exact live app source,
  `source_sha` is its captured revision, and the reviewed manifest id matches
  the target app repository (or declares the live id as `previous_id`). Never
  use it for platform changes, an unrelated app, a non-`app-*` repository, or
  as a workaround for an ordinary App Store update. Contribute shows this
  handoff inside the private review. Approval to send the exact reviewed app
  publication also approves this exact post-merge connection; it is one
  publication outcome, not a later public or destructive action. Send binds it
  to the exact reviewed source and capability digests, but the connection does
  not run until GitHub confirms the reviewed change has merged (what happens
  then: *After an app PR merges* in
  [publish.md](publish.md)).

Before you tell the partner it is ready, complete the exact-head review contract
from **Thoroughly review prepared work** above. CAS-mark `quality_review.state`
as `reviewing`, inspect the complete stored diff and its owning invariants, fix
every sound issue privately, and repeat on the new head. Confirm the body draft
is exactly what should be published and that no private data appears in the
branch, commit message, branch name, body, or diff. Only then CAS-store
`quality_review.state: all_clear` with `reviewed_head_sha` exactly equal to the
current `plan.head_sha`. If that verdict cannot honestly be recorded, leave the
record visibly at **Review needed** or **Changes needed**—never tell the partner
it is sendable.

Status stays `prepared`. Then give the partner one short, text-only handoff:
summarize what is staged and say it is waiting for their review. A prepared
review is not an app build completion. Do not navigate the workspace, place an
app, or link a completion notification to an app as part of this handoff.
