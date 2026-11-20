"""What the scheduled job asks GitHub for the lifecycle, and what it reads out of the answer.

One batched GraphQL document answers every pull request the job follows (about one rate-limit
point). The fields here ride in that same document: nothing in this module makes a request. If
GitHub rejects that document the job asks once more with only the fields it always asked
(`PR_EXTRA_FIELDS` and `VIEWER_FIELD` left out), so alerts, attention and notices still run and
the lifecycle's newer states simply see "not known".

What GitHub's answer is allowed to change on a record that was sent (`saved_fields`). The
version the owner reviewed and approved is never rewritten: `plan.head_sha`,
`quality_review.reviewed_head_sha` and `last_submit_push_sha` stay exactly as sent, because the
platform's approval digest, the reviewed-head ancestry check, the Ready button's expected head and
the app's approval fingerprint all bind to them. Four fields follow GitHub, and only inside a write
the job already makes (never a write of its own):

- `github_head_sha` and `github_base_ref`: new fields no check reads as "the approved version" (they
  are not among the platform's PUBLICATION_APPROVAL_FIELDS). They hold GitHub's own head, which the
  attention keys use (a push made outside Möbius changes the key), and the branch a merge went into,
  which the side-branch route lookup needs. Safe because nothing is compared against them.
- `publication_stage` and `title`: both ARE in the approval digest, so they follow GitHub only while
  the record's status is settled (draft, open, landing, merged, closed) and its last send is not
  unconfirmed: then no send of this record can be waiting on an approval of them. They are the PR's
  real stage and title. At worst a stack Send that compares public rows, or Mark ready, sees the change
  and refuses with `approval_changed`: a refusal, never a widening.

A write that holds only the job's own books (`BOOKKEEPING` and `FOLLOWS_GITHUB` in job.sh: the
lifecycle, the two github_* fields, the told-once markers, and the two details above) never decides
whether an attention is delivered: if it fails, the delivery due before it still runs in that pass.
"""
from __future__ import annotations

import json
from typing import Any

from lifecycle_record import facts_of

# Added to every PullRequest selection: the base branch and the repository's default branch decide
# whether a merge shipped, the queue entry says `queued`, the head is GitHub's own.
PR_EXTRA_FIELDS = (
  "headRefOid baseRefName title mergedAt mergeQueueEntry { id } "
  "repository { defaultBranchRef { name } } "
)
VIEWER_FIELD = "viewer { login } "
# Statuses at which nothing waits on a person's approval of this record's own fields.
SETTLED_STATUSES = ("draft", "open", "landing", "merged", "closed")


def _text(value: Any) -> str:
  return value.strip() if isinstance(value, str) else ""


def default_branch_of(node: Any) -> str | None:
  """The repository's default branch as this read reported it, or None when it did not ask."""
  repository = node.get("repository") if isinstance(node, dict) else None
  ref = repository.get("defaultBranchRef") if isinstance(repository, dict) else None
  name = _text(ref.get("name")) if isinstance(ref, dict) else ""
  return name or None


def viewer_login(data: Any) -> str:
  viewer = data.get("viewer") if isinstance(data, dict) else None
  return _text(viewer.get("login")) if isinstance(viewer, dict) else ""


def saved_fields(record: dict, node: Any) -> dict:
  """What a PR read says about the details saved when it was sent, for a write already being made.

  `record` is the record as it will be stored (the job's patch applied), so a PR that just merged is
  judged by its new status. The four fields that follow GitHub, and why each is safe, are listed in
  the module docstring; the sent version (`plan.head_sha`, `quality_review.reviewed_head_sha`,
  `last_submit_push_sha`) is never among them. Only values that differ are returned.
  """
  if not isinstance(node, dict) or node.get("__typename") != "PullRequest":
    return {}
  found = {"github_head_sha": _text(node.get("headRefOid")), "github_base_ref": _text(node.get("baseRefName"))}
  if record.get("status") in SETTLED_STATUSES and not facts_of(record)["unconfirmed"]:
    found["publication_stage"] = "draft" if node.get("isDraft") else "ready"
    found["title"] = _text(node.get("title"))
  return {key: value for key, value in found.items() if value and record.get(key) != value}


def lean_alias(alias: str, url: str, extended: bool = True) -> str:
  """A finished PR needs no comments, reviews or checks: its state, stage and base say all there is.

  `extended=False` is the read made after GitHub rejected the newer fields: the state and stage only.
  """
  return ("%s: resource(url: %s) { __typename ... on PullRequest { state isDraft updatedAt %s} "
          "... on Issue { state updatedAt } }" % (alias, json.dumps(url), PR_EXTRA_FIELDS if extended else ""))


def route_alias(alias: str, repo: str, branch: str) -> str:
  """The pull requests whose head branch is `branch`: the parent a side-branch merge waits for."""
  owner, _, name = repo.partition("/")
  return (
    "%s: repository(owner: %s, name: %s) { pullRequests(headRefName: %s, first: 5, "
    "orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { state baseRefName mergedAt } } }"
    % (alias, json.dumps(owner), json.dumps(name), json.dumps(branch))
  )


def parents_of(answer: Any) -> list | None:
  """The parent PRs a route read returned; None when the read failed (that decides nothing)."""
  repository = answer if isinstance(answer, dict) else None
  pulls = repository.get("pullRequests") if repository else None
  nodes = pulls.get("nodes") if isinstance(pulls, dict) else None
  return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else None


def _landed(parent: dict, default_branch: str) -> bool:
  """A parent that reached the default branch (with the time it did)."""
  return bool(parent.get("state") == "MERGED" and parent.get("baseRefName") == default_branch and parent.get("mergedAt"))


def route_resolution(merged_at: str, default_branch: str, parents: list | None) -> dict | None:
  """ROUTE_RESOLVED data for a PR merged into another branch, or None while the answer is "not yet".

  The change reached the default branch only if a parent branch did so AFTER this merge: any such
  parent decides "after", whatever older merges the same branch (develop, a reused stack branch) had
  before. "before" is only for the case that every parent that landed did so earlier and none is
  still open or on its way into yet another side branch; "dropped" is for parents that all closed
  unmerged. No PR with that head branch yet is "not yet", not "dropped": the maintainer may open it
  next week, and the engine's 14-day deadline covers silence.
  """
  if parents is None or not default_branch or not merged_at:
    return None
  landed = [p for p in parents if _landed(p, default_branch)]
  if any(p["mergedAt"] > merged_at for p in landed):
    return {"reached": "after"}
  if any(p.get("state") in ("OPEN", "MERGED") and p not in landed for p in parents):
    return None  # still on its way: open, or merged into yet another side branch
  if landed:
    return {"reached": "before"}
  return {"reached": "dropped"} if parents else None
