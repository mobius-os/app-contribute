# Contributing upstream

How to send an improvement back to the Möbius ecosystem — the GitHub connection,
studying prior issues and PRs, staging a reviewable plan in the Contribute app,
and the exact `gh` sequences. `Read` this before ANY public GitHub action. The
constitution's end-of-task checklist routes you here when your change would help
other users; "share this" or "report that bug upstream" lands here too.

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

---

## Study existing work first

Before building from scratch, check whether the ecosystem already has it — or
already tried. Searching and studying are read-only: no approval needed.

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
title,body,state,comments`, `gh pr diff <url>`), compare approaches concretely,
and stage exactly ONE: a **comment** (their work is the right vehicle; findings
first, then a concrete suggestion) or a **superseding PR** (yours covers more;
body references the issue "Fixes #N" and explains the delta). No hit → stage a
fresh PR or issue plan. Every outcome is STAGED for review (next), never posted.

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
in a `/tmp` clone there is no `upstream` branch — diff against `origin/main`.
Local commits routinely carry partner data into source (a seeded example, a
hardcoded name, a test fixture with real entries) — strip anything personal or
don't propose.

---

## The approval gate

Hard stop #1 is the gate. In practice:

1. Propose the contribution plainly ("Want me to prepare this PR privately in
   Contribute for your review?").
2. Wait for that yes.
3. Prepare everything needed for review and direct submission, then stop.

Anything but yes → stop. Preparing is still private: a local branch/commit and a
Contribute record, not a fork, push, PR, issue, or comment. The next public step
happens only after the partner presses **Send PR for review** in Contribute.

An unanswered, timed-out, disabled, or empty-response question card is **not**
approval. If the review surface expires or returns no answer, leave the
prepared record private and ask again in plain chat or wait for the Contribute
Send button. Never treat `{}` / no selection as "yes" for a public action.

---

## Prepare for review

Nothing goes public here. For a PR, create a durable branch under `/data`, commit
the exact source you want reviewed, and stage that branch as a `prepared` ledger
record (endpoints in *The ledger*) with a `plan` object carrying everything
Contribute needs to submit it directly after approval:

```
plan: {action: pr|issue|issue_comment|discussion_comment,  # mirrors record.type
       repo, target_url?, title?, body_draft, branch?, repo_path?,
       base_sha?, head_sha?, diff_sha256?, diff_stat,
       diff_excerpt?}         # diff_stat REQUIRED; diff_excerpt legacy (unused)
```

- `body_draft` is the FULL text you propose to publish — PR body, issue body, or
  comment, word for word. The partner reviews exactly this; never publish
  anything that differs from what they approved.
- For PRs, `repo_path` MUST be a durable git checkout under a staging root the
  platform accepts — `/data/contrib/<workspace>` (the primary durable staging
  root), `/data/apps/`, `/data/platform`, or the legacy `/data/contributions/`;
  a `/tmp` clone does not survive restart and cannot be approved with one click.
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

Before you tell the partner it is ready, review the staged record yourself:
re-read the stored `.diff`, confirm the body draft is exactly what should be
published, confirm no private data appears in the branch, commit message, branch
name, body, or diff, and confirm the branch is back on `main` when the prep
steps require it.

Status stays `prepared`. Then tell the partner what you found and staged in one
short paragraph, closing with "staged in the Contribute app for your review".

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
5. safely fast-forwards a stale reusable fork default branch from upstream
   (and stops without rewriting it if the fork has diverged),
6. pushes the branch to the owner's fork,
7. creates a review-ready PR with the approved `title` and `body_draft`, and
8. records `url`, `number`, and `status: "open"` back into the ledger.

If any preflight fails, the endpoint rolls the record back to `prepared` with
`last_submit_error`; the partner can press Leave feedback to return to the
source chat. Your job after feedback is to re-read the diff, fix/re-stage the
record, and stop again.

A record flipped to `abandoned` means the partner dropped it — never argue with
one, never resurrect it unasked.

---

## Prepare the branch

Run these during preparation, after the partner agrees to stage a PR for review.
Do not fork, push, or create a PR here.

### An app with a real origin (most catalog apps)

`git -C /data/apps/<slug> remote get-url origin` succeeds → work in the app's own
repo:

```bash
cd /data/apps/<slug>                       # app's own repo; main is checked out
git checkout -b fix/<slug>-<short>
git_email="$(git config --global --get user.email || true)"
if [ -n "$git_email" ] && [ "$git_email" != "agent@mobius" ]; then
  git config user.name "$(git config --global --get user.name)"
  git config user.email "$git_email"
