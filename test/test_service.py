import json
import subprocess
import sys
import unittest
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


class ServicePolicyTests(unittest.TestCase):
  def test_exact_reviewed_resolution_is_eligible(self):
    self.assertTrue(call(fixture()))

  def test_changed_target_or_stale_review_is_not_eligible(self):
    changed = fixture()
    changed["record"]["plan"]["head_sha"] = "b" * 40
    self.assertFalse(call(changed))
    stale = fixture()
    stale["record"]["quality_review"]["reviewed_at"] = "2026-09-12T09:59:59Z"
    self.assertFalse(call(stale))

  def test_only_a_clear_unattended_open_record_is_eligible(self):
    cases = [
      ("review state", ("quality_review", "state"), "reviewing"),
      ("attention flag", ("needs_attention",), True),
      ("attention detail", ("attention",), {"reason": "review"}),
      ("terminal status", ("status",), "merged"),
    ]
    for label, path, value in cases:
      with self.subTest(label=label):
        body = fixture()
        target = body["record"]
        for key in path[:-1]:
          target = target[key]
        target[path[-1]] = value
        self.assertFalse(call(body))

  def test_target_identity_binding_is_enforced(self):
    # A record whose target does not match the grant must stay ineligible. Each
    # field below is otherwise past the earlier repo/status guard, so it isolates
    # the expected/actual tuple comparison.
    mismatches = [
      ("record PR number", "record", ("number",), 999),
      ("record head repository", "record", ("head_repository",), "attacker/mobius"),
      ("record branch", "record", ("plan", "branch"), "fix/other"),
      ("record repo path", "record", ("plan", "repo_path"), "/review/other"),
      ("grant PR number", "grant", ("target_pr_number",), 999),
      ("grant branch", "grant", ("target_branch",), "fix/other"),
    ]
    for label, side, path, value in mismatches:
      with self.subTest(label=label):
        body = fixture()
        target = body[side]
        for key in path[:-1]:
          target = target[key]
        target[path[-1]] = value
        self.assertFalse(call(body))

    # An empty required target field is rejected by the non-empty guard even when
    # the record matches it, so a dropped guard cannot slip through as eligible.
    body = fixture()
    body["grant"]["target_repo_path"] = ""
    body["record"]["plan"]["repo_path"] = ""
    self.assertFalse(call(body), "empty target repo path")


if __name__ == "__main__":
  unittest.main()
