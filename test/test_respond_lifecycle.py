"""Tests for respond_lifecycle.py: the stamp `post` writes on a saved result (region `respond` of lifecycle_tables.py), and what it
does to the helper (a post cut short is recorded, and a post that went quiet is continued without repeating a step).

Run from the app folder: PYTHONPATH=test python3 -m unittest test/test_respond_lifecycle.py
"""

import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))

import lifecycle_engine as engine  # noqa: E402
import respond_lifecycle as lifecycle  # noqa: E402
import respond_result as respond  # noqa: E402
from test_respond_result import PULL, RespondWorld  # noqa: E402

CASES = json.loads((Path(__file__).parent / "respond-lifecycle.cases.json").read_text(encoding="utf-8"))


class TableTests(unittest.TestCase):
  def test_the_helpers_words_are_the_apps_table_read_for_the_state_word(self):
    by_region = {row["region"]: row["words"]["state"] for row in CASES["words"]}
    # NOT_STARTED has the words of APPROVED: only the app's clock tells them apart.
    self.assertEqual({**by_region, "NOT_STARTED": by_region["APPROVED"]}, lifecycle.STATE_WORDS)
    for word, state in lifecycle.WORD_STATES.items():
      self.assertEqual(lifecycle.STATE_WORDS[state], word)
    self.assertEqual(set(lifecycle.STATE_WORDS) | {"NONE"}, set(lifecycle.TABLES["regions"]["respond"]["states"]))

  def test_a_sequence_of_moves_writes_the_stamp_the_app_reads(self):
    for case in CASES["stamps"]:
      result = json.loads(json.dumps(case["result"]))
      for kind, now, word in case["moves"]:
        lifecycle.stamp(result, kind, now)
        result["state"] = word  # the helper sets its own word beside the stamp
      self.assertEqual(result["lifecycle"], case["vector"], case["name"])

  def test_the_stamp_follows_the_tables_deadline_and_restarts_it_with_every_step(self):
    deadline = lifecycle.TABLES["regions"]["respond"]["states"]["POSTING"]["deadline"]["seconds"]
    result = {"state": "ready"}
    lifecycle.stamp(result, "BEGIN", 100)
    result["state"] = "posting"
    self.assertEqual(result["lifecycle"]["regions"]["respond"], {"state": "POSTING", "since": 100, "deadline": 100 + deadline})
    lifecycle.stamp(result, "PROGRESS", 150)
    self.assertEqual(result["lifecycle"]["regions"]["respond"], {"state": "POSTING", "since": 100, "deadline": 150 + deadline})

  def test_a_stamp_that_contradicts_the_words_is_not_trusted(self):
    result = {"state": "ready"}
    lifecycle.stamp(result, "BEGIN", 100)  # POSTING
    result["state"] = "failed"  # an older helper moved the word and left the stamp
    lifecycle.stamp(result, "BEGIN", 500)
    vector = result["lifecycle"]
    self.assertEqual(vector["regions"]["respond"], {"state": "POSTING", "since": 500, "deadline": 680})
    self.assertEqual([entry["type"] for entry in vector["history"]], ["APPROVE", "CHAT_STARTED"], "started again from the words: failed, approved again, started")
    broken = {"state": "ready", "lifecycle": {"v": 99, "regions": {"respond": {"state": "POSTING", "since": 1, "deadline": 2}}}}
    lifecycle.stamp(broken, "BEGIN", 700)
    self.assertEqual(broken["lifecycle"]["regions"]["respond"]["state"], "POSTING")
    self.assertEqual(broken["lifecycle"]["v"], 1)

  def test_a_move_the_table_does_not_allow_is_replaced_by_the_state_it_names(self):
    result = {"state": "posted"}
    lifecycle.stamp(result, "BEGIN", 100)
    self.assertEqual(result["lifecycle"]["regions"]["respond"]["state"], "POSTING")

  def test_the_vector_is_the_engines_own(self):
    result = {"state": "ready"}
    lifecycle.stamp(result, "BEGIN", 100)
    self.assertEqual(engine.waiting_on(lifecycle.TABLES, result["lifecycle"]), [
      {"region": "respond", "state": "POSTING", "waits": "platform", "since": 100, "deadline": 280}])


