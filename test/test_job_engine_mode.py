"""Engine mode: the job stores the engine's status word and `lifecycle`, and performs its effects.

`lifecycle_writer: "engine"` in the app's settings.json turns it on. The same
harness drives both modes, so each behaviour is shown against what shadow mode does.
"""
import copy
import datetime
import json
import subprocess
import time
import unittest

import lifecycle_engine as engine
import lifecycle_job
from lifecycle_record import TABLES
from test_job_notifications import FakeResponse, JobEndpoints

DAY = 86400
URL = "https://github.com/example/project/pull/1"


def iso(seconds_ago):
  moment = datetime.datetime.fromtimestamp(time.time() - seconds_ago, datetime.timezone.utc)
  return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


class EngineEndpoints(JobEndpoints):
  """JobEndpoints that also answers the connect-app call and the parent-branch read."""

  def __init__(self):
    super().__init__()
    self.settings = {"lifecycle_writer": "engine"}
    self.connected = []
    self.cleaned = []
    self.parents = None  # the pull requests whose head branch is the merged PR's base
    self.queries = []  # every batched GraphQL document the job sent
    self.node["comments"] = {"nodes": []}

  def urlopen(self, request, **kwargs):
    path = request.full_url.split("fixture.invalid", 1)[1]
    if request.get_method() == "POST" and path.endswith("/connect-app"):
      self.connected.append(path)
      return FakeResponse({"status": "connected"})
    if request.get_method() == "POST" and path.endswith("/cleanup-staging"):
      self.cleaned.append(path)
    return super().urlopen(request, **kwargs)

  def gh(self, args, **kwargs):
    if args[:3] == ["gh", "api", "graphql"]:
      self.queries.append(args[-1])
    if args[:3] == ["gh", "api", "graphql"] and "p0: repository(" in args[-1]:
      data = {"r0": self.fetched_node(args[-1]), "p0": {"pullRequests": {"nodes": self.parents}}}
      return subprocess.CompletedProcess(args, 0, json.dumps({"data": data}), "")
    return super().gh(args, **kwargs)


def engine_job(**record):
  job = EngineEndpoints()
  job.change(**record)
  return job


def vector(state_by_region, seconds_ago=0):
  states = {"publication": None, "update": None, "followup": None, **state_by_region}
  return engine.new_vector(TABLES, states, int(time.time()) - seconds_ago)


def publication(job):
  return job.record["lifecycle"]["regions"]["publication"]["state"]


def update(job):
  return job.record["lifecycle"]["regions"]["update"]["state"]


def titles(job):
  return [item["title"] for item in job.sent]


def _untimed(attention):
  """An attention payload without its wall-clock stamps: two runs a second apart must still compare equal."""
  if not isinstance(attention, dict):
    return attention
  return {key: value for key, value in attention.items() if not key.endswith("_at")}


class FirstSightTest(unittest.TestCase):
  def test_a_record_read_for_the_first_time_stores_its_lifecycle_and_the_next_pass_is_quiet(self):
    job = engine_job()
    job.run()
    self.assertEqual(publication(job), "OPEN")
    self.assertEqual(job.record["status"], "open")
    self.assertEqual(job.record["lifecycle"]["attention"], {"flags": []})
    puts = len(job.puts)
    job.run()
    self.assertEqual(len(job.puts), puts)
    self.assertEqual(job.sent, [])

  def test_shadow_mode_stores_no_lifecycle_and_an_unreadable_setting_is_shadow(self):
    for settings in (None, {}, {"lifecycle_writer": "shadow"}, {"lifecycle_writer": "ENGINE"}, ["engine"]):
      with self.subTest(settings=settings):
        job = JobEndpoints()
        job.settings = settings
        job.node["state"] = "MERGED"
        job.run()
        self.assertNotIn("lifecycle", job.record)
        self.assertEqual(job.record["status"], "merged")

  def test_engine_and_shadow_agree_on_every_ordinary_move_of_a_live_pull_request(self):
    moves = [("open", {"state": "OPEN", "isDraft": True}), ("draft", {"state": "OPEN", "isDraft": False}),
             ("open", {"state": "CLOSED"}), ("draft", {"state": "CLOSED"}), ("open", {"state": "MERGED"}),
             ("draft", {"state": "MERGED"}), ("open", {"state": "OPEN", "isDraft": False}),
             ("landing", {"state": "MERGED"}), ("landing", {"state": "CLOSED"})]
    for status, read in moves:
      with self.subTest(status=status, read=read):
        results = []
        for settings in (None, {"lifecycle_writer": "engine"}):
          job = JobEndpoints()
          job.settings = settings
          job.change(status=status, type="pr")
          job.node.update(read)
          job.run()
          job.run()
          results.append((job.record["status"], [item["title"] for item in job.sent], _untimed(job.record.get("attention"))))
        self.assertEqual(results[0], results[1])

  def test_an_issue_is_followed_like_a_pull_request(self):
    for state, expected in (("CLOSED", "closed"), ("OPEN", "open")):
      with self.subTest(state=state):
        job = JobEndpoints()
        job.settings = {"lifecycle_writer": "engine"}
        job.change(type="issue")
        job.node.update(__typename="Issue", state=state)
        job.run()
        self.assertEqual(job.record["status"], expected)

  def test_engine_and_shadow_agree_on_an_ordinary_merge(self):
    answers = []
    for settings in (None, {"lifecycle_writer": "engine"}):
      job = JobEndpoints()
      job.settings = settings
      job.node["state"] = "MERGED"
      job.run()
      job.run()
      answers.append((job.record["status"], job.sent, job.record["attention"], len(job.puts)))
    self.assertEqual(answers[0][:3], answers[1][:3])
    self.assertEqual(len(answers[0][1]), 1)
    self.assertIn("🎉", answers[0][1][0]["title"])


