"""Shadow mode also notes what the engine-mode job would do for records today's job does not poll."""
import tempfile
import unittest

import lifecycle_shadow

NOW = 1_800_000_000
URL = "https://github.com/o/r/pull/1"


class Clock:
  def __init__(self):
    self.now = float(NOW)

  def __call__(self):
    return self.now


class WouldNotesTest(unittest.TestCase):
  def setUp(self):
    self.folder = tempfile.TemporaryDirectory()
    self.addCleanup(self.folder.cleanup)
    self.clock = Clock()
    self.shadow = lifecycle_shadow.Shadow(self.folder.name, self.clock)

  def kinds(self):
    return [note["kind"] for note in self.shadow.would]

  def test_a_closed_pr_the_engine_mode_job_would_watch_is_noted_once_not_as_a_disagreement(self):
    record = {"id": "c", "type": "pr", "status": "closed", "url": URL}
    self.shadow.read(record)
    self.shadow.read(record)
    self.assertEqual(self.kinds(), ["would_poll"])
    self.assertEqual(self.shadow.disagreements, [])

  def test_an_update_whose_target_the_reconcile_pass_saw_settle_is_noted_as_stranded(self):
    record = {"id": "u", "type": "pr", "status": "prepared", "url": URL, "plan": {"action": "pr_update"},
              "reconciliation_probe": {"target_state": "closed"}}
    self.shadow.read(record)
    self.assertEqual(sorted(self.kinds()), ["would_poll", "would_strand"])
    self.shadow.read(record)
    self.assertEqual(len(self.shadow.would), 2)

  def test_a_deadline_that_passed_is_noted_with_the_effects_it_would_have_raised(self):
    record = {"id": "s", "type": "pr", "status": "submitting"}
    self.shadow.read(record)
    self.clock.now = NOW + 301
    self.shadow.read(record)
    note = self.shadow.would[-1]
    self.assertEqual((note["kind"], note["effects"]), ("deadline", ["START_OBSERVING"]))

  def test_a_live_pr_todays_job_already_polls_says_nothing_and_the_notes_survive_a_save(self):
    self.shadow.read({"id": "o", "type": "pr", "status": "open", "url": URL})
    self.assertEqual(self.shadow.would, [])
    self.shadow.read({"id": "c", "type": "pr", "status": "closed", "url": URL})
    self.shadow.save()
    again = lifecycle_shadow.Shadow(self.folder.name, self.clock)
    self.assertEqual([n["kind"] for n in again.would], ["would_poll"])
    again.read({"id": "c", "type": "pr", "status": "closed", "url": URL})
    self.assertEqual(len(again.would), 1)

  def test_the_one_time_sweep_logs_what_it_read_as_inferred(self):
    node = {"__typename": "PullRequest", "state": "MERGED", "isDraft": False, "baseRefName": "stack",
            "repository": {"defaultBranchRef": {"name": "main"}}}
    self.shadow.backfilled({"id": "m", "type": "pr", "status": "merged", "url": URL}, node)
    note = self.shadow.would[-1]
    self.assertEqual((note["kind"], note["inferred"], note["states"]["publication"]), ("backfill", True, "MERGED_ELSEWHERE"))


if __name__ == "__main__":
  unittest.main()
