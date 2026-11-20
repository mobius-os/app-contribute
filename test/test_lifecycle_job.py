"""The job's binding to the engine, without the job: what a read and a clock mean for a record."""
import unittest
from datetime import datetime, timezone

import lifecycle_engine as engine
import lifecycle_job
from job_github import parents_of, route_alias, route_resolution, saved_fields
from lifecycle_record import TABLES

NOW = 1_800_000_000
NOW_ISO = "2027-01-15T08:00:00Z"
PR = {"id": "one", "type": "pr", "status": "open", "title": "Fixture", "url": "https://github.com/o/r/pull/1", "number": 1}


def node(state="OPEN", **more):
  return {"__typename": "PullRequest", "state": state, "isDraft": False, **more}


def plan(record, read=None, attention=None, now=NOW, route=None):
  return lifecycle_job.plan_record(record, read, now, NOW_ISO, attention or {}, route)


def stored(record, **states):
  adopted = engine.adopt(TABLES, None, lifecycle_job.facts_of(record), NOW - 10)["vector"]
  for name, state in states.items():
    slot = adopted["regions"][name]
    # A deadline belongs to a state that has one: a vector the engine cannot read is no vector (lifecycle_record.stored_vector).
    rule = TABLES["regions"][name]["states"][state].get("deadline")
    slot.update(state=state, deadline=slot["since"] + rule["seconds"] if rule else None)
  return {**record, "lifecycle": adopted}


class StepTest(unittest.TestCase):
  def test_a_quiet_record_has_no_patch_after_its_first_store(self):
    first = plan(PR, node())
    self.assertEqual(first["status"], "open")
    again = plan({**PR, "lifecycle": first["patch"]["lifecycle"]}, node())
    self.assertEqual(again["patch"], {})
    self.assertEqual(again["actions"], [])

  def test_a_comment_record_is_not_tracked(self):
    self.assertIsNone(plan({"id": "c", "type": "issue_comment", "status": "commented"}))

  def test_the_follow_up_lease_is_the_platforms_not_the_jobs(self):
    record = {**PR, "autopilot": {"enabled": True, "state": "responding"}}
    first = plan(record, node())
    self.assertEqual(first["vector"]["regions"]["followup"]["state"], "RESPONDING")
    later = plan({**record, "lifecycle": first["patch"]["lifecycle"]}, node(), now=NOW + 3 * 3600)
    self.assertEqual(later["patch"], {})  # the engine would expire a 45 minute lease; the job must not

  def test_a_merge_cleans_up_connects_and_tells_once_in_todays_order(self):
    result = plan(PR, node("MERGED"))
    self.assertEqual([a["do"] for a in result["actions"]], ["cleanup", "connect_app", "notify"])
    self.assertEqual(result["actions"][-1]["title"], "Contribution merged 🎉")
    self.assertEqual(result["patch"]["status"], "merged")

  def test_a_merge_into_a_side_branch_only_tells_it_has_not_shipped(self):
    result = plan(PR, node("MERGED", baseRefName="stack", repository={"defaultBranchRef": {"name": "main"}}))
    self.assertEqual([a["do"] for a in result["actions"]], ["notify"])  # nothing is closed out until it ships
    self.assertIn("not on the default branch yet", result["actions"][-1]["body"])
    self.assertEqual(result["status"], "merged")

  def test_a_finished_pull_request_empties_what_github_raised_and_keeps_an_owner_request(self):
    left = {"needs_attention": True, "attention": {"type": "github_activity", "key": "k"},
            "waiting_attention": [{"type": "checks_failed", "key": "c"}], "outside_activity": {"type": "outside_activity"}}
    result = plan({**PR, **left}, node("MERGED"))
    self.assertEqual({k: result["patch"][k] for k in ("needs_attention", "attention", "waiting_attention", "outside_activity")},
                     {"needs_attention": False, "attention": None, "waiting_attention": [], "outside_activity": None})
    asking = stored({**PR, "status": "merged", "needs_attention": True,
                     "attention": {"type": "owner_request", "key": "owner_request:update:STRANDED_UPDATE:%d" % (NOW - 10)}},
                    publication="MERGED", update="STRANDED_UPDATE")
    self.assertNotIn("attention", plan(asking, node("MERGED"))["patch"])

  def test_the_flags_stored_in_the_vector_follow_the_slots_in_priority_order(self):
    record = {**PR, "needs_attention": True, "attention": {"type": "checks_failed"},
              "waiting_attention": [{"type": "merge_conflict"}], "outside_activity": {"type": "outside_activity"}}
    self.assertEqual(lifecycle_job.attention_flags(record), ["merge_conflict", "checks_failed", "outside_activity"])
    self.assertEqual(plan(record, node())["vector"]["attention"]["flags"], ["merge_conflict", "checks_failed", "outside_activity"])

  def test_a_reopen_tells_once_and_a_stranded_update_becomes_prepared_again(self):
    record = stored({**PR, "status": "closed", "plan": {"action": "pr_update"}}, publication="CLOSED", update="STRANDED_UPDATE")
    result = plan(record, node("OPEN"))
    self.assertEqual(result["vector"]["regions"]["update"]["state"], "PREPARED_UPDATE")
    self.assertEqual([a["title"] for a in result["actions"] if a["do"] == "notify"], ["Contribution reopened"])
    self.assertEqual(result["status"], "prepared")


