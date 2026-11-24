"""The Python interpreter against the shared lifecycle cases, and the lock that pins every copy."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import lifecycle_engine as engine  # noqa: E402
import lifecycle_tables  # noqa: E402

TABLES = lifecycle_tables.tables()
TEST = ROOT / "test"
LOCK = json.loads((TEST / "lifecycle.lock.json").read_text())
FILE = json.loads((TEST / "lifecycle.cases.json").read_text())


def sha256(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def start_of(start: dict | None) -> dict | None:
  if start is None:
    return None
  vector = engine.new_vector(TABLES, start["states"], start["now"], start["attention"])
  if start["flags"]:
    vector["attention"]["flags"] = list(start["flags"])
  for region, deadline in (start.get("deadlines") or {}).items():
    vector["regions"][region]["deadline"] = deadline
  return vector


def run(step: dict, vector: dict | None) -> dict | None:
  if step["op"] == "apply":
    return engine.apply(TABLES, vector, step["payload"], step["now"])
  if step["op"] == "tick":
    return engine.tick(TABLES, vector, step["now"])
  if step["op"] == "observe":
    return engine.observe(TABLES, vector, step["payload"], step["now"])
  return engine.adopt(TABLES, vector, step["payload"], step["now"])


class LifecycleLock(unittest.TestCase):
  def test_the_lock_pins_the_tables_the_cases_and_the_python_files(self) -> None:
    self.assertEqual(sha256(lifecycle_tables.canonical_json().encode()), LOCK["tables_sha256"])
    self.assertEqual(sha256((TEST / "lifecycle.cases.json").read_bytes()), LOCK["cases_sha256"])
    self.assertEqual(sha256((ROOT / "lifecycle_tables.py").read_bytes()), LOCK["tables_py_sha256"])
    self.assertEqual(sha256((ROOT / "lifecycle_engine.py").read_bytes()), LOCK["engine_py_sha256"])

  def test_the_generated_files_are_not_stale(self) -> None:
    done = subprocess.run([sys.executable, str(TEST / "make_lifecycle_cases.py")], capture_output=True, text=True)
    self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
    self.assertEqual((ROOT / "lifecycle-tables.js").read_text(), lifecycle_tables.javascript_module())

  def test_the_platform_copy_pins_the_same_lock_when_one_is_named(self) -> None:
    # Never by default: an installed platform of another version must not turn this suite red.
    sibling = os.environ.get("LIFECYCLE_PLATFORM_LOCK")
    if not sibling:
      self.skipTest("LIFECYCLE_PLATFORM_LOCK is not set")
    self.assertEqual(json.loads(Path(sibling).read_text()), LOCK)


class LifecycleEngine(unittest.TestCase):
  def test_the_tables_obey_their_own_rules(self) -> None:
    self.assertEqual(engine.check_tables(TABLES), [])

  def test_every_shared_case_gives_the_stored_answer_step_by_step(self) -> None:
    for case in FILE["cases"]:
      vector = start_of(case["start"])
      for index, step in enumerate(case["steps"]):
        with self.subTest(case=case["name"], step=index):
          result = run(step, vector)
          self.assertEqual(result, step["result"])
          if result is None:
            continue
          vector = result["vector"]
          self.assertEqual(engine.waiting_on(TABLES, vector), step["waiting"])
          if "publication" in vector["regions"]:
            self.assertEqual(engine.status_of(TABLES, vector), step["status"])

  def test_an_event_with_no_row_for_the_state_is_refused_and_changes_nothing(self) -> None:
    for region, state, kind in FILE["refusals"]:
      with self.subTest(region=region, state=state, event=kind):
        vector = engine.new_vector(TABLES, {region: state}, 1, False)
        result = engine.apply(TABLES, vector, {"type": kind, "source": "test"}, 2)
        self.assertEqual((result["refusal"] or {}).get("reason"), "no_transition")
        self.assertEqual(result["vector"]["regions"], vector["regions"])
        self.assertFalse(engine.allowed(TABLES, vector, kind))

  def test_every_publication_and_update_pair_has_the_stored_status_word(self) -> None:
    for publication, update, status in FILE["statuses"]:
      vector = engine.new_vector(TABLES, {"publication": publication, "update": update}, 1)
      self.assertEqual(engine.status_of(TABLES, vector), status)

  def test_the_engine_never_changes_what_it_was_given(self) -> None:
    vector = engine.new_vector(TABLES, {"publication": "OPEN", "update": None, "followup": "IDLE"}, 1)
    before = json.dumps(vector, sort_keys=True)
    engine.apply(TABLES, vector, {"type": "MERGED", "source": "github", "data": {"base_is_default": True}}, 2)
    engine.observe(TABLES, vector, {"pr": "CLOSED"}, 2)
    engine.adopt(TABLES, vector, {"status": "merged"}, 2)
    self.assertEqual(json.dumps(vector, sort_keys=True), before)

  def test_the_shown_flag_is_the_first_by_priority(self) -> None:
    vector = engine.new_vector(TABLES, {"publication": "OPEN"}, 1)
    self.assertIsNone(engine.shown_attention(vector))
    vector["attention"]["flags"] = ["checks_failed", "github_activity"]
    self.assertEqual(engine.shown_attention(vector), "checks_failed")


if __name__ == "__main__":
  unittest.main()
