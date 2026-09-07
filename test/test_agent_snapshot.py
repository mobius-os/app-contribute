import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import agent_snapshot as snapshot


class AgentSnapshotTests(unittest.TestCase):
  def test_active_records_are_dependency_ordered_and_bounded(self):
    with tempfile.TemporaryDirectory() as raw:
      ledger = Path(raw)
      records = [
        {"id": "solo", "status": "open", "created_at": "2026-01-01T00:00:00Z"},
        {"id": "two", "status": "prepared", "plan": {"stack": {
          "id": "chain", "position": 2, "total": 2, "parent_record_id": "one",
        }}},
        {"id": "one", "status": "prepared", "plan": {"stack": {
          "id": "chain", "position": 1, "total": 2,
        }}},
        {"id": "done", "status": "merged"},
      ]
      for record in records:
        (ledger / f"{record['id']}.json").write_text(json.dumps(record))
      self.assertEqual(
        [record["id"] for record in snapshot.load_active(ledger)],
        ["one", "two", "solo"],
      )

  def test_canonical_record_settles_a_stale_active_legacy_mirror(self):
    with tempfile.TemporaryDirectory() as raw:
      ledger = Path(raw)
      (ledger / "review.record.json").write_text(json.dumps({
        "id": "review", "status": "prepared",
        "updated_at": "2026-08-04T12:00:00Z",
      }))
      (ledger / "review.json").write_text(json.dumps({
        "id": "review", "status": "abandoned",
        "updated_at": "2026-08-11T12:00:00Z",
      }))
      (ledger / "legacy-only.record.json").write_text(json.dumps({
        "id": "legacy-only", "status": "prepared",
      }))
      (ledger / "unrelated.json").write_text(json.dumps({
        "id": "different", "status": "prepared",
      }))

      self.assertEqual(
        [record["id"] for record in snapshot.load_active(ledger)],
        ["legacy-only"],
      )

  def test_one_graphql_query_covers_every_public_pull_request(self):
    items = [
      snapshot.Item(1, "first", "pr", "mobius-os/mobius", 12, "open", "", "", "", None, None, "", None, None, "", "", None, "", "", ""),
      snapshot.Item(2, "private", "pr", "mobius-os/mobius", None, "prepared", "", "", "", None, None, "", None, None, "", "", None, "", "", ""),
      snapshot.Item(3, "second", "pr", "mobius-os/app", 7, "open", "", "", "", None, None, "", None, None, "", "", None, "", "", ""),
      snapshot.Item(4, "issue", "issue", "mobius-os/mobius", 114, "open", "", "", "", None, None, "", None, None, "", "", None, "", "", ""),
    ]
    query, aliases = snapshot.build_graphql(items)
    self.assertEqual(aliases, {"c1": "first", "c3": "second"})
    self.assertEqual(query.count("pullRequest(number:"), 2)
    self.assertIn("statusCheckRollup{state}", query)

  def test_live_result_updates_revision_review_ci_and_mergeability(self):
    item = snapshot.Item(1, "first", "pr", "mobius-os/mobius", 12, "open", "", "", "", None, None, "", None, None, "", "", None, "", "", "")
    snapshot.merge_live([item], {"c1": {"pullRequest": {
      "state": "OPEN", "isDraft": False, "mergeable": "MERGEABLE",
      "headRefOid": "abc123", "statusCheckRollup": {"state": "SUCCESS"},
    }}}, {"c1": "first"})
    self.assertEqual(item.live_state, "OPEN")
    self.assertEqual(item.mergeable, "MERGEABLE")
    self.assertEqual(item.ci, "SUCCESS")
    self.assertEqual(item.live_head, "abc123")

  def test_issue_number_is_listed_without_being_queried_or_rendered_as_a_pr(self):
    item = snapshot.Item(
      1, "issue", "issue", "mobius-os/mobius", 114, "open",
      "", "", "", None, None, "", None, None, "", "", None, "", "", "",
    )
    query, aliases = snapshot.build_graphql([item])
    self.assertEqual(query, "query ContributionSnapshot{}")
    self.assertEqual(aliases, {})
    rendered = snapshot.render([item])
    self.assertIn("mobius-os/mobius #114", rendered)
    self.assertNotIn("review unknown", rendered)

  def test_partial_graphql_data_survives_one_missing_pull_request(self):
    completed = type("Completed", (), {
      "returncode": 1,
      "stdout": json.dumps({"data": {"c1": {"pullRequest": {"state": "OPEN"}}}}),
      "stderr": "one PR was not found",
    })()
    with patch.object(snapshot.subprocess, "run", return_value=completed):
      data, warning = snapshot.fetch_graphql("query ContributionSnapshot{c1:x}")
    self.assertEqual(data["c1"]["pullRequest"]["state"], "OPEN")
    self.assertEqual(warning, "one PR was not found")

  def test_attached_work_returns_only_overlapping_active_records(self):
    records = [
      {
        "id": "same-file", "status": "prepared", "chat_id": "older-chat",
        "plan": {
          "source_repo_path": "/data/platform",
          "repo_path": "/data/contrib/same-file/worktree",
          "files": ["backend/app/demo.py"],
        },
      },
      {
        "id": "same-chat", "status": "open", "chat_ids": ["source-chat"],
        "plan": {
          "source_repo_path": "/data/apps/example",
          "files": ["index.jsx"],
        },
      },
      {
        "id": "unrelated", "status": "prepared",
        "plan": {
          "source_repo_path": "/data/platform",
          "files": ["frontend/src/App.jsx"],
        },
      },
    ]
    work = {
      "v": 1,
      "intent": "prepare",
      "source_chat_id": "source-chat",
      "paths": [{
        "path": "/data/platform/backend/app/demo.py",
        "reviewed_through": 123,
      }],
      "record_ids": [],
      "project_roots": ["/data/platform"],
    }
    self.assertEqual(
      [record["id"] for record in snapshot.relevant_records(records, work)],
      ["same-file", "same-chat"],
    )

  def test_attached_project_work_includes_same_project_without_file_overlap(self):
    records = [{
      "id": "project-record", "status": "prepared",
      "plan": {
        "source_repo_path": "/data/apps/example",
        "files": ["other.js"],
      },
    }]
    work = {
      "v": 1,
      "intent": "project",
      "source_chat_id": "source-chat",
      "paths": [],
      "record_ids": [],
      "project_roots": ["/data/apps/example"],
    }
    self.assertEqual(snapshot.relevant_records(records, work), records)

  def test_attached_work_view_is_compact_and_checks_local_revision(self):
    record = {
      "id": "review", "type": "pr", "status": "prepared",
      "repo": "mobius-os/mobius", "title": "Review", "summary": "Safer",
      "chat_id": "source", "chat_ids": ["source"],
      "plan": {
        "action": "pr", "source_repo_path": "/data/platform",
        "repo_path": "/data/contrib/review/worktree",
        "files": ["backend/app/demo.py"], "branch": "fix/review",
        "base_sha": "base", "head_sha": "head", "body_draft": "omitted",
      },
      "quality_review": {"state": "all_clear", "reviewed_head_sha": "head"},
    }
    with patch.object(snapshot, "_git", side_effect=["head", ""]):
      view = snapshot.work_view(record, 1)
    self.assertNotIn("body_draft", view["plan"])
    self.assertEqual(view["local"]["revision_matches"], True)
    self.assertEqual(view["quality_review"]["state"], "all_clear")

  def test_ledger_checkout_paths_cannot_make_snapshot_read_private_data(self):
    self.assertEqual(snapshot.safe_repo_path("/data/cli-auth/private"), "")
    self.assertEqual(snapshot.safe_repo_path("/data/apps/80/contributions"), "")
    self.assertEqual(
      snapshot.safe_repo_path("/data/contrib/review/worktree"),
      "/data/contrib/review/worktree",
    )
    self.assertEqual(
      snapshot.safe_repo_path("/data/apps/contribute"),
      "/data/apps/contribute",
    )

  def test_local_item_runs_git_only_for_a_confined_checkout(self):
    completed = type("Completed", (), {"stdout": "head\n"})()
    record = {
      "id": "review", "status": "prepared", "branch": "fix/review",
      "plan": {
        "repo_path": "/data/contrib/review/worktree",
        "head_sha": "head",
      },
    }
    with patch.object(snapshot.subprocess, "run", return_value=completed) as run:
      item = snapshot.local_item(record, 1)
    self.assertEqual(item.actual_head, "head")
    self.assertEqual(item.revision_matches, True)
    self.assertEqual(run.call_count, 2)

    record["plan"]["repo_path"] = "/data/cli-auth/private"
    with patch.object(snapshot.subprocess, "run") as run:
      item = snapshot.local_item(record, 1)
    self.assertEqual(item.actual_head, "")
    run.assert_not_called()


if __name__ == "__main__":
  unittest.main()
