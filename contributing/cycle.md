# Contributing: the project cycle (owner intents)

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

The intent names below are complete workflow requests, not hints that the owner
must expand into a checklist every time. Preserve every hard stop while doing
the routine discovery and sequencing without asking the owner to restate it.

Every project adapter must supply five owning facts: the working source, the
accepted/shared source, the publication target, the reviewed local update path,
and the categories of private or local-only material that must be preserved.
The stages below do not change when those facts come from another repository or
project type. If a project has no truthful adapter yet, keep it visible but
name that missing capability instead of guessing with raw Git commands.

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

## Prepare my changes

Treat **prepare my changes**, **prepare to submit**, and a project-level
Contribute handoff as explicit approval for private preparation only. When the
owner does not narrow the scope, inventory every current Contribute project
source position, then prepare every coherent, reusable change that is safe to
share. Do not assume that every customized, personal, or local-only project
belongs upstream.

1. Start with the Contribute queue snapshot and the read-only Projects/source
   status. Refresh both rather than trusting counts copied into a handoff.
2. Classify each difference as a working draft, reusable local change, landed
   contribution already recognized, incoming shared work, compatible change,
   true conflict, private/personal project, or unavailable source. Never turn
   incoming-only work into a contribution and never publish runtime data.
3. Group reusable work by owning repository and dependency. Deduplicate it
   against existing PRs/issues, perform the two review passes, run proportionate
   checks, and stage exact private review records (all in
   [prepare.md](prepare.md)). When a later chat refines
   an existing record, preserve its original `chat_id` and CAS-add both the
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

## Finish the contribution cycle

Treat **finish the contribution cycle**, **handle the existing changes and
submit them**, **submit and sync**, **align my projects with upstream**, and the
Möbius-specific **align this Möbius with upstream** as one durable outcome. The
default scope is every active Contribute PR plus every current reusable local
change, unless the owner names a narrower repository or project. This intent
almost always earns a Goal because it crosses review, external waits, and local
reconciliation.

1. Refresh the complete queue and Projects status, then fetch canonical
   upstream read-only for every in-scope repository. Re-read live record
   states; prepared records may have become public or merged since the handoff
   was created. Never pull, rebase, reset, or switch the shared live checkout:
   upstream alignment for contribution review happens in an isolated checkout.
2. Privately repair stale reviews, failed checks, merge conflicts, and sound
   review feedback. Prepare newly discovered reusable changes. Leave genuine
   owner choices, unsafe work, and unrelated refactors explicitly blocked.
   Diagnose failed checks with `scripts/ci-failures.sh <pr-number|run-id>`
   (see [ci.md](ci.md)), not full-log dumps.
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
   watcher. For CI, wait with `/data/platform/scripts/pr-checks.sh <repo> <pr>
   <sha>` so a commit that never became the PR head fails at once. Refresh the
   real current head and outcome whenever the chat resumes.
5. Once every in-scope public item is merged, closed, superseded, or honestly
   blocked, reconcile each local project through the reviewed update path named
   by its adapter. Preserve private/local-only work and genuine local overlays,
   send overlaps to the owning resolver rather than resetting them, and retain
   any separately confirmed activation or restart gate.
6. Refresh Projects one final time. Completion means the accepted upstream work
   is present locally and every remaining difference is classified as
   intentional local work, private data, an active draft, unavailable source,
   or a named blocker. Release the disposable staging checkout for every
   terminal record through its platform cleanup endpoint; do not report the
   cycle complete while a merged, closed, superseded, commented, or abandoned
   record still owns a checkout. Report prepared, sent, merged/superseded,
   blocked, aligned, cleaned, and deliberately local outcomes in one concise
   handoff.

Do not replace these stages with a blind reset or a one-click destructive
shortcut. The streamlining is that the owner names the outcome once; exact
publication, update review, conflicts, and restart retain their existing gates.

## Current Möbius adapter

For the platform and installed apps currently shown in Contribute Projects:

- the working source is the live platform checkout or app source directory;
- the accepted/shared source is the configured canonical branch or installed
  app release marker;
- publication is staged through Contribute and, once explicitly approved,
  sent through the GitHub path in [publish.md](publish.md);
- accepted platform work returns through the reviewed Möbius update flow;
- eligible tracked apps return through App Store's reviewed **Update all** flow;
- private/local-only apps and genuine local overlays are preserved;
- overlaps use the existing resolver instead of a reset; and
- platform activation keeps its separately confirmed restart gate.

These are adapter rules, not definitions of the contribution cycle. A future
owner repository should register equivalent source, publication, update, and
privacy facts and then reuse the same **Prepare** and **Run full cycle** intents.
