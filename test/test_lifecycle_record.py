"""The Python record selectors answer what lifecycle-record.js answers (test/lifecycle-record.test.mjs)."""
from __future__ import annotations

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lifecycle_record import regions_of, sendable_now, stranded_update, vector_of  # noqa: E402

PULL = {"number": 5, "url": "https://github.com/o/r/pull/5"}


def waiting_update(**more: object) -> dict:
  return {"type": "pr", "status": "prepared", **PULL, "plan": {"action": "pr_update", "head_sha": "b" * 40}, **more}


def states(record: dict, now: int = 100) -> tuple:
  found = regions_of(record, now)
  return (found["publication"], found["update"]) if found else (None, None)


class Selectors(unittest.TestCase):
  def test_an_update_waiting_on_a_public_pull_request_is_public_and_waiting(self) -> None:
    self.assertEqual(states(waiting_update()), ("OPEN", "PREPARED_UPDATE"))
    self.assertEqual(states({"type": "pr", "status": "prepared", "plan": {"action": "pr"}}), ("PREPARED", "NONE"))
    self.assertIsNone(regions_of({"type": "issue_comment", "status": "commented"}, 100))
    self.assertFalse(stranded_update(waiting_update(), 100))

  def test_a_record_is_sendable_now_only_when_nothing_is_held_or_failed(self) -> None:
    ready = {"type": "pr", "status": "prepared", "plan": {"action": "pr"}}
    self.assertTrue(sendable_now(ready, 100))
    self.assertTrue(sendable_now(waiting_update(), 100))
    for more in ({"needs_attention": True}, {"last_submit_error": "refused"}, {"last_submit_stage": "push_ambiguous"},
                 {"status": "submitting"}, {"status": "draft"}, {"status": "abandoned"}):
      with self.subTest(more):
        self.assertFalse(sendable_now({**ready, **more}, 100))
    self.assertFalse(sendable_now({"id": "untracked", "status": "prepared"}, 100))

  def test_a_stored_attention_flag_holds_a_record_the_status_word_calls_ready(self) -> None:
    ready = {"type": "pr", "status": "prepared", "plan": {"action": "pr"}}
    stored = vector_of(ready, 100)
    self.assertTrue(sendable_now({**ready, "lifecycle": stored}, 100))
    flagged = {**stored, "attention": {"flags": ["checks_failed"]}}
    self.assertFalse(sendable_now({**ready, "lifecycle": flagged}, 100))

  def test_a_refused_update_is_a_refusal_not_a_lost_send_once_the_pushed_version_is_not_the_plans(self) -> None:
    def refused(pushed: str) -> tuple:
      more = {"last_submit_stage": "pushed", "last_submit_error": "Nothing was pushed."}
      return states(waiting_update(**more, **({"last_submit_push_sha": pushed} if pushed else {})))
    self.assertEqual(refused("a" * 40), ("OPEN", "PREPARED_UPDATE"))
    self.assertEqual(refused("b" * 40), ("OPEN", "UPDATE_UNCERTAIN"))
    self.assertEqual(refused(""), ("OPEN", "UPDATE_UNCERTAIN"))

  def test_a_record_an_older_app_abandoned_while_its_update_waited_reads_as_the_live_pull_request(self) -> None:
    stored = vector_of(waiting_update(), 100)
    self.assertEqual(states({**waiting_update(status="abandoned"), "lifecycle": stored}, 200), ("OPEN", "NONE"))
    self.assertEqual(states({"type": "pr", "status": "abandoned", "plan": {"action": "pr"}}, 200), ("ABANDONED", "NONE"))

  def test_an_abandoned_update_with_no_stored_lifecycle_reads_as_the_live_pull_request_it_still_is(self) -> None:
    abandoned = waiting_update(status="abandoned")
    self.assertNotIn("lifecycle", abandoned)
    self.assertEqual(states(abandoned, 200), ("OPEN", "NONE"))
    self.assertFalse(sendable_now(abandoned, 200))
    self.assertFalse(stranded_update(abandoned, 200))
    self.assertEqual(states({"type": "pr", "status": "abandoned", "plan": {"action": "pr_update"}}, 200), ("ABANDONED", "NONE"))
    self.assertEqual(states({"type": "pr", "status": "abandoned", **PULL, "plan": {"action": "pr"}}, 200), ("ABANDONED", "NONE"))


if __name__ == "__main__":
  unittest.main()
