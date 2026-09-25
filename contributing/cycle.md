# Contributing: the project cycle (owner intents)

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

The intent names below are complete workflow requests, not hints that the owner
must expand into a checklist every time. Preserve every hard stop while doing
the routine discovery and sequencing without asking the owner to restate it.

The stages below are the same for every project. What differs between targets
comes from its adapter (see *Project adapters* at the end); read that adapter
before touching source.

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
   source chat without duplicating or moving the contribution. Independent
   changes become independent PRs; a stack is only for truly dependent changes
   and needs upstream push permission
   ([maintainer.md](maintainer.md)). The source chat is the parent
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
submit them**, **submit and sync**, and **align my projects with upstream** as
one durable outcome. The
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
   Diagnose failed checks with `/data/platform/scripts/ci-failures.sh <owner/repo> <pr-number|run-id>`
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

## Project adapters

Every project adapter supplies five owning facts:

1. **Working source** — where the owner's local changes live.
2. **Shared source** — the accepted upstream the review is based on.
3. **Publication** — how an approved review becomes public.
4. **Local update path** — how accepted work returns to the working source.
5. **Private material** — what must stay local beyond the core allowlist.

The stages above do not change between adapters. If a project has no truthful
adapter, keep it visible but name that missing capability instead of guessing
with raw Git commands.

| Target | Adapter |
|---|---|
| The Möbius platform, shell, or an installed app shown in Contribute Projects | [adapter-mobius.md](adapter-mobius.md) |
| Any other GitHub repository — the owner's own project or third-party open source | [adapter-github.md](adapter-github.md) |
