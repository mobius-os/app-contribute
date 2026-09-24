---
name: contributing
description: "Contribute app's project-collaboration skill. Read before ANY public GitHub action, and for prepare my changes / prepare all, address existing contributions, finish the contribution cycle / submit and sync / align with upstream, and review or merge selected PRs."
---
# Contributing upstream

It moves local project changes into private review, public collaboration, and
safe local reconciliation. The constitution's end-of-task checklist routes you
here when a change would help other users; "share this" or "report that bug
upstream" lands here too. The current built-in adapters are Möbius
platform/app projects published through GitHub, but the cycle itself is
project-shaped rather than `mobius-os`-shaped so future owner projects can use
the same intents and UI.

This file is the core every contribution task needs. Procedures live in mode
files next to this one in the skill folder: open only the one the current step
needs, from the table below (links are relative to this file). After context
compaction, re-read this core plus the mode file you were working in — not
every file.

---

## Hard stops

Three rules never bend. Every mode file assumes them and points back here.

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

## Which file to read

| When you are about to… | Read |
|---|---|
| Run an owner intent across the queue: **prepare my changes / prepare all**, **finish the contribution cycle / submit and sync / align with upstream**; start any multi-contribution task (queue snapshot); reconcile local projects after merges; project adapter facts | [cycle.md](cycle.md) |
| Prepare one contribution: prior-work search, two-pass code review, **review all / review this PR / fix and review again** on prepared records, the `plan` fields, the `all_clear` verdict and handoff | [prepare.md](prepare.md) |
| Build the review branch: refresh upstream, scratch vs `/data/contrib` worktrees, app/platform recipes, choosing and preparing a PR stack, updating an existing open PR; **cleanup ownership** of any clone, worktree, install, or build output you create (incl. `wt-pytest.sh`/`wt-npm.sh`) | [branch.md](branch.md) |
| Read or write ledger records: create, CAS update, `.diff` blob, `chat_ids`, `type`/`status` values, `quality_review`, legacy bot records | [ledger.md](ledger.md) |
| Publish after approval: the green light, **Send/Open PR**, stack send, merge acceptance, issue/discussion comments, legacy bot sends, post-merge app connection, autopilot grants, the failure table | [publish.md](publish.md) |
| **Review** or **Review & merge** of selected existing public PRs (`review_prs.py`), **Prepare & merge** | [review-merge.md](review-merge.md) |
| Platform CI: what runs upstream, local checks before staging, inspecting failed CI (prefer `scripts/ci-failures.sh <pr-number\|run-id>` from `/data/platform` over full `gh run view --log` dumps), Playwright | [ci.md](ci.md) |
| Answer review activity in an "Autopilot: …" chat | the `review-followup` skill, not this one |

## Tools and GitHub status

Use `mapi` for every chat-context command in these files — it fills in
`$API_BASE_URL` + `$AGENT_TOKEN`; never hardcode localhost. A successful write
often returns **204 No Content**, so `mapi` prints nothing — that silence is
success, not failure: verify with a follow-up GET, or show the status with
`mapi -o /dev/null -w '%{http_code}' -X PUT /api/... -d '...'`. Use the exact
documented path including its trailing slash (`/api/apps/`): slash-less
variants are a plain 404, not a redirect curl could follow.

```bash
mapi /api/github/status | python3 -m json.tool
```

New contributions require the connected owner's GitHub account. Existing
records marked `submission_mode: "mobius-bot"` retain their legacy Möbius
service identity and recovery path.

- `connected: true` with a `login` — `gh` is authenticated as the owner. You
  never see the token (`gh` resolves it from the platform store — don't dig for
  it, never print it). It's wired GLOBALLY: once connected, ANY `git push` to a
  github.com remote authenticates as the owner and nothing at the git layer gates
  that — Hard stop #1 is the whole safety net. NEVER run a bare `git push` to a
  github remote outside the approved fork flow.
- `connected: false` — new contributions can still be prepared and reviewed
  privately, but sending requires a connected GitHub account. Only existing
  `mobius-bot` records may continue through their legacy path without that
  connection. Do not add the marker to a new record to bypass GitHub setup.
  Nothing goes public until the partner approves the exact record.
- `gh_version: null` — the platform image predates GitHub support. Tell the
  partner a platform update is needed; don't improvise around it.

## What may leave — the privacy allowlist

Hard stop #2 in full.

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
`upstream` is the Möbius per-app-git branch that exists INSIDE
`/data/apps/<slug>`; in a scratch clone under `$TMPDIR` there is no `upstream`
branch — diff against `origin/main`. Local commits routinely carry partner data
into source (a seeded example, a hardcoded name, a test fixture with real
entries) — strip anything personal or don't propose.

## The approval gate

Private preparation begins only from an explicit partner request, including a
project-level or **Prepare to submit** handoff from Contribute. The source chat's
automatic **Changes ready to organize** card is the lightweight preparation
suggestion after coherent file edits: it only reflects already-recorded work
and never starts an agent, reviews a diff, or inspects GitHub on its own. Do not
duplicate that visible choice with another question at the end of the turn.
Pressing **Prepare to submit** on the card or in Changes is an explicit
private-preparation request; dismissing it only hides that revision of the
suggestion and keeps the work in Changes and Contribute.

**One decision, no duplicate approval.** A live Contribute/prepare block is one
owner decision surface for the exact action it represents. Apart from the Goal
handoff below, never also call `request_user_input` / `AskUserQuestion` for
**Prepare**, **Review / Fix and review**, **Send / Update PR**, or another
action already shown by that block, and do not paraphrase the same choice into
chat merely to solicit a second answer. But if the partner voluntarily gives an
explicit, unambiguous chat instruction for that exact current action—or replies
"send all of those" to a just-enumerated immutable set—that is the owner
decision. Proceed without requiring the matching Contribute press. Run the same
exact-head, full-diff, identity, and freshness checks and use the documented
guarded submission path; chat approval changes the approval surface, not the
safety preflight.

**A Goal waiting on that decision** still needs a handoff; the block neither
owns the Goal nor resumes the chat. Claim the action's canonical work key (for
example `github:<owner/repo>:pr:<number>:<head_sha>:update`), then end with
exactly one `request_approval` card for that record and head under the same
key. Approving it is a valid yes. Never re-ask for the same head.

If the owner presses the block, let that action own its complete batch until
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
choice remains non-approval. Refinement feedback changes when the question is
asked again, never what the agent may publish. Preparing is still private: a
local branch/commit and a Contribute record, not a fork, push, PR, issue, or
comment. The next public step happens only after the partner explicitly
approves the exact current action in chat or uses the matching Contribute
control. Chat approval does not waive the record's guarded freshness and
exact-diff checks, and it never requires the partner to visit Contribute just to
say yes again.

## Contribute not installed

No staging, no review card, no tracking — but Hard stop #1 still holds (a plain
yes in chat gates each action). Recommend installing it from the App Store
before contributing; go app-less only if the partner insists.
