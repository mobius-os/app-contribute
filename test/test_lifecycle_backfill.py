"""The one-time sweep of attention left on finished PRs, in both modes."""
import copy
import json
import subprocess
import tempfile
import unittest
import urllib.error

import lifecycle_backfill
from test_job_engine_mode import EngineEndpoints, iso, publication
from test_job_notifications import JobEndpoints

LEFT = {
  "needs_attention": True,
  "attention": {"type": "github_activity", "key": "github_activity:x", "title": "New GitHub activity"},
  "waiting_attention": [{"type": "checks_failed", "key": "checks_failed:x"}],
  "outside_activity": {"type": "outside_activity", "key": "outside_activity:x"},
}


class BackfillEndpoints(EngineEndpoints):
  def gh(self, args, **kwargs):
    if args[:3] == ["gh", "api", "graphql"] and "b0: resource(" in args[-1]:
      return subprocess.CompletedProcess(args, 0, json.dumps({"data": {"b0": self.fetched_node(args[-1])}}), "")
    return super().gh(args, **kwargs)


def finished(status="merged", engine=True, **more):
  job = BackfillEndpoints()
  job.settings = {"lifecycle_writer": "engine"} if engine else None
  job.change(status=status, updated_at=iso(40 * 86400), **{**LEFT, **more})
  job.node["state"] = status.upper()
  return job


class SweepTest(unittest.TestCase):
  def test_shadow_mode_empties_the_leftover_slots_and_changes_nothing_else(self):
    job = finished(engine=False)
    before = copy.deepcopy(job.record)
    job.run()
    record = job.record
    self.assertFalse(record["needs_attention"])
    self.assertIsNone(record["attention"])
    self.assertEqual(record["waiting_attention"], [])
    self.assertIsNone(record["outside_activity"])
    self.assertEqual(record["updated_at"], before["updated_at"])
    self.assertEqual(record["status"], "merged")
    self.assertNotIn("lifecycle", record)
    self.assertEqual(job.sent, [])
    self.assertEqual(job.cleaned, [])

  def test_a_second_pass_finds_nothing_and_the_sweep_is_over(self):
    job = finished(engine=False)
    job.run()
    puts = len(job.puts)
    job.run()
    job.run()
    self.assertEqual(len(job.puts), puts)

  def test_engine_mode_also_stores_the_seeded_lifecycle_without_a_notice(self):
    job = finished()
    job.run()
    self.assertEqual(publication(job), "MERGED")
    self.assertFalse(job.record["needs_attention"])
    self.assertEqual(job.record["lifecycle"]["attention"], {"flags": []})
    self.assertEqual(job.sent, [])
    self.assertEqual(job.cleaned, [])  # no grant was left on

  def test_a_grant_left_on_is_closed_out_once_and_still_nothing_is_announced(self):
    job = finished(autopilot={"enabled": True, "state": "idle"})
    job.run()
    self.assertEqual(len(job.cleaned), 1)
    self.assertEqual(job.sent, [])
    job.run()
    self.assertEqual(len(job.cleaned), 1)

  def test_the_read_finds_a_closed_pull_request_that_is_open_again_silently(self):
    job = finished(status="closed")
    job.node["state"] = "OPEN"
    job.run()
    self.assertEqual(job.record["status"], "open")
    self.assertEqual(publication(job), "OPEN")
    self.assertEqual(job.sent, [])
    self.assertTrue(any(entry.get("inferred") for entry in job.record["lifecycle"]["history"]))

  def test_the_read_finds_a_merge_into_another_branch(self):
    job = finished()
    job.node.update(baseRefName="stack-parent", repository={"defaultBranchRef": {"name": "main"}})
    job.run()
    self.assertEqual(publication(job), "MERGED_ELSEWHERE")
    self.assertEqual(job.record["status"], "merged")
    self.assertEqual(job.record["github_base_ref"], "stack-parent")  # so the next pass can read its parent
    self.assertTrue(job.record["merged_announced"])
    self.assertEqual(job.sent, [])
    self.assertEqual(job.connected, [])

  def test_a_side_branch_merge_found_by_the_sweep_is_not_announced_as_shipped_a_second_time(self):
    job = finished()
    job.node.update(baseRefName="stack-parent", repository={"defaultBranchRef": {"name": "main"}}, mergedAt="2026-01-05T00:00:00Z")
    job.run()
    job.parents = [{"state": "MERGED", "baseRefName": "main", "mergedAt": "2026-01-06T00:00:00Z"}]
    job.run()  # the ordinary pass reads the parent branch
    self.assertEqual(publication(job), "MERGED")
    self.assertEqual(job.sent, [])  # the old job said "ships to everyone" when it merged

  def test_an_owner_request_on_a_finished_record_is_not_a_leftover(self):
    job = finished(needs_attention=True, attention={"type": "owner_request", "key": "owner_request:update:STRANDED_UPDATE:1"},
                   waiting_attention=[], outside_activity=None)
    job.run()
    self.assertTrue(job.record["needs_attention"])
    self.assertEqual(job.puts, [])

  def test_a_lost_race_is_tried_again_and_nothing_is_marked_done(self):
    job = finished(engine=False)
    job.on_put = lambda body: job.change(title="Concurrent title")
    job.run()
    self.assertTrue(job.record["needs_attention"])
    job.on_put = None
    job.run()
    self.assertFalse(job.record["needs_attention"])
    self.assertEqual(job.record["title"], "Concurrent title")


