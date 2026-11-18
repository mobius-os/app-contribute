"""One-time sweep of the attention left on finished pull requests.

Before the lifecycle, only a transition the job itself made emptied a record's attention slots, so
merged and closed records the job never read again kept a flag (the platform's follow-up grant too).
Once, in bounded batches, each such record is read, its leftover slots are emptied and, in engine
mode, its seeded lifecycle is stored. It sends NO notification and takes no other action than the
follow-up close-out a leftover grant needs (the engine's PR_FINISHED rule: grant off, chat hidden).

Its one batched GitHub read asks the state and base branch of those PRs, so a closed PR that was
reopened or a merge into a side branch is found; what it shows is applied as an inferred
move. State lives in the runner's per-app `APP_JOB_STATE_DIR`: a marker with the records done and
whether the sweep is over. Losing it repeats a sweep that finds nothing left to clear.

No record can hold the sweep up: one whose read or write fails (no storage version, a permanent
refusal) is tried on `FAILED_PASSES` passes, then marked done with the error kept in the marker and
skipped, so it neither starves the records behind it nor costs a read every pass.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.parse
from typing import Any, Callable

import lifecycle_job
from job_github import PR_EXTRA_FIELDS, saved_fields
from ledger_scan import FINISHED_STATUSES, PREFIX, has_attention_leftover

STATE_FILE = "lifecycle-backfill.json"
SCHEMA = 1
LIMIT = 25  # records per pass: a bounded cost; a longer backlog finishes on the next passes
FAILED_PASSES = 3  # a record that fails this many passes is given up on (marked done with its error)

Call = Callable[..., tuple[bytes, Any]]


def _query(items: list[tuple[str, dict]]) -> str:
  parts = [
    "b%d: resource(url: %s) { __typename ... on PullRequest { state isDraft %s} ... on Issue { state } }"
    % (index, json.dumps(record["url"]), PR_EXTRA_FIELDS)
    for index, (_name, record) in enumerate(items)
  ]
  return "query { " + " ".join(parts) + " }" if parts else ""


def _read_github(query: str) -> dict:
  """The answer's `data`, or {} when GitHub cannot be read (the sweep then clears without the read)."""
  if not query:
    return {}
  try:
    out = subprocess.run(["gh", "api", "graphql", "-f", "query=" + query], capture_output=True, text=True, timeout=30)
    return (json.loads(out.stdout) or {}).get("data") or {} if out.returncode == 0 else {}
  except Exception:
    return {}


