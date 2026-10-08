import os
import re
import unittest

JOB = os.path.join(os.path.dirname(__file__), "..", "job.sh")


def _job_python():
  with open(JOB, encoding="utf-8") as source:
    text = source.read()
  start = text.index("python3 - <<'PY'")
  body = text[text.index("\n", start) + 1:]
  return body[:body.index("\nPY\n")]


def _load_record_target(app_id="80"):
  source = _job_python()
  start = source.index("_RECORD_INTENT_ID = ")
  end = source.index("\ndef _notify_attention")
  scope = {"re": re, "APP_ID": app_id}
  exec(source[start:end], scope)
  return scope["_record_target"]


class ContributionPushTest(unittest.TestCase):
  def test_a_push_opens_its_own_contribution(self):
    target = _load_record_target()
    self.assertEqual(
      target({"id": "fixture-record-20260101"}),
      "/shell/?app=80&intent=review:fixture-record-20260101",
    )

  def test_an_unusable_record_id_still_opens_the_app(self):
    target = _load_record_target()
    self.assertEqual(target({"id": "../x y"}), "/shell/?app=80")
    self.assertEqual(target({}), "/shell/?app=80")
    self.assertEqual(target({"id": "fixture-record\n"}), "/shell/?app=80")

  def test_every_contribution_push_links_to_its_record(self):
    source = _job_python()
    self.assertNotIn('"target": "/shell/?app=%s" % APP_ID', source)
    self.assertEqual(source.count('"target": _record_target(rec)'), 3)

  def test_a_standing_attention_flag_is_announced_only_once(self):
    # Only an attention key raised by this pass reaches the owner; a flag
    # left from an earlier pass (or a platform escalation) is re-offered to
    # the autopilot loop only, never pushed again.
    source = _job_python()
    calls = re.findall(r"(?<!def )_notify_attention\((\w+), (\w+)\)", source)
    self.assertEqual(calls, [("updated", "attention_notice")])


if __name__ == "__main__":
  unittest.main()
