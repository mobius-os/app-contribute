"""Shadow mode takes notes beside the job and never changes a record."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import lifecycle_shadow  # noqa: E402
from lifecycle_record import facts_of, level_of, tracked, vector_of  # noqa: E402

CASES = json.loads((ROOT / "test" / "lifecycle-record.cases.json").read_text())["cases"]
OPEN_PR = {"id": "one", "type": "pr", "status": "open", "url": "https://github.com/o/r/pull/1", "number": 1}


def node(state: str, **more: object) -> dict:
  return {"__typename": "PullRequest", "state": state, "isDraft": False, **more}


class Clock:
  def __init__(self) -> None:
    self.now = 1_000_000.0

  def __call__(self) -> float:
    return self.now


class RecordReader(unittest.TestCase):
  def test_the_facts_of_a_record_are_the_ones_the_javascript_reader_gives(self) -> None:
    for case in CASES:
      with self.subTest(case["name"]):
        self.assertEqual(facts_of(case["record"]), case["facts"])

  def test_only_pull_request_and_issue_records_are_tracked(self) -> None:
    self.assertTrue(tracked({"type": "pr"}))
    self.assertTrue(tracked({"type": "issue"}))
    self.assertFalse(tracked({"type": "issue_comment"}))
    self.assertFalse(tracked(None))

  def test_a_github_read_becomes_a_level_and_an_unasked_field_stays_unknown(self) -> None:
    self.assertEqual(level_of(node("OPEN", isDraft=True)), {"pr": "OPEN", "is_draft": True, "queued": None, "base_is_default": None})
    asked = node("MERGED", baseRefName="stack/one", mergeQueueEntry=None)
    self.assertEqual(level_of(asked, "main"), {"pr": "MERGED", "is_draft": False, "queued": False, "base_is_default": False})
    self.assertTrue(level_of(node("OPEN", mergeQueueEntry={"position": 1}), "main")["queued"])
    self.assertIsNone(level_of(None))
    self.assertIsNone(level_of({"__typename": "Commit"}))
    self.assertIsNone(level_of(node("WEIRD")))


  def test_a_record_with_no_stored_lifecycle_gets_one_and_deadlines_pass_on_load(self) -> None:
    sending = vector_of({"type": "pr", "status": "submitting"}, 100)
    self.assertEqual(sending["regions"]["publication"]["state"], "SENDING")
    later = vector_of({"type": "pr", "status": "submitting", "lifecycle": sending}, 401)
    self.assertEqual(later["regions"]["publication"]["state"], "UNCERTAIN")

  def test_a_stored_lifecycle_follows_the_status_word_another_writer_stored(self) -> None:
    stored = vector_of({"type": "pr", "status": "open", "number": 3}, 100)
    merged = vector_of({"type": "pr", "status": "merged", "number": 3, "lifecycle": stored}, 200)
    self.assertEqual(merged["regions"]["publication"]["state"], "MERGED")
    self.assertIsNone(vector_of({"type": "issue_comment", "status": "commented"}, 1))


class ShadowMode(unittest.TestCase):
  def setUp(self) -> None:
    self.folder = tempfile.TemporaryDirectory()
    self.addCleanup(self.folder.cleanup)
    self.clock = Clock()

  def shadow(self) -> lifecycle_shadow.Shadow:
    return lifecycle_shadow.Shadow(self.folder.name, self.clock)

  def test_a_pass_that_agrees_with_the_job_notes_nothing_and_keeps_the_vector(self) -> None:
    shadow = self.shadow()
    shadow.read(OPEN_PR)
    shadow.observed(OPEN_PR, node("MERGED"), "merged")
    shadow.save()
    again = self.shadow()
    self.assertEqual(again.disagreements, [])
    self.assertEqual(again.vectors["one"]["regions"]["publication"]["state"], "MERGED")

  def test_a_status_the_engine_would_not_have_stored_is_one_note(self) -> None:
    shadow = self.shadow()
    shadow.read(OPEN_PR)
    shadow.observed(OPEN_PR, node("MERGED"), "open")
    self.assertEqual([(note["kind"], note["job"], note["engine"]) for note in shadow.disagreements], [("status", "open", "merged")])

  def test_a_status_another_writer_stored_is_explained_or_noted(self) -> None:
    shadow = self.shadow()
    shadow.read({**OPEN_PR, "status": "prepared", "plan": {"action": "pr"}, "url": None, "number": None})
    shadow.read({**OPEN_PR, "status": "submitting"})
    shadow.read({**OPEN_PR, "status": "open"})
    self.assertEqual(shadow.disagreements, [])
    shadow.read({**OPEN_PR, "status": "abandoned"})
    self.assertEqual([note["kind"] for note in shadow.disagreements], ["unexplained_status"])

  def test_a_deadline_passes_while_the_job_only_reads(self) -> None:
    shadow = self.shadow()
    shadow.read({**OPEN_PR, "status": "submitting"})
    self.clock.now += 301
    shadow.read({**OPEN_PR, "status": "submitting"})
    self.assertEqual(shadow.vectors["one"]["regions"]["publication"]["state"], "UNCERTAIN")
    self.assertEqual(shadow.disagreements, [])

  def test_records_the_engine_does_not_track_leave_no_vector(self) -> None:
    shadow = self.shadow()
    shadow.read({"id": "c", "type": "issue_comment", "status": "commented"})
    shadow.read({"id": "d", "type": "pr", "status": "commented"})
    shadow.observed({"id": "c"}, node("OPEN"), "open")
    self.assertEqual(shadow.vectors, {})

  def test_a_settled_record_the_job_stopped_reading_is_dropped_on_save(self) -> None:
    shadow = self.shadow()
    shadow.read({**OPEN_PR, "status": "merged"})
    shadow.read({**OPEN_PR, "id": "two"})
    shadow.save()
    later = self.shadow()
    later.read({**OPEN_PR, "id": "two"})
    later.save()
    self.assertEqual(sorted(self.shadow().vectors), ["two"])

  def test_without_a_state_folder_or_with_a_broken_file_it_starts_empty(self) -> None:
    self.assertEqual(lifecycle_shadow.Shadow(None, self.clock).vectors, {})
    Path(self.folder.name, lifecycle_shadow.STATE_FILE).write_text("{not json")
    self.assertEqual(self.shadow().vectors, {})
    lifecycle_shadow.Shadow(None, self.clock).save()


if __name__ == "__main__":
  unittest.main()
