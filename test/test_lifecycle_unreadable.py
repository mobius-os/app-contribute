"""A stored `lifecycle` the machine cannot read is ignored, as the platform's reader ignores it (test/lifecycle-unreadable.test.mjs runs the same cases)."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import lifecycle_engine as engine  # noqa: E402
import lifecycle_job  # noqa: E402
import ledger_scan  # noqa: E402
from lifecycle_record import TABLES, regions_of, sendable_now, stored_vector, vector_of  # noqa: E402

CASES = json.loads((ROOT / "test" / "lifecycle-unreadable.cases.json").read_text())["cases"]


class UnreadableVector(unittest.TestCase):
  def test_a_stored_vector_is_kept_only_when_every_part_of_it_can_be_read(self) -> None:
    for item in CASES:
      with self.subTest(item["name"]):
        found = regions_of(item["record"], 100)
        flags = found["vector"]["attention"]["flags"]
        self.assertEqual({"publication": found["publication"], "update": found["update"], "flags": flags}, item["reads"])
        self.assertEqual(stored_vector(item["record"]) is not None, item["stored"])

  def test_an_unreadable_vector_never_fails_a_reader_and_the_one_read_from_the_facts_is_whole(self) -> None:
    for item in (entry for entry in CASES if not entry["stored"]):
      with self.subTest(item["name"]):
        vector = vector_of(item["record"], 100)
        self.assertEqual(sorted(vector["regions"]), ["followup", "publication", "update"])
        self.assertEqual(vector["history"][-1]["type"], "SEEDED")

  def test_a_record_with_no_lifecycle_at_all_is_read_from_its_facts_as_before(self) -> None:
    found = regions_of({"type": "pr", "status": "prepared", "plan": {"action": "pr"}}, 100)
    self.assertEqual((found["publication"], found["update"]), ("PREPARED", "NONE"))
    self.assertIsNone(stored_vector({"type": "pr"}))


NOW = 1763460000
# What a hand edit or a partial write may leave in a JSON file: every kind of value, the unhashable ones and a whole-valued float included.
JUNK = [None, True, False, 0, 1, -1, 2 ** 70, 1.5, 1763460000.0, "", "OPEN", "x", [], ["OPEN"], [1, [2]], {}, {"state": "OPEN"}, {"a": {"b": []}}]


def _valid() -> dict:
  return engine.new_vector(TABLES, {"publication": "OPEN", "update": "NONE", "followup": "OFF"}, NOW - 100)


def _paths(node: object, path: tuple = ()):
  """Every place in a vector: each container and each value, as the keys leading to it."""
  yield path
  if isinstance(node, dict):
    for key, value in node.items():
      yield from _paths(value, path + (key,))
  elif isinstance(node, list):
    for index, value in enumerate(node):
      yield from _paths(value, path + (index,))


_GONE = object()


def _damaged(vector: dict):
  """Every vector one edit away from `vector`: any one place replaced by any junk value, or removed."""
  for path in _paths(vector):
    if not path:
      yield from JUNK
      continue
    for junk in [*JUNK, _GONE]:
      copy = json.loads(json.dumps(vector))
      parent = copy
      for key in path[:-1]:
        parent = parent[key]
      if junk is _GONE:
        parent.pop(path[-1])
      else:
        parent[path[-1]] = junk
      yield copy


class StoredVectorNeverRaises(unittest.TestCase):
  """Every reader of a stored vector goes through `stored_vector`, so none of them can be stopped by what a record holds.

  A damaged vector must read as none (the record is then read from its facts), never abort the pass that reaches it:
  every record behind it would be skipped every 15 minutes until someone repaired the file.
  """
  def test_stored_vector_answers_a_vector_or_none_for_every_one_edit_damage(self) -> None:
    seen = 0
    for lifecycle in _damaged(_valid()):
      seen += 1
      found = stored_vector({"type": "pr", "status": "open", "lifecycle": lifecycle})
      self.assertTrue(found is None or isinstance(found, dict), repr(lifecycle))
    self.assertGreater(seen, 300)

  def test_every_job_side_reader_survives_the_same_damage(self) -> None:
    for lifecycle in _damaged(_valid()):
      record = {"id": "a", "type": "pr", "status": "open", "url": "https://github.com/o/r/pull/1", "plan": {"action": "pr"}, "lifecycle": lifecycle}
      with self.subTest(lifecycle=lifecycle):
        self.assertIsNotNone(lifecycle_job.engine_step(record, None, NOW))
        self.assertIsNotNone(vector_of(record, NOW))
        self.assertIsNotNone(regions_of(record, NOW))
        sendable_now(record, NOW)
        for reader in (lifecycle_job.watching_route, ledger_scan.summarize, ledger_scan.awaiting_publication_connection, ledger_scan.owes_finish):
          reader(record)
        lifecycle_job.is_polled(record, NOW)
        lifecycle_job.is_lean(record, NOW)
        plan = lifecycle_job.plan_record(record, None, NOW, "2025-11-18T00:00:00Z", {})
        self.assertIsNotNone(plan)
        # What the job stores in its place is a vector the engine reads.
        stored = plan["patch"].get("lifecycle")
        self.assertTrue(stored is None or stored_vector({**record, "lifecycle": stored}) is not None)

  def test_a_state_that_is_not_a_string_is_no_state(self) -> None:
    for state in ([], ["OPEN"], {}, {"OPEN": 1}, [["OPEN"]], 1, True, None):
      vector = _valid()
      vector["regions"]["publication"]["state"] = state
      self.assertIsNone(stored_vector({"type": "pr", "lifecycle": vector}), repr(state))

  def test_a_whole_valued_float_reads_as_the_javascript_reader_reads_it_and_a_fractional_one_is_refused_by_both(self) -> None:
    # JSON.parse cannot tell 1763460000.0 from 1763460000, so the Python reader must not refuse what JavaScript accepts.
    for since, readable in ((1763460000.0, True), (1763460000.5, False), (float("inf"), False), (float("nan"), False), (True, False)):
      vector = _valid()
      vector["regions"]["publication"]["since"] = since
      self.assertEqual(stored_vector({"type": "pr", "lifecycle": vector}) is not None, readable, repr(since))


if __name__ == "__main__":
  unittest.main()
