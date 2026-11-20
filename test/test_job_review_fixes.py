"""The job's less obvious cases, each with the scenario that failed once: the route of a side-branch merge, a request that must
not lose a standing attention, a status word another writer changed, one reminder and no write for a clock, a books-only write
that never holds back a delivery, the retry with the older document and the route lookup apart, and the PR the app itself finished.
The other cases have their tests beside their modules.
"""
import copy
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import lifecycle_job
from test_job_engine_mode import DAY, SIDE, URL, EngineEndpoints, engine_job, iso, publication, titles, update, vector
from test_job_notifications import JOB, JobEndpoints, _job_python


def reads(job):
  """The documents the job asked about its records (not the review-again alert search that runs before them)."""
  return [query for query in job.queries if "ContributeReviewAgainAlerts" not in query]


def persistent(job, test):
  """Give a job a job-state folder that survives its passes, as the real runner's does."""
  job.state_dir = tempfile.mkdtemp()
  test.addCleanup(shutil.rmtree, job.state_dir, ignore_errors=True)
  return job


def merged_elsewhere(**more):
  job = engine_job(plan={"after_merge": {"action": "connect_app"}}, **more)
  job.node.update(state="MERGED", **SIDE)
  job.run()
  return job


REAL = time.time
MAIN_OLD = {"state": "MERGED", "baseRefName": "main", "mergedAt": "2025-09-01T00:00:00Z"}  # an earlier merge of a reused branch
MAIN_AFTER = {"state": "MERGED", "baseRefName": "main", "mergedAt": "2026-01-06T00:00:00Z"}  # after SIDE's merge on 2026-01-05


class RouteOfASideBranchMergeTest(unittest.TestCase):
  def test_a_parent_merged_after_this_merge_ships_it_whatever_older_merges_the_branch_had(self):
    job = merged_elsewhere()
    job.parents = [MAIN_OLD, MAIN_AFTER]
    job.run()
    self.assertEqual(publication(job), "MERGED")
    self.assertEqual(titles(job)[-1], "Contribution merged 🎉")

  def test_an_old_merge_of_the_same_branch_does_not_orphan_a_parent_that_is_still_open(self):
    job = merged_elsewhere()
    job.parents = [MAIN_OLD, {"state": "OPEN", "baseRefName": "main"}]
    job.run()
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    self.assertEqual(len(job.sent), 1)  # still only "merged into another branch"

  def test_when_every_parent_that_landed_did_so_earlier_it_is_orphaned(self):
    job = merged_elsewhere()
    job.parents = [MAIN_OLD, {"state": "CLOSED", "baseRefName": "main"}]
    job.run()
    self.assertEqual(publication(job), "ORPHANED")

  def test_no_pull_request_with_that_head_branch_yet_is_not_yet_and_the_14_days_cover_silence(self):
    job = merged_elsewhere()
    job.parents = []
    job.run()
    job.run()
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    self.assertEqual(len(job.sent), 1)
    self.assertNotIn("attention", {k for k, v in job.record.items() if v})  # nothing asked of the owner yet
    stored = copy.deepcopy(job.record["lifecycle"])
    stored["regions"]["publication"].update(since=int(time.time()) - 15 * DAY, deadline=int(time.time()) - DAY)
    job.change(lifecycle=stored)
    job.run()
    self.assertEqual(publication(job), "ORPHANED")
    self.assertEqual(job.record["attention"]["type"], "owner_request")