SIDE = {"baseRefName": "stack-parent", "mergedAt": "2026-01-05T00:00:00Z",
        "repository": {"defaultBranchRef": {"name": "main"}}}


class ReopenedTest(unittest.TestCase):
  def closed(self, **more):
    return engine_job(status="closed", updated_at=iso(5 * DAY), **more)

  def test_a_closed_pull_request_that_is_reopened_becomes_open_again_with_one_notice(self):
    job = self.closed()
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "open")
    self.assertEqual(publication(job), "OPEN")
    self.assertEqual(titles(job), ["Contribution reopened"])
    job.run()
    self.assertEqual(titles(job), ["Contribution reopened"])

  def test_a_finished_pull_request_is_read_lean_and_a_live_one_in_full(self):
    job = self.closed()
    job.node["state"] = "CLOSED"
    job.run()
    self.assertNotIn("comments(last", job.queries[-1])
    self.assertIn("baseRefName", job.queries[-1])
    live = engine_job()
    live.run()
    self.assertIn("comments(last", live.queries[-1])
    self.assertIn("viewer { login }", live.queries[-1])

  def test_a_reopened_draft_becomes_a_draft(self):
    job = self.closed()
    job.node.update(state="OPEN", isDraft=True)
    job.run()
    self.assertEqual(job.record["status"], "draft")

  def test_shadow_mode_leaves_a_reopened_pull_request_closed_as_before(self):
    job = self.closed()
    job.settings = None
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "closed")
    self.assertEqual(job.sent, [])

  def test_a_pull_request_still_closed_stays_quiet_and_is_not_announced_again(self):
    job = self.closed()
    job.node["state"] = "CLOSED"
    job.run()
    job.run()
    self.assertEqual(job.record["status"], "closed")
    self.assertEqual(job.sent, [])
    self.assertEqual(publication(job), "CLOSED")

  def test_a_pull_request_closed_for_over_30_days_is_no_longer_polled(self):
    job = self.closed()
    job.change(updated_at=iso(31 * DAY))
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "closed")
    self.assertNotIn("lifecycle", job.record)

  def test_a_watched_pull_request_goes_quiet_when_its_30_days_pass(self):
    job = self.closed(lifecycle=vector({"publication": "CLOSED", "update": "NONE", "followup": "CLOSED_OUT"}, 31 * DAY))
    job.node["state"] = "CLOSED"
    job.run()
    self.assertEqual(publication(job), "CLOSED_QUIET")
    self.assertEqual(job.record["status"], "closed")

  def test_a_merged_pull_request_is_never_read_for_a_reopen(self):
    job = engine_job(status="merged", updated_at=iso(DAY))
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "merged")


