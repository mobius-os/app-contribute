"""The job's attention decisions and the engine's ATTENTION rules, driven with the same inputs.

For every rule that GitHub's own facts can trigger, one scenario sets up a record with some flags
standing, lets the scheduled job read the matching GitHub state, applies the matching engine event to
a vector holding the same flags, and asserts both end with the same set of flags. A rule that no
scenario covers must be named in PLATFORM_OWNED with the reason, so a new rule cannot be forgotten.
"""
import unittest

import lifecycle_engine as engine
import lifecycle_job
from lifecycle_record import TABLES
from test_job_always_on import BaseBranchEndpoints, member_comment, review
from test_job_notifications import JobEndpoints

NOW = 1_800_000_000
FAILING = {"state": "FAILURE", "contexts": {"nodes": [
  {"__typename": "CheckRun", "name": "build", "conclusion": "FAILURE", "detailsUrl": "https://ci.example/1"}]}}
STANDING = {
  "checks_failed": {"type": "checks_failed", "key": "checks_failed:FAILURE:old", "title": "Checks failed"},
  "merge_conflict": {"type": "merge_conflict", "key": "merge_conflict:head-one", "title": "Needs a refresh to merge"},
  "changes_requested": {"type": "changes_requested", "key": "changes_requested:2026-01-02T00:00:00Z",
                        "title": "Changes requested", "url": review("CHANGES_REQUESTED")["url"]},
  "github_activity": {"type": "github_activity", "key": "github_activity:2026-01-02T00:00:00Z", "title": "New GitHub activity",
                      "url": "https://github.com/example/project/pull/1#issuecomment-c", "event_at": "2026-01-02T00:00:00Z"},
  "human_required": {"type": "human_required", "key": "human_required:x", "title": "Needs you"},
}
# Rules only the owner's buttons or the platform's routes can trigger: the job never feeds them.
PLATFORM_OWNED = {
  ("ESCALATED", "raise"): "the platform's /escalate; the job only holds the slot (see the held-escalation scenarios)",
  ("RESUME", "clear"): "the owner's Resume, through the platform",
  ("STAGE_UPDATE", "clear"): "staging an update is the platform's route",
}


def event(kind, **data):
  return {"type": kind, "source": "github", "data": data}


def job_flags(job):
  return lifecycle_job.attention_flags(job.record)


def start(job, *flags):
  """Stand the named flags on the record the way the job itself stores them."""
  for flag in flags[:1]:
    job.change(needs_attention=True, attention=dict(STANDING[flag]))
  if flags[1:]:
    job.change(waiting_attention=[dict(STANDING[flag]) for flag in flags[1:]])


def vector_with(flags):
  vector = engine.new_vector(TABLES, {"publication": "OPEN", "update": "NONE", "followup": "IDLE"}, NOW)
  return {**vector, "attention": {"flags": sorted(flags, key=TABLES["attention"]["priority"].index)}}


def engine_flags(flags, *events):
  vector = vector_with(flags)
  for item in events:
    vector = engine.apply(TABLES, vector, item, NOW)["vector"]
  return vector["attention"]["flags"]


def passing(job):
  job.node["commits"] = {"nodes": [{"commit": {"statusCheckRollup": {"state": "SUCCESS"}}}]}


def checks(job, rollup):
  job.node["commits"] = {"nodes": [{"commit": {"statusCheckRollup": rollup}}]}


def plain(job=None):
  job = job or JobEndpoints()
  job.node["comments"] = {"nodes": []}
  return job