class OrphanedIsWatchedTest(unittest.TestCase):
  def orphaned(self, test, **more):
    job = persistent(engine_job(
      status="merged", github_base_ref="stack-parent", updated_at=iso(20 * DAY),
      lifecycle=vector({"publication": "ORPHANED", "update": "NONE", "followup": "CLOSED_OUT"}, 2 * DAY), **more), test)
    job.node.update(state="MERGED", **SIDE)
    job.parents = []
    return job

  def test_a_parent_that_reaches_the_default_branch_after_all_resolves_an_orphaned_merge(self):
    job = self.orphaned(self, needs_attention=True, attention={
      "type": "owner_request", "key": "owner_request:publication:ORPHANED:1", "title": "x", "message": "y", "announced_at": iso(DAY)})
    job.parents = [MAIN_AFTER]
    job.run()
    self.assertEqual(publication(job), "MERGED")
    self.assertEqual(job.record["status"], "merged")
    self.assertEqual(titles(job), ["Contribution merged 🎉"])
    self.assertFalse(job.record["needs_attention"])
    self.assertEqual(len(job.connected), 0)  # no connect-app recorded in this fixture's plan

  def test_an_orphaned_record_is_read_at_most_once_a_day(self):
    job = self.orphaned(self)
    job.run()
    asked = len(reads(job))
    self.assertEqual(asked, 2)  # the lean read of the PR and, apart from it, the parent lookup
    job.run()
    job.run()
    self.assertEqual(len(reads(job)), asked)
    with patch("time.time", lambda: REAL() + 2 * DAY):  # two days later
      job.run()
    self.assertEqual(len(reads(job)), asked + 2)
    self.assertEqual(publication(job), "ORPHANED")  # unresolved: nothing written, nobody told again
    self.assertEqual((job.sent, job.puts), ([], []))

  def test_shadow_mode_never_reads_an_orphaned_record(self):
    job = self.orphaned(self)
    job.settings = None
    job.run()
    self.assertEqual(reads(job), [])


def _standing_human_required():
  return {"needs_attention": True, "attention": {
    "type": "human_required", "key": "human_required:1", "title": "Needs you", "message": "stuck", "announced_at": "2026-01-01T00:00:00Z"}}


def _not_confirmed_update(**more):
  # An update whose answer was lost 11 minutes ago: the engine asks the owner (UPDATE_NOT_CONFIRMED).
  record = {"id": "r1", "type": "pr", "status": "prepared", "url": URL, "number": 1, "plan": {"action": "pr_update"},
            "last_submit_error_code": "update_unconfirmed",
            "lifecycle": vector({"publication": "OPEN", "update": "UPDATE_UNCERTAIN", "followup": "OFF"}, 11 * 60), **more}
  return lifecycle_job.plan_record(record, None, int(time.time()), iso(0), {})


class OwnerRequestKeepsStandingAttentionTest(unittest.TestCase):
  def test_a_standing_blocker_is_parked_when_the_owners_request_takes_the_slot(self):
    for standing in (_standing_human_required(), {"needs_attention": True, "attention": {
        "type": "checks_failed", "key": "checks_failed:FAILURE:x", "title": "Checks failed", "announced_at": "t"}}):
      with self.subTest(type=standing["attention"]["type"]):
        plan = _not_confirmed_update(**standing)
        self.assertEqual(plan["patch"]["attention"]["type"], "owner_request")
        self.assertEqual([item["type"] for item in plan["patch"]["waiting_attention"]], [standing["attention"]["type"]])
        self.assertIn(standing["attention"]["type"], plan["patch"]["lifecycle"]["attention"]["flags"])

  def test_what_already_waits_stays_and_an_older_owner_request_is_simply_replaced(self):
    waiting = [{"type": "merge_conflict", "key": "merge_conflict:x"}]
    plan = _not_confirmed_update(waiting_attention=waiting, **_standing_human_required())
    self.assertEqual([item["type"] for item in plan["patch"]["waiting_attention"]], ["merge_conflict", "human_required"])
    older = {"needs_attention": True, "attention": {"type": "owner_request", "key": "owner_request:update:UPDATE_X:1"}}
    plan = _not_confirmed_update(**older)
    self.assertNotIn("waiting_attention", plan["patch"])

  def test_the_displaced_blocker_comes_back_once_the_slot_frees(self):
    job = engine_job(status="prepared", number=1, url=URL, plan={"action": "pr_update"}, **_standing_human_required(),
                     last_submit_error_code="update_unconfirmed",
                     lifecycle=vector({"publication": "OPEN", "update": "UPDATE_UNCERTAIN"}, 11 * 60))
    job.run()
    self.assertEqual(job.record["attention"]["type"], "owner_request")
    self.assertEqual([item["type"] for item in job.record["waiting_attention"]], ["human_required"])
    job.change(needs_attention=False, attention=None)  # the owner dealt with the request
    job.run()
    self.assertEqual(job.record["attention"]["type"], "human_required")


