# Contributing: card asks

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

## Card asks

A message "Please fix what the contribute card in this chat flagged:" followed
by lines `` `contribute · <record-id> · <code>` `` comes from **Fix in chat**
on this chat's Contribute card: the owner pressed it, and each line names a
record the card holds back and why. Möbius wrote the whole message; the card
supplied only the ids and codes. Pressing it again for an unchanged record
does not post it twice; once you restage, the card can ask again. It asks you to repair that record privately.
It is never approval to send, push or publish ([SKILL.md](SKILL.md) Hard stop
#1).
Work on exactly the named record, following `superseded_by` to its current
version, in its review worktree ([branch.md](branch.md)), then restage and
review it as [ledger.md](ledger.md) describes:

| Code | What to do |
|---|---|
| `commit_identity_mismatch` | Recommit the reviewed change with the connected account (`mapi /api/github/status` `login`) as author and committer, keeping the co-author trailer; restage and review again. |
| `invalid_pr_text` | Correct the title or body so GitHub can publish it exactly as written (length, characters, screenshot references); restage and review again. |
| `publication_destination_unavailable` | Read the record's review status again; if GitHub still cannot say where it would publish, tell the owner what is unavailable. |
| `needs_review` | Review the current head completely and record the verdict. |
| `changes_needed` | Fix what the review found; restage and review again. |
| `upstream_conflict` | Update onto the fresh upstream base and resolve the conflict, run the focused tests, restage and review again. |
| `upstream_base_moved` | Update onto the fresh upstream base and restage; review again unless the verdict carried over. |
| `source_changed` | Restage from the current reviewed source; review again if the diff changed. |
| `send_failed` | Read `last_submit_error` and `last_submit_error_code`, repair the cause ([publish.md](publish.md) failure table), restage and review again. |
| `needs_attention` | Read what the record's attention reports and resolve it. |
| `not_in_contribute` | Find what removed or replaced the record; stage the work again from this chat if it still exists, otherwise tell the owner it is gone. |
| `couldnt_check` | Read the record; if it is intact, only print a new card, otherwise repair it with the ledger's CAS rules. |
| `restage` | Restage it so its diff stat and identity are complete, then review again. |
| `stack_incomplete` | Layers of its stack are missing from the card or the ledger: prepare, review and stage only the missing private layers from this chat, so the card can list the whole stack. |
| `stack_parent_merged` | A parent layer has merged: rebuild only the remaining prepared (private) layers on the repository's fresh default branch, restage and review them again ([maintainer.md](maintainer.md) "Repair a prepared stack layer"). Never retarget the old child silently. |
| `stack_parent_changed` | A prepared layer of the named record's stack no longer sits on its parent's reviewed head (the parent was restaged or updated): rebuild only the prepared (private) layers above that parent on its current head, restage and review them again. |
| `result_unknown` | Read only: look on GitHub for the exact branch and pull request. Record a PR you find; otherwise report what you saw. Never clear the error or send again. |
| `publication_changed` | Read only: the platform's observation found that GitHub or the record no longer matches the signed attempt (a different head, base or text, or a closed target). That is not proof nothing was sent, so never clear the error or receipt, retry, reopen or replace the PR. Compare the record with the live branch and PR; tell the owner what changed and which decision it needs (update the existing PR, prepare a replacement, or dismiss). Restage only after the owner decides. |

For every stack code, change only prepared, private layers: never modify,
rebase, restage or force-push a layer that is already public (draft, open) or
merged. If the repair would change a public layer, for example a public
layer sits above one that must be rebuilt, stop and ask the owner how to
proceed instead.

Then print a fresh card with `python3 /data/apps/contribute/prepared_block.py
<record-id> …` ([publish.md](publish.md) "Offering Send in chat"), so the
owner can press Send. A stack whose chain is not valid (layers from different
repositories, a layer in an unpublishable state, mismatched layer metadata) is
not an ask: its row says "Stack not valid" and the card opens Contribute. If the repair needs an owner decision (a changed
scope, a closed target PR, a different repository), ask for that decision
instead. A GitHub connection problem is never an ask: the card offers the
owner the account itself.

## A stranded update

The card says **PR merged first** or **PR closed first** on a row when an
update to a public pull request was prepared and the PR merged or closed before
the update was sent (the record's `lifecycle` shows `update.state`
`STRANDED_UPDATE`, [ledger.md](ledger.md)). The update can no longer be sent: a
PR that is not open takes no update. The record waits in Needs you, as **Update
not sent**, until the owner settles it. It is not an ask code and never approval
to send, push, reopen or retarget the PR. When the owner asks you to settle it,
do exactly the exit they choose, and ask which when they have not. Then record
the exit: **only the checked writer records an exit**, so never hand-edit
`status` or `lifecycle`, and never write the record by `mapi`.

```bash
python3 /data/apps/contribute/settle_exit.py <record-id> <EXIT> [--successor <new record id>]
```

It reads the record, refuses an exit its state does not accept, and writes the
outcome (`update_outcome`, [ledger.md](ledger.md)), the `lifecycle` and the status
word it derives in one compare-and-swap write. Exit 0 saved; 2 refused, nothing
written; 3 the record changed under it, or Möbius could not be reached: run it
again. The owner's own buttons on the record (**Already in the merge**,
**Discard**) are the same writer: if they settled it first, the script says the
record no longer accepts the exit, and you are done.

| Exit | When | What to do |
|---|---|---|
| `COVERED_BY_MERGE` | The PR merged and already contains these changes | Compare the record's staged head with the merged PR on the default branch. If something of the update is missing, it is not this exit. If nothing is, tell the owner so, stage nothing and push nothing, and run `settle_exit.py <record-id> COVERED_BY_MERGE`: the record keeps the note that the merge already contained the changes. |
| `PRESERVE_AS_NEW` | Part of the update is still wanted | Rebuild only that change on the repository's fresh default branch in its own review worktree ([branch.md](branch.md)), stage it as a new record with a new `<record-id>` (never the stranded one), review it, and print its card. Then run `settle_exit.py <stranded-record-id> PRESERVE_AS_NEW --successor <the new record id>`, which stores the successor on the stranded record, and tell the owner which record replaces it. |
| `DISCARD_UPDATE` | The update is no longer wanted | Change nothing else. Run `settle_exit.py <record-id> DISCARD_UPDATE`: dropping the update leaves the merged or closed PR exactly as it is, never abandoned and never reopened. |

If the PR is reopened, the update can go out again: print a fresh card and do
not restage unless the head moved.

## A merge that never landed

The card says **Merged elsewhere** when the PR was merged into a branch other
than the default branch, and that branch did not reach the default branch (the
record's `lifecycle` shows `publication.state` `ORPHANED`, [ledger.md](ledger.md)).
The job waited, then asked the owner once. If that branch reaches the default
branch after all, the job records it by itself and the record is merged; nothing
for you to do. When the owner wants the change in the default branch, re-land it
as new work and record the exit:

| Exit | When | What to do |
|---|---|---|
| `OWNER_RELANDS` | The owner wants the change landed again | Rebuild it on the repository's fresh default branch in its own review worktree ([branch.md](branch.md)), stage it as a new record with a new `<record-id>`, review it, and print its card. Then run `settle_exit.py <orphaned-record-id> OWNER_RELANDS --successor <the new record id>`: the record becomes `superseded` by the new one (`superseded_by`), which every card follows. |

The same rules apply: `settle_exit.py` is the only way to record the exit, and
it is never approval to send, push, reopen or retarget anything.
