"""settle_exit.py: the agent's way to record the owner's exit from a finished PR that waits on them.

Its pure half answers the same cases as the app's writer (lifecycle-write.js `settleRecord`; test/held-records.test.mjs reads the same
file); its other half writes as every writer of a record does, only if the record is still the version it read.
"""
import contextlib
import io
import json
import unittest
import urllib.error
from pathlib import Path

import settle_exit

CASES = json.loads((Path(__file__).parent / "lifecycle-settle.cases.json").read_text())
PATH = "/api/storage/apps/10/contributions/%s.json"
HELD = next(case["record"] for case in CASES["cases"] if case["exit"] == "DISCARD_UPDATE" and case["expect"] and case["record"]["status"] == "closed")


class SharedCasesTest(unittest.TestCase):
  def test_every_case_the_app_answers_is_answered_the_same_way(self):
    for case in CASES["cases"]:
      with self.subTest(case["name"]):
        settled = settle_exit.settle_record(case["record"], case["exit"], case["successor"], CASES["now"], CASES["iso"])
        expect = case["expect"]
        if expect is None:
          self.assertIsNone(settled)
          continue
        regions = settled["lifecycle"]["regions"]
        self.assertEqual([regions["publication"]["state"], regions["update"]["state"]], [expect["regions"]["publication"], expect["regions"]["update"]])
        for field, value in expect["fields"].items():
          self.assertEqual(settled.get(field), value, field)
        self.assertEqual(settled["lifecycle"]["history"][-1]["type"], case["exit"])


class Ledger:
  """The storage API as one record's versions: GET with its ETag, PUT only with If-Match of the current one."""

  def __init__(self, **records):
    self.records = {name: (json.dumps(record).encode(), 1) for name, record in records.items()}
    self.writes = []
    self.race = None

  def __call__(self, method, path, body=None, headers=None):
    if path == "/api/apps/":
      return json.dumps([{"id": 9, "slug": "other"}, {"id": 10, "slug": "contribute"}]).encode(), {}
    name = path.removeprefix("/api/storage/apps/10/contributions/").removesuffix(".json")
    if method == "GET":
      if name not in self.records:
        raise urllib.error.HTTPError(path, 404, "not found", {}, None)
      raw, version = self.records[name]
      return raw, {"ETag": '"v%d"' % version}
    if self.race:
      self.records[name] = (self.records[name][0], self.records[name][1] + 1)
      self.race = None
    if (headers or {}).get("If-Match") != '"v%d"' % self.records[name][1]:
      raise urllib.error.HTTPError(path, 412, "precondition failed", {}, None)
    self.records[name] = (json.dumps(body).encode(), self.records[name][1] + 1)
    self.writes.append((name, body))
    return b"", {}


class WriteTest(unittest.TestCase):
  def test_a_held_record_is_written_once_with_the_version_it_was_read_at(self):
    ledger = Ledger(**{"held-1": HELD})
    settled = settle_exit.settle(ledger, "10", "held-1", "DISCARD_UPDATE", now=CASES["now"])
    self.assertEqual(ledger.writes, [("held-1", settled)])
    self.assertEqual(settled["update_outcome"]["exit"], "DISCARD_UPDATE")
    self.assertEqual(settled["lifecycle"]["regions"]["update"]["state"], "NONE")

  def test_a_successor_must_exist_in_the_ledger(self):
    ledger = Ledger(**{"held-1": HELD})
    with self.assertRaisesRegex(settle_exit.Refused, "no record new-1"):
      settle_exit.settle(ledger, "10", "held-1", "PRESERVE_AS_NEW", "new-1", now=CASES["now"])
    ledger = Ledger(**{"held-1": HELD, "new-1": {"id": "new-1", "type": "pr", "status": "prepared"}})
    settled = settle_exit.settle(ledger, "10", "held-1", "PRESERVE_AS_NEW", "new-1", now=CASES["now"])
    self.assertEqual(settled["update_outcome"]["successor"], "new-1")

  def test_a_record_that_does_not_accept_the_exit_is_refused_and_nothing_is_written(self):
    ledger = Ledger(**{"held-1": HELD, "held-2": {"id": "held-2", "type": "pr", "status": "prepared"}})
    with self.assertRaisesRegex(settle_exit.Refused, "does not accept OWNER_RELANDS"):
      settle_exit.settle(ledger, "10", "held-1", "OWNER_RELANDS", "held-2", now=CASES["now"])
    self.assertEqual(ledger.writes, [])
    with self.assertRaisesRegex(settle_exit.Refused, "no record missing"):
      settle_exit.settle(ledger, "10", "missing", "DISCARD_UPDATE")

  def test_a_record_that_changed_under_the_write_is_not_overwritten(self):
    ledger = Ledger(**{"held-1": HELD})
    ledger.race = True
    with self.assertRaises(settle_exit.Changed):
      settle_exit.settle(ledger, "10", "held-1", "DISCARD_UPDATE", now=CASES["now"])
    self.assertEqual(ledger.writes, [])


class CommandTest(unittest.TestCase):
  def run_main(self, ledger, *argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
      code = settle_exit.main(list(argv), call=ledger)
    return code, out.getvalue(), err.getvalue()

  def test_exit_codes_say_what_happened(self):
    ledger = Ledger(**{"held-1": HELD})
    code, out, _ = self.run_main(ledger, "held-1", "DISCARD_UPDATE")
    self.assertEqual((code, out), (0, "Saved: held-1 is now closed (DISCARD_UPDATE).\n"))
    code, _, err = self.run_main(ledger, "held-1", "DISCARD_UPDATE")
    self.assertEqual(code, 2, "settled already: not held any more")
    self.assertIn("does not accept", err)
    racing = Ledger(**{"held-1": HELD})
    racing.race = True
    self.assertEqual(self.run_main(racing, "held-1", "DISCARD_UPDATE")[0], 3)

  def test_a_word_that_is_no_exit_is_not_run(self):
    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
      settle_exit.main(["held-1", "SEND"], call=Ledger())


if __name__ == "__main__":
  unittest.main()
