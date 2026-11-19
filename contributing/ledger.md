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

**Pull-request records are staged, not hand-written.** Commit the reviewed
source on its review branch, then ask Contribute to stage it. Git, not the
agent, supplies the base, head, canonical diff, hash, stat and files, and the
same call writes the `.diff` beside the record:

```bash
mapi -X POST /api/github/contributions/<id>/<record-id>/stage \
  -H "Content-Type: application/json" -d '{
  "repo_path": "/data/contrib/<record-id>/worktree", "repo": "<owner>/<repo>",
  "title": "<title>", "body_draft": "<full PR body, word for word>",
  "summary": "<one plain-language sentence about what improves for people>",
  "labels": ["<type>", "<area>"], "prior_work": {...},
  "screenshots": [{"name": "before-desktop.png", "path": "/abs/path.png",
                   "alt": "<what it shows>"}]
}'
```

A new record needs `repo_path`, `repo`, `title`, `body_draft` and `summary`.
Restaging an existing record (after a fix, rebase, split, or upstream merge)
needs only `{}`, plus any text you are changing on a PR that is not public
yet (an open or draft PR's title and body are copied from GitHub and must not
be sent). Optional fields: `base_sha`
(the accepted base; default is the merge base with the target's freshly
fetched default branch, and a stack layer uses its parent's head),
`source_repo_path` (only for a checkout that is not a linked worktree of the
live source), `coauthor_trailer: false`, `chat_id` (the source chat, when a
helper stages for it), and `screenshots` (below). An open or draft PR
restages as a `pr_update` whose title and body are copied from GitHub.
Staging never pushes anything.

`screenshots` carries only images that meet the screenshot entry of the
privacy allowlist in [SKILL.md](SKILL.md). It lists up to 8 PNGs of at most
2 MB, each named in lowercase with hyphens and shown in `body_draft` as
`(screenshot:NAME)`. Every attached image must appear in the body, and every
reference must name an attached image. Each `path` must be a regular file under `/data` or the temp folder,
not a link. Staging copies the images, `[]` removes them, and leaving the
field out keeps the current ones. GitHub has no API for description images,
so Send hosts them on a `mobius-screenshots` branch of the owner's own
repository (their fork, or the target when they own it), links them, and
refuses an image that changed after approval. Send the field only when
`mapi /api/github/status` reports `"screenshot_upload": true`; an older
Möbius ignores it and would publish the references unresolved.

Screenshots are refused in four cases. Staging refuses them on a
`pr_update` and drops any attached earlier, because an open PR's description
is edited on GitHub. Send refuses them on a legacy `mobius-bot` record, when
the owner's fork of the target cannot be created, and when the hosting
repository is private, because GitHub does not serve its images publicly;
it stops before the code is pushed. In those cases leave them out: a new
PR's body says why screenshots are not included, and a `pr_update`
describes the visible change in words in the reply that accompanies the
update.

A 404 from either call means this Möbius predates them: tell the owner a
platform update is needed rather than writing the record by hand.

Tracking **another author's existing open PR** (for example to review or carry
it) is the one case where a record is created by hand: create it as `type: pr`,
`status: open`, then seed `plan.repo_path` (and `plan.repo`; for a fork also
`plan.head_repository`) **before** staging — staging an empty plan returns a
409 `checkout_changed`, and a fork's `head_repository` is not inferred. Then
stage with `{}` as usual. When the goal is reviewing selected PRs rather than
carrying them, prefer `review_prs.py` (see [maintainer.md](maintainer.md)),
which handles this for you.

Record the private verdict for the exact staged head the same way:

```bash
mapi -X POST /api/github/contributions/<id>/<record-id>/review \
  -H "Content-Type: application/json" -d '{
  "head_sha": "<plan.head_sha you reviewed>",
  "diff_sha256": "<plan.diff_sha256 you reviewed>",
  "state": "reviewing | changes_needed | all_clear",
  "summary": "<what the complete head review found>"
}'
```

A staged change that moved after you read it is refused; `all_clear` is also
refused while the checkout would not pass Send's local checks. Staging drops
a verdict unless the canonical diff and public text are byte-identical (a
clean rebase or upstream merge), in which case the verdict follows the new
head with `carried_from_head_sha`.

