# Contributing: publish after approval

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Nothing here runs without the
partner's explicit yes for the exact current action (Hard stop #1).

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

The platform's Send endpoint:

1. claims the `prepared` record as `submitting`,
2. verifies `plan.head_sha` still equals the branch tip, `diff_sha256` still
   equals the stored `.diff`, and the canonical `base_sha..head_sha` branch diff
   hashes to the same value,
3. verifies the commit carries the Möbius Agent co-author trailer, unless the
   reviewed plan set `coauthor_trailer: false`,
4. pushes to the target repository itself when the connected owner owns it or
   has push permission there (the commit must already carry the owner's
   identity); otherwise normalizes the tip commit author/committer to the
   connected owner while preserving the reviewed diff, adapts the reviewed
   topic commit to a strictly-behind reusable fork without changing its default
   branch, proves the upstream merge result still matches the exact reviewed
   diff (a diverged fork stops untouched), and pushes to the owner's fork,
5. creates a review-ready PR with the approved `title` and `body_draft`,
6. best-effort applies the reviewed `labels` that exist in the target repo, and
7. records `url`, `number`, label outcome, and `status: "open"` in the ledger.

If any preflight fails, the endpoint rolls the record back to `prepared` with
`last_submit_error`; the partner can press Leave feedback to return to the
source chat. Your job after feedback is to re-read the diff, fix/re-stage the
record, and stop again.

A record flipped to `abandoned` means the partner dropped it — never argue with
one, never resurrect it unasked.

## After it's sent: autopilot

When the partner sends a PR with autopilot on (the default), the platform records
a **grant** authorizing a background loop to answer reviews on that PR until it
merges or closes. You don't drive that here — the platform starts a fresh
"Autopilot: …" chat per PR and runs the `review-followup` skill there. If a
review comes in and you're asked to respond in such a chat, follow that skill,
not this one.

The record may carry an `autopilot` block (`enabled`, `state`, `rounds`, …). It
is a **display-only mirror** the platform writes; the real grant + claim live in
a platform DB row you can't see or write. Never treat the ledger block as
authorization, and never hand-edit it to start, stop, or fake a round — it does
nothing. Pause/Resume needs an explicit partner action, either through the
Contribute control or an unambiguous chat instruction to use that same guarded
operation.

PR stacks, merging, and app publication with a post-merge connection are in
[maintainer.md](maintainer.md); legacy `mobius-bot` sends
are in [legacy-bot.md](legacy-bot.md).

## Commenting on an issue or discussion

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

## Editing a PR's title or description

Publish the approved text through GitHub's direct pull-request update. Do not
use `gh pr edit`: it also reads organization and project metadata and needs
`read:org`, which the scopes Contribute requests do not include.

```bash
gh api --method PATCH repos/<owner>/<repo>/pulls/<number> \
  -f title="<the approved title>" -F body=@<file-with-the-approved-body>
```

Send only the fields that changed. Reading the PR back with `gh pr view` is
fine: only the edit command needs the extra permission.

## When something fails

| Symptom | What it means / what to do |
|---------|----------------------------|
| **403 "OAuth App access restrictions"** | The organization has not approved the Möbius GitHub app. Ask an organization owner to approve it, then reconnect through Contribute. |
| **`gh: command not found`** | Platform image too old; a platform update is needed. |
| **`git push fork` fails right after the fork** | Forks are created async — wait 2s and retry, up to 3×, before treating it as real. |
| **Push says `workflow` scope is required, but the reviewed diff does not change a workflow** | The reusable fork is stale and lacks an identical workflow file. Update Contribute and reconnect GitHub so the full PR scope set is granted, then retry the unchanged review. |
| **`gh pr edit` asks for `read:org`** | Expected with Contribute's scopes; nothing changed. Use the direct update in "Editing a PR's title or description" above rather than requesting a broader scope. |
| **Send says the co-author trailer is missing** | Re-commit with the trailer and re-review. If the target's policy forbids it or the owner asked to omit it, set `plan.coauthor_trailer: false`, say so in the approval summary, and re-review. |
| **A PR's CI checks failed** | Diagnose with `/data/platform/scripts/ci-failures.sh <owner/repo> <pr-number>` as described in [ci.md](ci.md), then repair privately and re-stage. |