def scenarios():
  """(name, rule key, flags standing before, job setup, engine events)."""
  def inherited(job):
    checks(job, FAILING)

  def untrusted_request(job):
    job.node["reviewDecision"] = "CHANGES_REQUESTED"
    job.node["reviews"] = {"nodes": [{**review("CHANGES_REQUESTED"), "authorAssociation": "NONE"}]}

  def trusted_request(job):
    job.node["reviewDecision"] = "CHANGES_REQUESTED"
    job.node["reviews"] = {"nodes": [review("CHANGES_REQUESTED")]}

  def no_request(job):
    job.node["reviewDecision"] = "REVIEW_REQUIRED"

  def own(job):
    job.viewer = "me"
    job.node["comments"] = {"nodes": [member_comment("2026-01-03T00:00:00Z", login="me", association="OWNER")]}

  def trusted_comment(job):
    job.node["comments"] = {"nodes": [member_comment("2026-01-03T00:00:00Z")]}

  def outside_comment(job):
    job.node["comments"] = {"nodes": [member_comment("2026-01-03T00:00:00Z", login="drive-by", association="NONE")]}

  def settled(job):
    job.change(autopilot={"enabled": True, "state": "idle", "rounds": [{
      "attention_key": STANDING["github_activity"]["key"], "outcome": "replied"}]})

  def merged(job):
    job.node["state"] = "MERGED"

  def set_mergeable(value):
    return lambda job: job.node.update(mergeable=value)

  def fail_then_comment(job):
    checks(job, {"state": "FAILURE"})
    trusted_comment(job)

  def new_head(job):
    job.node["headRefOid"] = "githubhead"
    checks(job, {"state": "FAILURE"})

  none = ()
  return [
    ("checks fail, one is this PR's", ("CHECKS_CHANGED", "raise"), none, lambda j: checks(j, {"state": "FAILURE"}),
     [event("CHECKS_CHANGED", state="failing", all_inherited=False)]),
    ("every failing check also fails on the default branch", ("CHECKS_CHANGED", "clear"), ("checks_failed",), inherited,
     [event("CHECKS_CHANGED", state="failing", all_inherited=True)]),
    ("checks pass", ("CHECKS_CHANGED", "clear"), ("checks_failed",), passing, [event("CHECKS_CHANGED", state="passing")]),
    ("checks still running", ("CHECKS_CHANGED", "keep"), ("checks_failed",), lambda j: checks(j, {"state": "PENDING"}),
     [event("CHECKS_CHANGED", state="pending")]),
    ("a trusted reviewer requests changes", ("REVIEW_CHANGED", "raise"), none, trusted_request,
     [event("REVIEW_CHANGED", changes_requested=True, trusted=True)]),
    ("an outsider's request raises only an outside note", ("REVIEW_CHANGED", "keep"), none, untrusted_request,
     [event("REVIEW_CHANGED", changes_requested=True, trusted=False), event("COMMENTED", by_owner=False, trusted=False)]),
    ("no change request stands any more", ("REVIEW_CHANGED", "clear"), ("changes_requested",), no_request,
     [event("REVIEW_CHANGED", changes_requested=False)]),
    ("a comment you wrote yourself", ("COMMENTED", "keep"), none, own, [event("COMMENTED", by_owner=True)]),
    ("a trusted comment", ("COMMENTED", "raise"), none, trusted_comment, [event("COMMENTED", by_owner=False, trusted=True)]),
    ("an outsider's comment", ("COMMENTED", "raise"), none, outside_comment, [event("COMMENTED", by_owner=False, trusted=False)]),
    ("a round settled the note", ("ANSWERED", "clear"), ("github_activity",), settled, [event("ANSWERED")]),
    ("the PR conflicts", ("MERGEABLE_CHANGED", "raise"), none, set_mergeable("CONFLICTING"), [event("MERGEABLE_CHANGED", state="conflicting")]),
    ("the PR can merge again", ("MERGEABLE_CHANGED", "clear"), ("merge_conflict",), set_mergeable("MERGEABLE"),
     [event("MERGEABLE_CHANGED", state="mergeable")]),
    ("GitHub has not computed mergeability", ("MERGEABLE_CHANGED", "keep"), ("merge_conflict",), set_mergeable("UNKNOWN"),
     [event("MERGEABLE_CHANGED", state="unknown")]),
    ("the PR merged", ("PR_FINISHED", "clear_all"), ("checks_failed", "merge_conflict"), merged, [event("PR_FINISHED")]),
    ("the head moved", ("HEAD_PUSHED", "keep"), ("checks_failed",), new_head, [event("HEAD_PUSHED"), event("CHECKS_CHANGED", state="failing", all_inherited=False)]),
    ("an escalation holds the slot against a trusted comment", ("ESCALATED", "raise"), ("human_required",), trusted_comment,
     [event("COMMENTED", by_owner=False, trusted=True)]),
    ("an escalation holds the slot against failing checks", ("ESCALATED", "raise"), ("human_required",), lambda j: checks(j, {"state": "FAILURE"}),
     [event("CHECKS_CHANGED", state="failing", all_inherited=False)]),
  ]


class AgreementTest(unittest.TestCase):
  def test_the_job_and_the_engine_end_with_the_same_flags_for_every_rule(self):
    for name, _rule, standing, setup, events in scenarios():
      with self.subTest(name):
        inherited = "every failing check" in name
        job = plain(BaseBranchEndpoints() if inherited else JobEndpoints())
        start(job, *standing)
        setup(job)
        job.run()
        self.assertEqual(job_flags(job), engine_flags(list(standing), *events))

  def test_every_attention_rule_has_a_scenario_or_a_named_reason(self):
    covered = {rule for _name, rule, *_ in scenarios()}
    for row in TABLES["attention"]["rules"]:
      key = (row["event"], row["action"])
      self.assertTrue(key in covered or key in PLATFORM_OWNED, "no scenario for the rule %s %s" % key)
    self.assertEqual(sorted(set(PLATFORM_OWNED) - {(r["event"], r["action"]) for r in TABLES["attention"]["rules"]}), [])


if __name__ == "__main__":
  unittest.main()
