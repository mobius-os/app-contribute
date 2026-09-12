import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parents[1]


def call(body):
  request = {
    "schema": 1,
    "path": "autopilot/reviewed-resolution",
    "body": body,
  }
  result = subprocess.run(
    [sys.executable, str(ROOT / "service.py")],
    input=json.dumps(request), text=True, capture_output=True, check=True,
  )
  return json.loads(result.stdout)["body"]["eligible"]


def fixture():
  grant = {
    "record_id": "change",
    "target_repo": "mobius-os/mobius",
    "target_pr_number": 12,
    "target_head_repository": "owner/mobius",
    "target_branch": "fix/change",
    "target_repo_path": "/review/worktree",
    "granted_head_sha": "a" * 40,
    "blocked_at": "2026-09-12T10:00:00Z",
  }
  record = {
    "id": "change",
    "repo": "mobius-os/mobius",
    "type": "pr",
    "status": "open",
    "number": 12,
    "head_repository": "owner/mobius",
    "branch": "fix/change",
    "plan": {
      "repo": "mobius-os/mobius",
      "head_repository": "owner/mobius",
      "branch": "fix/change",
      "repo_path": "/review/worktree",
      "head_sha": "a" * 40,
    },
    "quality_review": {
      "state": "all_clear",
      "reviewed_head_sha": "a" * 40,
      "reviewed_at": "2026-09-12T10:05:00Z",
    },
  }
  return {"grant": grant, "record": record, "now": "2026-09-12T10:06:00Z"}


def test_exact_reviewed_resolution_is_eligible():
  assert call(fixture()) is True


def test_changed_target_or_stale_review_is_not_eligible():
  changed = fixture()
  changed["record"]["plan"]["head_sha"] = "b" * 40
  assert call(changed) is False
  stale = fixture()
  stale["record"]["quality_review"]["reviewed_at"] = "2026-09-12T09:59:59Z"
  assert call(stale) is False


def test_only_a_clear_unattended_open_record_is_eligible():
  cases = [
    ("review state", ("quality_review", "state"), "reviewing"),
    ("attention flag", ("needs_attention",), True),
    ("attention detail", ("attention",), {"reason": "review"}),
    ("terminal status", ("status",), "merged"),
  ]
  for label, path, value in cases:
    body = fixture()
    target = body["record"]
    for key in path[:-1]:
      target = target[key]
    target[path[-1]] = value
    assert call(body) is False, label
