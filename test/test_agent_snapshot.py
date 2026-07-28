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


if __name__ == "__main__":
  unittest.main()
