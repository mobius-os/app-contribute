"""The scheduled job's decisions that do not depend on who writes the status word.

Each test states the behaviour it covers. They run the whole embedded program through the existing
`JobEndpoints` harness, so they prove what the job does, not what a helper function returns.
"""
import copy
import json
import subprocess
import unittest

from test_job_notifications import JobEndpoints

ME = "owner-login"
FAILING = {"state": "FAILURE", "contexts": {"nodes": [
  {"__typename": "CheckRun", "name": "build", "conclusion": "FAILURE", "detailsUrl": "https://ci.example/1"},
]}}


def checks(job, rollup):
  job.node["commits"] = {"nodes": [{"commit": {"statusCheckRollup": rollup}}]}


def member_comment(at, login="reviewer", association="MEMBER", suffix="c"):
  return {
    "url": "https://github.com/example/project/pull/1#issuecomment-%s" % suffix,
    "createdAt": at, "author": {"login": login}, "authorAssociation": association,
  }


class BaseBranchEndpoints(JobEndpoints):
  """Answers the three REST reads that tell which checks also fail on the default branch."""

  def __init__(self, base_failing=("build",)):
    super().__init__()
    self.base_failing = base_failing

  def gh(self, args, **kwargs):
    path = args[2] if len(args) == 3 and args[:2] == ["gh", "api"] else ""
    answers = {
      "repos/example/project": {"default_branch": "main"},
      "repos/example/project/actions/runs?per_page=1&status=completed&branch=main": {"workflow_runs": [{"id": 7}]},
      "repos/example/project/actions/runs/7/jobs?per_page=50": {"jobs": [
        {"name": name, "conclusion": "failure"} for name in self.base_failing]},
    }
    if path in answers:
      return subprocess.CompletedProcess(args, 0, json.dumps(answers[path]), "")
    return super().gh(args, **kwargs)


class InheritedChecksTest(unittest.TestCase):
  def test_a_check_that_also_fails_on_the_default_branch_does_not_ask_for_the_owner(self):
    job = BaseBranchEndpoints()
    job.node["comments"] = {"nodes": []}
    checks(job, FAILING)
    job.run()
    job.run()
    self.assertFalse(job.record.get("needs_attention"))
    self.assertEqual(job.sent, [])

  def test_a_suspect_failure_still_asks_and_an_empty_list_is_not_inherited(self):
    suspect = BaseBranchEndpoints(base_failing=("lint",))
    suspect.node["comments"] = {"nodes": []}
    checks(suspect, FAILING)
    suspect.run()
    self.assertEqual(suspect.record["attention"]["type"], "checks_failed")
    bare = JobEndpoints()
    bare.node["comments"] = {"nodes": []}
    checks(bare, {"state": "FAILURE"})
    bare.run()
    self.assertEqual(bare.record["attention"]["type"], "checks_failed")

  def test_a_standing_checks_flag_clears_once_every_failure_is_inherited(self):
    job = BaseBranchEndpoints(base_failing=("lint",))
    job.node["comments"] = {"nodes": []}
    checks(job, FAILING)
    job.run()
    self.assertEqual(job.record["attention"]["type"], "checks_failed")
    job.base_failing = ("build",)
    job.run()
    self.assertFalse(job.record["needs_attention"])
    self.assertIsNone(job.record["attention"])


class OwnCommentsTest(unittest.TestCase):
  def test_the_owners_own_comment_and_review_are_not_feedback(self):
    job = JobEndpoints()
    job.viewer = ME
    job.node["comments"] = {"nodes": [member_comment("2026-01-02T00:00:00Z", login=ME, association="OWNER")]}
    job.node["reviews"] = {"nodes": [{
      "url": "https://github.com/example/project/pull/1#pullrequestreview-9",
      "submittedAt": "2026-01-02T00:05:00Z", "state": "COMMENTED",
      "author": {"login": ME.upper()}, "authorAssociation": "OWNER",
    }]}
    job.run()
    job.run()
    self.assertFalse(job.record.get("needs_attention"))
    self.assertEqual(job.sent, [])

  def test_someone_elses_comment_still_counts_beside_the_owners(self):
    job = JobEndpoints()
    job.viewer = ME
    job.node["comments"] = {"nodes": [
      member_comment("2026-01-02T00:00:00Z", login=ME, association="OWNER", suffix="own"),
      member_comment("2026-01-03T00:00:00Z", login="reviewer", suffix="theirs"),
    ]}
    job.run()
    self.assertEqual(job.record["attention"]["type"], "github_activity")
    self.assertIn("reviewer", job.record["attention"]["message"])

  def test_a_standing_flag_that_names_the_owners_own_comment_is_cleared(self):
    job = JobEndpoints()
    job.viewer = ME
    comment = member_comment("2026-01-02T00:00:00Z", login=ME, association="OWNER")
    job.node["comments"] = {"nodes": [comment]}
    job.change(needs_attention=True, last_github_activity_at=comment["createdAt"], attention={
      "type": "github_activity", "key": "github_activity:" + comment["createdAt"],
      "title": "New GitHub activity", "message": "New comment from " + ME + ".",
      "url": comment["url"], "event_at": comment["createdAt"], "detected_at": "2026-01-02T00:01:00Z",
      "announced_at": "2026-01-02T00:02:00Z"})
    job.run()
    self.assertFalse(job.record["needs_attention"])
    self.assertIsNone(job.record["attention"])


