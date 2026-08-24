# Contributing upstream

This is the Contribute app's project-collaboration skill. It owns the reusable
cycle for moving changes from a local project into private review, public
collaboration, and safe local reconciliation. The current built-in adapters are
Möbius platform/app projects published through GitHub, but the cycle itself is
project-shaped rather than `mobius-os`-shaped so future owner projects can use
the same intents and UI.

Use this when the owner says **prepare my changes**, **prepare all**, **address
the existing contributions**, **finish the contribution cycle**, **submit and
sync**, or **align my projects with upstream**. `Read` this before ANY public
GitHub action. The constitution's end-of-task checklist routes you here when a
change would help other users; "share this" or "report that bug upstream" lands
here too.

---

## Hard stops

Three rules never bend. The rest of this doc assumes them and points back here.

1. **No public action without a per-action yes.** Fork, push, PR, issue,
   comment — each needs the partner's explicit yes for THAT action. Not a
   standing preference, not "they approved one last week", not an inferred
   "they'd want this". Ask plainly, or stage the plan and wait.
2. **Only source code leaves the instance, and only after you re-read the FULL
   diff.** The allowlist below is exhaustive — never memory, storage, db, logs,
   creds, chat, or personal data. Re-read every changed line before proposing;
   the `body_draft` and the `.diff` are exactly what goes public.
3. **Never submit stale work.** If the staged plan's `base_sha`/`head_sha` or
   canonical branch diff has drifted since the partner reviewed it, do NOT
   submit — re-stage and tell them what changed.

## The built-in project cycle

These names are complete workflow requests, not hints that the owner must
expand into a checklist every time. Preserve every hard stop above while doing
the routine discovery and sequencing without asking the owner to restate it.

Every project adapter must supply five owning facts: the working source, the
accepted/shared source, the publication target, the reviewed local update path,
and the categories of private or local-only material that must be preserved.
The stages below do not change when those facts come from another repository or
project type. If a project has no truthful adapter yet, keep it visible but
name that missing capability instead of guessing with raw Git commands.

### Prepare my changes

Treat **prepare my changes**, **prepare all**, and a project-level Contribute
handoff as explicit approval for private preparation only. When the owner does
not narrow the scope, inventory every current Contribute project source
position, then prepare every coherent, reusable change that is safe to share.
Do not assume that every customized, personal, or local-only project belongs
upstream.

1. Start with the Contribute queue snapshot and the read-only Projects/source
   status. Refresh both rather than trusting counts copied into a handoff.
2. Classify each difference as a working draft, reusable local change, landed
   contribution already recognized, incoming shared work, compatible change,
   true conflict, private/personal project, or unavailable source. Never turn
   incoming-only work into a contribution and never publish runtime data.
3. Group reusable work by owning repository and dependency. Deduplicate it
   against existing PRs/issues, perform the two review passes, run proportionate
   checks, and stage exact private review records. Use a stack only when the
   changes truly depend on one another.
4. Stop with the prepared records in Contribute. Report what was prepared and
   what was intentionally left local, private, incomplete, duplicated, or
   blocked. Nothing public happens in this intent.

When this spans several projects or review units, make it a durable Goal with
inventory, preparation, verification, and handoff stages. A single small
project can remain an ordinary bounded turn.

### Finish the contribution cycle

Treat **finish the contribution cycle**, **handle the existing changes and
submit them**, **submit and sync**, **align my projects with upstream**, and the
Möbius-specific **align this Möbius with upstream** as one durable outcome. The
default scope is every active Contribute PR plus every current reusable local
change, unless the owner names a narrower repository or project. This intent
almost always earns a Goal because it crosses review, external waits, and local
reconciliation.

1. Refresh the complete queue and Projects status. Re-read live record states;
   prepared records may have become public or merged since the handoff was
   created.
2. Privately repair stale reviews, failed checks, merge conflicts, and sound
   review feedback. Prepare newly discovered reusable changes. Leave genuine
   owner choices, unsafe work, and unrelated refactors explicitly blocked.
3. Present the exact ready set in Contribute. **Send all ready** is the reviewed
   public approval boundary and stops if any branch or diff moved. The broad
   cycle request does not authorize an unenumerated push, comment, PR, issue, or
   merge from chat.
4. After submission, let Contribute autopilot own ordinary PR feedback. When
   this chat promises to continue after CI, review, queue, or merge, declare a
   durable read-only wait using the `waiting` skill; prose alone is not a
   watcher. Refresh the real current head and outcome whenever the chat resumes.
