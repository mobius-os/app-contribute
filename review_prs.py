#!/usr/bin/env python3
"""Contribute's adapter over the platform's GitHub review workflow.

The platform's `github_review.py` owns PR inspection, the frozen prompt/model
preview, consent checks and admission. This adds only what Contribute owns: its
app context, the saved approval link its review page opens, and a link-only
chat block that opens a run in Contribute.
"""
from __future__ import annotations

import argparse
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlencode

SELECTION_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
CORE_FUNCTIONS = ("api", "prepare_selection", "freeze_preview", "verify_selection", "start_body", "review_path")
RUN_TITLES = {"review_merge": "Review & merge", "review_fix_merge": "Review, fix & merge"}


def load_core(scripts_dir=None):
  """Import the platform's canonical workflow; fail clearly on an older Möbius."""
  directory = Path(scripts_dir or os.environ.get("SCRIPTS_DIR") or "")
  path = directory / "github_review.py"
  if not (scripts_dir or os.environ.get("SCRIPTS_DIR")) or not path.is_file():
    raise ValueError("This Möbius has no core GitHub review workflow. Update Möbius to review PRs from Contribute.")
  sys.path.insert(0, str(directory))
  spec = importlib.util.spec_from_file_location("github_review", path)
  core = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(core)
  if any(not callable(getattr(core, name, None)) for name in CORE_FUNCTIONS):
    raise ValueError("This Möbius's GitHub review workflow is too old for Contribute. Update Möbius.")
  return core


def find_app_id(core):
  apps = [app for app in core.api("/api/apps/") if app.get("slug") == "contribute"]
  if not apps:
    raise ValueError('Contribute is not installed. Use python3 "$SCRIPTS_DIR/github_review.py" for core GitHub review workflows.')
  if len(apps) != 1:
    raise ValueError("Choose the installed Contribute app explicitly with --app-id.")
  return apps[0]["id"]


def selection_path(app_id, selection_id):
  if not SELECTION_ID.fullmatch(selection_id or ""):
    raise ValueError("Invalid saved selection id.")
  return f"/api/storage/apps/{app_id}/review-selections/{selection_id}.json"


def save_selection(core, app_id, selection):
  """Create the saved approval link once; an existing one must be identical."""
  path = selection_path(app_id, selection["request_id"])
  try:
    core.api(path, method="PUT", data=selection, headers={"If-None-Match": "*"})
  except HTTPError as error:
    if error.code != 412:
      raise
    previous = core.api(path)
    if core.start_body(previous) != core.start_body(selection) or previous.get("source_chat_id") != selection["source_chat_id"]:
      raise ValueError("The saved selection changed. Prepare a new selection rather than replacing it.") from error
    core.verify_selection(previous)
    return previous
  return selection


def capabilities(core, app_id):
  presets = core.api(core.review_path(app_id, "/review-presets")) or {}
  return presets.get("capabilities") or {}


def prepare(core, app_id, chat_id, args):
  served = capabilities(core, app_id)
  if args.mode == "review_fix_merge" and served.get("review_fix_merge") is not True:
    raise ValueError("This Möbius does not offer Review, fix & merge yet. Use review or review_merge.")
  if args.allow_mark_ready and (args.mode != "review_fix_merge" or served.get("draft_takeover") is not True):
    raise ValueError("Marking drafts ready needs review_fix_merge on a Möbius that offers draft takeover.")
  options = read_object(args.options) if args.options else None
  agent = read_object(args.agent) if args.agent else None
  extra = {"allow_mark_ready": True} if args.allow_mark_ready else {}
  if extra and "allow_mark_ready" not in inspect.signature(core.freeze_preview).parameters:
    raise ValueError("This Möbius's GitHub review workflow cannot freeze draft readiness. Update Möbius.")
  selection = core.freeze_preview(core.prepare_selection(args.prs, args.mode, chat_id, app_id), options, agent, **extra)
  return save_selection(core, app_id, selection)


def start(core, app_id, chat_id, selection, context):
  if selection.get("source_chat_id") != chat_id:
    link = "/shell/?" + urlencode({"chat": selection.get("source_chat_id", "")})
    raise ValueError(f"This selection belongs to another source chat. Continue at {link}; do not borrow its consent.")
  core.verify_selection(selection)
  body = {**core.start_body(selection), "chat_approval": {"context": context}}
  try:
    return {**core.api(core.review_path(app_id, "/review-runs"), method="POST", data=body), "approved": True}
  except HTTPError as error:
    if error.code != 409:
      raise
    detail = json.loads(error.read()).get("detail")
    if not isinstance(detail, dict) or not detail.get("chat_id"):
      raise ValueError(detail or "This selection changed. Inspect it before preparing another approval.") from error
    return {"approved": False, "already_owned": True, "message": detail.get("message"),
            "review_url": "/shell/?" + urlencode({"chat": detail["chat_id"]})}


