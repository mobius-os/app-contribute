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

For existing **legacy Möbius-bot records** only, the instance proves the same
exact reviewed head, merge-tests it against the configured current target, and
sends an exact file snapshot through a one-use body-bound capability. New
contributions use the connected GitHub account instead. The launcher writes
only to the configured bot publication repository, opens or updates one draft
PR in the target, and returns the stable PR URL. `local_record_id` stays stable while
`relay_revision` increases for each changed reviewed snapshot, so a refresh can
update the same PR without discarding comments. Exact retries reuse the same
revision and cannot create a duplicate. Status polling is a fallback behind
launcher webhooks. The partner may explicitly **Withdraw PR**; that closes the
PR and removes only its bot-owned branch, never an upstream branch and never a
merge.

## After an app PR merges: connect the same local app

A merged record with a reviewed `after_merge.action: connect_app` finishes the
local connection automatically. This is the completion step of the exact app
publication the owner already approved; never present a second **Link app**
decision or count it among owner actions. The scheduled reconciler retries any
interrupted handoff until it either completes or has a concrete recovery error.

The platform then checks GitHub's actual merge commit, the stored reviewed diff,
the durable landed witness, the immutable merged source and permission digests,
and the intended live app row. Only an exact match installs that merged commit
under the stable App Store identity. The
existing numeric app row and its saved data remain in place, so later App Store
updates target the same installation instead of creating a second app. If the
local source advanced after review, the ordinary update merge may report
conflicts; Contribute keeps the app connected and sends those source conflicts
back to its owning chat for deliberate resolution.

Do not call the publication complete until the local connection is recorded.
When the intended catalog identity is already attached to the same numeric app
row, the guarded route may reconcile that already-true connection without
rewriting the app or its source. Any other proof failure stays visible in
Working and must not be relabelled as connected.

This handoff depends on the running platform version that supports reviewed
publication connections. If Contribute reports that the route is unavailable,
restart after installing the companion platform change; do not fall back to
clicking App Store **Install** against an older public package.

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

## The green light for a PR stack

When 2–12 prepared PR records carry one complete `plan.stack` chain,
Contribute groups them into one visual review and shows the current **Update
stack** or **Send stack** action.
The second, explicit confirmation lists every title and `base → branch` pair
in the current public phase; that click approves exactly those enumerated
pushes and PR creations. An explicit, unambiguous chat instruction accepting
the same current list is equally valid; do not require both approval surfaces.
Any record carrying `plan.stack` is stack-only: malformed or incomplete chains
stay visible for feedback, but neither the app nor the platform may fall back
to sending one layer through the standalone PR path.

A reviewed chain may start with existing pull requests whose branches need an
update and end with new unpublished children. Keep that as one stack, but use
two exact public phases: first confirm and update the consecutive `pr_update`
prefix; after a fresh ledger read proves those updates settled, separately
confirm and open the `pr` suffix. The confirmation enumerates only the current
phase, while the full chain remains visible and is revalidated on both calls.
Never place an existing-PR update after a new private layer, and never let one
phase claim, hide, or inherit approval for the deferred phase.

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

## Let GitHub accept a public stack

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

## When something fails

| Symptom | What it means / what to do |
|---------|----------------------------|
| **403 "OAuth App access restrictions"** | The organization has not approved the Möbius GitHub app. Ask an organization owner to approve it, then reconnect through Contribute. |
| **`gh: command not found`** | Platform image too old; a platform update is needed. |
| **`git push fork` fails right after the fork** | Forks are created async — wait 2s and retry, up to 3×, before treating it as real. |
| **Push says `workflow` scope is required, but the reviewed diff does not change a workflow** | The reusable fork is stale and lacks an identical workflow file. Update Contribute and reconnect GitHub so the full PR scope set is granted, then retry the unchanged review. |
| **Empty search results** | Normal while the ecosystem is young; not an error. |
| **A PR's CI checks failed** | Diagnose with `scripts/ci-failures.sh` as described in [ci.md](ci.md), then repair privately and re-stage. |