class StatusWordChangedByAnotherWriterTest(unittest.TestCase):
  def test_a_closed_word_over_an_open_vector_is_handed_to_the_job_and_a_reopen_is_seen(self):
    job = engine_job(status="closed", updated_at=iso(2 * DAY), last_mergeable="MERGEABLE",
                     lifecycle=vector({"publication": "OPEN", "update": "NONE", "followup": "CLOSED_OUT"}, 3 * DAY))
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "open")
    self.assertEqual(publication(job), "OPEN")
    self.assertIn("Contribution reopened", titles(job))
    told, puts = len(job.sent), len(job.puts)
    job.run()
    self.assertEqual((len(job.sent), len(job.puts)), (told, puts))  # once: the vector now agrees with the word

  def test_shadow_mode_does_not_hand_the_record_over(self):
    job = engine_job(status="closed", updated_at=iso(2 * DAY),
                     lifecycle=vector({"publication": "OPEN", "update": "NONE", "followup": "CLOSED_OUT"}, 3 * DAY))
    job.settings = None
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "closed")


class StrandedReminderAndQueueClockTest(unittest.TestCase):
  def prepared_update(self):
    return engine_job(status="prepared", number=1, url=URL, plan={"action": "pr_update"})

  def test_the_stranded_update_reminder_is_sent_once_not_every_week_for_ever(self):
    job = self.prepared_update()
    job.node["state"] = "MERGED"
    job.run()
    for _week in range(3):
      stored = copy.deepcopy(job.record["lifecycle"])
      stored["regions"]["update"].update(deadline=int(time.time()) - 60)
      job.change(lifecycle=stored)
      job.run()
    self.assertEqual(titles(job).count("Update still waiting for you"), 1)
    self.assertEqual(len(job.sent), 3)
    self.assertTrue(job.record["stranded_reminded_at"])

  def test_a_reminder_already_sent_sends_nothing_and_writes_nothing_when_the_clock_runs_out_again(self):
    base = {"id": "r1", "type": "pr", "status": "merged", "url": URL, "number": 1, "stranded_reminded_at": iso(8 * DAY),
            "lifecycle": vector({"publication": "MERGED", "update": "STRANDED_UPDATE", "followup": "CLOSED_OUT"}, 15 * DAY)}
    plan = lifecycle_job.plan_record(base, None, int(time.time()), iso(0), {})
    self.assertEqual(plan["actions"], [])
    self.assertEqual(plan["patch"], {})

  def test_a_new_strand_is_reminded_again(self):
    record = {"id": "r1", "type": "pr", "status": "open", "url": URL, "number": 1, "stranded_reminded_at": iso(8 * DAY),
              "lifecycle": vector({"publication": "OPEN", "update": "NONE", "followup": "OFF"}, DAY)}
    plan = lifecycle_job.plan_record(record, None, int(time.time()), iso(0), {})
    self.assertIsNone(plan["patch"]["stranded_reminded_at"])

  def test_the_queued_six_hour_question_does_not_write_the_record(self):
    job = engine_job(lifecycle=vector({"publication": "QUEUED"}, 7 * 3600), last_mergeable="MERGEABLE")
    job.node["mergeQueueEntry"] = {"id": "q1"}
    job.run()
    self.assertEqual(job.puts, [])
    self.assertEqual(publication(job), "QUEUED")


class BooksOnlyWriteNeverHoldsBackADeliveryTest(unittest.TestCase):
  def test_a_lost_race_on_a_lifecycle_only_write_still_delivers_the_attention_due(self):
    job = engine_job(
      needs_attention=True, last_conflict_attention_key="merge_conflict:head-one", last_mergeable="CONFLICTING",
      attention={"type": "merge_conflict", "key": "merge_conflict:head-one", "title": "Needs a refresh to merge",
                 "message": "Conflicts.", "detected_at": "2026-01-02T00:00:00Z", "url": URL})
    job.node["mergeable"] = "CONFLICTING"
    job.on_put = lambda body: job.change()  # someone else writes first: this write is a 412
    job.run()
    self.assertNotIn("lifecycle", job.record)  # the books-only write did not land
    self.assertEqual(len(job.sent), 1)  # and the delivery due before it still went out

  def test_the_module_says_which_fields_follow_github_and_why(self):
    import job_github
    doc = job_github.__doc__
    for name in ("github_head_sha", "github_base_ref", "publication_stage", "title", "plan.head_sha",
                 "reviewed_head_sha", "last_submit_push_sha", "PUBLICATION_APPROVAL_FIELDS", "BOOKKEEPING"):
      self.assertIn(name, doc)