class PostStampTests(RespondWorld):
  def history(self) -> list[str]:
    return [entry["type"] for entry in self.saved_result()["lifecycle"]["history"]]

  def test_a_post_stamps_its_start_every_step_and_its_end(self):
    _, _, result = self.approved_result()
    self.assertNotIn("lifecycle", self.saved_result(), "saving stamps nothing: the words say ready")
    self.assertEqual(self.post(result["id"]).code, 0)
    stored = self.saved_result()
    self.assertEqual(stored["lifecycle"]["regions"]["respond"]["state"], "POSTED")
    steps = self.history()
    self.assertEqual(steps[:2], ["APPROVE", "CHAT_STARTED"])
    self.assertEqual(steps[-1], "POST_OK")
    # push, two replies (a note before and a receipt after each), the description, the re-request: every write is progress.
    self.assertGreaterEqual(steps.count("PROGRESS"), 6)
    self.assertEqual(self.history().count("CHAT_STARTED"), 1)

  def test_a_failed_step_stamps_failed_and_keeps_the_receipts(self):
    _, _, result = self.approved_result()
    with mock.patch.object(respond, "confirm_branch_head", side_effect=RuntimeError("boom")):
      self.assertEqual(self.post(result["id"]).code, 4)
    stored = self.saved_result()
    self.assertEqual((stored["state"], stored["lifecycle"]["regions"]["respond"]["state"]), ("failed", "FAILED"))
    self.assertEqual(self.history()[-1], "POST_FAILED")

  def test_a_post_cut_short_by_an_interrupt_is_recorded_as_failed_not_left_on_posting(self):
    _, _, result = self.approved_result()
    with mock.patch.object(respond, "confirm_branch_head", side_effect=KeyboardInterrupt()):
      with self.assertRaises(KeyboardInterrupt):
        self.post(result["id"])
    stored = self.saved_result()
    self.assertEqual(stored["state"], "failed", "before the change this was left on posting")
    self.assertEqual(stored["error"], {"step": "push", "message": "the post was interrupted"})
    self.assertEqual(stored["lifecycle"]["regions"]["respond"]["state"], "FAILED")

  def test_a_post_that_went_quiet_is_continued_and_never_repeats_a_step_that_has_a_receipt(self):
    shas, data, result = self.approved_result()
    with mock.patch.object(respond.Posting, "update_description", side_effect=KeyboardInterrupt()):
      with self.assertRaises(KeyboardInterrupt):
        self.post(result["id"])
    done = [(call["method"], call["path"]) for call in self.gh_writes()]
    self.assertEqual(done, [("POST", "repos/owner/repo/issues/7/comments"), ("POST", "repos/owner/repo/pulls/7/comments/4242/replies")])
    # What a restart leaves behind: the words still say posting, the stamp is old, the one-time permission is spent.
    killed = self.saved_result()
    killed["state"], killed["error"] = "posting", None
    killed["lifecycle"]["regions"]["respond"] = {"state": "POSTING", "since": 1, "deadline": 181}
    self.write_result(killed)
    receipts = killed["receipts"]
    self.assertTrue(receipts["push"] and len(receipts["replies"]) == 2, "the first run's receipts are on disk")
    self.decide(self.saved_result())  # a fresh approval: Try again asks the owner again
    with mock.patch.object(respond, "push_bundle") as push:
      outcome = self.post(result["id"])
    self.assertEqual(outcome.code, 0, outcome.err)
    self.assertIn("Resuming an earlier post: the steps already done are skipped.", outcome.out)
    push.assert_not_called()
    after = [(call["method"], call["path"]) for call in self.gh_writes()]
    self.assertEqual(after[len(done):], [("PATCH", "repos/owner/repo/pulls/7"), ("POST", "repos/owner/repo/pulls/7/requested_reviewers")],
                     "only what had no receipt went out: no reply was sent twice")
    self.assertEqual(after.count(("POST", "repos/owner/repo/issues/7/comments")), 1)
    self.assertEqual(after.count(("POST", "repos/owner/repo/pulls/7/comments/4242/replies")), 1)
    self.assertEqual(self.remote_branch(), shas[1])
    finished = self.saved_result()
    self.assertEqual((finished["state"], finished["lifecycle"]["regions"]["respond"]["state"]), ("posted", "POSTED"))
    types = [entry["type"] for entry in finished["lifecycle"]["history"]]
    quiet = types.index("TIMEOUT")  # the stale stamp was read as a post that went quiet, then the owner's fresh approval and the restart
    self.assertEqual(types[quiet:quiet + 3], ["TIMEOUT", "APPROVE", "CHAT_STARTED"])


class PlainResultTests(RespondWorld):
  def test_a_result_with_no_stamp_is_posted_exactly_as_before(self):
    _, _, result = self.approved_result()
    stored = self.saved_result()
    self.assertNotIn("lifecycle", stored)
    self.assertEqual(self.post(result["id"], "--dry-run").code, 0)
    self.assertNotIn("lifecycle", self.saved_result(), "a dry run leaves no trace, the stamp included")
    self.assertEqual(self.post(result["id"]).code, 0)
    self.assertEqual(self.gh_writes()[0]["path"], f"repos/owner/repo/issues/{PULL.split('#')[1]}/comments")


if __name__ == "__main__":
  unittest.main()
