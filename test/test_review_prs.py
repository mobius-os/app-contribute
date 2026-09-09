"""Approval links are preparation; chat consent is explicit and exact."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("review_prs", Path(__file__).parents[1] / "review_prs.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

ITEM = {"repo": "example/project", "number": 7, "head_sha": "a" * 40,
        "base_ref": "main", "base_sha": "b" * 40, "title": "A change",
        "url": "https://github.com/example/project/pull/7"}


class ApprovalHelperTests(unittest.TestCase):
  def selection(self):
    with patch.object(helper, "inspect_pr", return_value=ITEM):
      return helper.prepare_selection(["example/project#7"], "review_merge", "owning-chat")

  def run_main(self, args, api):
    output = io.StringIO()
    with patch.dict(helper.os.environ, {"CHAT_ID": "owning-chat"}), \
         patch.object(helper, "api", side_effect=api), contextlib.redirect_stdout(output):
      helper.main(["--app-id", "80", *args])
    return json.loads(output.getvalue())

  def test_default_preparation_only_saves_data_and_returns_exact_approval_link(self):
    calls = []
    with patch.object(helper, "inspect_pr", return_value=ITEM):
      result = self.run_main(["--mode", "review_merge", "example/project#7"],
        lambda path, **kwargs: calls.append((path, kwargs)))
    self.assertEqual(len(calls), 1)
    self.assertEqual(calls[0][1]["method"], "PUT")
    self.assertEqual(calls[0][1]["headers"], {"If-None-Match": "*"})
    self.assertIn("/review-selections/", calls[0][0])
    self.assertIn("intent=review-selection%3A" + result["selection"]["request_id"], result["approval_url"])
    self.assertFalse(result["approved"])

  def test_explicit_chat_consent_posts_original_versions_without_refresh(self):
    selected = self.selection()
    calls = []
    def api(path, **kwargs):
      calls.append((path, kwargs))
      return {"run": {"chat_id": "owning-chat"}, "brief": "Review exact selection"} if kwargs else selected
    with patch.object(helper, "inspect_pr", side_effect=AssertionError("Advanced saved selection")):
      result = self.run_main(["--selection", selected["request_id"], "--approved-in-chat",
                             "--approval-context", "The owner approved these exact PRs."], api)
    self.assertTrue(result["approved"])
    body = calls[-1][1]["data"]
    self.assertEqual(body["items"], [{key: ITEM[key] for key in helper.IDENTITY_FIELDS}])
    self.assertEqual(body["chat_approval"]["context"], "The owner approved these exact PRs.")
    self.assertEqual(calls[-1][0], "/api/github/contributions/80/review-runs")

  def test_another_source_chat_cannot_borrow_approval(self):
    selected = {**self.selection(), "source_chat_id": "other-chat"}
    calls = []
    with self.assertRaisesRegex(ValueError, "another source chat"):
      self.run_main(["--selection", selected["request_id"], "--approved-in-chat",
                     "--approval-context", "Approved elsewhere"],
        lambda path, **kwargs: calls.append((path, kwargs)) or selected)
    self.assertEqual(len(calls), 1)
    self.assertEqual(calls[0][1], {})

  def test_repeat_preparation_has_same_identity_but_changed_head_or_mode_does_not(self):
    one = self.selection()
    self.assertEqual(one["request_id"], self.selection()["request_id"])
    with patch.object(helper, "inspect_pr", return_value={**ITEM, "head_sha": "c" * 40}):
      changed = helper.prepare_selection(["example/project#7"], "review_merge", "owning-chat")
    self.assertNotEqual(one["request_id"], changed["request_id"])
    with patch.object(helper, "inspect_pr", return_value=ITEM):
      review = helper.prepare_selection(["example/project#7"], "review", "owning-chat")
    self.assertNotEqual(one["request_id"], review["request_id"])

  def test_approval_needs_both_explicit_flag_and_context(self):
    for args in (["--approved-in-chat"], ["--approval-context", "yes"],
                 ["--approved-in-chat", "--approval-context", " "]):
      with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
        self.run_main(args, lambda *a, **kw: self.fail("No I/O before explicit consent"))

  def test_selection_id_cannot_escape_app_data(self):
    with self.assertRaises(ValueError):
      helper.selection_path(80, "../another-app")

  def test_existing_other_review_returns_owning_chat_link_without_second_request(self):
    from urllib.error import HTTPError
    selected = self.selection()
    calls = []
    def api(path, **kwargs):
      calls.append((path, kwargs))
      if kwargs:
        payload = {"detail": {"chat_id": "existing-review", "message": "Already owned"}}
        raise HTTPError(path, 409, "Conflict", {}, io.BytesIO(json.dumps(payload).encode()))
      return selected
    result = self.run_main(["--selection", selected["request_id"], "--approved-in-chat",
                           "--approval-context", "The owner approved these exact PRs."], api)
    self.assertTrue(result["already_owned"])
    self.assertFalse(result["approved"])
    self.assertEqual(result["review_url"], "/shell/?chat=existing-review")
    self.assertEqual(len(calls), 2)


if __name__ == "__main__":
  unittest.main()