class GraphQLRejectionTest(unittest.TestCase):
  def rejecting(self, how, times=1):
    job = engine_job()
    answers = {"seen": 0}
    original = job.gh

    def gh(args, **kwargs):
      if args[:3] == ["gh", "api", "graphql"] and "ContributeReviewAgainAlerts" not in args[-1] and answers["seen"] < times:
        answers["seen"] += 1
        job.queries.append(args[-1])
        if how == "exit":
          # gh exits non-zero when the answer holds errors, and still prints that answer: it is the answer that says the document was refused.
          refused = json.dumps({"errors": [{"message": "Field 'x' doesn't exist on type 'PullRequest'"}]})
          return subprocess.CompletedProcess(args, 1, refused, "gh: Field 'x' doesn't exist on type 'PullRequest'")
        return subprocess.CompletedProcess(args, 0, json.dumps({"errors": [{"message": "no such field"}], "data": None}), "")
      return original(args, **kwargs)
    job.gh = gh
    return job

  def test_a_rejected_document_is_asked_again_once_with_the_fields_main_asked(self):
    for how in ("exit", "errors"):
      with self.subTest(how=how):
        job = self.rejecting(how)
        job.node["mergeable"] = "CONFLICTING"
        job.run()
        asked = reads(job)
        self.assertEqual(len(asked), 2)
        self.assertIn("viewer { login }", asked[0])
        self.assertIn("headRefOid", asked[0])
        for newer in ("viewer", "headRefOid", "mergeQueueEntry", "defaultBranchRef", "baseRefName"):
          self.assertNotIn(newer, asked[1])
        self.assertEqual(job.record["attention"]["type"], "merge_conflict")  # attention still ran
        self.assertEqual(len(job.sent), 1)

  def test_a_non_zero_exit_from_an_outage_is_not_a_rejected_document_and_is_not_asked_again(self):
    outages = [("", "gh: error connecting to api.github.com"), ("", ""), (json.dumps({"message": "API rate limit exceeded"}), "gh: API rate limit exceeded (HTTP 403)"),
               (json.dumps({"errors": [{"message": "Something went wrong"}], "data": {"r0": None}}), "gh: Something went wrong")]
    for stdout, stderr in outages:
      with self.subTest(stdout=stdout):
        job = engine_job()
        job.node["state"] = "MERGED"
        original = job.gh

        def gh(args, **kwargs):
          if args[:3] == ["gh", "api", "graphql"] and "ContributeReviewAgainAlerts" not in args[-1]:
            job.queries.append(args[-1])
            return subprocess.CompletedProcess(args, 1, stdout, stderr)
          return original(args, **kwargs)
        job.gh = gh
        job.run()
        self.assertEqual(len(reads(job)), 1)
        self.assertEqual(job.record["status"], "open", "nothing was read, so nothing changed")
        self.assertEqual(job.sent, [])

  def test_the_retry_is_one_and_a_second_failure_leaves_everything_as_it_was(self):
    job = self.rejecting("exit", times=2)
    job.node["state"] = "MERGED"
    job.run()
    self.assertEqual(len(reads(job)), 2)
    self.assertEqual(job.record["status"], "open")
    self.assertEqual(job.sent, [])

  def test_in_shadow_mode_too_the_older_document_is_the_one_main_always_asked(self):
    job = self.rejecting("exit")
    job.settings = None
    job.run()
    asked = reads(job)
    self.assertEqual(len(asked), 2)
    self.assertNotIn("headRefOid", asked[1])
    self.assertEqual(job.record["status"], "open")

  def test_a_timeout_or_garbage_is_not_a_rejection_and_is_not_asked_again(self):
    for failure in (TimeoutError("fixture"), "not json"):
      with self.subTest(failure=failure):
        job = engine_job()
        original = job.gh

        def gh(args, **kwargs):
          if args[:3] == ["gh", "api", "graphql"] and "ContributeReviewAgainAlerts" not in args[-1]:
            job.queries.append(args[-1])
            if isinstance(failure, Exception):
              raise failure
            return subprocess.CompletedProcess(args, 0, failure, "")
          return original(args, **kwargs)
        job.gh = gh
        job.run()
        self.assertEqual(len(reads(job)), 1)

  def test_the_parent_lookup_is_a_document_of_its_own_and_a_repository_it_cannot_read_costs_nothing_else(self):
    job = merged_elsewhere()
    original = job.gh

    def gh(args, **kwargs):
      if args[:3] == ["gh", "api", "graphql"] and "p0: repository(" in args[-1]:
        job.queries.append(args[-1])
        body = {"data": {"p0": None}, "errors": [{"type": "NOT_FOUND", "message": "Could not resolve to a Repository"}]}
        return subprocess.CompletedProcess(args, 1, json.dumps(body), "gh: Could not resolve to a Repository")
      return original(args, **kwargs)
    job.gh = gh
    before = len(reads(job))
    job.run()
    asked = reads(job)[before:]
    self.assertEqual(len(asked), 2)
    self.assertNotIn("repository(owner", asked[0])
    self.assertIn("r0: resource(", asked[0])
    self.assertIn("p0: repository(", asked[1])
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")  # no answer decides nothing
    self.assertEqual(len(job.sent), 1)