5. Once every in-scope public item is merged, closed, superseded, or honestly
   blocked, reconcile each local project through the reviewed update path named
   by its adapter. Preserve private/local-only work and genuine local overlays,
   send overlaps to the owning resolver rather than resetting them, and retain
   any separately confirmed activation or restart gate.
6. Refresh Projects one final time. Completion means the accepted upstream work
   is present locally and every remaining difference is classified as
   intentional local work, private data, an active draft, unavailable source,
   or a named blocker. Report prepared, sent, merged/superseded, blocked,
   aligned, and deliberately local outcomes in one concise handoff.

Do not replace these stages with a blind reset or a one-click destructive
shortcut. The streamlining is that the owner names the outcome once; exact
publication, update review, conflicts, and restart retain their existing gates.

### Thoroughly review prepared work

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

### Current Möbius adapter

For the platform and installed apps currently shown in Contribute Projects:

- the working source is the live platform checkout or app source directory;
- the accepted/shared source is the configured canonical branch or installed
  app release marker;
- publication is staged through Contribute and, once explicitly approved,
  sent through the GitHub path in this skill;
- accepted platform work returns through the reviewed Möbius update flow;
- eligible tracked apps return through App Store's reviewed **Update all** flow;
- private/local-only apps and genuine local overlays are preserved;
- overlaps use the existing resolver instead of a reset; and
- platform activation keeps its separately confirmed restart gate.

These are adapter rules, not definitions of the contribution cycle. A future
owner repository should register equivalent source, publication, update, and
privacy facts and then reuse the same **Prepare** and **Run full cycle** intents.

---

## Check you're set up

```bash
curl -s -H "Authorization: Bearer $AGENT_TOKEN" "$API_BASE_URL/api/github/status" | python3 -m json.tool
```

Use the `$API_BASE_URL` + `$AGENT_TOKEN` idiom for every chat-context command in
this file — never hardcode localhost. The payload:

- `connected: true` with a `login` — `gh` is authenticated as the owner. You
  never see the token (`gh` resolves it from the platform store — don't dig for
  it, never print it). It's wired GLOBALLY: once connected, ANY `git push` to a
  github.com remote authenticates as the owner and nothing at the git layer gates
  that — Hard stop #1 is the whole safety net. NEVER run a bare `git push` to a
  github remote outside the approved fork flow.
- `connected: false` — point the partner to the **Contribute app** (App Store)
  and its Connect GitHub card. You can still prepare a contribution (branch,
  commit, record it `prepared`); nothing goes public until they connect AND
  approve.
- `gh_version: null` — the platform image predates GitHub support. Tell the
  partner a platform update is needed; don't improvise around it.

## Start queue work from one snapshot

When the task covers more than one contribution, begin with Contribute's
read-only queue snapshot instead of rebuilding state with sequential `gh`, Git,
and ledger calls:

```bash
python3 /data/apps/contribute/agent_snapshot.py
```

It returns active items only, in dependency order, with each reviewed/local
revision, working-tree state, GitHub head, review state, mergeability, and CI.
All public PRs share one GraphQL request; one deleted or inaccessible PR remains
a partial warning and does not discard healthy siblings. Use `--json` when a
machine-readable result genuinely helps. Follow with a focused per-item read
only when that snapshot identifies a specific gap it does not contain; do not
reconstruct the complete queue again.

---

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

---

## What may leave — the privacy allowlist

Hard stop #2 names it; here it is in full.

**Contributable: source code only** — source diffs of apps (`/data/apps/<slug>/`,
the code not the data), the platform (`/data/platform/`), and the shell. That is
the whole list.

