"""Contribute's review CLI is a thin adapter: the platform workflow owns
inspection, frozen previews and admission; the app owns its link and block."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("review_prs", Path(__file__).parents[1] / "review_prs.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

ITEM = {"repo": "example/project", "number": 7, "head_sha": "a" * 40, "base_ref": "main", "base_sha": "b" * 40}


class FakeCore:
  """Records exactly what the adapter delegates to the platform workflow."""
  def __init__(self, capabilities=None, responses=None):
    self.calls, self.capabilities, self.responses = [], capabilities or {}, responses or {}
  def review_path(self, app_id, suffix):
    return (f"/api/github/contributions/{app_id}" if app_id is not None else "/api/github") + suffix
  def prepare_selection(self, references, mode, chat_id, app_id=None):
    self.calls.append(("prepare", tuple(references), mode, chat_id, app_id))
    return {"request_id": "selection-" + "1" * 32, "mode": mode, "source_chat_id": chat_id, "app_id": app_id, "items": [ITEM]}
  def freeze_preview(self, selection, options=None, agent=None):
    self.calls.append(("freeze", selection["mode"], options, agent))
    return {**selection, "preview_sha256": "f" * 64, "options": {"autopilot": False}, "agent": {"provider": "codex", "model": "m", "effort": None}}
  def verify_selection(self, selection):
    self.calls.append(("verify", selection["request_id"]))
    if selection.get("tampered"):
      raise ValueError("The saved selection identity changed.")
  def start_body(self, selection):
    return {"request_id": selection["request_id"], "mode": selection["mode"], "source_chat_id": selection["source_chat_id"], "items": selection["items"]}
  def api(self, path, **kwargs):
    self.calls.append(("api", path, kwargs.get("method", "GET"), kwargs.get("data"), kwargs.get("headers")))
    if path.endswith("/review-presets"):
      return {"presets": {}, "capabilities": self.capabilities}
    response = self.responses.get((kwargs.get("method", "GET"), path))
    if isinstance(response, Exception):
      raise response
    return response


def run(core, *args, chat="owning-chat"):
  output = io.StringIO()
  with patch.dict(os.environ, {"CHAT_ID": chat}), contextlib.redirect_stdout(output):
    adapter.main(["--app-id", "80", *args], core=core)
  text = output.getvalue()
  return text if text.startswith("```") else json.loads(text)


class AdapterTests(unittest.TestCase):
  def options_file(self, value):
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(value, handle); handle.close()
    self.addCleanup(os.unlink, handle.name)
    return handle.name

  def test_options_a_mode_cannot_freeze_are_refused_before_any_preview(self):
    refusals = [
      ("review", {"fix_prompt": "Fix it"}, "fix_prompt is only accepted with --mode review_fix_merge"),
      ("review", {"max_rounds": 2}, "max_rounds is only accepted with --mode review_fix_merge"),
      ("review_merge", {"post_review": True}, "post_review is only accepted with --mode review"),
      ("review", {"autopilot": False}, "autopilot is not supported"),
      ("review_fix_merge", {"autopilot": True}, "autopilot is not supported"),
      ("review_fix_merge", {"max_rounds": 0}, "max_rounds must be a whole number"),
      ("review_fix_merge", {"max_rounds": 2 ** 53}, "max_rounds must be a whole number from 1 to 9007199254740991"),
      ("review_fix_merge", {"max_rounds": 2.0}, "max_rounds must be a whole number"),
      ("review_fix_merge", {"max_rounds": True}, "max_rounds must be a whole number"),
      ("review", {"post_review": False}, "post_review may only be true"),
      ("review", {"review_prompt": " "}, "review_prompt must be non-empty text"),
      ("review", {"surprise": 1}, "Unknown review option: surprise"),
    ]
    for mode, options, message in refusals:
      with self.subTest(mode=mode, options=options):
        core = FakeCore({"review_fix_merge": True})
        with self.assertRaises(ValueError) as raised:
          run(core, "--mode", mode, "--options", self.options_file(options), "example/project#7")
        self.assertIn(message, str(raised.exception))
        self.assertFalse(any(call[0] == "freeze" for call in core.calls), "nothing was previewed or frozen")

  def test_options_a_mode_accepts_are_frozen_unchanged(self):
    for mode, options in [("review", {"review_prompt": "R", "merge_prompt": "M", "post_review": True}),
                          ("review_merge", {"review_prompt": "R", "merge_prompt": "M"}),
                          ("review_fix_merge", {"review_prompt": "R", "fix_prompt": "F", "max_rounds": 3}),
                          ("review_fix_merge", {"max_rounds": 2 ** 53 - 1})]:
      with self.subTest(mode=mode):
        core = FakeCore({"review_fix_merge": True})
        run(core, "--mode", mode, "--options", self.options_file(options), "example/project#7")
        self.assertIn(("freeze", mode, options, None), core.calls)

  def test_preparation_delegates_to_the_core_with_app_context_and_saves_only_the_link(self):
    core = FakeCore()
    result = run(core, "--mode", "review_merge", "example/project#7")
    self.assertIn(("prepare", ("example/project#7",), "review_merge", "owning-chat", 80), core.calls)
    self.assertIn(("freeze", "review_merge", None, None), core.calls)
    saves = [call for call in core.calls if call[0] == "api" and call[2] == "PUT"]
    self.assertEqual(len(saves), 1)
    self.assertEqual(saves[0][1], "/api/storage/apps/80/review-selections/selection-" + "1" * 32 + ".json")
    self.assertEqual(saves[0][4], {"If-None-Match": "*"})
    self.assertFalse(result["approved"])
    self.assertIn("intent=review-selection%3Aselection-" + "1" * 32, result["approval_url"])
    self.assertFalse(any(call[0] == "api" and call[1].endswith("/review-runs") for call in core.calls), "preparing is not consent")

  def test_explicit_chat_consent_posts_the_core_body_and_returns_a_run_block(self):
    saved = {"request_id": "selection-" + "2" * 32, "mode": "review", "source_chat_id": "owning-chat", "items": [ITEM]}
    run_view = {"id": "run-12345678", "mode": "review", "state": "reviewing", "items": [ITEM]}
    core = FakeCore(responses={("GET", "/api/storage/apps/80/review-selections/" + saved["request_id"] + ".json"): saved,
      ("POST", "/api/github/contributions/80/review-runs"): {"run": run_view}})
    result = run(core, "--selection", saved["request_id"], "--approved-in-chat", "--approval-context", "Owner asked: review #7")
    posts = [call for call in core.calls if call[0] == "api" and call[2] == "POST"]
    self.assertEqual(posts, [("api", "/api/github/contributions/80/review-runs", "POST",
      {**core.start_body(saved), "chat_approval": {"context": "Owner asked: review #7"}}, None)])
    self.assertIn(("verify", saved["request_id"]), core.calls)
    self.assertTrue(result["approved"])
    block = json.loads(result["block"].split("\n")[1])
    self.assertEqual(block["intent"], "review-run:run-12345678")
    self.assertIs(block["inline"], False)
    self.assertNotIn("action", block)

  def test_another_chat_or_an_edited_selection_cannot_borrow_consent(self):
    for saved, message in [({"request_id": "selection-" + "3" * 32, "mode": "review", "source_chat_id": "other-chat", "items": [ITEM]}, "another source chat"),
                           ({"request_id": "selection-" + "3" * 32, "mode": "review", "source_chat_id": "owning-chat", "items": [ITEM], "tampered": True}, "identity changed")]:
      core = FakeCore(responses={("GET", "/api/storage/apps/80/review-selections/" + saved["request_id"] + ".json"): saved})
      with self.assertRaisesRegex(ValueError, message):
        run(core, "--selection", saved["request_id"], "--approved-in-chat", "--approval-context", "Owner asked")
      self.assertFalse(any(call[0] == "api" and call[2] == "POST" for call in core.calls))

  def test_unadvertised_workflows_are_refused_before_any_preview(self):
    with self.assertRaisesRegex(ValueError, "does not offer Review, fix & merge"):
      run(FakeCore(), "--mode", "review_fix_merge", "example/project#7")
    with self.assertRaisesRegex(ValueError, "draft takeover"):
      run(FakeCore({"review_fix_merge": True}), "--mode", "review_fix_merge", "--allow-mark-ready", "example/project#7")
    core = FakeCore({"review_fix_merge": True, "draft_takeover": True})
    with self.assertRaisesRegex(ValueError, "cannot freeze draft readiness"):
      run(core, "--mode", "review_fix_merge", "--allow-mark-ready", "example/project#7")
    self.assertFalse(any(call[0] == "freeze" for call in core.calls))

  def test_existing_owner_is_returned_without_a_second_request(self):
    saved = {"request_id": "selection-" + "4" * 32, "mode": "review", "source_chat_id": "owning-chat", "items": [ITEM]}
    conflict = HTTPError("u", 409, "conflict", {}, io.BytesIO(json.dumps({"detail": {"chat_id": "review-chat", "message": "Owned"}}).encode()))
    core = FakeCore(responses={("GET", "/api/storage/apps/80/review-selections/" + saved["request_id"] + ".json"): saved,
      ("POST", "/api/github/contributions/80/review-runs"): conflict})
    result = run(core, "--selection", saved["request_id"], "--approved-in-chat", "--approval-context", "Owner asked")
    self.assertTrue(result["already_owned"])
    self.assertEqual(result["review_url"], "/shell/?chat=review-chat")

  def test_lost_save_response_keeps_the_existing_identical_link(self):
    conflict = HTTPError("u", 412, "exists", {}, io.BytesIO(b"{}"))
    path = "/api/storage/apps/80/review-selections/selection-" + "1" * 32 + ".json"
    core = FakeCore(responses={("PUT", path): conflict})
    previous = {**FakeCore().freeze_preview(FakeCore().prepare_selection(["x"], "review", "owning-chat", 80))}
    core.responses[("GET", path)] = previous
    result = run(core, "example/project#7")
    self.assertEqual(result["selection"], previous)
    core.responses[("GET", path)] = {**previous, "mode": "review_merge"}
    with self.assertRaisesRegex(ValueError, "saved selection changed"):
      run(core, "example/project#7")

  def test_run_block_reads_the_exact_run_even_beyond_the_recent_list(self):
    missing = HTTPError("u", 404, "missing", {}, io.BytesIO(b"{}"))
    core = FakeCore(responses={("GET", "/api/github/contributions/80/review-runs"): {"runs": []},
      ("GET", "/api/github/contributions/80/review-runs/run-87654321"): {"run": {"id": "run-87654321", "mode": "review_merge", "execution_state": "running", "items": [ITEM]}},
      ("GET", "/api/github/contributions/80/review-runs/run-00000000"): missing})
    printed = run(core, "--block", "run-87654321")
    block = json.loads(printed.split("\n")[1])
    self.assertEqual((block["intent"], block["title"]), ("review-run:run-87654321", "Review & merge"))
    self.assertIn({"label": "Pull requests", "value": "example/project#7"}, block["facts"])
    self.assertFalse(any(call[1].endswith("/review-runs") for call in core.calls if call[0] == "api"), "the capped list is not consulted")
    with self.assertRaisesRegex(ValueError, "not in Contribute"):
      run(core, "--block", "run-00000000")
    with self.assertRaisesRegex(ValueError, "Invalid run identity"):
      run(core, "--block", "../escape")

  def test_run_block_names_public_effects(self):
    base = {"id": "run-12345678", "mode": "review", "items": [ITEM]}
    self.assertEqual(adapter.run_block({**base, "options": {"post_review": False}})["title"], "Private review")
    self.assertEqual(adapter.run_block({**base, "options": {"post_review": True}})["title"], "GitHub review")
    self.assertEqual(adapter.run_block({**base, "mode": "review_fix_merge", "options": {"post_review": True}})["title"], "Review, fix & merge")

  def test_run_block_names_a_minimized_core_run_by_its_top_level_flag(self):
    # The platform's minimized view of a core run Contribute did not start.
    minimized = {"id": "run-12345678", "chat_id": "owner-chat", "state": "reviewing", "mode": "review", "created_at": "2026-10-23T09:00:00Z",
                 "app_id": None, "can_stop": False, "post_review": True, "details_in_owning_chat": True,
                 "items": [{"repo": "owner/repo", "number": 7, "head_sha": "a" * 40, "base_ref": "main", "base_sha": "b" * 40, "state": "reviewing"}]}
    self.assertEqual(adapter.run_block(minimized)["title"], "GitHub review")
    self.assertEqual(adapter.run_block({**minimized, "post_review": False})["title"], "Private review")
    self.assertEqual(adapter.run_block({**minimized, "post_review": False, "options": {"post_review": True}})["title"], "Private review",
                     "a minimized run is named only by its top-level flag")
    self.assertEqual(adapter.run_block({**minimized, "mode": "review_merge"})["title"], "Review & merge")
    no_mode = {key: value for key, value in minimized.items() if key != "mode"}
    self.assertEqual(adapter.run_block({**no_mode, "post_review": False})["title"], "Review run", "an unreported mode is not called private")
    self.assertEqual(adapter.run_block({"id": "run-12345678", "items": []})["title"], "Review run")

  def test_selection_id_cannot_escape_app_data(self):
    with self.assertRaisesRegex(ValueError, "Invalid saved selection id"):
      adapter.selection_path(80, "../../secret")

  def test_an_older_platform_fails_clearly(self):
    with tempfile.TemporaryDirectory() as empty:
      with self.assertRaisesRegex(ValueError, "no core GitHub review workflow"):
        adapter.load_core(empty)
      Path(empty, "github_review.py").write_text("def api(*a, **k): pass\n")
      with self.assertRaisesRegex(ValueError, "too old"):
        adapter.load_core(empty)
    with patch.dict(os.environ, {}, clear=True):
      with self.assertRaisesRegex(ValueError, "no core GitHub review workflow"):
        adapter.load_core()


def mode_aware(core):
  """Whether this core's freeze_preview sends the selection mode (G3 and later)."""
  import inspect
  return '"mode"' in inspect.getsource(core.freeze_preview)


