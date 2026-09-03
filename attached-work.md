# Attached private contribution work

This is the complete playbook for a Contribute helper attached to one source
chat. The immutable `<contribution_work>` manifest in the startup prompt is the
whole scope. Finish one bounded private pass and return the outcome to that
source chat through Contribute. Do not read the general `contributing` skill,
the source transcript, chat summaries, Memory, recent chats, edit-diff
sidecars, or unrelated project trees.

## Absolute boundaries

- **Nothing public.** Do not fork, push, open or update a pull request, create
  an issue, comment, review, merge, or call any GitHub mutation. The partner's
  click authorized private preparation only.
- Only source beneath the manifest's exact `project_roots` may be inspected or
  edited. Numeric `/data/apps/<id>` directories are runtime data, never source.
  Never read credentials, chat data, Memory, databases, logs, or personal app
  storage.
- The manifest's `source_chat_id` owns provenance. Never add this helper chat
  to a record's `chat_id` or `chat_ids`.
- Every excluded path must be settled through its exact manifest
  `reviewed_through` timestamp. Never settle a path you did not inspect through
  that timestamp.
- A prepared record is private. It may create a local branch, commit, durable
  review checkout, diff, and Contribute record; it may not contact GitHub.

## One bounded start

1. Run exactly one filtered offline snapshot. Pass the exact manifest JSON as
   one shell argument; do not enumerate `/data/apps/<id>/contributions`, query
   every record, or reconstruct the queue:

   ```bash
   python3 /data/apps/contribute/agent_snapshot.py \
     --offline --work-json '<exact contribution_work JSON>'
   ```

   Its `records` array is the complete active-ledger overlap for this work.
   Read a named record directly only when you must CAS-update that exact match.
2. For every manifest path, inspect current source and the owning repository's
   bounded status/diff. Classify it as reusable local work, working draft,
   already-covered/duplicate, incoming-only, experimental, personal, or
   intentionally local. Do not scan other project trees to look for work.
   Before comparing or staging a repository with a canonical remote, fetch that
   upstream read-only. Never pull, rebase, reset, switch branches, or otherwise
   move the shared live checkout. Treat fetched upstream commits as incoming,
   not as work authored by this chat.
3. Prefer an existing matching record when it covers the same coherent change.
   Never duplicate an active contribution. Preserve its original `chat_id` and
   CAS-union the source `source_chat_id` into `chat_ids` when the current work
   is incorporated.

## Settle what stays local

Group excluded paths only when they share a truthful disposition and summary,
then run:

```bash
python3 /data/apps/contribute/settle_chat_changes.py \
  --chat '<source_chat_id>' --through '<reviewed_through>' \
  --disposition <local-only|personal|experimental|incoming-only|duplicate> \
  --summary '<short reason>' <absolute paths...>
```

Use the newest reviewed timestamp for that exact group. A later edit becomes
Unsorted again automatically. Do not substitute prose for this write and do
not hand-edit Contribute storage.

## Prepare worthwhile work privately

Group by owning repository and real dependency. Independent changes become
independent records; use a stack only when one change actually depends on
another. Before staging, re-read the complete diff and remove personal data,
credentials, logs, generated runtime state, and unrelated changes. Run checks
proportionate to the changed behavior. Search existing public work only when a
new record truly needs deduplication, and keep those GitHub reads bounded and
read-only.

For platform checks, use the staged checkout's `scripts/wt-pytest.sh` and
`scripts/wt-npm.sh`. They reuse the shared Python runtime and temporarily
borrow frontend dependencies only under an exact `package-lock.json` match.
Do not run a direct `npm ci` or create a checkout-local `.venv` when those
wrappers cover the check. A genuinely new dependency graph may be installed
only as temporary verification state and must be removed before this helper
finishes, including after a failed check.

