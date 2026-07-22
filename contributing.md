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
       stack?: {id, name?, position, total, parent_record_id, base_branch},
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
5. adapts the reviewed topic commit to a strictly-behind reusable fork without
   changing its default branch, then proves the upstream merge result still
   matches the exact reviewed diff (a diverged fork stops untouched),
6. pushes the branch to the owner's fork,
7. creates a review-ready PR with the approved `title` and `body_draft`, and
8. records `url`, `number`, and `status: "open"` back into the ledger.

If any preflight fails, the endpoint rolls the record back to `prepared` with
`last_submit_error`; the partner can press Leave feedback to return to the
source chat. Your job after feedback is to re-read the diff, fix/re-stage the
record, and stop again.

A record flipped to `abandoned` means the partner dropped it — never argue with
one, never resurrect it unasked.

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

**Use a linked worktree for every staged review checkout.** Its `.git` marker is
a file pointing at the installed app/platform repo, not a nested `.git`
directory. That keeps the live source on `main`, makes the review checkout
restart-safe even on older images whose baked boot cleaner removes nested Git
directories, and still gives Contribute a durable path to verify. Put it at
`/data/contrib/<record-id>/worktree` and store that exact path as `repo_path`.

### Prepare a linked PR stack

Use a stack only when the changes have a real dependency or review order. Each
layer is its own reviewed commit and its `.diff` is **incremental against the
previous layer**, never the cumulative diff against `main`.

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
`base_sha: "$BASE_SHA"`, `head_sha: "$HEAD_SHA"`, `diff_sha256` from
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
co-author trailer. The separate Git directory is deliberately named `git`, not
`.git`, so older boot cleaners leave it intact. Use the worktree as `repo_path`.

**Platform/shell**: only when `/data/platform` has a real origin — create the
review branch with `git -C /data/platform worktree add -b fix/…
/data/contrib/<record-id>/worktree <base-sha>`, apply only the reviewed source
diff there, and record that worktree path with `repo: "mobius-os/mobius"`.
`/data/platform` itself remains on `main`. No origin → be honest: platform
contributions need the updated platform bootstrap; app contributions still work.

## PLATFORM CI

For `mobius-os/mobius` PRs, upstream CI runs backend pytest, frontend unit
`npm test`, `packager-unit`, `core-apps-unit`, `core-apps-sync` via
`scripts/check-core-apps-sync.sh`, and comprehensive Playwright e2e. Feature and
fix branch pushes run the cheap jobs; Playwright runs on the PR, main, and
integration branches. The Contribute checks refresh reports that PR result on
the record; expect it within the refresh cadence.

Before staging, run the cheapest focused checks that cover the changed files.
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
| **403 "OAuth App access restrictions"** | Org hasn't approved the Möbius OAuth app. Have the partner reconnect with a **`public_repo`-scoped PAT** (Connect card) — safer than full `repo`, which also grants read of the owner's PRIVATE repos through the read passthrough. |
| **`gh: command not found`** | Platform image too old; a platform update is needed. |
| **`git push fork` fails right after the fork** | Forks are created async — wait 2s and retry, up to 3×, before treating it as real. |
| **Push says `workflow` scope is required, but the reviewed diff does not change a workflow** | The reusable fork is stale and lacks an identical workflow file. Current platforms keep the fork default branch untouched and adapt only the reviewed topic commit; on an older platform, update the fork before retrying. |
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
