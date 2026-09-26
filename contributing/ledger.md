# Contributing: the ledger

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The `plan` field meanings live in
[prepare.md](prepare.md).

The Contribute app tracks every contribution so the partner sees status at a
glance. Find its id (slug `contribute`):

```bash
mapi /api/apps/ \
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
mapi -X PUT /api/storage/apps/<id>/contributions/<record-id>.json \
  -H "Content-Type: application/json" \
  -H "If-None-Match: *" -d '{
  "id": "<record-id>", "type": "pr", "repo": "<owner>/<repo>",
  "status": "prepared", "title": "<title>", "branch": "fix/<topic>",
  "chat_id": "'"$CHAT_ID"'", "chat_ids": ["'"$CHAT_ID"'"],
  "created_at": "<ISO>", "updated_at": "<ISO>",
  "summary": "<one plain-language sentence about what improves for people>",
  "plan": {"action": "pr", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full PR body, word for word>",
           "branch": "fix/<topic>",
           "repo_path": "/data/contrib/<record-id>/worktree",
           "base_sha": "<sha>", "head_sha": "<sha>",
           "source_repo_path": "<adapter working source>", "source_sha": "<sha>",
           "files": ["<every path covered by this exact contribution>"],
           "diff_sha256": "<sha256 of the .diff>",
           "diff_stat": "<git diff --stat tail>"}
}'
```

`chat_id` is the immutable creation/provenance chat. `chat_ids` is private,
additive coverage metadata for the source conversations whose edits the same
record has reconciled. A newly created record may contain only the current
chat. When reusing a prepared or public record from another chat, CAS-union the
existing primary/list values with the current `$CHAT_ID`; never overwrite the
primary id or create a duplicate merely to make the new chat's Changes view
settle. A background worker child is execution history, not source provenance:
never add its chat id to `chat_ids`. If that worker performed the actual review,
its id may be recorded in `quality_review.chat_id` for audit while the parent
source chat still owns the final record. Neither provenance field is published
to GitHub.

Store the full diff beside it as raw text (the once-only write named above):

```bash
mapi -X PUT /api/storage/apps/<id>/contributions/<record-id>.diff \
  -H "Content-Type: text/plain" \
  --data-binary @/tmp/<record-id>.diff
```

**Update** (re-stage or status changes) — read with `x-mobius-version: 1`, note
the `ETag`, PUT the edited record with `If-Match`. For PR submission itself,
Contribute's approve endpoint owns the claim/outcome write. A **412** means the
record changed under you: re-read, check the fresh status still allows your
change, reconcile, then retry with the new ETag:

```bash
mapi -si -H "x-mobius-version: 1" \
  /api/storage/apps/<id>/contributions/<record-id>.json
# note the ETag, edit the JSON, then PUT with -H 'If-Match: <etag>' -d '{ ...full record... }'
```

Refreshing a record keeps its id and public identity (PR URL/number); replace
the plan/diff and invalidate the old `quality_review`. Do not create a second
record merely because upstream moved.

`type` ∈ `pr | issue | issue_comment | discussion_comment`; `status` ∈ `prepared
| submitting | draft | open | merged | closed | commented | abandoned`; `number`,
`url`, `branch` are optional until they exist. `submitting` = the approve endpoint
claimed the record and the action is in flight; `commented` = terminal for
comment actions. A record stuck in `submitting` is reconciled by the platform's
lost-response recovery, never by searching GitHub and inventing a new record.
Legacy `submission_mode: "mobius-bot"` records carry extra `relay_*` fields:
[legacy-bot.md](legacy-bot.md).

`quality_review.state` ∈ `reviewing | changes_needed | all_clear`. The
`reviewed_head_sha` must exactly equal the record's current `plan.head_sha`.
Every re-stage or amended commit must replace or invalidate the verdict; never
carry `all_clear` across heads. Publication endpoints enforce this invariant.
The CAS update adds this sibling block to the full record:

```json
"quality_review": {
  "state": "all_clear",
  "reviewed_head_sha": "<exact plan.head_sha>",
  "reviewed_at": "<ISO>",
  "iteration": 2,
  "chat_id": "<review chat id>",
  "scope": ["correctness", "maintainability", "simplicity", "tests",
            "security_privacy", "technical_debt"],
  "summary": "Complete current head passes review."
}
```

The scheduled refresh job only tracks `pr | issue` records in `draft | open`.
