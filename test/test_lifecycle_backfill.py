"""The one-time sweep of attention left on finished PRs, in both modes."""
import copy
import json
import os
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
  down = False  # the sweep's batched GitHub read fails

  def gh(self, args, **kwargs):
    if args[:3] == ["gh", "api", "graphql"] and "b0: resource(" in args[-1] and self.down:
      return subprocess.CompletedProcess(args, 1, "", "gh: could not reach GitHub")
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


def marker(state):
  with open(os.path.join(state, lifecycle_backfill.STATE_FILE), encoding="utf-8") as handle:
    return json.load(handle)


def swept_in_shadow(state, **more):
  """A finished record whose sweep ran, and finished, in shadow mode (the writer has not been flipped yet)."""
  job = finished(engine=False, **more)
  job.state_dir = state
  job.parents = []
  job.run()
  return job


def to_engine(job):
  job.settings = {"lifecycle_writer": "engine"}
  return job


class EngineHalfTest(unittest.TestCase):
  def test_a_sweep_finished_in_shadow_mode_stores_the_lifecycle_once_the_writer_is_engine(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state)
      job.node.update(baseRefName="stack-parent", repository={"defaultBranchRef": {"name": "main"}})
      self.assertNotIn("lifecycle", job.record)
      self.assertFalse(job.record["needs_attention"])
      self.assertTrue(marker(state)["complete"])
      to_engine(job).run()
      self.assertEqual(publication(job), "MERGED_ELSEWHERE")  # what GitHub shows, not the seeded "merged"
      self.assertEqual(job.record["status"], "merged")
      self.assertEqual(job.record["github_base_ref"], "stack-parent")
      self.assertTrue(job.record["merged_announced"])
      self.assertEqual(job.sent, [])
      self.assertEqual(job.connected, [])
      self.assertTrue(marker(state)["engine"]["complete"])
      puts = len(job.puts)
      job.run()
      job.run()
      self.assertEqual(len(job.puts), puts)
      self.assertEqual(job.sent, [])

  def test_the_engine_half_gives_what_a_fresh_engine_sweep_gives(self):
    with tempfile.TemporaryDirectory() as state:
      later = swept_in_shadow(state, autopilot={"enabled": True, "state": "idle"})
      to_engine(later).run()
    fresh = finished(autopilot={"enabled": True, "state": "idle"})
    fresh.run()
    self.assertEqual(later.cleaned, fresh.cleaned)  # the grant left on is closed out, once, in both
    self.assertEqual(len(later.cleaned), 1)
    for key in ("status", "needs_attention", "attention", "waiting_attention", "outside_activity"):
      self.assertEqual(later.record.get(key), fresh.record.get(key), key)
    states = lambda job: {name: slot["state"] for name, slot in job.record["lifecycle"]["regions"].items()}
    self.assertEqual(states(later), states(fresh))
    self.assertEqual(later.record["lifecycle"]["attention"], fresh.record["lifecycle"]["attention"])

  def test_a_closed_pull_request_that_was_reopened_is_found_by_the_engine_half(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state, status="closed")
      job.node["state"] = "OPEN"
      to_engine(job).run()
      self.assertEqual(job.record["status"], "open")
      self.assertEqual(publication(job), "OPEN")
      self.assertEqual(job.sent, [])

  def test_a_failed_github_read_leaves_the_engine_half_to_the_next_pass(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state)
      job.node.update(baseRefName="stack-parent", repository={"defaultBranchRef": {"name": "main"}})
      before = copy.deepcopy(job.record)
      puts = len(job.puts)
      to_engine(job).down = True
      job.run()
      self.assertEqual(job.record, before)  # nothing was stored from the seeded state
      self.assertEqual(len(job.puts), puts)
      engine = marker(state)["engine"]
      self.assertEqual((engine["done"], engine["complete"]), ({}, False))
      self.assertEqual(engine["failed"]["fixture-record.json"], {"passes": 1, "why": "GitHub not read"})
      self.assertEqual(job.sent, [])
      job.down = False
      job.run()
      self.assertEqual(publication(job), "MERGED_ELSEWHERE")  # the correction was not lost
      self.assertEqual(job.record["github_base_ref"], "stack-parent")
      self.assertEqual(job.sent, [])
      self.assertTrue(marker(state)["engine"]["complete"])

  def test_a_record_whose_github_read_keeps_failing_is_given_up_on_with_the_error_kept(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state)
      puts = len(job.puts)
      to_engine(job).down = True
      for passes in range(1, lifecycle_backfill.FAILED_PASSES):
        job.run()
        self.assertFalse(marker(state)["engine"]["complete"], passes)
      job.run()
      self.assertEqual(len(job.puts), puts, "its slots were emptied in shadow mode: nothing is left to write")
      engine = marker(state)["engine"]
      self.assertIn("fixture-record.json", engine["done"])
      self.assertEqual(engine["failed"]["fixture-record.json"], {"passes": lifecycle_backfill.FAILED_PASSES, "why": "GitHub not read"})
      self.assertTrue(engine["complete"])
      self.assertNotIn("lifecycle", job.record)
      sweeps = lambda: sum("b0: resource(" in query for query in job.queries)
      reads = sweeps()
      job.down = False
      job.run()  # given up on: the sweep does not read it again
      self.assertEqual((sweeps(), len(job.puts)), (reads, puts))

  def test_an_engine_first_sweep_through_a_long_outage_still_clears_the_leftover_it_gives_up_on(self):
    with tempfile.TemporaryDirectory() as state:
      job = finished()
      job.state_dir, job.down = state, True
      before = copy.deepcopy(job.record)
      for passes in range(1, lifecycle_backfill.FAILED_PASSES):
        job.run()
        self.assertEqual(job.record, before, "still flagged: GitHub may answer on the next pass (pass %d)" % passes)
        self.assertFalse(marker(state)["complete"])
      job.run()
      self.assertFalse(job.record["needs_attention"])
      self.assertIsNone(job.record["attention"])
      self.assertEqual(job.record["waiting_attention"], [])
      self.assertIsNone(job.record["outside_activity"])
      self.assertNotIn("lifecycle", job.record, "nothing is stored from the seeded state")
      self.assertEqual((job.record["status"], job.record["updated_at"]), (before["status"], before["updated_at"]))
      self.assertEqual(marker(state)["engine"]["failed"]["fixture-record.json"], {"passes": lifecycle_backfill.FAILED_PASSES, "why": "GitHub not read"})
      self.assertTrue(marker(state)["engine"]["complete"])
      self.assertEqual((job.sent, job.cleaned, job.connected), ([], [], []))
      puts = len(job.puts)
      job.down = False
      job.run()
      self.assertEqual(len(job.puts), puts, "given up on: it is not read again")

  def test_shadow_mode_still_clears_a_record_when_github_cannot_be_read(self):
    job = finished(engine=False)
    job.down = True
    job.run()
    self.assertFalse(job.record["needs_attention"])
    self.assertEqual(job.record["waiting_attention"], [])

  def test_a_marker_written_before_the_engine_half_counts_as_shadow_only(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state)
      with open(os.path.join(state, lifecycle_backfill.STATE_FILE), encoding="utf-8") as handle:
        written = json.load(handle)
      self.assertNotIn("engine", written)  # shadow mode writes the marker exactly as it always did
      legacy = {"schema": 1, "done": written["done"], "complete": True, "failed": {}}
      with open(os.path.join(state, lifecycle_backfill.STATE_FILE), "w", encoding="utf-8") as handle:
        json.dump(legacy, handle)
      to_engine(job).run()
      self.assertEqual(publication(job), "MERGED")
      self.assertEqual(marker(state)["engine"]["done"].keys(), legacy["done"].keys())

  def test_shadow_then_engine_then_shadow_again_redoes_and_undoes_nothing(self):
    with tempfile.TemporaryDirectory() as state:
      job = swept_in_shadow(state)
      to_engine(job).run()
      self.assertEqual(publication(job), "MERGED")  # the engine half was done
      stored, written, done = copy.deepcopy(job.record), len(job.puts), marker(state)
      job.settings = None
      job.run()
      job.run()
      self.assertEqual(job.record, stored)
      self.assertEqual(len(job.puts), written)
      self.assertEqual(marker(state), done)
      self.assertEqual(job.sent, [])

  def test_a_marker_that_already_says_engine_was_done_changes_nothing_in_shadow_mode(self):
    with tempfile.TemporaryDirectory() as state:
      store = FakeStore(3)
      names = sorted(store.records)
      engine_done = {"schema": 1, "done": dict.fromkeys(names, 1), "complete": True, "failed": {},
                     "engine": {"done": dict.fromkeys(names, 1), "complete": True, "failed": {}}}
      with open(os.path.join(state, lifecycle_backfill.STATE_FILE), "w", encoding="utf-8") as handle:
        json.dump(engine_done, handle)
      backfill = lifecycle_backfill.Backfill(store.call, "80", state, False, 1_000_000, "2026-01-01T00:00:00Z")
      backfill.run(names)
      self.assertEqual(store.writes, [])
      self.assertEqual(marker(state), engine_done)


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

  def test_a_backlog_swept_in_shadow_mode_is_visited_again_in_bounded_passes_and_then_never_again(self):
    count = lifecycle_backfill.LIMIT + 5
    store = FakeStore(count)
    names = sorted(store.records)
    with tempfile.TemporaryDirectory() as state:
      def sweep(engine, leftovers):
        backfill = lifecycle_backfill.Backfill(store.call, "80", state, engine, 1_000_000, "2026-01-01T00:00:00Z")
        backfill.run(leftovers)
        return backfill

      for leftovers in (names, names, names):
        sweep(False, leftovers)  # shadow mode finishes the sweep
      self.assertFalse(any("lifecycle" in record for record in store.records.values()))
      self.assertEqual(len(sweep(True, []).cleared), lifecycle_backfill.LIMIT)  # nothing is left over any more
      self.assertEqual(sum("lifecycle" in record for record in store.records.values()), lifecycle_backfill.LIMIT)
      self.assertEqual(len(sweep(True, []).cleared), 5)
      self.assertEqual(sum("lifecycle" in record for record in store.records.values()), count)
      self.assertTrue(sweep(True, []).state["engine"]["complete"])
      writes = len(store.writes)
      sweep(True, [])
      sweep(False, [])
      self.assertEqual(len(store.writes), writes)

  def test_a_record_the_engine_half_cannot_write_is_given_up_on_without_touching_the_shadow_marker(self):
    store = FailingStore(2, [])
    names = sorted(store.records)
    with tempfile.TemporaryDirectory() as state:
      lifecycle_backfill.Backfill(store.call, "80", state, False, 1_000_000, "t").run(names)
      done = copy.deepcopy(marker(state)["done"])
      store.broken = {"r01.json"}
      for _pass in range(lifecycle_backfill.FAILED_PASSES):
        lifecycle_backfill.Backfill(store.call, "80", state, True, 1_000_000, "t").run([])
      engine = marker(state)["engine"]
      self.assertEqual(sorted(engine["done"]), names)
      self.assertEqual(engine["failed"]["r01.json"]["passes"], lifecycle_backfill.FAILED_PASSES)
      self.assertEqual(marker(state)["done"], done)
      self.assertTrue(engine["complete"])


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