class SideBranchTest(unittest.TestCase):
  def merged(self, **more):
    job = engine_job(plan={"after_merge": {"action": "connect_app"}}, **more)
    job.node.update(state="MERGED", **SIDE)
    return job

  def test_a_merge_into_another_branch_is_not_announced_as_shipped(self):
    job = self.merged()
    job.run()
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    self.assertEqual(job.record["status"], "merged")
    self.assertEqual(titles(job), ["Contribution merged into another branch"])
    self.assertIn("stack-parent", job.sent[0]["body"])
    self.assertIn("not on the default branch yet", job.sent[0]["body"])
    self.assertNotIn("🎉", json.dumps(job.sent))
    self.assertEqual(job.connected, [])
    self.assertEqual(job.record["github_base_ref"], "stack-parent")

  def test_shadow_mode_still_announces_it_as_shipped(self):
    job = self.merged()
    job.settings = None
    job.run()
    self.assertIn("🎉", job.sent[0]["title"])

  def test_a_merge_into_the_default_branch_ships_and_connects(self):
    job = self.merged()
    job.node.update(baseRefName="main")
    job.run()
    self.assertEqual(publication(job), "MERGED")
    self.assertIn("🎉", job.sent[0]["title"])
    self.assertEqual(len(job.connected), 1)

  def test_a_read_that_did_not_name_the_base_keeps_todays_behaviour(self):
    job = self.merged()
    for key in ("baseRefName", "repository"):
      del job.node[key]
    job.run()
    self.assertEqual(publication(job), "MERGED")

  def parent_pass(self, parents):
    job = self.merged()
    job.run()
    job.parents = parents
    job.run()
    return job

  def test_the_parent_reaching_the_default_branch_after_the_merge_ships_it(self):
    job = self.parent_pass([{"state": "MERGED", "baseRefName": "main", "mergedAt": "2026-01-06T00:00:00Z"}])
    self.assertEqual(publication(job), "MERGED")
    self.assertEqual(titles(job)[-1], "Contribution merged 🎉")
    self.assertEqual(len(job.connected), 1)

  def test_a_parent_that_landed_before_or_was_dropped_needs_the_owner_once(self):
    for parents in ([{"state": "MERGED", "baseRefName": "main", "mergedAt": "2026-01-04T00:00:00Z"}],
                    [{"state": "CLOSED", "baseRefName": "main"}]):
      with self.subTest(parents=parents):
        job = self.parent_pass(parents)
        self.assertEqual(publication(job), "ORPHANED")
        self.assertEqual(job.record["attention"]["type"], "owner_request")
        self.assertEqual(len(job.sent), 2)  # merged elsewhere, then needs you
        job.run()
        self.assertEqual(len(job.sent), 2)
        self.assertEqual(job.connected, [])

  def test_a_parent_still_open_waits(self):
    job = self.parent_pass([{"state": "OPEN", "baseRefName": "main"}])
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    self.assertEqual(len(job.sent), 1)

  def test_silence_for_14_days_asks_the_owner(self):
    job = self.merged()
    job.run()
    stored = copy.deepcopy(job.record["lifecycle"])
    stored["regions"]["publication"].update(since=int(time.time()) - 15 * DAY, deadline=int(time.time()) - DAY)
    job.change(lifecycle=stored)
    job.parents = [{"state": "OPEN", "baseRefName": "main"}]
    job.run()
    self.assertEqual(publication(job), "ORPHANED")


class UpdateStrandedTest(unittest.TestCase):
  def prepared_update(self, **more):
    job = engine_job(status="prepared", number=1, url=URL, plan={"action": "pr_update"}, **more)
    return job

  def test_an_update_whose_pull_request_merged_first_is_stranded_and_told_once(self):
    job = self.prepared_update()
    job.node["state"] = "MERGED"
    job.run()
    self.assertEqual(update(job), "STRANDED_UPDATE")
    self.assertEqual(publication(job), "MERGED")
    self.assertEqual(job.record["status"], "merged")
    self.assertEqual(sorted(titles(job)), ["Contribution merged 🎉", "Update could not be sent"])
    self.assertEqual(job.record["attention"]["type"], "owner_request")
    self.assertEqual(len(job.cleaned), 1)
    job.run()
    self.assertEqual(len(job.sent), 2)
    self.assertEqual(len(job.cleaned), 1)

  def test_closed_first_says_closed_and_strands_the_update(self):
    job = self.prepared_update()
    job.node["state"] = "CLOSED"
    job.run()
    self.assertEqual(update(job), "STRANDED_UPDATE")
    self.assertEqual(job.record["status"], "closed")
    self.assertEqual(sorted(titles(job)), ["Contribution closed", "Update could not be sent"])

  def test_an_update_on_an_open_pull_request_waits_and_stays_prepared(self):
    job = self.prepared_update()
    job.run()
    job.run()
    self.assertEqual(update(job), "PREPARED_UPDATE")
    self.assertEqual(job.record["status"], "prepared")
    self.assertEqual(job.sent, [])

  def test_the_seven_day_reminder_is_the_engines_timeout(self):
    job = self.prepared_update()
    job.node["state"] = "MERGED"
    job.run()
    stored = copy.deepcopy(job.record["lifecycle"])
    stored["regions"]["update"].update(deadline=int(time.time()) - 60)
    job.change(lifecycle=stored)
    job.run()
    self.assertEqual(titles(job)[-1], "Update still waiting for you")
    self.assertEqual(len(job.sent), 3)
    job.run()
    self.assertEqual(len(job.sent), 3)

  def test_shadow_mode_does_not_read_a_prepared_update_at_all(self):
    job = self.prepared_update()
    job.settings = None
    job.node["state"] = "MERGED"
    job.run()
    self.assertEqual(job.record["status"], "prepared")
    self.assertEqual(job.sent, [])


