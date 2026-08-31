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
   "they'd want this". An explicit, unambiguous instruction in chat is a valid
   yes when it names the exact current action, or clearly accepts a
   just-enumerated immutable set of actions. The partner does not need to repeat
   that same approval in Contribute. A Contribute control is a convenient
   durable approval surface, not the only valid one. If the target, diff, head,
   or proposed public text changes, the old yes no longer applies: show the new
   exact action and ask again.
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

Treat **prepare my changes**, **prepare to submit**, and a project-level Contribute
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
   checks, and stage exact private review records. When a later chat refines an
   existing record, preserve its original `chat_id` and CAS-add both the
   original and current chat to `chat_ids`; one review can then reconcile every
   source chat without duplicating or moving the contribution. Use a stack only
   when the changes truly depend on one another. The source chat is the parent
   and final integrator for chat-scoped work. Ordinary preparation stays in
   that turn. If, after inspection, genuinely independent project work can
   proceed in parallel, use the installed Subagents app's durable background
   Delegation path from the active source run. Give each helper one bounded
   task, wait for every result, then let the source parent reconcile the final
   source and write or CAS-update the records and settlements. Never replace
   this relation with an app-owned chat whose prompt or opaque scope merely
   mentions the source chat.
4. For a chat-scoped request, durably settle every recorded source path that
   was intentionally excluded. Fetch that chat's current `edit-diffs` before
   classification, retain the newest `ts` actually reviewed, and after the
   source recheck run the app helper once per disposition/summary group:

   ```bash
   python3 /data/apps/contribute/settle_chat_changes.py \
     --chat "$CHAT_ID" --through '<newest-reviewed-ts>' \
     --disposition local-only --summary 'Kept local by design.' \
     /data/platform/path/to/file /data/apps/example/path/to/file
   ```

   Use `personal`, `experimental`, `incoming-only`, or `duplicate` when that is
   the truthful reason. The helper writes the Contribute-owned temporal
   disposition through the platform domain route; never hand-edit its storage.
   A later edit to the same path becomes Unsorted again. Do not settle a path
   you did not inspect through the supplied timestamp, and do not substitute a
   prose summary for this write—without it the same card will return.
5. Stop with the prepared records in Contribute. Report what was prepared and
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
3. Present the exact ready set in Contribute or enumerate it clearly in chat.
   **Send all ready** is one reviewed public approval boundary; an explicit,
   unambiguous chat reply accepting that same current set is equally valid. Do
   not send the partner to Contribute solely to repeat an approval they already
   gave in chat. Either path stops if any branch or diff moved. The broad cycle
   request alone still does not authorize an unenumerated push, comment, PR,
   issue, or merge.
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

## Check the available public paths

```bash
curl -s -H "Authorization: Bearer $AGENT_TOKEN" "$API_BASE_URL/api/github/status" | python3 -m json.tool
```

Use the `$API_BASE_URL` + `$AGENT_TOKEN` idiom for every chat-context command in
this file — never hardcode localhost. This status is for the optional personal
GitHub path; a linked Möbius account can use the bot path without connecting a
personal GitHub account. The payload:

- `connected: true` with a `login` — `gh` is authenticated as the owner. You
  never see the token (`gh` resolves it from the platform store — don't dig for
  it, never print it). It's wired GLOBALLY: once connected, ANY `git push` to a
  github.com remote authenticates as the owner and nothing at the git layer gates
  that — Hard stop #1 is the whole safety net. NEVER run a bare `git push` to a
  github remote outside the approved fork flow.
- `connected: false` — personal GitHub is unavailable, but a supported Möbius
  repository may still use **Contribute via Möbius (no GitHub needed)**. Other
  repositories can still be prepared privately and wait for a later personal
  connection. Nothing goes public until the partner approves the exact record.
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
project-level or **Prepare to submit** handoff from Contribute. The source chat's
automatic **Changes ready to organize** card is the lightweight preparation
suggestion after coherent file edits: it only reflects already-recorded work
and never starts an agent, reviews a diff, or inspects GitHub on its own. The
agent must not duplicate that visible choice with another question at the end
of the turn. Pressing **Prepare to submit** on the card or in Changes is an
explicit private-preparation request; dismissing it only hides that revision
of the suggestion and keeps the work in Changes and Contribute.

**One decision, no duplicate approval.** A live Contribute/prepare block is one
owner decision surface for the exact action it represents. Never also call
`request_user_input` / `AskUserQuestion` for **Prepare**, **Review / Fix and
review**, **Send / Update PR**, or another action already shown by that block.
Do not paraphrase the same choice into chat merely to solicit a second answer.
But if the partner voluntarily gives an explicit, unambiguous chat instruction
for that exact current action—or replies "send all of those" to a
just-enumerated immutable set—that is the owner decision. Proceed without
requiring the matching Contribute press. Run the same exact-head, full-diff,
identity, and freshness checks and use the documented guarded submission path;
chat approval changes the approval surface, not the safety preflight. If the
owner presses the block instead, let that action own its complete batch until
every item settles; in-flight siblings stay visibly in flight and never turn
into a second doorway. A chat-scoped review, repair, or failed-publication
recovery continues as a hidden turn in its source chat. Contribute may start an
app-owned scoped conversation only for genuinely global work that has no source
chat. Background Delegation children return evidence or independent edits to
their parent; they do not become owner-facing contribution homes.

