"""Prepared reconciliation beside the lifecycle: engine mode and a hint that stays as it is.

In engine mode the Update region says a settled update target (STRANDED_UPDATE), so reconciliation
adds no `review_target_settled` note; in shadow mode it keeps exactly today's behaviour. A note or a
hint the record already carries is never written again only because the default branch moved.
"""
import unittest

from prepared_reconcile import _same_hint, reconcile_record

SETTLED = {
  "number": 59, "state": "closed", "merged_at": "2026-08-25T01:23:17Z",
  "updated_at": "2026-08-25T01:23:17Z", "head": {"sha": "a" * 40},
  "html_url": "https://github.com/owner/repo/pull/59",
}
OPEN = {**SETTLED, "state": "open", "merged_at": None}


class Github:
  def __init__(self, pull, main="c" * 40):
    self.target, self.main, self.pulls_read = pull, main, 0

  def repo_info(self, repo):
    return "main", self.main

  def pull(self, repo, number):
    self.pulls_read += 1
    return self.target

  def branch_pull(self, repo, base, branch):
    return None

  def head_is_on_main(self, repo, head, main):
    return False

  def pull_for_commit(self, repo, sha, base):
    return None

  def main_file(self, repo, base, path):
    return None


class Local:
  def patch_commit(self, repo, base, main, patch):
    return ""

  def reverse_patch_present(self, repo, base, main, diff):
    return False


class NoDiff:
  def read_diff(self, name):
    return None


def update_record(**extra):
  return {"id": "follow-up", "type": "pr", "status": "prepared", "repo": "owner/repo", "number": 59,
          "created_at": "2026-08-25T00:00:00Z",
          "plan": {"action": "pr_update", "branch": "fix/follow-up", "head_sha": "b" * 40}, **extra}


def reconcile(github, record, now="2026-08-25T02:00:00Z", **options):
  return reconcile_record(github, Local(), NoDiff(), "follow-up.json", record, now, **options)


class EngineModeTest(unittest.TestCase):
  def test_engine_mode_adds_no_settled_target_note_and_does_not_read_the_target_itself(self):
    github = Github(SETTLED)
    patch = reconcile(github, update_record(), engine=True)
    self.assertNotIn("attention", patch)
    self.assertNotIn("needs_attention", patch)
    self.assertEqual(github.pulls_read, 0)
    self.assertEqual(set(patch["reconciliation_probe"]) - {"checked_at"}, {"main_sha"})

  def test_shadow_mode_keeps_surfacing_it_exactly_as_before(self):
    patch = reconcile(Github(SETTLED), update_record())
    self.assertEqual(patch["attention"]["type"], "review_target_settled")
    self.assertTrue(patch["needs_attention"])

  def test_an_old_settled_note_is_still_cleared_when_the_target_is_open_again(self):
    note = {"type": "review_target_settled", "key": "review_target_settled:59:closed", "detected_at": "x"}
    record = update_record(needs_attention=True, attention=note)
    patch = reconcile(Github(OPEN), record, engine=True)
    self.assertIsNone(patch["attention"])
    self.assertIs(patch["needs_attention"], False)


class MovingMainTest(unittest.TestCase):
  def test_a_settled_note_the_record_already_carries_is_not_rewritten_when_main_moves(self):
    first = reconcile(Github(SETTLED, "c" * 40), update_record())
    record = update_record(**{key: first[key] for key in ("needs_attention", "attention", "reconciliation_probe")})
    second = reconcile(Github(SETTLED, "d" * 40), record, now="2026-08-25T02:15:00Z")
    self.assertEqual(second["reconciliation_probe"]["main_sha"], "d" * 40)
    for key in ("attention", "needs_attention", "updated_at"):
      self.assertNotIn(key, second)

  def test_a_different_settled_outcome_is_a_new_note(self):
    stale = {"needs_attention": True, "attention": {"type": "review_target_settled", "key": "review_target_settled:59:merged"}}
    patch = reconcile(Github({**SETTLED, "merged_at": None}), update_record(**stale))
    self.assertEqual(patch["attention"]["key"], "review_target_settled:59:closed")

  def test_a_hint_that_only_differs_by_when_and_against_which_main_is_the_same_hint(self):
    stored = {"type": "already_landed", "main_identifiers_present": 2, "main_identifiers_total": 3,
              "landing_pr": None, "detected_at": "2026-08-25T01:00:00Z", "main_sha": "c" * 40}
    found = {**stored, "detected_at": "2026-08-25T02:00:00Z", "main_sha": "d" * 40}
    self.assertTrue(_same_hint(stored, found))
    self.assertFalse(_same_hint(stored, {**found, "main_identifiers_present": 3}))
    self.assertFalse(_same_hint(None, found))


if __name__ == "__main__":
  unittest.main()