class TheAppFinishedItItselfTest(unittest.TestCase):
  GRANT = {"enabled": True, "state": "idle"}

  def finished(self, status, marker, shadow, **more):
    job = engine_job(status=status, updated_at=iso(DAY), autopilot=self.GRANT, **{marker: False}, **more)
    job.node["state"] = status.upper()
    if shadow:
      job.settings = None
    return job

  def test_a_pull_request_the_app_merged_is_told_once_and_its_grant_closed_in_both_modes(self):
    for shadow in (True, False):
      with self.subTest(shadow=shadow):
        job = self.finished("merged", "merged_announced", shadow)
        before = job.record["updated_at"]
        job.run()
        self.assertEqual(titles(job), ["Contribution merged 🎉"])
        self.assertEqual(len(job.cleaned), 1)
        self.assertIs(job.record["merged_announced"], True)
        self.assertEqual(job.record["updated_at"], before)  # the marker is the job's books, not an edit
        job.run()
        job.run()
        self.assertEqual(len(job.sent), 1)
        self.assertEqual(len(job.cleaned), 1)

  def test_a_pull_request_the_app_closed_is_told_once(self):
    job = self.finished("closed", "closed_announced", True)
    job.run()
    self.assertEqual(titles(job), ["Contribution closed"])
    self.assertIs(job.record["closed_announced"], True)
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_a_grant_already_off_is_not_closed_out_again_but_the_notice_still_goes(self):
    job = self.finished("merged", "merged_announced", True)
    job.change(autopilot={"enabled": False})
    job.run()
    self.assertEqual(job.cleaned, [])
    self.assertEqual(len(job.sent), 1)

  def test_a_pull_request_finished_before_the_marker_existed_is_never_announced(self):
    for status in ("merged", "closed"):
      for shadow in (True, False):
        with self.subTest(status=status, shadow=shadow):
          job = engine_job(status=status, updated_at=iso(DAY), autopilot=self.GRANT)
          job.node["state"] = status.upper()
          if shadow:
            job.settings = None
          job.run()
          job.run()
          self.assertEqual(job.sent, [])
          self.assertNotIn("merged_announced", job.record)

  def test_a_told_marker_stays_told(self):
    job = self.finished("merged", "merged_announced", True)
    job.change(merged_announced=True)
    job.run()
    self.assertEqual(job.sent, [])

  def test_a_merge_into_a_side_branch_is_left_to_the_route_watch(self):
    job = self.finished("merged", "merged_announced", False,
                        lifecycle=vector({"publication": "MERGED_ELSEWHERE", "update": "NONE", "followup": "CLOSED_OUT"}, DAY),
                        github_base_ref="stack-parent")
    job.node.update(SIDE)
    job.parents = []
    job.run()
    self.assertNotIn("🎉", json.dumps(job.sent))


