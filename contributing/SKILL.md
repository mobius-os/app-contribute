---
name: contributing
description: "Contribute app's project-collaboration skill. Read before ANY public GitHub action, and for prepare my changes / prepare all, address existing contributions, finish the contribution cycle / submit and sync / align with upstream, and review or merge selected PRs."
---
# Contributing upstream

It moves local project changes into private review, public collaboration, and
safe local reconciliation. The constitution's end-of-task checklist routes you
here when a change would help other users; "share this" or "report that bug
upstream" lands here too. The cycle is project-shaped: a project adapter
supplies the facts that differ between targets (where source lives, what is
shared, how publication and local updates work), and this core applies to every
target.

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
| Run an owner intent across the queue: **prepare my changes / prepare all**, **finish the contribution cycle / submit and sync / align with upstream**; start any multi-contribution task (queue snapshot); reconcile local projects after merges; choose the project adapter | [cycle.md](cycle.md) |
| Work on a Möbius target — the platform, shell, or an installed app: source roots, branch recipes, checkout-local test wrappers (`wt-pytest.sh`/`wt-npm.sh`), the Möbius CI suite, labels, catalog check | [adapter-mobius.md](adapter-mobius.md) |
| Work on any other GitHub repository — the owner's own project or third-party open source: clone, default branch, fork or branch PR, the target's contribution policy | [adapter-github.md](adapter-github.md) |
| Prepare one contribution: prior-work search, two-pass code review, **review all / review this PR / fix and review again** on prepared records, the `plan` fields, the `all_clear` verdict and handoff | [prepare.md](prepare.md) |
| Build the review branch: refresh upstream, scratch vs `/data/contrib` checkouts, the locked review worktree, updating an existing open PR; **cleanup ownership** of any clone, worktree, install, or build output you create | [branch.md](branch.md) |
| Read or write ledger records: create, CAS update, `.diff` blob, `chat_ids`, `type`/`status` values, `quality_review` | [ledger.md](ledger.md) |
| Publish after approval: the green light, **Send/Open PR**, issue/discussion comments, editing a PR's title or description, autopilot grants, the failure table | [publish.md](publish.md) |
| Work that needs upstream push or merge rights: PR stacks, **Review** / **Review & merge** of selected public PRs (`review_prs.py`), **Prepare & merge**, publishing an app into its own `mobius-os/app-<id>` repository and the post-merge `connect_app` | [maintainer.md](maintainer.md) |
| Check results: required checks, local checks before staging, inspecting failed CI (prefer `/data/platform/scripts/ci-failures.sh <owner/repo> <pr-number\|run-id>` over full `gh run view --log` dumps) | [ci.md](ci.md) |
| Any record with `submission_mode: "mobius-bot"` (legacy relay records only) | [legacy-bot.md](legacy-bot.md) |
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

New contributions require the connected owner's GitHub account. Never add the
legacy `submission_mode: "mobius-bot"` marker to a record.

- `connected: true` with a `login` — `gh` is authenticated as the owner. You
  never see the token (`gh` resolves it from the platform store — don't dig for
  it, never print it). It's wired GLOBALLY: once connected, ANY `git push` to a
  github.com remote authenticates as the owner and nothing at the git layer gates
  that — Hard stop #1 is the whole safety net. NEVER run a bare `git push` to a
  github remote outside the guarded Send path.
- `connected: false` — contributions can still be prepared and reviewed
  privately, but sending requires a connected GitHub account. Nothing goes
  public until the partner approves the exact record.
- `gh_version: null` — `gh` is unavailable. Tell the partner a platform update
  is needed; don't improvise around it.

## What may leave — the privacy allowlist

Hard stop #2 in full.

**Contributable: source code only** — source files of the target repository,
under a project root its adapter registers. That is the whole list. The Möbius
adapter lists its roots; a generic GitHub target's root is its own checkout.

**Never, no exceptions:** anything under `/data/shared/memory/`, app storage
(`/data/apps/<int-id>/` — numeric-id dirs are runtime data, not source), the
database, logs, `/data/cli-auth/`, chat content, and anything personal — names,
schedules, health data, locations, habits, the partner's writing. Commit
messages, branch names, and PR bodies leak too: keep them generic ("fix
empty-state crash", not "fix crash when <name>'s workout log is empty").

**Re-read the FULL diff — every changed line, not the file list** — the
canonical `base_sha..head_sha` diff against the accepted base the adapter
names. Local commits routinely carry partner data into source (a seeded
example, a hardcoded name, a test fixture with real entries) — strip anything
personal or don't propose.

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
every item settles; in-flight siblings stay visibly in flight. A chat-scoped
review, repair, or failed-publication recovery continues as a hidden turn in its
source chat. Contribute may start an app-owned scoped conversation only for
genuinely global work that has no source chat. Background Delegation children return evidence or independent edits to
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