def run_block(run):
  """A static chat block that opens this run in Contribute. It grants nothing."""
  if not RUN_ID.fullmatch(str(run.get("id") or "")):
    raise ValueError("Invalid run identity.")
  items = run.get("items") or []
  # The same public-effect naming as the app's run view: posting is not private.
  posted = run.get("mode") == "review" and (run.get("options") or {}).get("post_review") is True
  title = "GitHub review" if posted else RUN_TITLES.get(run.get("mode"), "Private review")
  return {"app": "contribute", "intent": f"review-run:{run['id']}", "title": title, "inline": False,
    "facts": [{"label": "Pull requests", "value": ", ".join(f"{item['repo']}#{item['number']}" for item in items)[:240] or "None"},
      {"label": "Status", "value": str(run.get("execution_state") or run.get("state") or "unknown")[:240]}]}


def fence(block):
  return "```mobius-app\n" + json.dumps(block, ensure_ascii=False) + "\n```"


def read_object(path):
  with open(path, encoding="utf-8") as source:
    value = json.load(source)
  if not isinstance(value, dict):
    raise ValueError("Options and agent files must contain JSON objects.")
  return value


def main(argv=None, core=None):
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("prs", nargs="*", help="owner/repository#123 or full PR URL")
  parser.add_argument("--app-id", type=int)
  parser.add_argument("--mode", choices=("review", "review_merge", "review_fix_merge"), help="New selection mode; default: review")
  parser.add_argument("--options", help="JSON file: review_prompt/fix_prompt/merge_prompt/max_rounds/autopilot")
  parser.add_argument("--agent", help="JSON file: provider/model/effort; frozen by the platform preview")
  parser.add_argument("--allow-mark-ready", action="store_true", help="Takeover preview includes marking drafts ready after review/checks; not consent itself")
  parser.add_argument("--selection", help="Use an already prepared exact selection; never refresh its versions")
  parser.add_argument("--approved-in-chat", action="store_true", help="The owner explicitly approved this exact action in this owning chat")
  parser.add_argument("--approval-context", help="Concise quote/reference and explanation of that explicit consent")
  parser.add_argument("--block", metavar="RUN_ID", help="Print a link-only chat block for an existing run")
  args = parser.parse_args(argv)
  if args.selection and args.prs:
    parser.error("Use either a saved --selection or PR references, not both.")
  if args.selection and (args.mode or args.options or args.agent or args.allow_mark_ready):
    parser.error("A saved selection already has exact mode/options/model; prepare a new selection to change it.")
  if args.approved_in_chat != bool(args.approval_context and args.approval_context.strip()):
    parser.error("--approved-in-chat requires --approval-context; context alone is not approval.")
  if args.approved_in_chat and not args.selection:
    parser.error("Freeze a selection first; --approved-in-chat requires --selection and uses the existing scoped consent.")
  if not args.block and not args.selection and not args.prs:
    parser.error("Name the pull requests to review, a saved --selection, or a run --block.")
  args.mode = args.mode or "review"
  core = core or load_core()
  app_id = args.app_id or find_app_id(core)
  if args.block:
    if not RUN_ID.fullmatch(args.block):
      raise ValueError("Invalid run identity.")
    # The exact run, however old; the recent list is capped.
    try:
      run = (core.api(core.review_path(app_id, "/review-runs/" + args.block)) or {}).get("run")
    except HTTPError as error:
      if error.code != 404:
        raise
      run = None
    if not run:
      raise ValueError("That run is not in Contribute's review history.")
    print(fence(run_block(run)))
    return
  chat_id = os.environ["CHAT_ID"]
  if args.selection:
    selection = core.api(selection_path(app_id, args.selection))
    if selection.get("request_id") != args.selection:
      raise ValueError("The saved selection has a different identity.")
  else:
    selection = prepare(core, app_id, chat_id, args)
  result = {"selection": selection,
            "approval_url": "/shell/?" + urlencode({"app": app_id, "intent": "review-selection:" + selection["request_id"]}, quote_via=quote),
            "approved": False}
  if args.approved_in_chat:
    result.update(start(core, app_id, chat_id, selection, args.approval_context.strip()))
    if result.get("run", {}).get("id"):
      result["block"] = fence(run_block(result["run"]))
  print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
  try:
    main()
  except HTTPError as error:
    print(f"Contribute returned {error.code}: {error.read().decode(errors='replace')}", file=sys.stderr)
    sys.exit(1)
  except (ValueError, KeyError, OSError) as error:
    print(f"Could not prepare this review: {error}", file=sys.stderr)
    sys.exit(1)
