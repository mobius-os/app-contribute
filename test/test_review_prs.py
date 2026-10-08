"""Approval links are preparation; chat consent is explicit and exact."""
import contextlib
import importlib.util
import io
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("review_prs", Path(__file__).parents[1] / "review_prs.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

ITEM = {"repo": "example/project", "number": 7, "head_sha": "a" * 40,
        "base_ref": "main", "base_sha": "b" * 40, "title": "A change",
        "url": "https://github.com/example/project/pull/7"}
SNAPSHOT = {"review_prompt": "Review exact diff", "fix_prompt": "Fix findings",
            "merge_prompt": "Use guarded endpoint", "max_rounds": 5, "autopilot": False,
            "provider": "codex", "model": "test-model", "reasoning_effort": "high"}
PREVIEW = {"options": SNAPSHOT, "preview_sha256": hashlib.sha256(json.dumps(SNAPSHOT, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()}


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
    def api(path, **kwargs):
      calls.append((path, kwargs))
      return PREVIEW if path.endswith("/review-preview") else None
    with patch.object(helper, "inspect_pr", return_value=ITEM):
      result = self.run_main(["--mode", "review_merge", "example/project#7"], api)
    self.assertEqual(len(calls), 2)
    self.assertTrue(calls[0][0].endswith("/review-preview"))
    self.assertEqual(calls[1][1]["method"], "PUT")
    self.assertEqual(calls[1][1]["headers"], {"If-None-Match": "*"})
    self.assertIn("/review-selections/", calls[1][0])
    self.assertEqual(result["selection"]["resolved_snapshot"], SNAPSHOT)
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

  def test_inspection_binds_current_target_tip_not_pull_comparison_base(self):
    pull = {
      "state": "open", "merged": False,
      "base": {"ref": "release/next", "sha": "c" * 40,
               "repo": {"full_name": "Example/Project"}},
      "head": {"sha": "a" * 40}, "title": "A change",
      "html_url": "https://github.com/Example/Project/pull/7",
    }
    results = [SimpleNamespace(stdout=json.dumps(pull)),
               SimpleNamespace(stdout=json.dumps({"object": {"sha": "b" * 40}}))]
    with patch.object(helper.subprocess, "run", side_effect=results) as run:
      item = helper.inspect_pr("example/project#7")
    self.assertEqual(item["base_sha"], "b" * 40)
    self.assertEqual(run.call_args_list[1].args[0][-1],
                     "repos/Example/Project/git/ref/heads/release%2Fnext")

  def test_approval_needs_both_explicit_flag_and_context(self):
    for args in (["--approved-in-chat"], ["--approval-context", "yes"],
                 ["--approved-in-chat", "--approval-context", " "]):
      with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
        self.run_main(args, lambda *a, **kw: self.fail("No I/O before explicit consent"))

  def test_selection_id_cannot_escape_app_data(self):
    with self.assertRaises(ValueError):
      helper.selection_path(80, "../another-app")

  def test_new_prompts_and_model_cannot_be_resolved_after_claimed_consent(self):
    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
      self.run_main(["example/project#7", "--mode", "review_fix_merge",
                     "--approved-in-chat", "--approval-context", "yes"],
        lambda *a, **kw: self.fail("Freeze and present snapshot before consent, not during start"))

  def test_takeover_freezes_before_approval_and_posts_scoped_original_snapshot(self):
    with patch.object(helper, "inspect_pr", return_value=ITEM), patch.object(helper, "api", return_value=PREVIEW):
      selected = helper.freeze_preview(80, helper.prepare_selection(["example/project#7"], "review_fix_merge", "owning-chat"))
    calls = []
    def api(path, **kwargs):
      calls.append((path, kwargs))
      return {"run": {"chat_id": "owning-chat"}} if kwargs else selected
    with patch.object(helper, "inspect_pr", side_effect=AssertionError("Refreshed saved head")):
      result = self.run_main(["--selection", selected["request_id"], "--approved-in-chat",
                             "--approval-context", "Owner approved named repairs and reviewed successors."], api)
    self.assertTrue(result["approved"])
    self.assertEqual(len(calls), 2)
    body = calls[-1][1]["data"]
    self.assertEqual(body["confirmation_scope"], helper.TAKEOVER_SCOPE)
    self.assertEqual(body["preview_sha256"], PREVIEW["preview_sha256"])
    self.assertEqual(body["agent"], {"provider": "codex", "model": "test-model", "effort": "high"})
    self.assertFalse(body["options"]["autopilot"])
    self.assertEqual(body["items"][0]["head_sha"], ITEM["head_sha"])

  def test_draft_ready_permission_requires_a_fresh_explicit_preview_scope(self):
    with patch.object(helper, "api", return_value=PREVIEW):
      selected={**self.selection(), "mode":"review_fix_merge", "items":[{**ITEM,"is_draft":True}]}
      with self.assertRaisesRegex(ValueError,"allow-mark-ready"):
        helper.freeze_preview(80,selected)
      frozen=helper.freeze_preview(80,selected,allow_mark_ready=True)
      self.assertEqual(frozen["confirmation_scope"], helper.DRAFT_TAKEOVER_SCOPE)
      self.assertEqual(helper.start_body(frozen)["confirmation_scope"], helper.DRAFT_TAKEOVER_SCOPE)
      self.assertNotIn("is_draft", helper.start_body(frozen)["items"][0])
      edited={**frozen,"confirmation_scope":helper.TAKEOVER_SCOPE}
      with self.assertRaisesRegex(ValueError,"identity changed"):
        helper.verify_selection(edited)
      with self.assertRaisesRegex(ValueError,"requires review_fix_merge"):
        helper.freeze_preview(80,self.selection(),allow_mark_ready=True)

  def test_uncapped_saved_preview_preserves_explicit_null_through_guarded_start(self):
    snapshot = {**SNAPSHOT, "max_rounds": None}
    preview = {"options": snapshot, "preview_sha256": hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()}
    with patch.object(helper, "inspect_pr", return_value=ITEM), patch.object(helper, "api", return_value=preview):
      selection = helper.freeze_preview(80, helper.prepare_selection(["example/project#7"], "review_fix_merge", "owning-chat"))
    body = helper.start_body(selection)
    self.assertIsNone(selection["options"]["max_rounds"])
    self.assertIsNone(body["options"]["max_rounds"])
    self.assertEqual(body["preview_sha256"], preview["preview_sha256"])

  def test_public_review_opt_in_is_frozen_and_forwarded_without_becoming_default(self):
    for enabled in (False, True):
      snapshot = {**SNAPSHOT, "post_review": enabled}
      preview = {"options": snapshot, "preview_sha256": hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()}
      with patch.object(helper, "api", return_value=preview):
        selected = helper.freeze_preview(80, {**self.selection(), "mode": "review_fix_merge"})
      self.assertIs(selected["options"].get("post_review"), enabled)
      self.assertIs(helper.start_body(selected)["options"].get("post_review"), enabled)
      helper.verify_selection(selected)
    # Existing immutable saved previews predate this opt-in and stay valid.
    with patch.object(helper, "api", return_value=PREVIEW):
      legacy = helper.freeze_preview(80, self.selection())
    self.assertNotIn("post_review", legacy["options"])
    helper.verify_selection(legacy)

  def test_saved_takeover_cannot_use_legacy_grant_without_preview(self):
    with self.assertRaisesRegex(ValueError, "frozen"):
      helper.start_body({**self.selection(), "mode": "review_fix_merge"})

  def test_options_or_model_changes_need_a_new_selection_not_mutation(self):
    for flag in ("--options", "--agent"):
      with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
        self.run_main(["--selection", "selection-123", flag, "unread.json"],
          lambda *a, **kw: self.fail("No I/O for changed saved consent"))
    with patch.object(helper, "api", return_value=PREVIEW):
      one = helper.freeze_preview(80, self.selection())
    new_snapshot = {**SNAPSHOT, "review_prompt": "New prompt"}
    new_hash = hashlib.sha256(json.dumps(new_snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    with patch.object(helper, "api", return_value={"options": new_snapshot, "preview_sha256": new_hash}):
      two = helper.freeze_preview(80, self.selection())
    self.assertNotEqual(one["request_id"], two["request_id"])

  def test_lost_save_response_cannot_replace_frozen_consent(self):
    from urllib.error import HTTPError
    with patch.object(helper, "api", return_value=PREVIEW):
      selected = helper.freeze_preview(80, self.selection())
    changed = {**selected, "preview_sha256": "e" * 64}
    with patch.object(helper, "api", side_effect=[HTTPError("url", 412, "exists", {}, None), changed]):
      with self.assertRaisesRegex(ValueError, "saved selection changed"):
        helper.save_selection(80, selected)

  def test_edited_saved_head_retaining_request_id_never_reaches_start(self):
    selected = self.selection()
    selected["items"] = [{**ITEM, "head_sha": "c" * 40}]
    calls = []
    with self.assertRaisesRegex(ValueError, "identity changed"):
      self.run_main(["--selection", selected["request_id"], "--approved-in-chat",
                     "--approval-context", "yes"], lambda p, **kw: calls.append((p, kw)) or selected)
    self.assertEqual(len(calls), 1)
    self.assertEqual(calls[0][1], {})

  def test_resolved_snapshot_cannot_disagree_with_frozen_start_options(self):
    with patch.object(helper, "api", return_value=PREVIEW):
      selected = helper.freeze_preview(80, self.selection())
    selected["resolved_snapshot"] = {**selected["resolved_snapshot"], "model": "another-model"}
    with self.assertRaisesRegex(ValueError, "frozen preview changed"):
      helper.verify_selection(selected)

  def test_backend_preview_drift_never_refreshes_or_retries_consent(self):
    from urllib.error import HTTPError
    with patch.object(helper, "api", return_value=PREVIEW):
      selected = helper.freeze_preview(80, self.selection())
    calls = []
    def api(p, **kw):
      calls.append((p, kw))
      if kw:
        raise HTTPError(p, 409, "changed", {}, io.BytesIO(json.dumps({"detail": "The resolved prompts or model changed"}).encode()))
      return selected
    with self.assertRaisesRegex(ValueError, "prompts or model changed"):
      self.run_main(["--selection", selected["request_id"], "--approved-in-chat", "--approval-context", "yes"], api)
    self.assertEqual(len(calls), 2)

  def test_legacy_saved_selection_cannot_acquire_autopilot_without_new_preview(self):
    selected = {**self.selection(), "options": {"autopilot": True}}
    calls = []
    with self.assertRaisesRegex(ValueError, "Legacy selections cannot acquire"):
      self.run_main(["--selection", selected["request_id"], "--approved-in-chat", "--approval-context", "yes"],
                    lambda p, **kw: calls.append((p, kw)) or selected)
    self.assertEqual(len(calls), 1)

  def test_app_missing_points_to_core_workflow_without_install_requirement(self):
    with patch.object(helper, "api", return_value=[]), self.assertRaisesRegex(ValueError, "core GitHub review workflows"):
      helper.find_app_id()

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