The stage response's `source_sync.state` says how the live source relates to
the staged version: `in_source` (it contains it), `adopted` (the live source
held the previous staged version, so the review revision was just committed
onto it), or `diverged` (it does not; `detail` says why). Mention `adopted`
backend changes that need a restart, and tell the owner when a change stays
`diverged`.

**Other JSON writes use CAS** — issue and comment records, field changes, and
`chat_ids` unions — because a record has several writers (you, the publication
endpoints, the scheduled refresh job, the app's Dismiss button) and an
unconditional PUT silently erases one.

**Create** — `If-None-Match: *` so the PUT 412s if the id somehow exists (then
pick a new id):

```bash
mapi -X PUT /api/storage/apps/<id>/contributions/<record-id>.json \
  -H "Content-Type: application/json" \
  -H "If-None-Match: *" -d '{
  "id": "<record-id>", "type": "issue", "repo": "<owner>/<repo>",
  "status": "prepared", "title": "<title>",
  "chat_id": "'"$CHAT_ID"'", "chat_ids": ["'"$CHAT_ID"'"],
  "created_at": "<ISO>", "updated_at": "<ISO>",
  "summary": "<one plain-language sentence>",
  "plan": {"action": "issue", "repo": "<owner>/<repo>", "title": "<title>",
           "body_draft": "<full text, word for word>", "diff_stat": ""}
}'
```

`chat_id` is the immutable creation/provenance chat. `chat_ids` is private,
additive coverage metadata for the source conversations whose edits the same
record has reconciled. A newly created record may contain only the current
chat. When reusing a prepared or public record from another chat, restage it
from that chat (staging adds the chat) or CAS-union the existing values with
the current `$CHAT_ID`; never overwrite the primary id or create a duplicate
record for the new chat. A background worker child is
execution history, not source provenance: never add its chat id to `chat_ids`
(pass the source chat as `chat_id` when a helper stages). If that worker
performed the actual review, its id is recorded in `quality_review.chat_id` for
audit while the parent source chat still owns the final record. Neither
provenance field is published to GitHub.

**Update** — read with `x-mobius-version: 1`, note the `ETag`, PUT the edited
record with `If-Match`. A **412** means the record changed under you: re-read,
check the fresh status still allows your change, reconcile, then retry with the
new ETag:

```bash
mapi -si -H "x-mobius-version: 1" \
  /api/storage/apps/<id>/contributions/<record-id>.json
# note the ETag, edit the JSON, then PUT with -H 'If-Match: <etag>' -d '{ ...full record... }'
```

Refreshing a record keeps its id and public identity (PR URL/number). Do not
create a second record merely because upstream moved.

`type` ∈ `pr | issue | issue_comment | discussion_comment`; `status` ∈ `prepared
| submitting | draft | open | landing | merged | closed | commented | abandoned |
superseded`; `number`, `url`, `branch` are optional until they exist.
`submitting` = the approve endpoint claimed the record and the action is in
flight; `commented` = terminal for comment actions; `superseded` = replaced by
other work, with `superseded_by` naming the record that replaced it (the card
follows it to the current version). `landing` is the platform's own word while it lands a stack
that already exists: the pull request is open, nothing new starts a landing, and
the lifecycle engine never writes or replaces that word. A record stuck in
`submitting` is reconciled by the platform's lost-response recovery, never by
searching GitHub and inventing a new record.
Legacy `submission_mode: "mobius-bot"` records carry extra `relay_*` fields:
[legacy-bot.md](legacy-bot.md).

**The `lifecycle` field** is optional. Contribute's lifecycle engine stores it
beside `status` on a `pr | issue` record: `{"v": 1, "regions": {"publication":
{"state", "since", "deadline"}, "update": …, "followup": …}, "attention":
{"flags": […]}, "history": […]}`. It says what one status word cannot: a public
PR with an update waiting, an update whose PR merged or closed first
(`update.state` `STRANDED_UPDATE`), a merge into a branch other than the
default, a send whose answer was lost. A record without it (everything written
before it, and everything while the engine is not the writer) is read from its
`status` and fields, so never require it. The `status` word is derived from the
regions, and only the engine path writes it: staging, review, send, the
scheduled job and the app's own buttons. Do not change `status` or `lifecycle`
of a record that exists, by hand; the two hand-written creations above are the
exceptions, and the engine adopts the status they seed.

| Publication state (and update state) | `status` |
|---|---|
| `PREPARED`, `NOT_CONFIRMED` | `prepared` |
| `SENDING`, `UNCERTAIN` | `submitting` (`UNCERTAIN` also accepts `prepared`) |
| `DRAFT` | `draft` |
| `OPEN`, `QUEUED` | `open` |
| `MERGED`, `MERGED_ELSEWHERE`, `ORPHANED` | `merged` |
| `CLOSED`, `CLOSED_QUIET` | `closed` |
| `ABANDONED` | `abandoned` |
| `SUPERSEDED` | `superseded` |
| a public PR with `PREPARED_UPDATE` or `UPDATE_NOT_CONFIRMED` | `prepared` |
| a public PR with `SENDING_UPDATE` (`UPDATE_UNCERTAIN` also accepts `prepared`) | `submitting` |

Send claims a record by its `status` word, so an update waiting on a public PR
reads `prepared` there: `prepared` does not mean private. A `pr_update` record
with a PR `url` and `number` is public; read `lifecycle` (or `plan.action`)
instead of the word to tell the two apart.

**Fields the scheduled job writes.** All optional, and the job's own: read them,
never hand-write them.

| Field | Meaning |
|---|---|
| `github_head_sha`, `github_base_ref` | GitHub's own head commit and base branch of the PR as the job last read them. They are never the reviewed version: `plan.head_sha`, `quality_review.reviewed_head_sha` and `last_submit_push_sha` stay exactly as sent. After a merge into another branch, `github_base_ref` is that branch. |
| `merged_announced`, `closed_announced` | `false` means the owner merged this PR into the default branch, or closed it, in the app and the job has not yet told them once and closed out the follow-up grant; the job sets `true` after it has. A record finished any other way (a merge into another branch included) has neither key and owes nothing. |
| `stranded_announced` | `false` means the owner merged or closed the PR in the app while an update to it was waiting, so the update is stranded, and the job has not yet asked them (an `owner_request`) and told them once that the update could not be sent; the job sets `true` after it has. A record whose update the job itself stranded never has the key. Written in engine mode only. |
| `stranded_reminded_at` | The ISO time of the one reminder about a stranded update. Cleared when the update is no longer stranded. |
| `update_outcome` | How the owner settled a stranded update: `{ "exit", "at", "note"?, "successor"? }`, `exit` one of `COVERED_BY_MERGE` (with a `note` that the merge already contained the changes), `PRESERVE_AS_NEW` (with the `successor`, the id of the record that took the change over) or `DISCARD_UPDATE`. The status stays the PR's own (`merged` or `closed`). Written only by the checked writer: the record's buttons, or `settle_exit.py` ([card-asks.md](card-asks.md) "A held record"). A merge that never landed and was landed again as new work is not here: the record is `superseded` and `superseded_by` names its successor. |
| `attention` with `type: "owner_request"` | A region of the `lifecycle` waits on the owner: a send or an update that could not be confirmed, a merge into another branch that never reached the default branch, or an update that can no longer go out. Its `key` is `owner_request:<region>:<state>:<since>` and it carries `title`, `message`, `url`, `detected_at` and `announced_at`. It stands on a merged or closed record, where every other attention is emptied, and it goes once the region it names has left that state. It holds the one attention slot as `human_required` does; what it displaced waits in `waiting_attention`. Written in engine mode only. |

`quality_review.state` ∈ `reviewing | changes_needed | all_clear`, written
only through the review call above. Its `reviewed_head_sha` must exactly equal
the record's current `plan.head_sha`; publication endpoints enforce this.

The scheduled refresh job tracks `pr | issue` records in `draft | open | landing`.
With `lifecycle_writer` set to `"engine"` in the app's `settings.json` it also
follows a PR closed less than 30 days ago (it may be reopened), a merge into a
branch other than the default one until that branch reaches it, and a PR with a
prepared update that has not gone out.
