"""Shadow mode: the lifecycle engine runs beside the job's own status logic and only takes notes.

Nothing here writes a contribution record or changes what the job does. Each pass, every
tracked record the job reads is brought through the engine (adopt, tick, and observe when the
job read GitHub); where the engine would have stored a different status word than the job, or
cannot explain a status another writer stored, one disagreement is logged. It also notes what the
engine-mode job WOULD do for records today's job does not poll (a recently closed PR, a merge into
a side branch, an update whose target settled), using only what the job already read: no extra
GitHub request. The notes live in the runner's per-app job-state folder, so losing them costs
nothing but history.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from typing import Callable

import lifecycle_engine as engine
import lifecycle_job
from job_github import default_branch_of
from lifecycle_record import TABLES, facts_of, level_of, tracked

STATE_FILE = "lifecycle-shadow.json"
SCHEMA = 1
DISAGREEMENT_LIMIT = 200


class Shadow:
  def __init__(self, state_dir: str | None, now: Callable[[], float] = time.time):
    self._path = os.path.join(state_dir, STATE_FILE) if state_dir else None
    self._now = now
    state = self._load()
    self.vectors: dict = state["vectors"]
    self.disagreements: list = state["disagreements"]
    self.would: list = state["would"]  # what the engine-mode job would do: not a disagreement, only a note
    self.noted: dict = state["noted"]  # what was already said once about a record, so it is not said every pass
    self._seen: set = set()

  def _load(self) -> dict:
    empty = {"schema": SCHEMA, "vectors": {}, "disagreements": [], "would": [], "noted": {}}
    if not self._path:
      return empty
    try:
      with open(self._path, encoding="utf-8") as handle:
        state = json.load(handle)
    except (OSError, ValueError):
      return empty
    usable = isinstance(state, dict) and state.get("schema") == SCHEMA and state.get("tables") == TABLES["version"]
    return {**empty, **state} if usable else empty

  def _note(self, record: dict, kind: str, **detail: object) -> None:
    entry = {"at": int(self._now()), "id": str(record.get("id") or ""), "kind": kind, **detail}
    self.disagreements = (self.disagreements + [entry])[-DISAGREEMENT_LIMIT:]

  def _would_note(self, record: dict, kind: str, **detail: object) -> None:
    entry = {"at": int(self._now()), "id": str(record.get("id") or ""), "kind": kind, **detail}
    self.would = (self.would + [entry])[-DISAGREEMENT_LIMIT:]

  def read(self, record: dict) -> None:
    """A record the job read this pass: explain its stored status, then let deadlines pass."""
    if not tracked(record) or not record.get("id"):
      return
    key, now = str(record["id"]), int(self._now())
    stored = self.vectors.get(key)
    result = engine.adopt(TABLES, stored, facts_of(record), now)
    if result is None:
      self.vectors.pop(key, None)
      return
    reseeded = [entry for entry in result["log"] if entry["type"] == "RESEEDED"]
    if reseeded:
      self._note(record, "unexplained_status", status=record.get("status"), was=reseeded[0]["from"], now=reseeded[0]["to"])
    ticked = lifecycle_job.engine_step({**record, "lifecycle": result["vector"]}, None, now)
    self.vectors[key] = ticked["vector"]
    self._seen.add(key)
    self._deadlines(record, result["vector"], ticked)
    self._would_poll(record, ticked["vector"], now)
    self._would_strand(record, ticked["vector"])

  def _once(self, record: dict, kind: str, signature: object, **detail: object) -> None:
    """Note something about a record once per signature: an unchanged answer is not repeated."""
    key = str(record.get("id") or "")
    if self.noted.get(key, {}).get(kind) == signature:
      return
    self.noted.setdefault(key, {})[kind] = signature
    self._would_note(record, kind, **detail)

  def _deadlines(self, record: dict, before: dict, ticked: dict) -> None:
    """A deadline that passed: what the engine-mode job would move, and what it would then do."""
    moves = [{"region": name, "from": before["regions"][name]["state"], "to": slot["state"]}
             for name, slot in ticked["vector"]["regions"].items() if before["regions"][name]["state"] != slot["state"]]
    if moves:
      self._once(record, "deadline", json.dumps(moves), moves=moves, effects=sorted({e["effect"] for e in ticked["effects"]}))

  def _would_poll(self, record: dict, vector: dict, now: int) -> None:
    """A record the engine-mode job reads from GitHub and today's job does not."""
    today = record.get("status") in ("draft", "open", "landing")
    if not today and lifecycle_job.is_polled(record, now, vector):
      regions = vector["regions"]
      self._once(record, "would_poll", regions["publication"]["state"] + "/" + regions["update"]["state"],
                 publication=regions["publication"]["state"], update=regions["update"]["state"])

  def _would_strand(self, record: dict, vector: dict) -> None:
    """An update waiting on a target the reconcile pass already saw settle: the engine would strand it."""
    probe = record.get("reconciliation_probe") if isinstance(record.get("reconciliation_probe"), dict) else {}
    state = str(probe.get("target_state") or "")
    update = vector["regions"]["update"]["state"]
    if update in lifecycle_job.POLLED_UPDATE and state == "closed":
      self._once(record, "would_strand", state, target_state=state, update=update)

  def backfilled(self, record: dict, node: object) -> None:
    """The one-time sweep read this finished PR: what GitHub shows is applied as an inferred move."""
    self.read(record)
    key = str(record.get("id") or "")
    level = level_of(node, default_branch_of(node))
    if key not in self.vectors or level is None:
      return
    self.vectors[key] = engine.observe(TABLES, self.vectors[key], level, int(self._now()))["vector"]
    states = {name: slot["state"] for name, slot in self.vectors[key]["regions"].items()}
    self._would_note(record, "backfill", states=states, level=level, inferred=True)

  def observed(self, record: dict, node: object, written_status: object, default_branch: str | None = None) -> None:
    """The job read GitHub for this record and left `written_status` on it."""
    key = str(record.get("id") or "")
    level = level_of(node, default_branch or default_branch_of(node))
    if key not in self.vectors or level is None:
      return
    vector = engine.observe(TABLES, self.vectors[key], level, int(self._now()))["vector"]
    self.vectors[key] = vector
    mine = engine.status_of(TABLES, vector, written_status)
    if mine != written_status:
      states = {name: slot["state"] for name, slot in vector["regions"].items()}
      self._note(record, "status", job=written_status, engine=mine, states=states, level=level)

  def _kept(self) -> dict:
    """A settled record the job no longer reads needs no shadow."""
    def settled(vector: dict) -> bool:
      return not engine.waiting_on(TABLES, vector) and all(
        TABLES["regions"][name]["states"][slot["state"]]["final"] or name != "publication"
        for name, slot in vector["regions"].items())
    return {key: vector for key, vector in self.vectors.items() if key in self._seen or not settled(vector)}

  def save(self) -> None:
    if not self._path:
      return
    kept = self._kept()
    state = {"schema": SCHEMA, "tables": TABLES["version"], "vectors": kept, "disagreements": self.disagreements,
             "would": self.would, "noted": {key: said for key, said in self.noted.items() if key in kept}}
    folder = os.path.dirname(self._path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=".lifecycle-shadow-")
    try:
      with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
      os.replace(tmp, self._path)
    except BaseException:
      try:
        os.unlink(tmp)
      except OSError:
        pass
      raise