@unittest.skipUnless(os.environ.get("MOBIUS_PLATFORM_SCRIPTS"), "set MOBIUS_PLATFORM_SCRIPTS to the platform's backend/scripts")
class RealCoreTests(unittest.TestCase):
  """The adapter's old invocations against the platform's exact request bodies."""
  def test_preview_and_start_use_the_platform_serialization(self):
    core = adapter.load_core(os.environ["MOBIUS_PLATFORM_SCRIPTS"])
    snapshot = {"review_prompt": "r", "fix_prompt": "f", "merge_prompt": "m", "max_rounds": None, "autopilot": False,
                "provider": "codex", "model": "test-model", "reasoning_effort": "high"}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    calls, store = [], {}
    def api(path, method="GET", data=None, headers=None):
      calls.append((path, method, data))
      if path.endswith("/review-presets"): return {"capabilities": {}}
      if path.endswith("/review-preview"): return {"options": snapshot, "preview_sha256": digest}
      if method == "PUT": store[path] = data; return None
      if method == "GET" and path in store: return store[path]
      if path.endswith("/review-runs") and method == "POST": return {"run": {"id": "run-12345678", "items": [ITEM]}}
    core.api = api
    core.inspect_pr = lambda reference: {**ITEM, "title": "A change", "url": "https://github.com/example/project/pull/7"}
    prepared = run(core, "--mode", "review_merge", "example/project#7")
    preview = [call for call in calls if call[0].endswith("/review-preview")][0]
    self.assertEqual(preview[0], "/api/github/contributions/80/review-preview")
    # The core owns the preview body. A mode-aware core (G3+, whose
    # freeze_preview sends the mode) must send exactly the selected mode; an
    # earlier core sends none. The adapter never adds or changes it.
    if mode_aware(core):
      self.assertEqual(preview[2], {"mode": "review_merge", "options": None, "agent": None})
    else:
      self.assertEqual(preview[2], {"options": None, "agent": None})
    started = run(core, "--selection", prepared["selection"]["request_id"], "--approved-in-chat", "--approval-context", "Owner asked")
    post = [call for call in calls if call[1] == "POST" and call[0].endswith("/review-runs")][0]
    self.assertEqual(post[2], {**core.start_body(prepared["selection"]), "chat_approval": {"context": "Owner asked"}})
    self.assertTrue(started["approved"])

  def test_takeover_with_readiness_is_frozen_by_the_platform_when_advertised(self):
    core = adapter.load_core(os.environ["MOBIUS_PLATFORM_SCRIPTS"])
    import inspect
    if "allow_mark_ready" not in inspect.signature(core.freeze_preview).parameters:
      self.skipTest("this platform has no draft takeover yet")
    snapshot = {"review_prompt": "r", "fix_prompt": "f", "merge_prompt": "m", "max_rounds": None, "autopilot": True,
                "provider": "codex", "model": "test-model", "reasoning_effort": "high"}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    store, posts = {}, []
    def api(path, method="GET", data=None, headers=None):
      if path.endswith("/review-presets"): return {"capabilities": {"review_fix_merge": True, "draft_takeover": True}}
      if path.endswith("/review-preview"): return {"options": snapshot, "preview_sha256": digest}
      if method == "PUT": store[path] = data; return None
      if method == "GET" and path in store: return store[path]
      if method == "POST": posts.append(data); return {"run": {"id": "run-takeover1", "items": [ITEM]}}
    core.api = api
    core.inspect_pr = lambda reference: {**ITEM, "title": "A change", "url": "https://github.com/example/project/pull/7", "is_draft": True}
    previews = []
    original = api
    def recording(path, method="GET", data=None, headers=None):
      if path.endswith("/review-preview"): previews.append(data)
      return original(path, method, data, headers)
    core.api = recording
    prepared = run(core, "--mode", "review_fix_merge", "--allow-mark-ready", "example/project#7")
    self.assertEqual(prepared["selection"]["confirmation_scope"], "named_pr_repairs_ready_and_reviewed_successors")
    self.assertTrue(mode_aware(core), "draft takeover cores preview by mode")
    self.assertEqual(previews[0]["mode"], "review_fix_merge", "a repair preview is frozen for the repair mode")
    run(core, "--selection", prepared["selection"]["request_id"], "--approved-in-chat", "--approval-context", "Owner asked")
    self.assertEqual(posts[0]["confirmation_scope"], "named_pr_repairs_ready_and_reviewed_successors")


if __name__ == "__main__":
  unittest.main()