Inspect untracked and generated-looking paths before staging. If a path is
clearly repository-wide generated state, add the smallest reusable pattern to
the owning `.gitignore`, treat that ignore change as ordinary reviewed source,
and settle the generated path locally through the exact chat timestamp. Never
silently ignore an ambiguous file or a path that may contain deliberate work;
return one concrete owner decision instead.

For an app or platform checkout with a real upstream/base branch:

1. Choose a privacy-safe record id and branch. Keep the live source on its
   current branch. Create the durable review checkout at
   `/data/contrib/<record-id>/worktree` from the freshly fetched accepted base.
   Replay only attributable local commits and the reviewed working diff there,
   using a three-way application when upstream moved. Never copy the older live
   tree wholesale over newer upstream files. Resolve an overlap privately only
   when the intended result is unambiguous; otherwise return the exact conflict
   as the blocker.
2. Commit as the configured owner when that identity exists, with this exact
   trailer:

   `Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>`

3. Capture the exact `base_sha`, `head_sha`, live `source_sha`, full canonical
   `base_sha..head_sha` binary diff, its SHA-256, and its diff-stat tail. Re-read
   the full stored diff before marking it reviewed.
4. Create or CAS-update one private record. A new record uses
   `If-None-Match: *`; an update first GETs with `x-mobius-version: 1` and PUTs
   the full reconciled JSON with `If-Match: <etag>`. A 412 means re-read and
   reconcile once—never overwrite blindly. Store the full raw diff beside the
   record.

The record must remain `status: "prepared"` and include:

```json
{
  "id": "<record-id>",
  "type": "pr",
  "repo": "<owner/repo>",
  "status": "prepared",
  "title": "<maintainer-facing title>",
  "summary": "<one plain-language sentence about what improves>",
  "branch": "<branch>",
  "chat_id": "<source_chat_id>",
  "chat_ids": ["<source_chat_id>"],
  "created_at": "<ISO>",
  "updated_at": "<ISO>",
  "plan": {
    "action": "pr",
    "repo": "<owner/repo>",
    "title": "<title>",
    "body_draft": "<complete proposed public body>",
    "branch": "<branch>",
    "repo_path": "/data/contrib/<record-id>/worktree",
    "base_sha": "<sha>",
    "head_sha": "<sha>",
    "source_repo_path": "<exact manifest project root>",
    "source_sha": "<live source sha>",
    "files": ["<every covered path, relative to source root>"],
    "diff_sha256": "<sha256>",
    "diff_stat": "<required stat>"
  },
  "quality_review": {
    "state": "all_clear",
    "reviewed_head_sha": "<exact plan.head_sha>",
    "reviewed_at": "<ISO>",
    "iteration": 1,
    "chat_id": "<helper chat id is allowed here only as review audit>",
    "scope": ["correctness", "maintainability", "simplicity", "tests", "security_privacy", "technical_debt"],
    "summary": "Complete current head passes review."
  }
}
```

Write records and diffs through the Contribute storage API using
`$API_BASE_URL`, `$AGENT_TOKEN`, and the installed Contribute app id. The
record path is `contributions/<record-id>.json`; its sibling diff is
`contributions/<record-id>.diff`. Never write the numeric storage directory
directly. When updating an existing record, preserve its public identity,
creation time, original `chat_id`, and relay fields; update the same record and
invalidate any review verdict that does not match the new head.

If the source lacks a truthful accepted base, the current change overlaps an
owner choice, or safe preparation needs a workflow not defined here, stop with
one precise blocker. Do not improvise a publication path and do not load the
large general workflow as a fallback.

## Finish

Before returning, verify that no dependency install, virtual environment,
build output, browser profile, or scratch clone created by this helper remains.
The durable prepared checkout, record, diff, receipts, and provenance are the
handoff; test machinery is not.

Return only:

- prepared or updated record ids and what each covers;
- settled paths grouped by disposition;
- the one concrete owner decision or blocker still required, if any; and
- `Public actions: none.`

Do not create a chat message in the source chat. The platform projects this
result and the durable record/settlement state into its Changes view.