class QueueAndLandingTest(unittest.TestCase):
  def test_a_pull_request_in_the_merge_queue_is_queued_and_still_reads_open(self):
    job = engine_job()
    job.node["mergeQueueEntry"] = {"id": "q1"}
    job.run()
    self.assertEqual(publication(job), "QUEUED")
    self.assertEqual(job.record["status"], "open")
    job.node["mergeQueueEntry"] = None
    job.run()
    self.assertEqual(publication(job), "OPEN")
    self.assertEqual(job.sent, [])

  def test_a_landing_record_is_open_for_the_engine_and_keeps_the_platforms_word_landing(self):
    # The platform owns `landing` (the stack-landing claim: its success marking refuses a row that is
    # not `landing`). The vector says OPEN; the word is never replaced, as shadow mode never replaces it.
    for settings in ({"lifecycle_writer": "engine"}, None):
      with self.subTest(settings=settings):
        job = engine_job(status="landing")
        job.settings = settings
        job.run()
        self.assertEqual(job.record["status"], "landing")
        if settings:
          self.assertEqual(publication(job), "OPEN")
        puts = len(job.puts)
        job.run()
        self.assertEqual(job.record["status"], "landing")
        self.assertEqual(len(job.puts), puts)  # a second pass finds nothing to say about it

  def test_the_landing_word_follows_a_pull_request_that_merged_or_closed(self):
    for state, word in (("MERGED", "merged"), ("CLOSED", "closed")):
      with self.subTest(state=state):
        job = engine_job(status="landing")
        job.node["state"] = state
        job.run()
        self.assertEqual(job.record["status"], word)


class LostSendTest(unittest.TestCase):
  def submitting(self, state, seconds_ago):
    return engine_job(status="submitting", url=None, lifecycle=vector({"publication": state}, seconds_ago))

  def test_a_send_nobody_could_confirm_moves_on_by_the_enginess_deadlines(self):
    job = self.submitting("SENDING", 6 * 60)
    job.run()
    self.assertEqual(publication(job), "UNCERTAIN")
    self.assertEqual(job.record["status"], "submitting")
    self.assertEqual(job.sent, [])

  def test_after_ten_more_minutes_it_asks_the_owner_once_and_never_resends(self):
    job = self.submitting("UNCERTAIN", 11 * 60)
    job.run()
    self.assertEqual(publication(job), "NOT_CONFIRMED")
    self.assertEqual(job.record["status"], "prepared")
    self.assertEqual(job.record["attention"]["type"], "owner_request")
    self.assertEqual(titles(job), ["Could not confirm the send"])
    job.run()
    self.assertEqual(len(job.sent), 1)

  def test_shadow_mode_leaves_such_a_record_alone(self):
    job = self.submitting("UNCERTAIN", 11 * 60)
    job.settings = None
    job.run()
    self.assertEqual(job.record["status"], "submitting")


class DamagedVectorTest(unittest.TestCase):
  """A vector the engine cannot read (a hand edit, a partial write) is read as none: the pass goes on and stores a whole one."""

  def damaged(self, edit):
    lifecycle = vector({"publication": "OPEN"})
    edit(lifecycle)
    return lifecycle

  def test_a_record_with_a_damaged_vector_never_aborts_the_pass_and_is_stored_whole_again(self):
    edits = [lambda v: v["regions"].pop("update"), lambda v: v["regions"]["publication"].update(state=["OPEN"]),
             lambda v: v["regions"]["publication"].update(state={"OPEN": 1}), lambda v: v["regions"].update(update=[]),
             lambda v: v["regions"]["publication"].update(since="soon"), lambda v: v.update(regions=None), lambda v: v.update(v=99)]
    for index, edit in enumerate(edits):
      with self.subTest(edit=index):
        job = engine_job(lifecycle=self.damaged(edit))
        job.node["state"] = "MERGED"
        job.run()
        self.assertEqual(job.record["status"], "merged")
        self.assertEqual(publication(job), "MERGED")
        self.assertEqual(titles(job), ["Contribution merged \U0001F389"])
        job.run()
        self.assertEqual(len(job.sent), 1, "told once")


class EffectTableTest(unittest.TestCase):
  def test_every_effect_the_tables_can_raise_is_acted_on_or_listed_with_its_reason(self):
    every = {effect for region in TABLES["regions"].values() for row in region["transitions"] for effect in row["effects"]}
    named = set(lifecycle_job.ACTED) | set(lifecycle_job.NOT_ACTED) | lifecycle_job.NOT_THE_JOBS
    self.assertEqual(sorted(every - named), [])
    self.assertEqual(sorted(named - every), [])


if __name__ == "__main__":
  unittest.main()
