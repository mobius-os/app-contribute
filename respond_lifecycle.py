"""The helper's stamp of a post: the optional `lifecycle` key of a saved Respond-to-feedback result.

Region `respond` of lifecycle_tables.py. The result file belongs to the helper alone (respond-result.md), so the helper is the one
that knows when a post began and when it last completed a step. It writes that down as a vector, and the app reads the vector and
applies the deadline when it loads the answer (respond-lifecycle.js): a post with no progress for 3 minutes (a restart in the
middle of it, a chat that died) is FAILED, and Try again asks the owner again and skips every step that has a receipt.

Nothing here decides whether a post may run. That stays the owner's approval, the digest and the PR (respond_result.py).
"""
from __future__ import annotations

import time

import lifecycle_engine as engine
import lifecycle_tables

TABLES = lifecycle_tables.tables()
REGION = "respond"

# THE TABLE, both directions: the helper's `state` word and the region states it can be in. The app's table (RESPOND_WORDS in
# respond-lifecycle.js) is the full one, with the owner's decision beside it; test/respond-lifecycle.cases.json pins the two together.
STATE_WORDS = {
  "READY": "ready", "APPROVED": "ready", "NOT_STARTED": "ready", "DISCARDED": "ready", "OUT_OF_DATE": "ready",
  "POSTING": "posting", "FAILED": "failed", "POSTED": "posted",
}
WORD_STATES = {"ready": "READY", "posting": "POSTING", "failed": "FAILED", "posted": "POSTED"}

# Starting a post is, in the tables, the owner's approval (the helper has just checked it) and then the chat starting. Which of the
# two are still to come depends on where the stamp stands: a resumed post only counts as progress.
_START = {
  "READY": (("APPROVE", "owner"), ("CHAT_STARTED", "agent")),
  "FAILED": (("APPROVE", "owner"), ("CHAT_STARTED", "agent")),
  "APPROVED": (("CHAT_STARTED", "agent"),),
  "NOT_STARTED": (("CHAT_STARTED", "agent"),),
  "POSTING": (("PROGRESS", "agent"),),
}
_TARGET = {"BEGIN": "POSTING", "PROGRESS": "POSTING", "POST_OK": "POSTED", "POST_FAILED": "FAILED"}


def now_seconds() -> int:
  return int(time.time())


def _state(vector: dict) -> str:
  return vector["regions"][REGION]["state"]


def _stored(result: dict, now: int) -> dict:
  """The result's stamp after the lazy tick, or a fresh vector in the state its words name when there is none, it is not this
  table's, or it contradicts the words (an older helper moved the state word without a stamp)."""
  stamp = result.get("lifecycle")
  slot = stamp.get("regions", {}).get(REGION) if isinstance(stamp, dict) and isinstance(stamp.get("regions"), dict) else None
  words = WORD_STATES.get(result.get("state"), "READY")
  usable = (isinstance(slot, dict) and stamp.get("v") == TABLES["version"] and STATE_WORDS.get(slot.get("state")) == result.get("state")
            and isinstance(slot.get("since"), int) and isinstance(stamp.get("history", []), list))
  vector = stamp if usable else engine.new_vector(TABLES, {REGION: words}, now, attention=False)
  return engine.tick(TABLES, vector, now)["vector"]


def stamp(result: dict, kind: str, now: int | None = None) -> None:
  """Record one move of the post on the result (the caller writes the file): BEGIN (the post starts or resumes), PROGRESS (a step
  went out, so the 3 minutes start again), POST_OK or POST_FAILED. Call it BEFORE the `state` word changes: the old stamp is only
  trusted while it agrees with the word. A move the table does not allow is not trusted: the stamp is replaced by a fresh one in
  the state the move names."""
  now = now_seconds() if now is None else now
  vector = _stored(result, now)
  moves = _START.get(_state(vector), ()) if kind == "BEGIN" else ((kind, "agent"),)
  for event, source in moves:
    vector = engine.apply(TABLES, vector, {"type": event, "source": source}, now)["vector"]
  if _state(vector) != _TARGET[kind]:
    vector = engine.new_vector(TABLES, {REGION: _TARGET[kind]}, now, attention=False)
  result["lifecycle"] = vector