fi
# Squash the watcher's commits into ONE clean, generic commit. `upstream` is the
# Möbius per-app-git branch inside /data/apps/<slug>:
git reset --soft "$(git merge-base HEAD upstream)"
git commit -m "<one line, generic>" \
  -m "Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>"
BASE_SHA="$(git merge-base HEAD upstream)"
HEAD_SHA="$(git rev-parse HEAD)"
git -c core.quotePath=false diff --no-ext-diff --no-color --binary \
  --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..$HEAD_SHA" > /tmp/<record-id>.diff
DIFF_SHA256="$(sha256sum /tmp/<record-id>.diff | awk '{print $1}')"
git checkout main     # INVARIANT
```

Then write the ledger record with `repo_path: "/data/apps/<slug>"`, `branch`,
`base_sha: "$BASE_SHA"`, `head_sha: "$HEAD_SHA"`, `diff_sha256` from
`$DIFF_SHA256`, and `diff_stat` (required). `diff_excerpt` is legacy — omit it.

Two invariants: the
**`Co-authored-by: Möbius Agent` trailer on every contributed commit** (the
visible Möbius mark on GitHub — partner stays author, Möbius co-author), and
**`git checkout main` before the turn ends** — the watcher auto-commits partner
edits onto the checked-out branch and store updates merge to `main`, so a dir left
on `fix/…` derails the next edit and conflicts the next update. The `fix/` branch
stays for follow-ups; only the checkout returns.

### An app with no origin, or platform/shell

**No origin** (installed from a manifest): derive the repo from `manifest_url`
(`.../<org>/<repo>/<ref>/mobius.json` → `github.com/<org>/<repo>`), clone it into
`/data/contrib/<record-id>/repo` (the primary durable staging root; legacy
`/data/contributions/` still works), `checkout -b fix/…`, copy the changed
source over (re-read vs the allowlist), and `commit` with the co-author trailer.
Use that durable clone as `repo_path`. The live app dir never branches, so it
never leaves `main`.

**Platform/shell**: only when `/data/platform` has a real origin — same sequence
from a branch there, ledger `repo: "mobius-os/mobius"`, same back-to-`main`
invariant. No origin → be honest: platform contributions need the updated
platform bootstrap; app contributions still work.

## PLATFORM CI

For `mobius-os/mobius` PRs, upstream CI runs backend pytest, frontend unit
`npm test`, `packager-unit`, `core-apps-unit`, `core-apps-sync` via
`scripts/check-core-apps-sync.sh`, and Playwright e2e.

Before staging, validate what you can in-container: backend pytest yes;
`scripts/check-core-apps-sync.sh` yes, with network; frontend unit plus build
yes. Playwright e2e is not runnable in-container. The Contribute checks refresh
reports that PR result on the record; expect it within the refresh cadence.

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
| **403 "OAuth App access restrictions"** | Org hasn't approved the Möbius OAuth app. Have the partner reconnect with a **`public_repo`-scoped PAT** (Connect card) — safer than full `repo`, which also grants read of the owner's PRIVATE repos through the read passthrough. |
| **`gh: command not found`** | Platform image too old; a platform update is needed. |
| **`git push fork` fails right after the fork** | Forks are created async — wait 2s and retry, up to 3×, before treating it as real. |
| **Push says `workflow` scope is required, but the reviewed diff does not change a workflow** | The reusable fork is stale and lacks an identical workflow file. Current platforms safely sync the fork during Send; on an older platform, update it before retrying. Do not rebase the reviewed PR onto the stale fork. |
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
  "summary": "<one line for the partner>",
  "plan": {"action": "pr", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full PR body, word for word>",
           "branch": "fix/<slug>-<short>", "repo_path": "/data/apps/<slug>",
           "base_sha": "<sha>", "head_sha": "<sha>",
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
The scheduled refresh job only tracks `pr | issue` records in `draft | open`.

App NOT installed: no staging, no review card, no tracking — but Hard stop #1
still holds (a plain yes in chat gates each action). Recommend installing it from
the App Store before contributing; go app-less only if the partner insists.
