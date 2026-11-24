"""Record the owner's exit from a finished pull request that still waits on them.

A finished PR can keep a question open. An update prepared for it can no longer go out (its `update` region is STRANDED_UPDATE), or it was merged
into a branch that never reached the default branch (its `publication` region is ORPHANED). Both are in Needs you, on the record, until the
owner settles them, and the exits are the lifecycle tables' own events. The record's buttons in Contribute make the two that need no new record
(COVERED_BY_MERGE, DISCARD_UPDATE); this makes all four, for the agent that did the work the owner chose:

  python3 settle_exit.py <record-id> COVERED_BY_MERGE
  python3 settle_exit.py <record-id> DISCARD_UPDATE
  python3 settle_exit.py <record-id> PRESERVE_AS_NEW --successor <the new record's id>
  python3 settle_exit.py <record-id> OWNER_RELANDS --successor <the new record's id>

It is the Python twin of lifecycle-write.js `settleRecord` (test/lifecycle-settle.cases.json holds the cases both must answer the same way), and
it writes as every other writer of a record does: read the version, change the record as it is now, write it back only if it still is that version.
Exit 0 and one line: saved. Exit 2: the record does not allow that exit (not held, or a successor missing, equal to the record itself or not in the
ledger). Exit 3: the record changed under the write (read it again and run it again), or Möbius could not be reached.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable

import lifecycle_engine as engine
from lifecycle_job import settled_request
from lifecycle_record import TABLES, vector_of

PREFIX = "contributions/"
RECORD_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
# Where each exit is stored is explained in lifecycle-write.js `EXITS`; the two sides keep the same words.
EXITS = {
  "COVERED_BY_MERGE": {"note": "The merged pull request already contained these changes."},
  "PRESERVE_AS_NEW": {"successor": True},
  "DISCARD_UPDATE": {},
  "OWNER_RELANDS": {"successor": True},
}
Call = Callable[..., tuple[bytes, Any]]


class Refused(Exception):
  """The record does not allow this exit: nothing was written."""


class Changed(Exception):
  """The record changed under the write, or Möbius could not be asked."""


def settle_record(record: dict, exit_name: str, successor: str = "", now: int | None = None, iso: str | None = None) -> dict | None:
  """The record after the owner settles it by `exit_name`, or None when its state does not accept that exit."""
  rule = EXITS.get(exit_name)
  now = int(time.time()) if now is None else now
  vector = vector_of(record, now) if rule is not None else None
  if vector is None or (rule.get("successor") and (not RECORD_ID.match(successor or "") or successor == record.get("id"))):
    return None
  step = engine.apply(TABLES, vector, {"type": exit_name, "source": "owner"}, now)
  if step["refusal"]:
    return None
  iso = iso or datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
  outcome = {"superseded_by": successor} if exit_name == "OWNER_RELANDS" else {
    "update_outcome": {"exit": exit_name, "at": iso, **({"note": rule["note"]} if "note" in rule else {}),
                       **({"successor": successor} if rule.get("successor") else {})}}
  settled = {**record, **outcome, "lifecycle": step["vector"], "status": engine.status_of(TABLES, step["vector"], record.get("status")),
             "updated_at": iso}
  if record.get("stranded_reminded_at"):
    settled["stranded_reminded_at"] = None
  if settled_request(settled, step["vector"]):
    settled.update(needs_attention=False, attention=None)
  return settled


def _path(app_id: str, record_id: str) -> str:
  return "/api/storage/apps/%s/%s%s.json" % (app_id, PREFIX, urllib.parse.quote(record_id, safe=""))


def _read(call: Call, app_id: str, record_id: str) -> tuple[dict | None, str | None]:
  try:
    raw, headers = call("GET", _path(app_id, record_id), headers={"x-mobius-version": "1"})
  except urllib.error.HTTPError as error:
    if error.code == 404:
      return None, None
    raise
  record = json.loads(raw)
  return (record if isinstance(record, dict) else None), headers.get("ETag")


def settle(call: Call, app_id: str, record_id: str, exit_name: str, successor: str = "", now: int | None = None) -> dict:
  """Read the record, settle it, write it back only if it is still the version read. Returns the stored record."""
  record, etag = _read(call, app_id, record_id)
  if record is None or not etag:
    raise Refused("There is no record %s." % record_id)
  if successor and _read(call, app_id, successor)[0] is None:
    raise Refused("There is no record %s to take over from it." % successor)
  settled = settle_record(record, exit_name, successor, now)
  if settled is None:
    raise Refused("Record %s does not accept %s now (it must be a finished pull request that waits on you for this, with a successor where one is needed)." % (record_id, exit_name))
  try:
    call("PUT", _path(app_id, record_id), settled, headers={"If-Match": etag})
  except urllib.error.HTTPError as error:
    if error.code == 412:
      raise Changed("Record %s changed while this ran. Nothing was written; run it again." % record_id) from error
    raise
  return settled


def _http_call(method: str, path: str, body: Any = None, headers: dict | None = None) -> tuple[bytes, Any]:
  api = os.environ.get("API_BASE_URL", "http://localhost:8000").rstrip("/")
  request_headers = {"Authorization": "Bearer " + os.environ["AGENT_TOKEN"], **(headers or {})}
  data = None if body is None else json.dumps(body).encode("utf-8")
  if data is not None:
    request_headers["Content-Type"] = "application/json"
  with urllib.request.urlopen(urllib.request.Request(api + path, data=data, headers=request_headers, method=method), timeout=30) as response:
    return response.read(), response.headers


def contribute_app_id(call: Call) -> str:
  raw, _ = call("GET", "/api/apps/")
  apps = [app for app in json.loads(raw) if app.get("slug") == "contribute"]
  if len(apps) != 1:
    raise Refused("Contribute is not installed, or more than one app has its slug.")
  return str(apps[0]["id"])


def main(argv: list[str] | None = None, call: Call = _http_call) -> int:
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("record_id")
  parser.add_argument("exit", choices=sorted(EXITS))
  parser.add_argument("--successor", default="", help="the id of the record the work went on in (PRESERVE_AS_NEW, OWNER_RELANDS)")
  args = parser.parse_args(argv)
  try:
    settled = settle(call, contribute_app_id(call), args.record_id, args.exit, args.successor)
  except Refused as error:
    print(str(error), file=sys.stderr)
    return 2
  except (Changed, urllib.error.URLError, OSError) as error:
    print(str(error), file=sys.stderr)
    return 3
  print("Saved: %s is now %s (%s)." % (args.record_id, settled["status"], args.exit))
  return 0


if __name__ == "__main__":
  sys.exit(main())
