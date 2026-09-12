#!/usr/bin/env python3
"""Contribute-owned synchronous policy for platform trust adapters."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta


def _time(value) -> datetime | None:
  try:
    parsed = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
  except ValueError:
    return None
  if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=UTC)
  return parsed.astimezone(UTC)


def reviewed_resolution(body: dict) -> bool:
  """A private record may release a blocker; it can never create authority."""
  row = body.get("grant")
  record = body.get("record")
  if not isinstance(row, dict) or not isinstance(record, dict):
    return False
  if (
    record.get("id") != row.get("record_id")
    or record.get("repo") != row.get("target_repo")
    or record.get("type") != "pr"
    or record.get("status") not in {"open", "draft"}
    or record.get("needs_attention")
    or record.get("attention")
  ):
    return False
  plan = record.get("plan")
  review = record.get("quality_review")
  if not isinstance(plan, dict) or not isinstance(review, dict):
    return False
  expected = (
    row.get("target_repo"), row.get("target_pr_number"),
    row.get("target_head_repository"), row.get("target_branch"),
    row.get("target_repo_path"),
  )
  actual = (
    plan.get("repo") or record.get("repo"), record.get("number"),
    record.get("head_repository") or plan.get("head_repository"),
    plan.get("branch") or record.get("branch"), plan.get("repo_path"),
  )
  if any(value in (None, "") for value in expected) or actual != expected:
    return False
  granted_head = row.get("granted_head_sha")
  reviewed_head = review.get("reviewed_head_sha")
  if (
    review.get("state") != "all_clear"
    or not granted_head
    or not reviewed_head
    or reviewed_head not in {
      granted_head, plan.get("attribution_normalized_from"),
    }
    or plan.get("head_sha") != granted_head
  ):
    return False
  reviewed_at = _time(review.get("reviewed_at"))
  blocked_at = _time(row.get("blocked_at"))
  now = _time(body.get("now"))
  return bool(
    reviewed_at and blocked_at and now
    and blocked_at <= reviewed_at <= now + timedelta(minutes=5)
  )


def handle(request: dict) -> dict:
  if request.get("schema") != 1:
    return {"status": 400, "body": {"error": "unsupported request schema"}}
  if request.get("path") == "autopilot/reviewed-resolution":
    body = request.get("body")
    return {
      "status": 200,
      "body": {"eligible": reviewed_resolution(body if isinstance(body, dict) else {})},
    }
  return {"status": 404, "body": {"error": "unknown Contribute policy"}}


if __name__ == "__main__":
  try:
    print(json.dumps(handle(json.load(sys.stdin)), separators=(",", ":")))
  except Exception as exc:
    print(f"Contribute service failed: {exc}", file=sys.stderr)
    raise SystemExit(1)
