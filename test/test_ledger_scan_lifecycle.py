"""What the scan keeps about the lifecycle, and which records the engine-mode job reads because of it."""
import json
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone

from unittest.mock import patch

import ledger_scan
import lifecycle_engine as engine
from ledger_scan import LedgerScan, awaiting_publication_connection, has_attention_leftover, owes_finish, owes_stranded, summarize
from lifecycle_record import TABLES
from test_ledger_scan import FakeLedger

NOW = time.time()


def ago(days):
  return (datetime.fromtimestamp(NOW, timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")


def life(publication, update="NONE", deadline=None, since=1):
  """A vector the engine can read (lifecycle_record.stored_vector reads nothing else): every record region, the version, and a deadline
  only on a state that has one: the update's when it has a rule (a stranded update's reminder), else the publication's."""
  slot = lambda region, state, due=None: {"state": state, "since": since, "deadline": due}
  on_update = deadline if TABLES["regions"]["update"]["states"][update].get("deadline") else None
  return {"v": TABLES["version"], "regions": {
    "publication": slot("publication", publication, None if on_update else deadline),
    "update": slot("update", update, on_update), "followup": slot("followup", "OFF")}}


def read(records, engine):
  with tempfile.TemporaryDirectory() as state:
    scan = LedgerScan(FakeLedger(records).call, "80", state)
    scan.engine = engine
    return {name for name, _record, _version in scan.records_needing_work()}


class EngineModeReadsTest(unittest.TestCase):
  RECORDS = {
    "closed-recent.json": {"id": "a", "type": "pr", "status": "closed", "updated_at": ago(5)},
    "closed-old.json": {"id": "b", "type": "pr", "status": "closed", "updated_at": ago(40)},
    "closed-watched.json": {"id": "c", "type": "pr", "status": "closed", "updated_at": ago(40), "lifecycle": life("CLOSED")},
    "closed-quiet.json": {"id": "d", "type": "pr", "status": "closed", "updated_at": ago(5), "lifecycle": life("CLOSED_QUIET")},
    "elsewhere.json": {"id": "e", "type": "pr", "status": "merged", "updated_at": ago(90), "lifecycle": life("MERGED_ELSEWHERE")},
    "merged.json": {"id": "f", "type": "pr", "status": "merged", "updated_at": ago(1), "lifecycle": life("MERGED")},
    "stranded-due.json": {"id": "g", "type": "pr", "status": "merged", "lifecycle": life("MERGED", "STRANDED_UPDATE", deadline=int(NOW) - 5)},
    "stranded-later.json": {"id": "h", "type": "pr", "status": "merged", "lifecycle": life("MERGED", "STRANDED_UPDATE", deadline=int(NOW) + 5000)},
    "open.json": {"id": "i", "type": "pr", "status": "open"},
  }

  def test_shadow_mode_reads_exactly_what_it_always_did(self):
    self.assertEqual(read(self.RECORDS, False), {"open.json"})

  def test_engine_mode_also_reads_a_closed_pr_that_may_be_reopened_and_what_waits_on_a_deadline(self):
    self.assertEqual(read(self.RECORDS, True), {
      "open.json", "closed-recent.json", "closed-watched.json", "elsewhere.json", "stranded-due.json"})


class SummaryTest(unittest.TestCase):
  def test_the_summary_says_when_a_pr_closed_and_whether_attention_was_left(self):
    closed = summarize({"status": "closed", "updated_at": "2027-01-01T00:00:00Z"})
    self.assertEqual(closed["closed_at"], int(datetime(2027, 1, 1, tzinfo=timezone.utc).timestamp()))
    watched = summarize({"status": "closed", "lifecycle": life("CLOSED", since=777)})
    self.assertEqual((watched["closed_at"], watched["lifecycle"]["publication"]), (777, "CLOSED"))
    self.assertIsNone(summarize({"status": "open"})["closed_at"])
    self.assertTrue(summarize({"status": "merged", "waiting_attention": [{"type": "checks_failed"}]})["leftover"])
    self.assertFalse(summarize({"status": "open", "needs_attention": True, "attention": {"type": "checks_failed"}})["leftover"])

  def test_an_owner_request_is_not_a_leftover(self):
    request = {"needs_attention": True, "attention": {"type": "owner_request", "key": "k"}}
    self.assertFalse(has_attention_leftover(request))
    self.assertTrue(has_attention_leftover({**request, "outside_activity": {"type": "outside_activity"}}))
    self.assertTrue(has_attention_leftover({"needs_attention": True}))

  def test_a_merge_into_a_side_branch_does_not_wait_for_the_app_connection(self):
    handoff = {"plan": {"after_merge": {"action": "connect_app"}}, "status": "merged"}
    self.assertTrue(awaiting_publication_connection(handoff))
    self.assertTrue(awaiting_publication_connection({**handoff, "lifecycle": life("MERGED")}))
    for state in ledger_scan.NOT_SHIPPED:
      self.assertFalse(awaiting_publication_connection({**handoff, "lifecycle": life(state)}))

  def test_the_scan_names_the_finished_records_that_still_hold_attention(self):
    ledger = FakeLedger({
      "left.json": {"id": "l", "type": "pr", "status": "merged", "waiting_attention": [{"type": "merge_conflict"}]},
      "clean.json": {"id": "c", "type": "pr", "status": "merged"},
      "live.json": {"id": "o", "type": "pr", "status": "open", "needs_attention": True, "attention": {"type": "checks_failed"}},
    })
    with tempfile.TemporaryDirectory() as state:
      scan = LedgerScan(ledger.call, "80", state)
      scan.records_needing_work()
      self.assertEqual(scan.finished_with_leftovers(), ["left.json"])


def whole(publication, update="NONE", followup="OFF"):
  """A real vector (with its history), as the engine stores it."""
  return engine.new_vector(TABLES, {"publication": publication, "update": update, "followup": followup}, int(NOW) - 100)


class StatusWordChangedByAnotherWriterTest(unittest.TestCase):
  def test_a_word_that_disagrees_with_the_stored_vector_is_marked_and_handed_to_the_job_once(self):
    changed = {"id": "a", "type": "pr", "status": "closed", "updated_at": ago(2), "lifecycle": whole("OPEN")}
    agreeing = {**changed, "id": "b", "status": "merged", "lifecycle": whole("MERGED")}
    landing = {**changed, "id": "c", "status": "landing", "lifecycle": whole("OPEN")}  # the platform's own word on an open PR
    self.assertTrue(summarize(changed)["lifecycle"]["mismatch"])
    self.assertFalse(summarize(agreeing)["lifecycle"]["mismatch"])
    self.assertFalse(summarize(landing)["lifecycle"]["mismatch"])
    records = {"changed.json": changed, "agreeing.json": {**agreeing, "updated_at": ago(40)},
               "settled.json": {**landing, "status": "merged", "updated_at": ago(40), "lifecycle": whole("MERGED")}}
    self.assertEqual(read(records, True), {"changed.json"})
    self.assertEqual(read(records, False), set())  # shadow mode never reads it

  def test_a_vector_the_engine_cannot_explain_never_makes_a_record_due_for_ever(self):
    odd = {"id": "a", "type": "pr", "status": "commented", "updated_at": ago(40), "lifecycle": whole("OPEN")}
    self.assertFalse(summarize(odd)["lifecycle"]["mismatch"])
    # A vector the engine cannot read at all (here, one holding only a state) is no vector: the record is not due for it either.
    self.assertIsNone(summarize({**odd, "lifecycle": {"regions": {"publication": {"state": "OPEN"}}}})["lifecycle"])


class OrphanedPollTest(unittest.TestCase):
  RECORD = {"id": "o", "type": "pr", "status": "merged", "updated_at": ago(40), "lifecycle": whole("ORPHANED", followup="CLOSED_OUT")}

  def test_an_orphaned_record_is_read_by_the_engine_mode_job_at_most_once_a_day(self):
    ledger = FakeLedger({"orphan.json": self.RECORD})
    with tempfile.TemporaryDirectory() as state:
      def pass_at(seconds):
        with patch("time.time", lambda: NOW + seconds):
          scan = LedgerScan(ledger.call, "80", state)
          scan.engine = True
          work = scan.records_needing_work()
          scan.save()
          return [name for name, _record, _version in work]

      self.assertEqual(pass_at(0), ["orphan.json"])
      self.assertEqual(pass_at(900), [])
      self.assertEqual(pass_at(23 * 3600), [])
      self.assertEqual(pass_at(25 * 3600), ["orphan.json"])
      self.assertEqual(pass_at(25 * 3600 + 900), [])

  def test_shadow_mode_does_not_read_it(self):
    self.assertEqual(read({"orphan.json": self.RECORD}, False), set())


class TheAppFinishedItTest(unittest.TestCase):
  def test_only_an_explicit_false_marker_on_a_finished_record_is_owed(self):
    for status, marker in (("merged", "merged_announced"), ("closed", "closed_announced")):
      base = {"type": "pr", "status": status}
      self.assertTrue(owes_finish({**base, marker: False}))
      for told in (True, None):
        self.assertFalse(owes_finish({**base, marker: told}))
      self.assertFalse(owes_finish(base))  # finished before the marker existed: owes nothing
    self.assertFalse(owes_finish({"type": "pr", "status": "open", "merged_announced": False}))
    self.assertFalse(owes_finish({"type": "pr", "status": "merged", "closed_announced": False}))
    self.assertFalse(owes_finish({"type": "pr", "status": "merged", "merged_announced": False, "lifecycle": whole("MERGED_ELSEWHERE")}))

  def test_the_scan_hands_such_a_record_to_the_job_in_both_modes(self):
    records = {"owed.json": {"id": "a", "type": "pr", "status": "merged", "updated_at": ago(40), "merged_announced": False},
               "told.json": {"id": "b", "type": "pr", "status": "merged", "updated_at": ago(40), "merged_announced": True},
               "old.json": {"id": "c", "type": "pr", "status": "merged", "updated_at": ago(40)}}
    for engine_mode in (False, True):
      self.assertEqual(read(records, engine_mode), {"owed.json"})


class AnUpdateStrandedByTheAppsOwnMergeTest(unittest.TestCase):
  STRANDED = {"type": "pr", "status": "merged", "stranded_announced": False, "lifecycle": whole("MERGED", "STRANDED_UPDATE", "CLOSED_OUT")}

  def test_only_an_explicit_false_marker_on_a_stranded_update_nobody_asked_about_is_owed(self):
    self.assertTrue(owes_stranded(self.STRANDED))
    for told in (True, None):
      self.assertFalse(owes_stranded({**self.STRANDED, "stranded_announced": told}))
    self.assertFalse(owes_stranded({**self.STRANDED, "lifecycle": whole("MERGED", "NONE", "CLOSED_OUT")}))
    self.assertFalse(owes_stranded({"type": "pr", "status": "merged", "stranded_announced": False}))  # no lifecycle: nothing stranded
    asked = {"type": "owner_request", "key": "owner_request:update:STRANDED_UPDATE:1"}
    self.assertFalse(owes_stranded({**self.STRANDED, "needs_attention": True, "attention": asked}))
    other = {"type": "owner_request", "key": "owner_request:publication:ORPHANED:1"}
    self.assertTrue(owes_stranded({**self.STRANDED, "needs_attention": True, "attention": other}))

  def test_the_scan_hands_such_a_record_to_the_job_and_the_one_that_was_told_is_left_alone(self):
    records = {"owed.json": {"id": "a", **self.STRANDED, "updated_at": ago(40)},
               "told.json": {"id": "b", **self.STRANDED, "stranded_announced": True, "updated_at": ago(40)}}
    for engine_mode in (False, True):
      self.assertEqual(read(records, engine_mode), {"owed.json"})


class StrandedClockTest(unittest.TestCase):
  def test_a_reminded_stranded_update_and_a_queued_pr_are_not_due_by_a_clock_that_only_re_arms(self):
    clock = whole("MERGED", "STRANDED_UPDATE", "CLOSED_OUT")
    clock["regions"]["update"]["deadline"] = int(NOW) - 5
    stranded = {"id": "g", "type": "pr", "status": "merged", "updated_at": ago(40), "lifecycle": clock}
    self.assertEqual(read({"a.json": stranded}, True), {"a.json"})  # not reminded yet: due
    self.assertEqual(read({"a.json": {**stranded, "stranded_reminded_at": ago(1)}}, True), set())
    self.assertIsNone(summarize({**stranded, "stranded_reminded_at": ago(1)})["lifecycle"]["due"])
    queued = {"id": "q", "type": "pr", "status": "open", "lifecycle": whole("QUEUED")}
    self.assertIsNotNone(queued["lifecycle"]["regions"]["publication"]["deadline"])
    self.assertIsNone(summarize(queued)["lifecycle"]["due"])


class DirectoryEntriesTest(unittest.TestCase):
  def test_the_platform_lists_a_folder_as_directory_and_it_is_not_read_as_a_record(self):
    class WithFolders(FakeLedger):
      def call(self, method, path, body=None, headers=None):
        raw, headers_out = super().call(method, path, body, headers)
        if path.startswith("/api/storage/apps-list/"):
          page = json.loads(raw)
          page["entries"] += [{"name": "shots.json", "type": "directory", "size": 0, "modified_at": "x"},
                              {"name": "old.json", "type": "dir", "size": 0, "modified_at": "x"}]
          raw = json.dumps(page).encode()
        return raw, headers_out

    ledger = WithFolders({"open.json": {"id": "i", "type": "pr", "status": "open"}})
    with tempfile.TemporaryDirectory() as state:
      work = LedgerScan(ledger.call, "80", state).records_needing_work()
    self.assertEqual([name for name, _r, _v in work], ["open.json"])
    self.assertEqual(ledger.reads, ["open.json"])


if __name__ == "__main__":
  unittest.main()
