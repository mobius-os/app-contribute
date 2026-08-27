import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from prepared_reconcile import (
    branch_match_is_current,
    distinctive_added_lines,
    distinctive_identifiers,
    exact_landing,
    identifier_landing,
    identifier_presence,
    is_prepared_pr,
    partial_identifier_presence,
    LocalMain,
    reconcile_record,
    Storage,
    strong_identifier_presence,
    settled_update_attention,
    update_target_probe,
    validated_review_diff,
)


DIFF = """diff --git a/reconcile.js b/reconcile.js
index 1111111..2222222 100644
--- a/reconcile.js
+++ b/reconcile.js
@@ -1 +1,6 @@
+function reconcilePreparedContributions() {}
+const distinctiveLandingEvidence = true
+class PreparedRecordReconciler {}
+const reconciliation_main_sha = "abc"
+const ordinary = true
"""


class PreparedReconciliationEvidenceTests(unittest.TestCase):
    class LocalOnlyGitHub:
        def main_file(self, repo, branch, path):
            return None

        def pull_for_commit(self, repo, sha, base):
            return None

    def assert_preexisting_icon_wrappers_are_not_a_landing(
        self,
        identifiers_by_path,
    ):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args, input=None):
                return subprocess.run(
                    ["git", "-C", str(repo), *args],
                    input=input,
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            (repo / "README.md").write_text("app\n")
            git("add", ".")
            git("commit", "-qm", "initial")

            for file_path, identifiers in identifiers_by_path.items():
                target = repo / file_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("".join(
                    f"export function {identifier}(props) {{ return <svg {{...props}} /> }}\n"
                    for identifier in identifiers
                ))
            git("add", ".")
            git("commit", "-qm", "historical app bootstrap")
            historical_bootstrap = git("rev-parse", "HEAD")

            (repo / "README.md").write_text("app\nreview base\n")
            git("commit", "-qam", "review base")
            review_base = git("rev-parse", "HEAD")

            for file_path, identifiers in identifiers_by_path.items():
                (repo / file_path).write_text("".join(
                    f"export const {identifier} = (props) => <SdkIcon {{...props}} />\n"
                    for identifier in identifiers
                ))
            git("commit", "-qam", "reviewed SDK icon change")
            review_head = git("rev-parse", "HEAD")
            review_diff = git(
                "diff",
                "--binary",
                "--full-index",
                f"{review_base}..{review_head}",
            ) + "\n"
            identifiers = distinctive_identifiers(review_diff)
            self.assertEqual(
                identifiers,
                {
                    path: set(values)
                    for path, values in identifiers_by_path.items()
                },
            )

            git("checkout", "-q", "--detach", review_base)
            local = LocalMain({"owner/repo": [str(repo)]})
            self.assertEqual(
                local.identifiers_introduced_after_base(
                    "owner/repo",
                    "main",
                    review_base,
                    review_base,
                    identifiers,
                ),
                {},
            )
            landing, hint = identifier_landing(
                self.LocalOnlyGitHub(),
                local,
                "owner/repo",
                "main",
                review_base,
                review_base,
                identifiers,
            )

            self.assertIsNone(landing)
            self.assertIsNone(hint)
            self.assertEqual(
                local.identifier_commit(
                    "owner/repo",
                    "main",
                    review_base,
                    review_base,
                    identifiers,
                ),
                "",
                f"{historical_bootstrap} is behind the reviewed base",
            )

    def test_review_diff_must_match_the_stored_hash(self):
        digest = hashlib.sha256(DIFF.encode()).hexdigest()
        record = {"plan": {"diff_sha256": digest}}
        self.assertEqual(validated_review_diff(record, DIFF), DIFF)
        self.assertIsNone(validated_review_diff(record, DIFF + "\nchanged"))

    def test_existing_pr_updates_are_reconciled_without_treating_them_as_new_prs(self):
        record = {
            "type": "pr",
            "status": "prepared",
            "repo": "owner/repo",
            "plan": {"action": "pr_update"},
        }
        self.assertTrue(is_prepared_pr(record))

        pull = {
            "number": 59,
            "state": "closed",
            "merged_at": "2026-08-25T01:23:17Z",
            "updated_at": "2026-08-25T01:23:17Z",
            "head": {"sha": "a" * 40},
            "html_url": "https://github.com/owner/repo/pull/59",
        }
        self.assertEqual(update_target_probe(record, pull), {
            "target_state": "closed",
            "target_head_sha": "a" * 40,
            "target_updated_at": "2026-08-25T01:23:17Z",
        })
        attention = settled_update_attention(record, pull, "2026-08-25T02:00:00Z")
        self.assertTrue(attention["needs_attention"])
        self.assertEqual(attention["attention"]["type"], "review_target_settled")
        self.assertIn("new reviewed contribution", attention["attention"]["message"])

    def test_open_or_malformed_update_targets_do_not_invent_a_blocker(self):
        record = {"plan": {"action": "pr_update"}}
        self.assertIsNone(settled_update_attention(
            record, {"state": "open", "merged_at": None}, "now",
        ))
        self.assertIsNone(settled_update_attention(
            record, {"state": "", "head": "invalid"}, "now",
        ))
        self.assertEqual(update_target_probe(
            record, {"state": "open", "head": "invalid"},
        )["target_head_sha"], "")

    def test_a_merged_branch_does_not_supersede_an_unsent_pr_update(self):
        class GitHubStub:
            def branch_pull(self, repo, base, branch):
                return {
                    "merged_at": "2026-08-25T01:23:17Z",
                    "head": {"sha": "a" * 40},
                }

            def head_is_on_main(self, repo, head, main):
                return False

            def pull_for_commit(self, repo, sha, base):
                return None

        class LocalStub:
            def patch_commit(self, repo, base, main, patch):
                return ""

            def reverse_patch_present(self, repo, base, main, diff):
                return False

        record = {
            "created_at": "2026-08-25T01:00:00Z",
            "plan": {
                "action": "pr_update",
                "branch": "fix/follow-up",
                "head_sha": "b" * 40,
            },
        }
        self.assertIsNone(exact_landing(
            GitHubStub(), LocalStub(), "owner/repo", "main", "c" * 40,
            record, DIFF,
        ))
        record["plan"]["action"] = "pr"
        self.assertEqual(exact_landing(
            GitHubStub(), LocalStub(), "owner/repo", "main", "c" * 40,
            record, DIFF,
        ).matched_by, "merged_branch")

    class UpdateTargetGitHub:
        def __init__(self, pull):
            self.target = pull
            self.requested = None

        def repo_info(self, repo):
            return "main", "c" * 40

        def pull(self, repo, number):
            self.requested = (repo, number)
            return self.target

        def branch_pull(self, repo, base, branch):
            return self.target

        def head_is_on_main(self, repo, head, main):
            return False

        def pull_for_commit(self, repo, sha, base):
            return None

    class UnlandedLocalMain:
        def patch_commit(self, repo, base, main, patch):
            return ""

        def reverse_patch_present(self, repo, base, main, diff):
            return False

    class NoStoredDiff:
        def read_diff(self, name):
            return None

    def prepared_update_record(self, **extra):
        return {
            "id": "follow-up",
            "type": "pr",
            "status": "prepared",
            "repo": "owner/repo",
            "number": 59,
            "plan": {
                "action": "pr_update",
                "branch": "fix/follow-up",
                "head_sha": "b" * 40,
            },
            **extra,
        }

    def reconcile_update_target(self, github, record, now):
        return reconcile_record(
            github, self.UnlandedLocalMain(), self.NoStoredDiff(),
            "follow-up.json", record, now,
        )

    def test_reconciliation_surfaces_a_settled_update_target(self):
        github = self.UpdateTargetGitHub({
            "number": 59,
            "state": "closed",
            "merged_at": "2026-08-25T01:23:17Z",
            "updated_at": "2026-08-25T01:23:17Z",
            "head": {"sha": "a" * 40},
            "html_url": "https://github.com/owner/repo/pull/59",
        })
        patch = self.reconcile_update_target(
            github, self.prepared_update_record(), "2026-08-25T02:00:00Z",
        )
        self.assertEqual(github.requested, ("owner/repo", 59))
        self.assertTrue(patch["needs_attention"])
        self.assertEqual(patch["attention"]["type"], "review_target_settled")
        self.assertEqual(patch["reconciliation_probe"]["target_state"], "closed")

    def test_a_reopened_update_target_clears_its_recovery_blocker(self):
        github = self.UpdateTargetGitHub({
            "number": 59,
            "state": "open",
            "merged_at": None,
            "updated_at": "2026-08-25T02:15:00Z",
            "head": {"sha": "a" * 40},
            "html_url": "https://github.com/owner/repo/pull/59",
        })
        settled_probe = {
            "main_sha": "c" * 40,
            "target_state": "closed",
            "target_head_sha": "a" * 40,
            "target_updated_at": "2026-08-25T01:23:17Z",
        }
        blocked = self.prepared_update_record(
            needs_attention=True,
            attention={
                "type": "review_target_settled",
                "key": "review_target_settled:59:closed",
                "title": "Pull request #59 already closed",
                "detected_at": "2026-08-25T02:00:00Z",
            },
            reconciliation_probe=settled_probe,
        )

        patch = self.reconcile_update_target(
            github, blocked, "2026-08-25T02:30:00Z",
        )
        self.assertIs(patch["needs_attention"], False)
        self.assertIsNone(patch["attention"])
        self.assertEqual(patch["updated_at"], "2026-08-25T02:30:00Z")
        self.assertEqual(patch["reconciliation_probe"]["target_state"], "open")

        never_blocked = self.prepared_update_record(
            reconciliation_probe=settled_probe,
        )
        self.assertNotIn("needs_attention", self.reconcile_update_target(
            github, never_blocked, "2026-08-25T02:30:00Z",
        ))

    def test_identifier_evidence_uses_distinctive_added_declarations(self):
        identifiers = distinctive_identifiers(DIFF)
        self.assertEqual(
            identifiers["reconcile.js"],
            {
                "reconcilePreparedContributions",
                "distinctiveLandingEvidence",
                "PreparedRecordReconciler",
                "reconciliation_main_sha",
            },
        )
        present, total, ratio = identifier_presence(
            identifiers,
            {
                "reconcile.js": (
                    "reconcilePreparedContributions distinctiveLandingEvidence "
                    "PreparedRecordReconciler reconciliation_main_sha"
                ),
            },
        )
        self.assertEqual((present, total, ratio), (4, 4, 1.0))
        self.assertTrue(strong_identifier_presence(present, total, ratio))

    def test_literal_landing_probes_ignore_headers_and_short_noise(self):
        self.assertEqual(
            distinctive_added_lines(DIFF),
            {
                "reconcile.js": [
                    "function reconcilePreparedContributions() {}",
                    "const distinctiveLandingEvidence = true",
                    "class PreparedRecordReconciler {}",
                    'const reconciliation_main_sha = "abc"',
                    "const ordinary = true",
                ],
            },
        )

    def test_partial_presence_never_meets_the_auto_clear_threshold(self):
        self.assertTrue(partial_identifier_presence(2, 4, 0.5))
        self.assertFalse(strong_identifier_presence(2, 4, 0.5))
        self.assertFalse(partial_identifier_presence(1, 4, 0.25))

    def test_artifacts_bootstrap_cannot_supersede_a_later_sdk_icon_review(self):
        self.assert_preexisting_icon_wrappers_are_not_a_landing({
            "ui/Icons.jsx": (
                "ArrowLeftIcon",
                "ChevronDownIcon",
                "ArtifactIcon",
                "DownloadIcon",
                "ExpandIcon",
                "ReloadIcon",
                "ArrowUpRightIcon",
                "ChevronRightIcon",
            ),
        })

    def test_latex_modularization_cannot_supersede_a_later_sdk_icon_review(self):
        self.assert_preexisting_icon_wrappers_are_not_a_landing({
            "ui/ChatBubbleIcon.jsx": ("ChatBubbleIcon",),
            "ui/ChevronIcon.jsx": ("ChevronIcon",),
            "ui/NewFileIcon.jsx": ("NewFileIcon",),
            "ui/NewFolderIcon.jsx": ("NewFolderIcon",),
            "ui/PencilIcon.jsx": ("PencilIcon",),
            "ui/UploadIcon.jsx": ("UploadIcon",),
        })

    def test_webstudio_modularization_cannot_supersede_a_later_sdk_icon_review(self):
        self.assert_preexisting_icon_wrappers_are_not_a_landing({
            "ui/ChatBubbleIcon.jsx": ("ChatBubbleIcon",),
            "ui/ChevronIcon.jsx": ("ChevronIcon",),
            "ui/NewFileIcon.jsx": ("NewFileIcon",),
            "ui/NewFolderIcon.jsx": ("NewFolderIcon",),
            "ui/PencilIcon.jsx": ("PencilIcon",),
            "ui/PublishIcon.jsx": ("PublishIcon",),
            "ui/UploadIcon.jsx": ("UploadIcon",),
        })

    def test_reimplemented_identifiers_introduced_after_base_still_match(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args, input=None):
                return subprocess.run(
                    ["git", "-C", str(repo), *args],
                    input=input,
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            (repo / "README.md").write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            review_base = git("rev-parse", "HEAD")

            reviewed = """\
function reconcilePreparedContributions() { return "reviewed" }
const distinctiveLandingEvidence = "reviewed"
class PreparedRecordReconciler {}
const reconciliation_main_sha = "reviewed"
"""
            (repo / "reconcile.js").write_text(reviewed)
            git("add", ".")
            git("commit", "-qm", "reviewed change")
            review_head = git("rev-parse", "HEAD")
            review_diff = git(
                "diff",
                "--binary",
                "--full-index",
                f"{review_base}..{review_head}",
            ) + "\n"
            identifiers = distinctive_identifiers(review_diff)

            git("checkout", "-q", "--detach", review_base)
            landed = reviewed.replace('"reviewed"', '"reimplemented"')
            (repo / "reconcile.js").write_text(landed)
            (repo / "also.txt").write_text("batched landing\n")
            git("add", ".")
            git("commit", "-qm", "squashed reimplementation")
            main_sha = git("rev-parse", "HEAD")

            local = LocalMain({"owner/repo": [str(repo)]})
            self.assertEqual(
                local.identifiers_introduced_after_base(
                    "owner/repo",
                    "main",
                    main_sha,
                    review_base,
                    identifiers,
                ),
                identifiers,
            )
            landing, hint = identifier_landing(
                self.LocalOnlyGitHub(),
                local,
                "owner/repo",
                "main",
                main_sha,
                review_base,
                identifiers,
            )

            self.assertIsNone(hint)
            self.assertIsNotNone(landing)
            self.assertEqual(landing.matched_by, "distinctive_identifiers")
            self.assertEqual(landing.commit_sha, main_sha)

    def test_partial_post_base_identifier_overlap_stays_a_truthful_hint(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args):
                return subprocess.run(
                    ["git", "-C", str(repo), *args],
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            (repo / "README.md").write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            review_base = git("rev-parse", "HEAD")

            reviewed = """\
function reconcilePreparedContributions() {}
const distinctiveLandingEvidence = true
class PreparedRecordReconciler {}
const reconciliation_main_sha = "reviewed"
"""
            (repo / "reconcile.js").write_text(reviewed)
            git("add", ".")
            git("commit", "-qm", "reviewed change")
            review_head = git("rev-parse", "HEAD")
            review_diff = git(
                "diff",
                "--binary",
                "--full-index",
                f"{review_base}..{review_head}",
            ) + "\n"
            identifiers = distinctive_identifiers(review_diff)

            git("checkout", "-q", "--detach", review_base)
            (repo / "reconcile.js").write_text("""\
function reconcilePreparedContributions() {}
const distinctiveLandingEvidence = "partial"
""")
            git("add", ".")
            git("commit", "-qm", "partial overlap")
            main_sha = git("rev-parse", "HEAD")

            landing, hint = identifier_landing(
                self.LocalOnlyGitHub(),
                LocalMain({"owner/repo": [str(repo)]}),
                "owner/repo",
                "main",
                main_sha,
                review_base,
                identifiers,
            )

            self.assertIsNone(landing)
            self.assertIsNotNone(hint)
            self.assertEqual(hint["main_identifiers_present"], 2)
            self.assertEqual(hint["main_identifiers_total"], 4)
            self.assertIn("2 of 4", hint["message"])

    def test_branch_only_match_must_postdate_the_prepared_record(self):
        record = {"created_at": "2026-07-20T12:00:00Z"}
        self.assertTrue(branch_match_is_current(
            record,
            {"merged_at": "2026-07-20T12:00:01Z"},
        ))
        self.assertFalse(branch_match_is_current(
            record,
            {"merged_at": "2026-07-19T12:00:00Z"},
        ))
        self.assertFalse(branch_match_is_current({}, {"merged_at": "2026-07-21T00:00:00Z"}))

    def test_reverse_patch_proves_a_reviewed_change_inside_a_larger_main_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)

            def git(*args, input=None):
                return subprocess.run(
                    ["git", "-C", str(repo), *args],
                    input=input,
                    capture_output=True,
                    text=True,
                    check=True,
                ).stdout.strip()

            git("init", "-q")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            (repo / "feature.txt").write_text("base\n")
            git("add", "feature.txt")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")

            (repo / "feature.txt").write_text("base\nreviewed feature\n")
            git("commit", "-qam", "reviewed")
            head = git("rev-parse", "HEAD")
            review_diff = git(
                "diff", "--binary", "--full-index",
                "--src-prefix=a/", "--dst-prefix=b/", f"{base}..{head}",
            ) + "\n"

            git("checkout", "-q", "--detach", base)
            (repo / "feature.txt").write_text("base\nreviewed feature\n")
            (repo / "also.txt").write_text("batch addition\n")
            git("add", ".")
            git("commit", "-qm", "larger landing")
            main = git("rev-parse", "HEAD")

            local = LocalMain({"owner/repo": [str(repo)]})
            self.assertTrue(local.reverse_patch_present(
                "owner/repo", "main", main, review_diff,
            ))

            pending_diff = review_diff.replace("reviewed feature", "pending feature")
            self.assertFalse(local.reverse_patch_present(
                "owner/repo", "main", main, pending_diff,
            ))

    def test_record_write_uses_the_version_read_for_compare_and_swap(self):
        class RecordingStorage(Storage):
            def __init__(self):
                super().__init__("http://example.invalid", "token", "80")
                self.request = None

            def call(self, method, path, body=None, headers=None):
                self.request = (method, path, body, headers)
                return b"", {}

        storage = RecordingStorage()
        self.assertTrue(storage.write_record(
            "record.json",
            {"id": "record", "status": "merged"},
            '"version-7"',
        ))
        self.assertEqual(storage.request[3], {"If-Match": '"version-7"'})


if __name__ == "__main__":
    unittest.main()
