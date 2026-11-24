"""What the lifecycle engine needs to know about a stored contribution record or a GitHub read.

The engine works on facts and levels, not on records: this is the one place that reads the
ledger's field names. `lifecycle-record.js` is the same reader for the app's screens.
"""
from __future__ import annotations

import time

import lifecycle_engine as engine
import lifecycle_tables

TABLES = lifecycle_tables.tables()
TRACKED_TYPES = ("pr", "issue")
UNSETTLED_SUBMIT_STAGES = ("push_pending", "push_ambiguous")
UNCONFIRMED_SUBMIT_CODES = ("publication_unconfirmed", "update_unconfirmed", "create_unconfirmed", "push_ambiguous")


def tracked(record: dict) -> bool:
  """Comment records have no life on GitHub to follow."""
  return isinstance(record, dict) and record.get("type") in TRACKED_TYPES


def _unconfirmed(record: dict) -> bool:
  """The last send's outcome is not known: the same rule as domain.js `lastSendUnconfirmed`.

  A `pushed` stage with an error counts only when that push is the version the plan sends now.
  The platform keeps `pushed` and the old push sha across a restage, so a refusal of the new
  version is not a lost send. An absent sha, or a plan with no head, cannot say otherwise.
  """
  stage = record.get("last_submit_stage")
  return (stage in UNSETTLED_SUBMIT_STAGES
          or record.get("last_submit_error_code") in UNCONFIRMED_SUBMIT_CODES
          or (stage == "pushed" and bool(record.get("last_submit_error")) and _pushed_current_version(record)))


def _sha(value: object) -> str:
  return str(value if value is not None else "").strip().lower()


def _pushed_current_version(record: dict) -> bool:
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  pushed, head = _sha(record.get("last_submit_push_sha")), _sha(plan.get("head_sha"))
  return not pushed or not head or pushed == head


def _following(record: dict) -> str:
  """The follow-up grant as the record mirrors it."""
  block = record.get("autopilot")
  if not isinstance(block, dict):
    return "off"
  if not block.get("enabled"):
    return "paused"
  return block.get("state") if block.get("state") in ("responding", "blocked") else "idle"


def facts_of(record: dict) -> dict:
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  return {
    "status": record.get("status"),
    "is_update": plan.get("action") == "pr_update",
    "has_pr": bool(record.get("url") or record.get("number")),
    "unconfirmed": _unconfirmed(record),
    "following": _following(record),
  }


# The regions a contribution record's vector holds; the others live on their own host objects (a respond result, a review, a run).
RECORD_REGIONS = frozenset(name for name, region in TABLES["regions"].items() if region["host"] == "record")


def _whole(value: object) -> bool:
  """Whole seconds. A float that is a whole number counts as it does in the JavaScript reader, which cannot tell 1763460000.0 from
  1763460000 once the JSON is parsed; a fractional second, a boolean and NaN count in neither."""
  if isinstance(value, bool):
    return False
  return isinstance(value, int) or (isinstance(value, float) and value.is_integer())


def _slot_readable(name: str, slot: object) -> bool:
  """A region slot the engine can read: a state the tables know, and times it can compare.

  A deadline belongs to a state that has a deadline rule. One on any other state comes from tables
  this copy does not have (the version may not have moved), so the whole vector is read as none.
  """
  states = TABLES["regions"][name]["states"]
  # A state that is not a string (a list or an object in a hand-edited file) is no state: looking it up in a dict would raise.
  if not isinstance(slot, dict) or not isinstance(slot.get("state"), str) or slot["state"] not in states:
    return False
  deadline = slot.get("deadline")
  timed = deadline is None or (_whole(deadline) and bool(states[slot["state"]].get("deadline")))
  return _whole(slot.get("since")) and timed


def stored_vector(record: dict) -> dict | None:
  """The record's stored vector when the engine can read all of it, else None.

  The field is the record's own to edit: a hand edit or a partial write may leave anything in it,
  and a vector of another table version means other states. One the engine cannot read is not
  repaired and not trusted: the record is read as if it had none, from its facts (the platform's
  reader does the same, so the two agree).
  """
  stored = record.get("lifecycle")
  if not isinstance(stored, dict) or stored.get("v") != TABLES["version"]:
    return None
  regions, attention = stored.get("regions"), stored.get("attention")
  if not isinstance(regions, dict) or set(regions) != RECORD_REGIONS:
    return None
  if not all(_slot_readable(name, slot) for name, slot in regions.items()):
    return None
  history = stored.get("history") or []
  history_ok = isinstance(history, list) and all(isinstance(entry, dict) for entry in history)
  attention_ok = attention is None or (isinstance(attention, dict) and isinstance(attention.get("flags"), list))
  return stored if history_ok and attention_ok else None


def vector_of(record: dict, now: int) -> dict | None:
  """The record's lifecycle as it stands now: the stored vector brought in line with the
  status word another writer may have stored, with every passed deadline applied. None for a
  record the machine does not track. Nothing is written; the caller decides whether to store it.
  """
  if not tracked(record):
    return None
  adopted = engine.adopt(TABLES, stored_vector(record), facts_of(record), now)
  return engine.tick(TABLES, adopted["vector"], now)["vector"] if adopted else None


def level_of(node: object, default_branch: str | None = None) -> dict | None:
  """A GitHub GraphQL PullRequest or Issue node as the level the engine observes.

  None means the read decides nothing (deleted, inaccessible, another type). A field the query
  did not ask for stays None, which the tables read as "not known".
  """
  if not isinstance(node, dict) or node.get("__typename") not in ("PullRequest", "Issue"):
    return None
  if node.get("state") not in ("OPEN", "CLOSED", "MERGED"):
    return None
  base = node.get("baseRefName")
  return {
    "pr": node["state"],
    "is_draft": bool(node.get("isDraft")),
    "queued": None if "mergeQueueEntry" not in node else node["mergeQueueEntry"] is not None,
    "base_is_default": None if not (base and default_branch) else base == default_branch,
  }


# ---- Selectors: what a screen or a card asks of a record. The Python twin of lifecycle-record.js
# (only the ones the printed card needs). Each reads the regions, never the status word.
PUBLIC = ("DRAFT", "OPEN", "QUEUED")


def _seconds(now: int | None) -> int:
  return int(time.time()) if now is None else now


def regions_of(record: dict, now: int | None = None) -> dict | None:
  """{"publication", "update", "vector"} for a record, or None for one the machine does not track."""
  vector = vector_of(record, _seconds(now))
  if vector is None:
    return None
  regions = vector["regions"]
  return {"publication": regions["publication"]["state"], "update": regions["update"]["state"], "vector": vector}


def stranded_update(record: dict, now: int | None = None) -> bool:
  """The PR merged or closed before the update went out."""
  found = regions_of(record, now)
  return bool(found) and found["update"] == "STRANDED_UPDATE"


def sendable_now(record: dict, now: int | None = None) -> bool:
  """The record's own state lets it be sent now: a private record waiting to be sent, or a public
  PR with an update waiting, with no attention flag and no refusal or send error saved on it.
  An unconfirmed send is neither (its regions are UNCERTAIN, never PREPARED). The review of the
  exact version is the caller's check: the lifecycle does not know it."""
  found = regions_of(record, now)
  if not found:
    return False
  waiting = found["publication"] == "PREPARED" or (found["publication"] in PUBLIC and found["update"] == "PREPARED_UPDATE")
  flags = (found["vector"].get("attention") or {}).get("flags") or []
  return bool(waiting and not flags and record.get("needs_attention") is not True and not record.get("last_submit_error"))