class ClosedClockTest(unittest.TestCase):
  def test_a_closed_pr_seen_first_is_watched_30_days_from_when_it_was_closed(self):
    closed_at = NOW - 25 * 86400
    stamp = datetime.fromtimestamp(closed_at, timezone.utc).isoformat().replace("+00:00", "Z")
    result = plan({**PR, "status": "closed", "updated_at": stamp}, node("CLOSED"))
    slot = result["vector"]["regions"]["publication"]
    self.assertEqual((slot["since"], slot["deadline"]), (closed_at, closed_at + 30 * 86400))
    old = plan({**PR, "status": "closed", "updated_at": "2020-01-01T00:00:00Z"}, node("CLOSED"))
    self.assertEqual(old["vector"]["regions"]["publication"]["state"], "CLOSED_QUIET")


class OwnerRequestTest(unittest.TestCase):
  def test_a_region_waiting_on_the_owner_says_so_once_with_a_plain_reason(self):
    record = stored({**PR, "status": "submitting", "url": None}, publication="UNCERTAIN")
    record["lifecycle"]["regions"]["publication"].update(deadline=NOW - 1)
    result = plan(record)
    attention = result["patch"]["attention"]
    self.assertEqual((attention["type"], result["patch"]["needs_attention"]), ("owner_request", True))
    self.assertIn("never sends again", attention["message"])
    self.assertEqual([a["title"] for a in result["actions"]], ["Could not confirm the send"])

  def test_a_stranded_update_tells_through_its_own_notice_not_twice(self):
    record = {**PR, "status": "prepared", "plan": {"action": "pr_update"}}
    result = plan(record, node("CLOSED"))
    self.assertEqual(sorted(a["title"] for a in result["actions"] if a["do"] == "notify"), ["Contribution closed", "Update could not be sent"])
    self.assertEqual(result["patch"]["attention"]["type"], "owner_request")

  def test_the_request_goes_when_its_region_has_moved_on(self):
    record = {**PR, "needs_attention": True,
              "attention": {"type": "owner_request", "key": "owner_request:publication:NOT_CONFIRMED:5"}}
    self.assertEqual(plan(record, node())["patch"]["attention"], None)


class FirstSightTest(unittest.TestCase):
  def test_a_finished_record_seen_first_closes_out_a_grant_left_on_and_tells_nobody(self):
    record = {**PR, "status": "merged", "autopilot": {"enabled": True, "state": "idle"}}
    result = plan(record)
    self.assertEqual([a["do"] for a in result["actions"]], ["cleanup"])

  def test_a_deadline_the_job_owns_moves_the_record_and_one_that_is_not_due_does_not(self):
    sending = stored({**PR, "status": "submitting", "url": None}, publication="SENDING")
    sending["lifecycle"]["regions"]["publication"].update(deadline=NOW + 100)
    self.assertEqual(plan(sending)["patch"], {})
    sending["lifecycle"]["regions"]["publication"].update(deadline=NOW - 1)
    self.assertEqual(plan(sending)["vector"]["regions"]["publication"]["state"], "UNCERTAIN")


class PollingTest(unittest.TestCase):
  def test_which_records_the_engine_mode_job_asks_github_about(self):
    cases = [
      ({}, True), ({"status": "closed"}, True), ({"status": "merged"}, False), ({"status": "prepared", "url": None}, False),
      ({"status": "prepared", "plan": {"action": "pr_update"}}, True), ({"status": "abandoned"}, False),
      ({"status": "closed", "lifecycle": stored({**PR, "status": "closed"}, publication="CLOSED_QUIET")["lifecycle"]}, False),
    ]
    for more, expected in cases:
      with self.subTest(more=more):
        self.assertEqual(lifecycle_job.is_polled({**PR, **more}, NOW), expected)
    self.assertFalse(lifecycle_job.is_polled({**PR, "url": "https://example.com/x"}, NOW))

  def test_the_mode_is_engine_only_for_the_exact_setting_and_never_fails(self):
    def answer(body):
      return lambda *args, **kwargs: (body, {})

    def broken(*args, **kwargs):
      raise OSError("down")
    self.assertEqual(lifecycle_job.writer_mode(answer(b'{"lifecycle_writer": "engine"}'), "1"), "engine")
    for body in (b"", b"[]", b'{"lifecycle_writer": "shadow"}', b"not json", b'{"lifecycle_writer": true}'):
      self.assertEqual(lifecycle_job.writer_mode(answer(body), "1"), "shadow")
    self.assertEqual(lifecycle_job.writer_mode(broken, "1"), "shadow")