Hard stop #1 is still the gate. In practice:

1. If the partner explicitly asks to prepare a contribution, prepare it
   privately and stop at the Contribute review record. If they ask whether a
   change *should* be contributed, answer the investigative question first and
   do not prepare anything until they explicitly ask. If they ask to
   "contribute" or "share" without distinguishing preparation from publication,
   treat that as approval for routine private preparation only; the resulting
   exact record still needs later explicit public approval, either in chat or
   through its Contribute control.
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

Anything except an explicit private-preparation request or **Prepare privately**
choice remains non-approval.
Refinement feedback changes when the question is asked again, never what the
agent may publish. Preparing is still private: a local branch/commit and a
Contribute record, not a fork, push, PR, issue, or comment. The next public step
happens only after the partner explicitly approves the exact current action in
chat or uses the matching Contribute control. Chat approval does not waive the
record's guarded freshness and exact-diff checks, and it never requires the
partner to visit Contribute just to say yes again.

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

Before you tell the partner it is ready, complete the exact-head review contract
from **Thoroughly review prepared work**. CAS-mark `quality_review.state` as
`reviewing`, inspect the complete stored diff and its owning invariants, fix
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

---

## The green light

The green light for a staged PR is explicit approval of its exact current,
`all_clear` record. **Open PR** in Contribute is one convenient path. An
explicit, unambiguous chat instruction approving that same record and current
head is equally valid, and the agent must not require the partner to repeat it
in Contribute. Whichever surface carries the yes, re-read the canonical record
immediately before Send and use the same guarded submission path. A stale
record returns to **Review** instead of publishing; the earlier approval cannot
be stretched to the changed head. No agent turn is needed after a valid button
press, while a chat approval authorizes the current agent turn to submit the
enumerated action.

For **Personal GitHub**, the platform endpoint:

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

For **Contribute via Möbius**, the instance proves the same exact reviewed head,
merge-tests it against the configured current target, and sends an exact file
snapshot through a one-use body-bound capability. The launcher writes only to
the configured bot publication repository, opens or updates one draft PR in the
target, and returns the stable PR URL. `local_record_id` stays stable while
`relay_revision` increases for each changed reviewed snapshot, so a refresh can
update the same PR without discarding comments. Exact retries reuse the same
revision and cannot create a duplicate. Status polling is a fallback behind
launcher webhooks. The partner may explicitly **Withdraw PR**; that closes the
PR and removes only its bot-owned branch, never an upstream branch and never a
merge.

### After an app PR merges: connect the same local app

A merged record with a reviewed `after_merge.action: connect_app` shows
**Connect app** in Contribute History. The owner may press it or explicitly,
unambiguously approve that exact current handoff in chat. After chat approval,
the agent may call the same guarded endpoint; without either form of approval,
do not simulate the action.

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
nothing. Pause/Resume needs an explicit partner action, either through the
Contribute control or an unambiguous chat instruction to use that same guarded
operation.

### The green light for a PR stack

When 2–12 prepared PR records carry one complete `plan.stack` chain,
Contribute groups them into one visual review and shows **Send N-PR stack**.
The second, explicit confirmation lists every title and `base → branch` pair;
that click approves exactly those enumerated pushes and PR creations. An
explicit, unambiguous chat instruction accepting the same current list is
equally valid; do not require both approval surfaces.
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

### Let GitHub accept a public stack

Once the reviewed layers are public, GitHub owns their acceptance through the
repository's ordinary review, protection, and merge-queue rules. Contribute
observes those results and keeps the related records together; it does not
advance a repository ref directly or bypass the repository's merge policy.

Sending a stack never authorizes merging it. Any later queue or merge action is
a separate exact approval against the current public head, performed through a
repository-owned GitHub operation. For a dependent chain, advance parent-first
and re-read the remaining layers after each accepted parent because their base
or topology may have changed. Contribute then reconciles merged, closed, or
superseded outcomes from GitHub without manufacturing a second public action.

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

### Updating an existing open PR

When a new owner-authored change belongs on a PR that is already open, update
that contribution's existing record instead of opening a duplicate or pushing
around Contribute. This is still a private preparation until the owner
explicitly approves the exact update in chat or presses **Update PR**.

1. Refresh GitHub read-only and require that the recorded repository, PR
   number, public head repository, and topic branch still name one open PR.
   Re-anchor the durable review worktree at the public pushed head before
   applying the new local patch. Never build on an unpushed local attempt.