class Backfill:
  def __init__(self, call: Call, app_id: str, state_dir: str | None, engine: bool, now: int, now_iso: str,
               shadow: Any = None):
    self._call, self._app_id, self._engine = call, app_id, engine
    self._now, self._now_iso, self._shadow = now, now_iso, shadow
    self._path = os.path.join(state_dir, STATE_FILE) if state_dir else None
    self.state = self._load()
    self.cleared: list[str] = []
    # What the sweep wrote, with the version the write returned: the job keeps these records in this
    # pass (their terminal cleanup and app connection must not wait a pass) instead of the stale ones.
    self.refreshed: dict[str, tuple[dict, str | None]] = {}

  def _load(self) -> dict:
    empty = {"schema": SCHEMA, "done": {}, "complete": False, "failed": {}}
    try:
      with open(self._path, encoding="utf-8") as handle:
        state = json.load(handle)
    except (OSError, ValueError, TypeError):
      return empty
    usable = isinstance(state, dict) and state.get("schema") == SCHEMA and isinstance(state.get("done"), dict)
    return {"failed": {}, **state} if usable else empty

  def _save(self) -> None:
    if not self._path:
      return
    folder = os.path.dirname(self._path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".lifecycle-backfill-")
    try:
      with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(self.state, handle)
      os.replace(tmp, self._path)
    except BaseException:
      try:
        os.unlink(tmp)
      except OSError:
        pass
      raise

  def _read(self, name: str) -> tuple[dict | None, str | None]:
    path = "/api/storage/apps/%s/%s%s" % (self._app_id, PREFIX, name)
    try:
      raw, headers = self._call("GET", path, headers={"x-mobius-version": "1"})
      record = json.loads(raw)
    except (urllib.error.URLError, OSError, ValueError):
      return None, None
    return (record if isinstance(record, dict) else None), headers.get("ETag")

  def _write(self, name: str, record: dict, etag: str | None) -> tuple[bool, str | None]:
    """Compare-and-swap; `updated_at` stays, so a finished record does not jump back up the history.

    (written, the version the write returned).
    """
    if not etag:
      return False, None
    path = "/api/storage/apps/%s/%s%s" % (self._app_id, PREFIX, name)
    try:
      _, headers = self._call("PUT", path, record, headers={"If-Match": etag})
    except (urllib.error.URLError, OSError):
      return False, None  # a lost race (412) or a failure: this record is tried again next pass
    return True, headers.get("ETag") if headers else None

  def _close_out(self, record: dict) -> None:
    path = "/api/github/contributions/%s/%s/cleanup-staging" % (
      self._app_id, urllib.parse.quote(str(record.get("id") or ""), safe=""))
    try:
      self._call("POST", path, {})
    except Exception:
      pass  # the next pass of the ordinary cleanup asks again

  def _patch(self, record: dict, node: Any) -> tuple[dict, bool]:
    """(patch, close out the grant). Engine mode stores the seeded lifecycle and what the read shows."""
    emptied = lifecycle_job.emptied_attention(record, {})
    if not self._engine:
      if self._shadow is not None:
        self._shadow.backfilled(record, node)
      return emptied, False
    plan = lifecycle_job.plan_record(record, node, self._now, self._now_iso, emptied)
    if plan is None:
      return emptied, False
    return plan["patch"], any(action["do"] == "cleanup" for action in plan["actions"])

  def _remembered(self, record: dict, patch: dict, node: Any) -> dict:
    """GitHub's head and base ride along (a merge into a side branch is later resolved from its base)."""
    found = saved_fields({**record, **patch}, node)
    return {key: value for key, value in found.items() if key in ("github_head_sha", "github_base_ref")}

  def run(self, names: list[str]) -> None:
    if self.state.get("complete"):
      return
    todo = [name for name in names if name not in self.state["done"]][:LIMIT]
    if not todo:
      self.state["complete"] = True
      self._save()
      return
    found = [(name, *self._read(name)) for name in todo]
    watch = [(name, record) for name, record, _etag in found
             if record and record.get("status") in FINISHED_STATUSES and isinstance(record.get("url"), str)]
    data = _read_github(_query(watch))
    aliases = {name: "b%d" % index for index, (name, _record) in enumerate(watch)}
    for name, record, etag in found:
      self._one(name, record, etag, data.get(aliases.get(name)))
    self.state["complete"] = all(name in self.state["done"] for name in names)
    self._save()
    if self._shadow is not None:
      self._shadow.save()

  def _failed(self, name: str, why: str) -> None:
    """This pass did not settle the record. After FAILED_PASSES of them it is marked done, the error
    kept in the marker, so it cannot hold up the records behind it (the first LIMIT undone names)."""
    failed = self.state.setdefault("failed", {})
    count = int((failed.get(name) or {}).get("passes") or 0) + 1
    failed[name] = {"passes": count, "why": why}
    if count >= FAILED_PASSES:
      self.state["done"][name] = self._now

  def _one(self, name: str, record: dict | None, etag: str | None, node: Any) -> None:
    if record is None:
      return self._failed(name, "unreadable")
    if record.get("status") not in FINISHED_STATUSES or not has_attention_leftover(record):
      self.state["done"][name] = self._now  # someone else already settled it
      return
    patch, close_out = self._patch(record, node)
    written = {**record, **patch}
    if patch:
      patch = {**patch, **self._remembered(record, patch, node)}
      if (patch.get("lifecycle") or {}).get("regions", {}).get("publication", {}).get("state") == "MERGED_ELSEWHERE":
        patch["merged_announced"] = True  # the old job already told the owner it shipped: not a second time
      written = {**record, **patch}
      ok, version = self._write(name, written, etag)
      if not ok:
        return self._failed(name, "write refused" if etag else "no storage version")
      self.refreshed[name] = (written, version)
    if close_out:
      self._close_out(record)
    self.state["done"][name] = self._now
    self.cleared.append(name)
