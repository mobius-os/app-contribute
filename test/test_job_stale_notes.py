"""A saved "new GitHub activity" note clears once its cause is gone.

The note names an event someone may still owe an answer to, so it is never
dropped on a guess: only a settled round that named it, an approval at or
after the event, or a merged or closed pull request clears it.
"""
import unittest

from test_job_notifications import JobEndpoints

EVENT_AT = "2026-01-02T00:00:00Z"
REVIEW_URL = "https://github.com/example/project/pull/1#pullrequestreview-%d"


def review(number, state, at, association="MEMBER"):
  return {
    "url": REVIEW_URL % number, "submittedAt": at, "state": state,
    "author": {"login": "reviewer-%d" % number}, "authorAssociation": association,
  }


def job_with_activity_note():
  """A record holding the note the job raises for the fixture's maintainer comment."""
  job = JobEndpoints()
  job.run()
  assert job.record["attention"]["type"] == "github_activity"
  # The activity cursor already covers every event on the thread, as it does
  # on a later pass, so only the cause of the note can change its fate.
  job.change(last_github_activity_at="2026-01-09T00:00:00Z")
  return job


def settled_round(key, outcome="replied"):
  return {"enabled": True, "state": "idle", "rounds": [{
    "attention_key": key, "outcome": outcome, "finished_at": "2026-01-02T01:00:00Z",
  }]}


class StaleActivityNoteTest(unittest.TestCase):
  def assertCleared(self, job):
    self.assertFalse(job.record["needs_attention"])
    self.assertIsNone(job.record["attention"])

  def test_a_later_approval_clears_the_note(self):
    job = job_with_activity_note()
    job.node["reviewDecision"] = "APPROVED"
    job.node["reviews"] = {"nodes": [review(1, "APPROVED", "2026-01-03T00:00:00Z")]}
    job.run()
    self.assertCleared(job)

  def test_an_approval_before_the_event_leaves_the_note(self):
    job = job_with_activity_note()
    job.node["reviewDecision"] = "APPROVED"
    job.node["reviews"] = {"nodes": [review(1, "APPROVED", "2026-01-01T00:00:00Z")]}
    job.run()
    self.assertTrue(job.record["needs_attention"])
    self.assertEqual(job.record["attention"]["type"], "github_activity")

  def test_an_approval_no_longer_standing_leaves_the_note(self):
    job = job_with_activity_note()
    job.node["reviewDecision"] = "CHANGES_REQUESTED"
    job.node["reviews"] = {"nodes": [review(1, "APPROVED", "2026-01-03T00:00:00Z")]}
    job.run()
    self.assertEqual(job.record["attention"]["type"], "github_activity")

  def test_a_review_that_is_itself_the_approval_clears_on_the_next_pass(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node["reviewDecision"] = "APPROVED"
    job.node["reviews"] = {"nodes": [review(1, "APPROVED", EVENT_AT)]}
    job.run()
    self.assertEqual(job.record["attention"]["type"], "github_activity")
    job.run()
    self.assertCleared(job)

  def test_a_settled_round_that_named_the_note_clears_it(self):
    for outcome in ("pushed", "replied", "handled"):
      with self.subTest(outcome=outcome):
        job = job_with_activity_note()
        job.change(autopilot=settled_round(job.record["attention"]["key"], outcome))
        job.run()
        self.assertCleared(job)

  def test_a_round_that_failed_or_named_another_event_leaves_the_note(self):
    job = job_with_activity_note()
    key = job.record["attention"]["key"]
    for rounds in (settled_round(key, "failed"), settled_round(key, "stale"),
                   settled_round("github_activity:2025-12-31T00:00:00Z")):
      with self.subTest(rounds=rounds):
        job.change(autopilot=rounds)
        job.run()
        self.assertEqual(job.record["attention"]["key"], key)
        self.assertTrue(job.record["needs_attention"])

  def test_the_pull_request_merging_or_closing_clears_the_note_and_its_waiting_blockers(self):
    for state in ("MERGED", "CLOSED"):
      with self.subTest(state=state):
        job = job_with_activity_note()
        job.change(waiting_attention=[{"type": "changes_requested", "key": "changes_requested:x"}])
        job.node["state"] = state
        job.run()
        self.assertCleared(job)
        self.assertEqual(job.record["waiting_attention"], [])

  def test_a_changes_request_waiting_behind_the_note_returns_once_it_is_answered(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node["reviewDecision"] = "CHANGES_REQUESTED"
    job.node["reviews"] = {"nodes": [review(1, "CHANGES_REQUESTED", EVENT_AT)]}
    job.run()
    request = job.record["attention"]
    self.assertEqual(request["type"], "changes_requested")
    job.node["comments"] = {"nodes": [{
      "url": "https://github.com/example/project/pull/1#comment",
      "createdAt": "2026-01-03T00:00:00Z", "author": {"login": "reviewer-2"},
      "authorAssociation": "MEMBER",
    }]}
    job.run()
    note = job.record["attention"]
    self.assertEqual(note["type"], "github_activity")
    self.assertEqual([item["key"] for item in job.record["waiting_attention"]], [request["key"]])
    job.change(autopilot=settled_round(note["key"]))
    job.run()
    self.assertTrue(job.record["needs_attention"])
    self.assertEqual(job.record["attention"]["key"], request["key"])
    self.assertFalse(job.record["waiting_attention"])


if __name__ == "__main__":
  unittest.main()