class SavedFieldsTest(unittest.TestCase):
  LIVE = node(headRefOid="b" * 40, baseRefName="main", title=" New title ", isDraft=True)

  def test_the_sent_version_is_never_touched_and_the_digest_fields_follow_only_a_settled_record(self):
    found = saved_fields({**PR, "publication_stage": "ready", "title": "Old"}, self.LIVE)
    self.assertEqual(found, {"github_head_sha": "b" * 40, "github_base_ref": "main", "publication_stage": "draft", "title": "New title"})
    waiting = saved_fields({**PR, "status": "prepared", "title": "Old"}, self.LIVE)
    self.assertEqual(sorted(waiting), ["github_base_ref", "github_head_sha"])
    self.assertEqual(sorted(saved_fields({**PR, "last_submit_error_code": "publication_unconfirmed"}, self.LIVE)), ["github_base_ref", "github_head_sha"])
    for sent in ("head_sha", "last_submit_push_sha"):
      self.assertNotIn(sent, found)

  def test_an_issue_or_an_unreadable_node_changes_nothing(self):
    self.assertEqual(saved_fields(PR, {"__typename": "Issue", "state": "OPEN"}), {})
    self.assertEqual(saved_fields(PR, None), {})
    self.assertEqual(saved_fields({**PR, "github_head_sha": "b" * 40, "github_base_ref": "main", "title": "New title", "publication_stage": "draft"}, self.LIVE), {})


class RouteTest(unittest.TestCase):
  def parent(self, state, base="main", merged="2027-01-02T00:00:00Z"):
    return {"state": state, "baseRefName": base, "mergedAt": merged}

  def test_the_parent_decides_after_before_or_dropped_and_otherwise_waits(self):
    mine = "2027-01-01T00:00:00Z"
    self.assertEqual(route_resolution(mine, "main", [self.parent("MERGED")]), {"reached": "after"})
    self.assertEqual(route_resolution(mine, "main", [self.parent("MERGED", merged="2026-12-31T00:00:00Z")]), {"reached": "before"})
    self.assertEqual(route_resolution(mine, "main", [self.parent("MERGED", merged=mine)]), {"reached": "before"})
    self.assertEqual(route_resolution(mine, "main", [self.parent("CLOSED", merged=None)]), {"reached": "dropped"})
    self.assertIsNone(route_resolution(mine, "main", []))  # no PR with that head branch yet: not yet, not dropped
    self.assertIsNone(route_resolution(mine, "main", [self.parent("OPEN", merged=None)]))
    self.assertIsNone(route_resolution(mine, "main", [self.parent("MERGED", base="other-branch")]))
    self.assertIsNone(route_resolution(mine, "main", None))
    self.assertIsNone(route_resolution("", "main", [self.parent("MERGED")]))

  def test_any_parent_that_landed_after_this_merge_decides_after_whatever_landed_before(self):
    mine = "2027-01-01T00:00:00Z"
    old, new = self.parent("MERGED", merged="2026-09-01T00:00:00Z"), self.parent("MERGED")
    self.assertEqual(route_resolution(mine, "main", [old, new]), {"reached": "after"})
    self.assertEqual(route_resolution(mine, "main", [new, old]), {"reached": "after"})
    self.assertEqual(route_resolution(mine, "main", [old, new, self.parent("OPEN", merged=None)]), {"reached": "after"})

  def test_before_needs_every_landed_parent_earlier_and_none_still_open(self):
    mine = "2027-01-01T00:00:00Z"
    old = self.parent("MERGED", merged="2026-09-01T00:00:00Z")
    self.assertIsNone(route_resolution(mine, "main", [old, self.parent("OPEN", merged=None)]))
    self.assertIsNone(route_resolution(mine, "main", [old, self.parent("MERGED", base="side")]))
    self.assertEqual(route_resolution(mine, "main", [old, self.parent("CLOSED", merged=None)]), {"reached": "before"})
    self.assertEqual(route_resolution(mine, "main", [old, old]), {"reached": "before"})

  def test_no_parent_yet_is_not_yet_and_closed_parents_are_dropped(self):
    mine = "2027-01-01T00:00:00Z"
    self.assertIsNone(route_resolution(mine, "main", []))
    self.assertEqual(route_resolution(mine, "main", [self.parent("CLOSED", merged=None), self.parent("CLOSED", merged=None)]), {"reached": "dropped"})

  def test_the_parent_read_is_one_aliased_field(self):
    text = route_alias("p0", "o/r", 'stack"x')
    self.assertIn('p0: repository(owner: "o", name: "r")', text)
    self.assertIn('headRefName: "stack\\"x"', text)
    self.assertEqual(parents_of({"pullRequests": {"nodes": [{"state": "OPEN"}, 3]}}), [{"state": "OPEN"}])
    self.assertIsNone(parents_of(None))


if __name__ == "__main__":
  unittest.main()