class AnUpdateStrandedByTheAppsOwnMergeTest(unittest.TestCase):
  """The owner merged or closed the PR in the app while an update was waiting: the receipt stored the update as stranded, and the job
  raises the request and sends the one notice the receipt could not."""

  def stranded(self, status="merged", marker=False, publication=None, **more):
    fields = {"%s_announced" % status: True, **more}
    job = engine_job(status=status, number=1, url=URL, plan={"action": "pr_update"}, updated_at=iso(DAY), **fields,
                     lifecycle=vector({"publication": publication or status.upper(), "update": "STRANDED_UPDATE", "followup": "CLOSED_OUT"}, DAY))
    if marker is not None:
      job.change(stranded_announced=marker)
    job.node["state"] = status.upper()
    return job

  def test_a_stranded_update_the_app_left_behind_is_asked_and_told_once(self):
    for status in ("merged", "closed"):
      with self.subTest(status=status):
        job = self.stranded(status)
        job.run()
        self.assertEqual(titles(job), ["Update could not be sent"])
        self.assertIn("was %s before" % status, job.sent[0]["body"])
        self.assertEqual(job.record["attention"]["type"], "owner_request")
        self.assertTrue(job.record["attention"]["key"].startswith("owner_request:update:STRANDED_UPDATE:"))
        self.assertIs(job.record["needs_attention"], True)
        self.assertIs(job.record["stranded_announced"], True)
        self.assertEqual(update(job), "STRANDED_UPDATE")
        job.run()
        job.run()
        self.assertEqual(len(job.sent), 1)

  def test_it_is_told_in_the_same_pass_as_the_merge_the_app_finished(self):
    job = self.stranded("merged", merged_announced=False)
    job.run()
    self.assertEqual(titles(job), ["Contribution merged 🎉", "Update could not be sent"])
    self.assertEqual((job.record["merged_announced"], job.record["stranded_announced"]), (True, True))
    job.run()
    self.assertEqual(len(job.sent), 2)

  def test_a_merge_into_a_side_branch_that_stranded_an_update_is_asked_about_too(self):
    job = self.stranded("merged", publication="MERGED_ELSEWHERE", github_base_ref="stack-parent")
    job.node.update(SIDE)
    job.parents = []
    job.run()
    self.assertEqual(titles(job), ["Update could not be sent"])
    self.assertIn("was merged before", job.sent[0]["body"])
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_a_record_the_job_stranded_itself_never_carries_the_marker_and_is_not_told_twice(self):
    job = engine_job(status="prepared", number=1, url=URL, plan={"action": "pr_update"})
    job.node["state"] = "MERGED"
    job.run()
    job.run()
    self.assertEqual(sorted(titles(job)), ["Contribution merged 🎉", "Update could not be sent"])
    self.assertNotIn("stranded_announced", job.record)

  def test_nothing_is_owed_when_the_request_already_stands_the_marker_is_told_or_the_update_moved_on(self):
    asked = {"type": "owner_request", "key": "owner_request:update:STRANDED_UPDATE:1", "title": "x", "message": "y", "announced_at": iso(DAY)}
    for name, job in (("already asked", self.stranded(needs_attention=True, attention=asked)),
                      ("told", self.stranded(marker=True)),
                      ("no marker", self.stranded(marker=None)),
                      ("update moved on", engine_job(status="merged", merged_announced=True, stranded_announced=False,
                                                     lifecycle=vector({"publication": "MERGED", "update": "NONE", "followup": "CLOSED_OUT"}, DAY)))):
      with self.subTest(name):
        job.run()
        self.assertEqual(job.sent, [])

  def test_shadow_mode_has_no_stranded_update_and_is_unchanged(self):
    job = engine_job(status="merged", merged_announced=True, updated_at=iso(DAY))
    job.settings = None
    job.node["state"] = "MERGED"
    job.run()
    self.assertEqual(job.sent, [])
    self.assertNotIn("stranded_announced", job.record)


class SourceShapeTest(unittest.TestCase):
  def source(self):
    with open(JOB, encoding="utf-8") as handle:
      return handle.read()

  def test_the_attention_function_is_not_longer_than_it_was_on_main(self):
    text = _job_python()
    start = text.index("def _attention_update(")
    end = text.index("\n# A push about one contribution", start)
    self.assertLessEqual(text[start:end].count("\n"), 203)  # main's own length

  def test_lifecycle_shadow_is_imported_once(self):
    self.assertEqual(self.source().count("import lifecycle_shadow"), 1)

  def test_the_owner_decision_sits_behind_one_function(self):
    text = _job_python()
    self.assertEqual(text.count("own_event_urls(node"), 1)
    self.assertIn("def _owner_words(node):", text)
    self.assertEqual(text.count("_owner_words(node)"), 2)  # the definition's line and its one use


if __name__ == "__main__":
  unittest.main()