def review(state, at="2026-01-02T00:00:00Z"):
  return {"url": "https://github.com/example/project/pull/1#pullrequestreview-1", "submittedAt": at,
          "state": state, "author": {"login": "reviewer"}, "authorAssociation": "MEMBER"}


class AttentionRulesTest(unittest.TestCase):
  def requested(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node["reviewDecision"] = "CHANGES_REQUESTED"
    job.node["reviews"] = {"nodes": [review("CHANGES_REQUESTED")]}
    job.run()
    self.assertEqual(job.record["attention"]["type"], "changes_requested")
    return job

  def test_a_change_request_clears_when_no_request_stands_any_more(self):
    for decision in ("REVIEW_REQUIRED", None):
      with self.subTest(decision=decision):
        job = self.requested()
        job.node["reviewDecision"] = decision
        job.node["reviews"] = {"nodes": [review("DISMISSED")]}
        job.run()
        self.assertFalse(job.record["needs_attention"])
        self.assertIsNone(job.record["attention"])

  def test_a_null_decision_does_not_lift_a_request_a_trusted_reviewers_newest_review_still_makes(self):
    # GitHub answers null where the branch has no review rule (or the rule was removed): that is no statement about requests.
    job = self.requested()
    job.node["reviewDecision"] = None
    job.run()
    self.assertTrue(job.record["needs_attention"])
    self.assertEqual(job.record["attention"]["type"], "changes_requested")
    job.run()
    self.assertEqual(job.record["attention"]["type"], "changes_requested", "and the next pass keeps it too")

  def test_the_reviews_lift_it_when_that_reviewer_approved_or_was_dismissed_afterwards_but_a_comment_does_not(self):
    later = "2026-01-03T00:00:00Z"
    for newest, lifted in (("APPROVED", True), ("DISMISSED", True), ("COMMENTED", False)):
      with self.subTest(newest=newest):
        job = self.requested()
        job.node["reviewDecision"] = None
        job.node["reviews"] = {"nodes": [review("CHANGES_REQUESTED"), {**review(newest, later), "url": "https://github.com/example/project/pull/1#pullrequestreview-2"}]}
        job.run()
        # The approval, the dismissal or the comment is itself new activity, so the request may wait behind that note instead of holding the slot.
        held = [job.record["attention"], *job.record.get("waiting_attention", [])]
        self.assertEqual(not any((item or {}).get("type") == "changes_requested" for item in held), lifted)

  def test_only_a_trusted_reviewers_request_holds_it(self):
    job = self.requested()
    job.node["reviewDecision"] = None
    job.node["reviews"] = {"nodes": [{**review("CHANGES_REQUESTED"), "authorAssociation": "NONE"}]}
    job.run()
    self.assertIsNone(job.record["attention"], "a stranger's request is surfaced as activity, never held as a change request")

  def test_a_read_that_did_not_ask_for_the_decision_decides_nothing(self):
    job = self.requested()
    del job.node["reviewDecision"]
    job.run()
    self.assertEqual(job.record["attention"]["type"], "changes_requested")

  def test_an_escalation_holds_the_slot_and_a_later_comment_waits_behind_it(self):
    job = JobEndpoints()
    escalation = {"type": "human_required", "key": "human_required:fixture", "title": "Needs you"}
    job.node["comments"] = {"nodes": []}
    job.change(needs_attention=True, attention=escalation)
    job.node["comments"] = {"nodes": [member_comment("2026-01-03T00:00:00Z")]}
    job.run()
    job.run()
    self.assertEqual(job.record["attention"], escalation)
    self.assertEqual([item["type"] for item in job.record["waiting_attention"]], ["github_activity"])
    self.assertEqual(job.sent, [])

  def test_a_failing_check_waits_behind_an_escalation_and_returns_after_resume(self):
    job = JobEndpoints()
    escalation = {"type": "human_required", "key": "human_required:fixture", "title": "Needs you"}
    job.node["comments"] = {"nodes": []}
    job.change(needs_attention=True, attention=escalation)
    checks(job, {"state": "FAILURE"})
    job.run()
    self.assertEqual(job.record["attention"], escalation)
    self.assertEqual([item["type"] for item in job.record["waiting_attention"]], ["checks_failed"])
    job.change(needs_attention=False, attention=None)  # the owner pressed Resume
    job.run()
    self.assertEqual(job.record["attention"]["type"], "checks_failed")
    self.assertFalse(job.record["waiting_attention"])

  def test_the_attention_key_names_githubs_head_not_the_ledgers(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node["headRefOid"] = "githubhead"
    checks(job, {"state": "FAILURE"})
    job.run()
    self.assertEqual(job.record["attention"]["key"], "checks_failed:FAILURE:githubhead")
    other = JobEndpoints()
    other.node["comments"] = {"nodes": []}
    checks(other, {"state": "FAILURE"})
    other.run()
    self.assertEqual(other.record["attention"]["key"], "checks_failed:FAILURE:head-one")


class SavedFieldsTest(unittest.TestCase):
  def live(self, **fields):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node.update(headRefOid="b" * 40, title="Renamed on GitHub", isDraft=False, baseRefName="main")
    job.node.update(fields)
    return job

  def test_the_write_the_job_makes_refreshes_what_it_read_and_leaves_what_was_sent(self):
    job = self.live(mergeable="CONFLICTING")
    job.change(publication_stage="draft", plan={"head_sha": "a" * 40, "title": "Sent title"},
               quality_review={"reviewed_head_sha": "a" * 40}, last_submit_push_sha="a" * 40)
    before = copy.deepcopy({k: job.record[k] for k in ("plan", "quality_review", "last_submit_push_sha")})
    job.run()
    record = job.record
    self.assertEqual(record["github_head_sha"], "b" * 40)
    self.assertEqual(record["github_base_ref"], "main")
    self.assertEqual(record["publication_stage"], "ready")
    self.assertEqual(record["title"], "Renamed on GitHub")
    self.assertEqual({k: record[k] for k in before}, before)

  def test_a_draft_pull_request_is_saved_as_a_draft_stage(self):
    job = self.live(mergeable="CONFLICTING", isDraft=True)
    job.change(publication_stage="ready")
    job.run()
    self.assertEqual(job.record["publication_stage"], "draft")

  def test_it_is_never_a_write_of_its_own(self):
    job = self.live()
    job.run()  # first write: nothing else to say except the metadata the job already saves
    puts = len(job.puts)
    job.node["title"] = "Another title"
    job.run()
    self.assertEqual(len(job.puts), puts)

  def test_a_send_nobody_has_confirmed_keeps_the_fields_the_platform_compares(self):
    job = self.live(mergeable="CONFLICTING")
    job.change(publication_stage="draft", last_submit_error_code="publication_unconfirmed")
    job.run()
    self.assertEqual(job.record["publication_stage"], "draft")
    self.assertEqual(job.record["title"], "Fixture")
    self.assertEqual(job.record["github_head_sha"], "b" * 40)  # the new, separate field is always safe


class FinishedLeftoverTest(unittest.TestCase):
  def test_the_merging_pass_empties_every_attention_slot(self):
    job = JobEndpoints()
    job.run()  # raises github_activity for the fixture's maintainer comment
    job.node["mergeable"] = "CONFLICTING"
    checks(job, {"state": "FAILURE"})
    job.node["state"] = "MERGED"
    job.change(outside_activity={"type": "outside_activity", "key": "outside_activity:x"})
    job.run()
    self.assertEqual(job.record["status"], "merged")
    self.assertFalse(job.record["needs_attention"])
    self.assertIsNone(job.record["attention"])
    self.assertFalse(job.record.get("waiting_attention"))
    self.assertFalse(job.record.get("outside_activity"))

  def test_a_blocker_displaced_in_the_merging_pass_does_not_survive_it(self):
    job = JobEndpoints()
    job.node["comments"] = {"nodes": []}
    job.node["mergeable"] = "CONFLICTING"
    job.run()
    self.assertEqual(job.record["attention"]["type"], "merge_conflict")
    checks(job, {"state": "FAILURE"})
    job.node["state"] = "MERGED"
    job.run()
    self.assertEqual(job.record["status"], "merged")
    self.assertEqual(job.record["waiting_attention"], [])


if __name__ == "__main__":
  unittest.main()