2. Keep the same record id, PR URL, number, branch, `head_repository`, original
   `submitted_at`, and original PR base. Set the record back to `prepared` and
   set `plan.action` to `pr_update`; update `plan.head_sha`, the complete
   base-to-new-head diff/hash/stat, source witness, body draft, and timestamps.
   The stored diff is the complete current PR, not only the new delta, because
   the all-clear verdict must describe exactly what maintainers will review.
   For every `pr_update`, store the exact live values observed during
   preparation as `plan.pr_metadata.old_title` and
   `plan.pr_metadata.old_body`, even when the reviewed text is unchanged. Put
   the desired public text in `plan.title` and `plan.body_draft`. Do not
   normalize, summarize, or reconstruct the old text: those exact witnesses
   are the compare-and-swap guard against overwriting a maintainer edit.
3. Re-run the full private review on the new head and pin
   `quality_review.reviewed_head_sha` to it. The ordinary local review-status
   endpoint understands both `pr` and `pr_update`; a changed checkout, source
   witness, diff, ancestry, or upstream conflict blocks the action before the
   public action regardless of where the owner approved it.
4. Stop for explicit public approval. **Update PR** in Contribute is one
   approval surface; an explicit, unambiguous chat instruction approving this
   same record and exact new head is equally valid. Do not require both. The
   guarded update route rechecks the live PR identity and requires the public
   title/body to match either the exact recorded old values or the
   already-reviewed desired values before any push. The second state is only
   the restart-safe recovery case for an earlier ambiguous submission. The
   route allows only the exact reviewed fast-forward and applies
   `plan.title`/`plan.body_draft` once after the branch update. Any other live
   metadata stops for a fresh private review instead of being overwritten; a
   resumed ambiguous submission does not edit already-visible reviewed text a
   second time. Ordinary **Send PR** continues to reject a branch that already
   has a PR, and raw `git push` is never a substitute.
5. After a successful update, the same record returns to `open`, retains its
   original submission time, records `last_updated_pr_at`, and advances an
   existing Autopilot grant to the new public head without creating, enabling,
   or retargeting a grant.

If the installed platform does not yet expose the reviewed update route, keep
the record privately prepared and say that a restart or platform update is
needed. Do not fall back to a duplicate PR or an unguarded branch rewrite.

## PLATFORM CI

For `mobius-os/mobius` PRs, upstream CI runs backend pytest, frontend unit
`npm test`, `packager-unit`, `core-apps-unit`, `core-apps-sync` via
`scripts/check-core-apps-sync.sh`, and comprehensive Playwright e2e.

The complete upstream suite begins after the owner explicitly sends the pull
request. Contribute has one public path for a prepared change: **Send PR**.
Preparation and local verification stay private; there is no second fork-push
or workflow-dispatch action to reconcile.

Before staging, run the cheapest focused checks that cover the changed files.
Classify the evidence honestly: local focused checks are fast implementation
feedback; a lock-matched hosted run proves the exact reviewed revision in the
full environment; the merge queue is the unconditional final gate.

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
  "chat_id": "'"$CHAT_ID"'", "chat_ids": ["'"$CHAT_ID"'"],
  "created_at": "<ISO>", "updated_at": "<ISO>",
  "summary": "<one plain-language sentence about what improves for people>",
  "plan": {"action": "pr", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full PR body, word for word>",
           "branch": "fix/<slug>-<short>", "repo_path": "/data/apps/<slug>",
           "base_sha": "<sha>", "head_sha": "<sha>",
           "source_repo_path": "/data/apps/<slug>", "source_sha": "<sha>",
           "files": ["<every path covered by this exact contribution>"],
           "diff_sha256": "<sha256 of the .diff>",
           "diff_stat": "<git diff --stat tail>"}
}'
```

`chat_id` is the immutable creation/provenance chat. `chat_ids` is private,
additive coverage metadata for the source conversations whose edits the same
record has reconciled. A newly created record may contain only the current
chat. When reusing a prepared or public record from another chat, CAS-union the
existing primary/list values with the current `$CHAT_ID`; never overwrite the
primary id or create a duplicate merely to make the new chat's Changes view
settle. A background worker child is execution history, not source provenance:
never add its chat id to `chat_ids`. If that worker performed the actual review,
its id may be recorded in `quality_review.chat_id` for audit while the parent
source chat still owns the final record. Neither provenance field is published
to GitHub.

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

When refreshing a record that already has a Möbius-bot PR, keep the same record
id and preserve its `relay_contribution_id`, `relay_revision`,
`relay_publication_repo`, and PR URL/number. Replace the plan/diff and invalidate
the old `quality_review`; the instance assigns the next revision only after it
has built the exact new merge snapshot. Do not create a second record merely
because upstream moved.

`type` ∈ `pr | issue | issue_comment | discussion_comment`; `status` ∈ `prepared
| submitting | draft | open | merged | closed | commented | abandoned`; `number`,
`url`, `branch` are optional until they exist. `submitting` = the approve endpoint
claimed the record and the action is in flight; `commented` = terminal for
comment actions. Bot-published records may additionally carry
`submission_mode: "mobius-bot"`, `relay_contribution_id`, `relay_revision`,
`relay_status`, and `relay_publication_repo`. A bot record stuck in `submitting`
is reconciled by its saved relay id and exact revision—never search GitHub and
invent a new record. The personal-GitHub path retains its existing lost-response
reconciliation.

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
