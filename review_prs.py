#!/usr/bin/env python3
"""Prepare an exact Contribute approval link, or use explicit owning-chat consent.

Preparation reads GitHub and saves non-authoritative selection data. Only the
guarded platform review-run route can grant review-and-merge execution.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


IDENTITY_FIELDS = ("repo", "number", "head_sha", "base_ref", "base_sha")
SELECTION_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
PR_REFERENCE = re.compile(r"^(?:https://github\.com/)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:#|/pull/)([1-9][0-9]*)/?$")
OPTION_FIELDS = ("review_prompt", "fix_prompt", "merge_prompt", "max_rounds", "autopilot")
TAKEOVER_SCOPE = "named_pr_repairs_and_reviewed_successors"
DRAFT_TAKEOVER_SCOPE = "named_pr_repairs_ready_and_reviewed_successors"


def api(path, *, method="GET", data=None, headers=None):
  base = os.environ["API_BASE_URL"].rstrip("/")
  token = os.environ["AGENT_TOKEN"]
  request = Request(base + path, method=method,
    data=json.dumps(data).encode() if data is not None else None,
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", **(headers or {})})
  with urlopen(request, timeout=60) as response:
    body = response.read()
    return json.loads(body) if body else None


def find_app_id():
  apps = [app for app in api("/api/apps/") if app.get("slug") == "contribute"]
  if not apps:
    raise ValueError('Contribute is not installed. Use python3 "$SCRIPTS_DIR/github_review.py" for core GitHub review workflows.')
  if len(apps) != 1:
    raise ValueError("Choose the installed Contribute app explicitly with --app-id.")
  return apps[0]["id"]


def gh_api(endpoint):
  result = subprocess.run(["gh", "api", endpoint], capture_output=True,
    text=True, check=True, timeout=60)
  return json.loads(result.stdout)


def inspect_pr(reference):
  match = PR_REFERENCE.fullmatch(reference)
  if not match:
    raise ValueError("Use owner/repository#123 or a github.com pull-request URL.")
  repo, number = match.group(1), int(match.group(2))
  pull = gh_api(f"repos/{repo}/pulls/{number}")
  if pull.get("state") != "open" or pull.get("merged"):
    raise ValueError(f"{reference} is no longer open.")
  canonical_repo = pull["base"]["repo"]["full_name"]
  if canonical_repo.lower() != repo.lower():
    raise ValueError(f"{reference} moved to another repository; inspect its destination first.")
  base_ref = pull["base"]["ref"]
  base = gh_api(f"repos/{canonical_repo}/git/ref/heads/{quote(base_ref, safe='')}")
  return {"repo": canonical_repo.lower(), "number": number,
    "head_sha": pull["head"]["sha"], "base_ref": base_ref,
    "base_sha": base["object"]["sha"], "is_draft": pull.get("draft") is True, "title": pull["title"], "url": pull["html_url"]}


def prepare_selection(references, mode, chat_id):
  if not 1 <= len(references) <= 20:
    raise ValueError("Select between 1 and 20 pull requests.")
  items = sorted((inspect_pr(ref) for ref in references), key=lambda item: (item["repo"], item["number"]))
  if len({(item["repo"], item["number"]) for item in items}) != len(items):
    raise ValueError("Select each pull request only once.")
  identity = {"mode": mode, "source_chat_id": chat_id,
              "items": [{key: item[key] for key in IDENTITY_FIELDS} for item in items]}
  digest = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:32]
  return {**identity, "request_id": "selection-" + digest, "items": items,
          "title": items[0]["title"] if len(items) == 1 else f"Review {len(items)} pull requests",
          "created_at": datetime.now(timezone.utc).isoformat()}


def selection_path(app_id, selection_id):
  if not SELECTION_ID.fullmatch(selection_id):
    raise ValueError("Invalid saved selection id.")
  return f"/api/storage/apps/{app_id}/review-selections/{selection_id}.json"


def save_selection(app_id, selection):
  path = selection_path(app_id, selection["request_id"])
  try:
    api(path, method="PUT", data=selection, headers={"If-None-Match": "*"})
  except HTTPError as error:
    if error.code != 412:
      raise
    previous = api(path)
    if start_body(previous) != start_body(selection) or previous.get("source_chat_id") != selection["source_chat_id"]:
      raise ValueError("The saved selection changed. Prepare a new selection rather than replacing it.") from error
    verify_selection(previous)
    return previous
  return selection


def start_body(selection):
  if selection["mode"] == "review_fix_merge" and not selection.get("preview_sha256"):
    raise ValueError("Scoped takeover requires a frozen prompt/model preview. Prepare a new selection.")
  return {"request_id": selection["request_id"], "mode": selection["mode"],
          "source_chat_id": selection["source_chat_id"],
          **{key: selection[key] for key in ("options", "agent", "preview_sha256", "confirmation_scope") if key in selection},
          "items": [{key: item[key] for key in IDENTITY_FIELDS} for item in selection["items"]]}


def freeze_preview(app_id, selection, options=None, agent=None, *, allow_mark_ready=False):
  """Save resolved prompts/model before consent; later start never re-resolves silently."""
  if allow_mark_ready and selection["mode"] != "review_fix_merge":
    raise ValueError("Mark-ready permission requires review_fix_merge.")
  if selection["mode"] == "review_fix_merge" and any(item.get("is_draft") for item in selection["items"]) and not allow_mark_ready:
    raise ValueError("Draft takeover needs --allow-mark-ready and explicit consent to mark ready after review and checks.")
  preview = api(f"/api/github/contributions/{app_id}/review-preview", method="POST",
                data={"options": options, "agent": agent})
  snapshot = preview["options"]
  if not re.fullmatch(r"[0-9a-f]{64}", preview["preview_sha256"]) or not snapshot.get("model"):
    raise ValueError("The platform did not return a complete frozen prompt/model preview.")
  frozen = {**selection, "options": {key: snapshot[key] for key in OPTION_FIELDS},
    "agent": {"provider": snapshot["provider"], "model": snapshot["model"],
              "effort": snapshot.get("reasoning_effort")},
    "preview_sha256": preview["preview_sha256"], "resolved_snapshot": snapshot}
  if selection["mode"] == "review_fix_merge":
    frozen["confirmation_scope"] = DRAFT_TAKEOVER_SCOPE if allow_mark_ready else TAKEOVER_SCOPE
  identity = start_body(frozen)
  identity.pop("request_id")
  frozen["request_id"] = "selection-" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:32]
  verify_selection(frozen)
  return frozen


def verify_selection(selection):
  """Reject edited saved input before interpreting consent for it."""
  if selection.get("mode") not in ("review", "review_merge", "review_fix_merge"):
    raise ValueError("Invalid saved selection mode.")
  if selection.get("preview_sha256"):
    snapshot = selection["resolved_snapshot"]
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    expected_agent = {"provider": snapshot["provider"], "model": snapshot["model"],
                      "effort": snapshot.get("reasoning_effort")}
    if (digest != selection["preview_sha256"]
        or selection["options"] != {key: snapshot[key] for key in OPTION_FIELDS}
        or selection["agent"] != expected_agent):
      raise ValueError("The frozen preview changed. Prepare and present a fresh selection.")
    identity = start_body(selection)
    identity.pop("request_id")
  else:
    if any(key in selection for key in ("options", "agent", "confirmation_scope", "resolved_snapshot")):
      raise ValueError("Legacy selections cannot acquire options or model settings without a fresh frozen preview.")
    identity = {"mode": selection["mode"], "source_chat_id": selection["source_chat_id"],
                "items": [{key: item[key] for key in IDENTITY_FIELDS} for item in selection["items"]]}
  expected_id = "selection-" + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:32]
  if selection["request_id"] != expected_id:
    raise ValueError("The saved selection identity changed. Prepare a fresh selection.")
  start_body(selection)


def read_object(path):
  with open(path, encoding="utf-8") as source:
    value = json.load(source)
  if not isinstance(value, dict):
    raise ValueError("Options and agent files must contain JSON objects.")
  return value


def main(argv=None):
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("prs", nargs="*", help="owner/repository#123 or full PR URL")
  parser.add_argument("--app-id", type=int)
  parser.add_argument("--mode", choices=("review", "review_merge", "review_fix_merge"), help="New selection mode; default: review")
  parser.add_argument("--options", help="JSON file: review_prompt/fix_prompt/merge_prompt/max_rounds/autopilot")
  parser.add_argument("--agent", help="JSON file: provider/model/effort; frozen by platform preview")
  parser.add_argument("--allow-mark-ready", action="store_true", help="New takeover preview includes permission to mark drafts ready after review/checks; not consent itself")
  parser.add_argument("--selection", help="Use an already prepared exact selection; never refresh its versions")
  parser.add_argument("--approved-in-chat", action="store_true",
                      help="The owner explicitly approved this exact action in this owning chat")
  parser.add_argument("--approval-context", help="Concise quote/reference and explanation of that explicit consent")
  args = parser.parse_args(argv)
  if args.selection and args.prs:
    parser.error("Use either a saved --selection or PR references, not both.")
  if args.selection and (args.mode or args.options or args.agent or args.allow_mark_ready):
    parser.error("A saved selection already has exact mode/options/model; prepare a new selection to change it.")
  if args.approved_in_chat != bool(args.approval_context and args.approval_context.strip()):
    parser.error("--approved-in-chat requires --approval-context; context alone is not approval.")
  if args.approved_in_chat and not args.selection:
    parser.error("Freeze a selection first; --approved-in-chat requires --selection and uses the existing scoped consent.")
  app_id = args.app_id or find_app_id()
  chat_id = os.environ["CHAT_ID"]
  if args.selection:
    selection = api(selection_path(app_id, args.selection))
    if selection.get("request_id") != args.selection:
      raise ValueError("The saved selection has a different identity.")
  else:
    selection = freeze_preview(app_id, prepare_selection(args.prs, args.mode or "review", chat_id),
      read_object(args.options) if args.options else None, read_object(args.agent) if args.agent else None, allow_mark_ready=args.allow_mark_ready)
    selection = save_selection(app_id, selection)
  result = {"selection": selection,
            "approval_url": "/shell/?" + urlencode({"app": app_id, "intent": "review-selection:" + selection["request_id"]}, quote_via=quote),
            "approved": False}
  if args.approved_in_chat:
    if selection.get("source_chat_id") != chat_id:
      link = "/shell/?" + urlencode({"chat": selection.get("source_chat_id", "")})
      raise ValueError(f"This selection belongs to another source chat. Continue at {link}; do not borrow its consent.")
    verify_selection(selection)
    body = {**start_body(selection), "chat_approval": {"context": args.approval_context.strip()}}
    try:
      result.update(api(f"/api/github/contributions/{app_id}/review-runs", method="POST", data=body))
      result["approved"] = True
    except HTTPError as error:
      if error.code != 409:
        raise
      detail = json.loads(error.read()).get("detail")
      if not isinstance(detail, dict) or not detail.get("chat_id"):
        raise ValueError(detail or "This selection changed. Inspect it before preparing another approval.") from error
      result.update(already_owned=True, message=detail.get("message"),
                    review_url="/shell/?" + urlencode({"chat": detail["chat_id"]}))
  print(json.dumps(result, indent=2))


if __name__ == "__main__":
  try:
    main()
  except HTTPError as error:
    print(f"Contribute returned {error.code}: {error.read().decode(errors='replace')}", file=sys.stderr)
    sys.exit(1)
  except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
    print(f"Could not prepare this review: {error}", file=sys.stderr)
    sys.exit(1)