class FakeStore:
  """Storage double for the bound: many finished records with leftovers."""

  def __init__(self, count):
    self.records = {"r%02d.json" % i: {"id": "r%02d" % i, "type": "pr", "status": "merged", **copy.deepcopy(LEFT)} for i in range(count)}
    self.writes = []

  def call(self, method, path, body=None, headers=None, timeout=15):
    name = path.rsplit("/", 1)[1]
    if method == "GET":
      return json.dumps(self.records[name]).encode(), {"ETag": "1"}
    self.writes.append(name)
    self.records[name] = body
    return b"", {}


class BoundTest(unittest.TestCase):
  def test_a_long_backlog_is_swept_in_bounded_passes_then_stops_for_good(self):
    store = FakeStore(lifecycle_backfill.LIMIT + 5)
    with tempfile.TemporaryDirectory() as state:
      def sweep():
        backfill = lifecycle_backfill.Backfill(store.call, "80", state, False, 1_000_000, "2026-01-01T00:00:00Z")
        backfill.run(sorted(store.records))
        return backfill

      first = sweep()
      self.assertEqual(len(first.cleared), lifecycle_backfill.LIMIT)
      second = sweep()
      self.assertEqual(len(second.cleared), 5)
      third = sweep()
      self.assertTrue(third.state["complete"])
      writes = len(store.writes)
      sweep().run(sorted(store.records))
      self.assertEqual(len(store.writes), writes)


class FailingStore(FakeStore):
  """A store whose write keeps failing for some records (no way to write them, a permanent refusal)."""

  def __init__(self, count, broken):
    super().__init__(count)
    self.broken = set(broken)

  def call(self, method, path, body=None, headers=None, timeout=15):
    if method == "PUT" and path.rsplit("/", 1)[1] in self.broken:
      raise urllib.error.HTTPError(path, 400, "refused", {}, None)
    return super().call(method, path, body, headers, timeout)


class HeadOfLineTest(unittest.TestCase):
  def test_records_whose_write_keeps_failing_are_given_up_after_three_passes_and_do_not_starve_the_rest(self):
    count = lifecycle_backfill.LIMIT + 5
    names = ["r%02d.json" % i for i in range(count)]
    store = FailingStore(count, names[:lifecycle_backfill.LIMIT])  # exactly the first batch cannot be written
    with tempfile.TemporaryDirectory() as state:
      def sweep():
        backfill = lifecycle_backfill.Backfill(store.call, "80", state, False, 1_000_000, "2026-01-01T00:00:00Z")
        backfill.run(names)
        return backfill

      for _pass in range(lifecycle_backfill.FAILED_PASSES - 1):
        self.assertEqual(sweep().cleared, [])  # the same 25 are tried and fail: the rest wait
      third = sweep()
      self.assertEqual(third.cleared, [])
      self.assertEqual(len(third.state["done"]), lifecycle_backfill.LIMIT)  # given up on, the error kept
      self.assertEqual(third.state["failed"][names[0]]["passes"], lifecycle_backfill.FAILED_PASSES)
      fourth = sweep()
      self.assertEqual(sorted(fourth.cleared), names[lifecycle_backfill.LIMIT:])
      self.assertTrue(fourth.state["complete"])
      reads = len(store.writes)
      sweep()
      self.assertEqual(len(store.writes), reads)

  def test_a_record_that_cannot_even_be_read_counts_as_a_failed_pass(self):
    def down(*args, **kwargs):
      raise urllib.error.URLError("down")

    with tempfile.TemporaryDirectory() as state:
      for _pass in range(lifecycle_backfill.FAILED_PASSES):
        backfill = lifecycle_backfill.Backfill(down, "80", state, False, 1, "t")
        backfill.run(["r00.json"])
      self.assertIn("r00.json", backfill.state["done"])
      self.assertEqual(backfill.state["failed"]["r00.json"]["why"], "unreadable")
      self.assertTrue(backfill.state["complete"])

  def test_a_record_the_sweep_rewrote_keeps_this_passes_terminal_work(self):
    for engine in (False, True):
      with self.subTest(engine=engine):
        job = finished(engine=engine, plan={"after_merge": {"action": "connect_app"}})
        job.run()
        self.assertFalse(job.record["needs_attention"])  # cleared by the sweep
        self.assertEqual(len(job.connected), 1)  # and its app connection did not wait a pass


if __name__ == "__main__":
  unittest.main()