**Never, no exceptions:** anything under `/data/shared/memory/`, app storage
(`/data/apps/<int-id>/` — numeric-id dirs are runtime data, not source), the
database, logs, `/data/cli-auth/`, chat content, and anything personal — names,
schedules, health data, locations, habits, the partner's writing. Commit
messages, branch names, and PR bodies leak too: keep them generic ("fix
empty-state crash", not "fix crash when <name>'s workout log is empty").

**Re-read the FULL diff — every changed line, not the file list.** In an
installed app's repo, `git diff upstream...HEAD` shows everything local, where
`upstream` is the Möbius per-app-git branch that exists INSIDE `/data/apps/<slug>`;
in a scratch clone under `$TMPDIR` there is no `upstream` branch — diff against
`origin/main`.
Local commits routinely carry partner data into source (a seeded example, a
hardcoded name, a test fixture with real entries) — strip anything personal or
don't propose.

---

## The approval gate

Private preparation begins only from an explicit partner request, including a
project-level or **Prepare all** handoff from Contribute. Do not surface an
unsolicited contribution question at the end of an otherwise complete chat:
Contribute's Projects view owns discovery of local changes and lets the partner
start preparation when they want it.

Hard stop #1 is still the gate. In practice:

1. If the partner explicitly asks to prepare a contribution, prepare it
   privately and stop at the Contribute review record. If they ask whether a
   change *should* be contributed, answer the investigative question first and
   do not prepare anything until they explicitly ask. If they ask to
   "contribute" or "share" without distinguishing preparation from publication,
   clarify that you can prepare it privately now but publishing still needs a
   later explicit approval.
2. Wait and classify the response:
   - **Prepare privately** is approval for preparation only. Prepare everything
     needed for review and direct submission, then stop.
   - **Refine first**, or actionable free-text feedback about the candidate,
     defers the contribution decision; it does not decline it. Do not prepare
     yet. Apply the feedback within the approved scope, verify the revised
     change, then wait for a fresh explicit preparation request. If the
     partner selected **Refine first** without saying what to change, ask for
     that open-ended feedback in plain chat.
   - **Not now** declines preparation. Leave the change local and do not
     re-offer the same version.
3. An unanswered, timed-out, disabled, or empty-response card stops the flow
   without preparing. Silence is neither approval nor refinement, so do not
   immediately re-ask or treat `{}` / no selection as a yes.

Anything except an explicit **Prepare privately** remains non-approval.
Refinement feedback changes when the question is asked again, never what the
agent may publish. Preparing is still private: a local branch/commit and a
Contribute record, not a fork, push, PR, issue, or comment. The next public step
happens only after the partner presses **Send PR for review** in Contribute.

---

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

---

## Prepare for review

Nothing goes public here. For a PR, create a durable branch under `/data`, commit
the exact source you want reviewed, and stage that branch as a `prepared` ledger
record (endpoints in *The ledger*) with a `plan` object carrying everything
Contribute needs to submit it directly after approval:

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
  (raw-text PUT — see the ledger): the review card renders its file list from
  this. `diff_stat` is REQUIRED — the card's diffline and its file-list fallback
  (when the `.diff` is missing) both parse it. `diff_excerpt` is legacy and no
  longer displayed; you may omit it. Record `base_sha`/`head_sha`/`diff_sha256`
  so the submit button can recompute the exact branch diff before pushing (Hard
  stop #3). Compute the hash from the exact `.diff` bytes you store.
- For every review originating from an installed app or the platform, record
  `source_repo_path` (the live source checkout) and `source_sha` (its exact
  commit when the reviewed diff was captured). The submit path proves
  `base_sha..head_sha` is present in that source commit and keeps the witness
  only after the owner sends the PR. If GitHub later merges the reviewed change
  under a squash/rebase identity, both shell and App Store updates can recognize
  it as shared history without guessing or dropping later local edits. A linked
  review already shares the Git objects; for a standalone app review, Contribute
  imports only the two hash-verified reviewed commits into the installed repo
  without moving its branch or worktree.
- When the contribution publishes a local app into its own canonical
  `mobius-os/app-<id>` repository, add one reviewed `after_merge` handoff:
  `{"action":"connect_app","app_id":<live numeric app id>,
  "manifest_url":"https://raw.githubusercontent.com/mobius-os/app-<id>/main/mobius.json"}`.
  Use it only when `source_repo_path` is that exact live app source,
  `source_sha` is its captured revision, and the reviewed manifest id matches
  the target app repository (or declares the live id as `previous_id`). Never
  use it for platform changes, an unrelated app, a non-`app-*` repository, or
  as a workaround for an ordinary App Store update. Contribute shows this
  action inside the private review. Send binds it to the exact reviewed source
  and capability digests; it does not connect or reinstall anything yet.

Before you tell the partner it is ready, review the staged record yourself:
re-read the stored `.diff`, confirm the body draft is exactly what should be
published, confirm no private data appears in the branch, commit message, branch
name, body, or diff, and confirm the branch is back on `main` when the prep
steps require it.

Status stays `prepared`. Then give the partner one short, text-only handoff:
summarize what is staged and say it is waiting for their review. A prepared
review is not an app build completion. Do not navigate the workspace, place an
app, or link a completion notification to an app as part of this handoff.

---

## The green light

The green light for a staged PR is the Send PR for review button in Contribute.
No agent turn is needed after that click. The platform endpoint:

1. claims the `prepared` record as `submitting`,
2. verifies `plan.head_sha` still equals the branch tip, `diff_sha256` still
   equals the stored `.diff`, and the canonical `base_sha..head_sha` branch diff
   hashes to the same value,
3. verifies the commit carries the Möbius Agent co-author trailer,
4. normalizes the tip commit author/committer to the connected owner while
   preserving the reviewed diff,
5. adapts the reviewed topic commit to a strictly-behind reusable fork without
   changing its default branch, then proves the upstream merge result still
   matches the exact reviewed diff (a diverged fork stops untouched),
6. pushes the branch to the owner's fork,
7. creates a review-ready PR with the approved `title` and `body_draft`,
8. best-effort applies the reviewed `labels` that exist in the target repo, and
9. records `url`, `number`, label outcome, and `status: "open"` in the ledger.
   For a reviewed `after_merge` app handoff, Send also stores an immutable
   publication witness in the live app repo; this remains private local
   provenance and does not alter the PR.

If any preflight fails, the endpoint rolls the record back to `prepared` with
`last_submit_error`; the partner can press Leave feedback to return to the
source chat. Your job after feedback is to re-read the diff, fix/re-stage the
record, and stop again.

A record flipped to `abandoned` means the partner dropped it — never argue with
one, never resurrect it unasked.

### After an app PR merges: connect the same local app

A merged record with a reviewed `after_merge.action: connect_app` shows
**Connect app** in Contribute History. The owner presses it explicitly; do not
simulate that click or call its endpoint from an agent turn.

The platform then checks GitHub's actual merge commit, the stored reviewed diff,
the durable landed witness, the immutable merged source and permission digests,
and the intended live app row. Only an exact match installs that merged commit
under the stable App Store identity. The
existing numeric app row and its saved data remain in place, so later App Store
updates target the same installation instead of creating a second app. If the
local source advanced after review, the ordinary update merge may report
conflicts; Contribute keeps the app connected and sends those source conflicts
back to its owning chat for deliberate resolution.

This handoff depends on the running platform version that supports reviewed
publication connections. If Contribute reports that the route is unavailable,
restart after installing the companion platform change; do not fall back to
clicking App Store **Install** against an older public package.

### After it's sent: autopilot

When the partner sends a PR with autopilot on (the default), the platform records
a **grant** authorizing a background loop to answer reviews on that PR until it
merges or closes. You don't drive that here — the platform starts a fresh
"Autopilot: …" chat per PR and runs [review-followup.md](review-followup.md)
there. If a review comes in and you're asked to respond in such a chat, follow
that skill, not this one.

The record may carry an `autopilot` block (`enabled`, `state`, `rounds`, …). It
is a **display-only mirror** the platform writes; the real grant + claim live in
a platform DB row you can't see or write. Never treat the ledger block as
authorization, and never hand-edit it to start, stop, or fake a round — it does
nothing. Pause/Resume is a partner action in the Contribute app.

### The green light for a PR stack

When 2–12 prepared PR records carry one complete `plan.stack` chain,
Contribute groups them into one visual review and shows **Send N-PR stack**.
The second, explicit confirmation lists every title and `base → branch` pair;
that one click approves exactly those enumerated pushes and PR creations.
Any record carrying `plan.stack` is stack-only: malformed or incomplete chains
stay visible for feedback, but neither the app nor the platform may fall back
to sending one layer through the standalone PR path.

Before the first public push, the platform rechecks every record, every stored
diff, every parent SHA, the full branch topology, commit attribution, and the
whole stack's ability to merge with current upstream. It then publishes the
branches and opens the PRs from parent to child. If a later layer fails after a
parent PR was already created, the successful record remains open and every
unsent record returns to `prepared` with the durable error — retry never hides
the partial public state. Draft and open parents remain valid reviewed links,
but their upstream branch must still point at the exact reviewed commit before
another layer can be sent. If a parent has merged, rebuild the remaining private
layers on current upstream and review them again; never silently retarget an old
child, because squash/rebase merges can change the diff GitHub would show.

**True stacks require upstream push permission.** GitHub cannot use a branch
that exists only in the contributor's fork as the base of a PR in the upstream
repository. The stack path therefore publishes dedicated `stack/**` branches
directly to upstream, and the server refuses before pushing anything unless the
connected owner has `permissions.push` there. Without that permission, prepare
independent fork PRs instead; never simulate a stack by publishing a cumulative
diff that differs from the reviewed `.diff`.

### Choose a stack by default for coherent dependent work

Before preparing two or more PRs for one goal, explicitly decide whether they
form a stack. Use a stack by default when every layer is independently coherent
and later layers genuinely depend on earlier ones, or when an ordered split
makes review substantially clearer. This lets CI start on the foundation and on
the cumulative result at the same time.

Do not manufacture layers from one indivisible fix just to obtain more CI, and
do not stack unrelated changes: independent work should stay as independent PRs
to `main` so one failure, review, or delay cannot block the others. A stack's
direction is parent-first: PR A targets `main`; PR B targets A's upstream
branch, so B's check covers A+B; PR C targets B, and so on. Mention the stack
choice in `prior_work.summary` or the record summary when it helps the partner
understand the review shape.

### Landing a green app stack

Once every public layer is open and every GitHub check is green, Contribute can
show **Land** for the complete stack. This is a second public action with its own
explicit confirmation; preparing or sending the PRs never authorizes landing.

Landing is deliberately narrow. The platform re-verifies every reviewed diff,
local and upstream branch tip, PR base/head pair, and CI result; requires the
repository's default branch to still equal layer 1's reviewed `base_sha`; proves
the top commit is a fast-forward containing the exact chain; and then advances
that one upstream ref with an exact-base lease. All layers are recorded merged
only after that single push succeeds. If upstream moved, a check is pending or
failed, a PR was retargeted, or any commit changed, nothing is overwritten and
the records return to `open` with the blocker.

Atomic landing is for **unprotected app repositories only**. Any classic branch
protection or active repository rule stops the operation even when the connected
owner is an administrator; use GitHub's ordinary merge or merge queue instead.
In particular, `mobius-os/mobius` keeps its protected, strict CI flow. App
workflows may still run once on the resulting push to `main`; that is post-landing
validation, not a second pre-merge run of the child PR.

---

## Prepare the branch

Run these during preparation, after the partner agrees to stage a PR for review.
Do not fork, push, or create a PR here.

### Keep exploration out of durable staging

`/data/contrib` is the final review boundary, not a general Git workspace. Until
the partner has approved **Prepare privately** and one exact review + record id
have been chosen, keep review clones, rebase trials, integration carriers,
builds, and candidate fixes under the current turn's `$TMPDIR`. That scratch is
owned by the chat run and swept after it becomes idle.

Use independent clones whose `.git` directory lives inside the scratch clone.
Do not create linked worktrees there: the scratch sweeper removes directories
recursively and cannot unregister a linked worktree from its source repository.
Once the review is exact, create only its record-bound checkout at
`/data/contrib/<record-id>/worktree`; keep alternate candidates ephemeral and
remove them in the turn that created them.

**Use a linked worktree for every staged review checkout.** Its `.git` marker is
a file pointing at the installed app/platform repo, not a nested `.git`
directory. That keeps the live source on `main`, makes the review checkout
restart-safe even on older images whose baked boot cleaner removes nested Git
directories, and still gives Contribute a durable path to verify. Put it at
`/data/contrib/<record-id>/worktree` and store that exact path as `repo_path`.

### Prepare a linked PR stack

Use a stack when the default decision above finds a real dependency or review
order. Each layer is its own complete, reviewed commit and its `.diff` is
**incremental against the previous layer**, never the cumulative diff against
`main`. Each layer must remain a sensible review unit; put the tests needed to
trust a layer in that layer rather than postponing all coverage to the end.

1. Choose one privacy-safe stack id, for example `chat-settlement`. Every branch
   must start `stack/<stack-id>/`, followed by an ordered descriptive suffix:
   `stack/chat-settlement/01-runtime`, `.../02-ui`, `.../03-tests`.
2. Prepare layer 1 from the current upstream/default base SHA. Prepare layer 2
   from layer 1's exact `head_sha`, and so on. Use one durable linked worktree
   per record under `/data/contrib/<record-id>/worktree`.
3. Set the connected owner's repo-local author/committer identity **before every
   commit**. Standalone send can normalize one tip commit; stack send cannot
   rewrite a parent without invalidating every child's reviewed ancestry.
4. Store the canonical `base_sha..head_sha` diff and hash for each layer exactly
   as for a standalone PR.
5. Put this additive object in every plan (positions are 1-based and complete):

```json
"stack": {
  "id": "chat-settlement",
  "name": "Chat settlement",
  "position": 2,
  "total": 3,
  "parent_record_id": "chat-settlement-01",
  "base_branch": "stack/chat-settlement/01-runtime"
}
```

Layer 1 has an empty `parent_record_id` and `base_branch` equal to upstream's
default branch (normally `main`). Every later `parent_record_id` names the
immediately preceding ledger record, `base_branch` equals that record's branch,
and its `base_sha` equals that record's `head_sha`. Re-read all records and diffs
as one review unit before saying the stack is ready.

### An app with a real origin (most catalog apps)

`git -C /data/apps/<slug> remote get-url origin` succeeds → build one clean
review commit in a linked worktree while the live app stays on `main`:

```bash
SOURCE=/data/apps/<slug>
WORKTREE=/data/contrib/<record-id>/worktree
BASE_SHA="$(git -C "$SOURCE" merge-base main upstream)"
SOURCE_SHA="$(git -C "$SOURCE" rev-parse main)"
git -C "$SOURCE" -c core.quotePath=false diff --no-ext-diff --no-color \
  --binary --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..main" > /tmp/<record-id>.diff
git -C "$SOURCE" worktree add -b fix/<slug>-<short> "$WORKTREE" "$BASE_SHA"
cd "$WORKTREE"
git apply --index --binary /tmp/<record-id>.diff
git_email="$(git config --global --get user.email || true)"
if [ -n "$git_email" ] && [ "$git_email" != "agent@mobius" ]; then
  git config user.name "$(git config --global --get user.name)"
  git config user.email "$git_email"
fi
git commit -m "<one line, generic>" \
  -m "Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>"
HEAD_SHA="$(git rev-parse HEAD)"
git -c core.quotePath=false diff --no-ext-diff --no-color --binary \
  --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..$HEAD_SHA" > /tmp/<record-id>.diff
DIFF_SHA256="$(sha256sum /tmp/<record-id>.diff | awk '{print $1}')"
```

Then write the ledger record with `repo_path: "$WORKTREE"`, `branch`,
`base_sha: "$BASE_SHA"`, `head_sha: "$HEAD_SHA"`,
`source_repo_path: "$SOURCE"`, `source_sha: "$SOURCE_SHA"`, `diff_sha256` from
`$DIFF_SHA256`, and `diff_stat` (required). `diff_excerpt` is legacy — omit it.

Two invariants: the
**`Co-authored-by: Möbius Agent` trailer on every contributed commit** (the
visible Möbius mark on GitHub — partner stays author, Möbius co-author), and the
**live source repo remains on `main`** — only the separate review worktree stays
on `fix/…`, so watcher edits and store updates cannot land on the review branch.

### An app with no origin, or platform/shell

**No origin** (installed from a manifest): derive the repo from `manifest_url`
(`.../<org>/<repo>/<ref>/mobius.json` → `github.com/<org>/<repo>`), clone it into
`/data/contrib/<record-id>/worktree` with
`--separate-git-dir=/data/contrib/<record-id>/git`, `checkout -b fix/…`, copy
the changed source over (re-read vs the allowlist), and commit with the
co-author trailer. Before cloning, capture the installed app's live source path
as `source_repo_path` and its exact `main` commit as `source_sha`; the reviewed
commit identities may differ, and the submit path handles that safely. The
separate Git directory is deliberately named `git`, not `.git`, so older boot
cleaners leave it intact. Use the worktree as `repo_path`.

**Platform/shell**: only when `/data/platform` has a real origin — create the
review branch with `git -C /data/platform worktree add -b fix/…
/data/contrib/<record-id>/worktree <base-sha>`, apply only the reviewed source
diff there, and record that worktree path with `repo: "mobius-os/mobius"`.
Capture `SOURCE_SHA="$(git -C /data/platform rev-parse HEAD)"` before creating
the review worktree and store `source_repo_path: "/data/platform"` beside
`plan.source_sha`; `/data/platform` itself remains on its current live branch.
No origin → be honest: platform
contributions need the updated platform bootstrap; app contributions still work.

## PLATFORM CI

For `mobius-os/mobius` PRs, upstream CI runs backend pytest, frontend unit
`npm test`, `packager-unit`, `core-apps-unit`, `core-apps-sync` via
`scripts/check-core-apps-sync.sh`, and comprehensive Playwright e2e. The same
suite can run before a PR exists, but preparation itself remains private and
must NEVER push automatically.

For a standalone prepared `mobius-os/mobius` PR, Contribute shows **Run GitHub
checks**. Its in-card confirmation is the explicit approval for exactly these
public actions: create or fast-forward the connected owner's personal fork when
needed, enable the allowlisted Tests workflow there, push the exact reviewed
branch, and manually dispatch `.github/workflows/test.yml`. It does NOT open a
PR, mention a team, comment, or email the organization. GitHub's ordinary
Actions completion notification is directed to the triggerer according to
their personal notification settings. The run is recorded under the prepared
record's top-level `pre_pr_checks` field, and Contribute refreshes it while the
app is open.

The manual trigger must already exist on upstream's default branch. The PR that
bootstraps `workflow_dispatch` is therefore the one exception that must use the
ordinary Send path before pre-PR checks become available for later work. For a
branch already pushed to a personal fork, the command-line equivalent is:

```bash
gh workflow run test.yml -R <owner>/mobius --ref <reviewed-branch>
```

That command is a public GitHub action too: never run it, create/update a fork,
or push the branch from chat without a fresh explicit yes for those exact
actions. Prefer the Contribute button because it preserves the reviewed SHA,
run id, and no-PR boundary as one durable operation.

When pre-PR checks fail, **Fix in chat** returns to the source chat with the run
URL. Inspect the failed jobs and artifacts read-only, fix the owning live source,
run the narrowest focused local checks, then re-stage the SAME record on a fresh
private branch and checkout. Recompute its canonical diff/hash, update its
reviewed base/head/source witness with CAS, and remove the stale `pre_pr_checks`
and old pushed-branch evidence from the refreshed record. Do not overwrite the
old public fork branch or dispatch another run: the owner reviews the new diff
and presses **Run GitHub checks** again for that new branch. A passing pre-PR run
is evidence for the exact stored `head_sha`; any re-stage clears it.

Before staging, run the cheapest focused checks that cover the changed files.
Classify the evidence honestly: local focused checks are fast implementation
feedback; a lock-matched hosted run proves the exact reviewed revision in the
full environment; the merge queue is the unconditional final gate.

Recommend **Run GitHub checks** explicitly before **Send PR** when the change
touches concurrency or ordering, persistence, auth or security, migrations,
provider protocols, dependencies/runtime behavior, or a broad cross-cutting
path. The same recommendation applies when the partner asks for a thorough or
expanding-scope review and the complete environment could reveal something
the local container cannot. This is a risk-based owner choice, never an
automatic push: small documentation, styling, or narrowly covered changes do
not earn a duplicate expensive run merely because the button exists. When the
recommendation is earned, include it in the prepared handoff so the owner sees
the early full-suite option before sending the PR.

Do **not** run Playwright locally by default. The Möbius app container does not
have Docker, so agents normally diagnose browser failures from the hosted CI
report. On a Docker-capable contributor host, a CI failure can be reproduced by
first committing the exact revision, then using the disposable runner with the
narrowest spec or grep possible:

```bash
scripts/playwright-local.sh --allow-local-e2e <spec or --grep arguments>
```

The runner makes a standalone temporary clone, then builds a separate backend,
database, credentials, ports, and browser session from that same commit. It
uses one worker and tears everything down. It refuses tracked uncommitted edits
instead of testing them against an older runtime. Never point Playwright,
`auth.setup.mjs`, or a preview proxy at the live backend — localhost alone does
not prove isolation.

### Commenting on an issue or discussion

Publish the approved `body_draft` word for word — it posts under the partner's name.

```bash
gh issue comment <issue-url> --body "<the approved text>"
```

Discussions use GraphQL (`gh` has no discussion-comment subcommand):

```bash
gh api graphql -f query='mutation($id: ID!, $body: String!) {
  addDiscussionComment(input: {discussionId: $id, body: $body}) { comment { url } } }' \
  -F id=<discussion-node-id> -F body="<the approved text>"
```

---

## When something fails

| Symptom | What it means / what to do |
|---------|----------------------------|
| **403 "OAuth App access restrictions"** | The organization has not approved the Möbius GitHub app. Ask an organization owner to approve it, then reconnect through Contribute. |
| **`gh: command not found`** | Platform image too old; a platform update is needed. |
| **`git push fork` fails right after the fork** | Forks are created async — wait 2s and retry, up to 3×, before treating it as real. |
| **Push says `workflow` scope is required, but the reviewed diff does not change a workflow** | The reusable fork is stale and lacks an identical workflow file. Update Contribute and reconnect GitHub so the full PR scope set is granted, then retry the unchanged review. |
| **Empty search results** | Normal while the ecosystem is young; not an error. |

---

## The ledger

The Contribute app tracks every contribution so the partner sees status at a
glance. Find its id (slug `contribute`):

```bash
curl -s -H "Authorization: Bearer $AGENT_TOKEN" "$API_BASE_URL/api/apps/" \
  | python3 -c 'import sys,json;[print(a["id"]) for a in json.load(sys.stdin) if a.get("slug")=="contribute"]'
```

**CAS governs every JSON RECORD write** — the same If-Match discipline as the
submit claim, because the record has four writers (you, the submit endpoint,
the scheduled refresh job, the app's Dismiss button) and an unconditional PUT
silently erases one. The `.diff` blob is exempt: it's written once alongside the
prepared record, not concurrently edited.

**Create** (on prepare) — `If-None-Match: *` so the PUT 412s if the id somehow
exists (then pick a new id). A prepared record carries a `plan` and has NO public
url/number yet:

```bash
curl -s -X PUT "$API_BASE_URL/api/storage/apps/<id>/contributions/<record-id>.json" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: application/json" \
  -H "If-None-Match: *" -d '{
  "id": "<record-id>", "type": "pr", "repo": "<owner>/<repo>",
  "status": "prepared", "title": "<title>", "branch": "fix/<slug>-<short>",
  "chat_id": "'"$CHAT_ID"'", "created_at": "<ISO>", "updated_at": "<ISO>",
  "summary": "<one plain-language sentence about what improves for people>",
  "plan": {"action": "pr", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full PR body, word for word>",
           "branch": "fix/<slug>-<short>", "repo_path": "/data/apps/<slug>",
           "base_sha": "<sha>", "head_sha": "<sha>",
           "source_repo_path": "/data/apps/<slug>", "source_sha": "<sha>",
           "diff_sha256": "<sha256 of the .diff>",
           "diff_stat": "<git diff --stat tail>"}
}'
```

Store the full diff beside it as raw text (the once-only write named above):

```bash
curl -s -X PUT "$API_BASE_URL/api/storage/apps/<id>/contributions/<record-id>.diff" \
  -H "Authorization: Bearer $AGENT_TOKEN" -H "Content-Type: text/plain" \
  --data-binary @/tmp/<record-id>.diff
```

**Update** (re-stage or status changes) — read with `x-mobius-version: 1`, note
the `ETag`, PUT the edited record with `If-Match`. For PR submission itself,
Contribute's approve endpoint owns the claim/outcome write. A **412** means the
record changed under you: re-read, check the fresh status still allows your
change, reconcile, then retry with the new ETag:

```bash
curl -si -H "Authorization: Bearer $AGENT_TOKEN" -H "x-mobius-version: 1" \
  "$API_BASE_URL/api/storage/apps/<id>/contributions/<record-id>.json"
# note the ETag, edit the JSON, then PUT with -H 'If-Match: <etag>' -d '{ ...full record... }'
```

`type` ∈ `pr | issue | issue_comment | discussion_comment`; `status` ∈ `prepared
| submitting | draft | open | merged | closed | commented | abandoned`; `number`,
`url`, `branch` are optional until they exist. `submitting` = the approve endpoint
claimed the record and the action is in flight; `commented` = terminal for
comment actions. A record stuck in `submitting` with an old `updated_at` (crashed
submit) → verify via `gh search` whether the action actually happened before
redoing it.

`quality_review.state` ∈ `reviewing | changes_needed | all_clear`. The
`reviewed_head_sha` must exactly equal the record's current `plan.head_sha`.
Every re-stage or amended commit must replace or invalidate the verdict; never
carry `all_clear` across heads. Publication endpoints enforce this invariant.
The CAS update adds this sibling block to the full record:

```json
"quality_review": {
  "state": "all_clear",
  "reviewed_head_sha": "<exact plan.head_sha>",
  "reviewed_at": "<ISO>",
  "iteration": 2,
  "chat_id": "<review chat id>",
  "scope": ["correctness", "maintainability", "simplicity", "tests",
            "security_privacy", "technical_debt"],
  "summary": "Complete current head passes review."
}
```
The scheduled refresh job only tracks `pr | issue` records in `draft | open`.

App NOT installed: no staging, no review card, no tracking — but Hard stop #1
still holds (a plain yes in chat gates each action). Recommend installing it from
the App Store before contributing; go app-less only if the partner insists.
