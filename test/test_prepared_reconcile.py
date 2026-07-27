import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from prepared_reconcile import (
    branch_match_is_current,
    distinctive_added_lines,
    distinctive_identifiers,
    identifier_presence,
    partial_identifier_presence,
    LocalMain,
    Storage,
    strong_identifier_presence,
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
    def test_review_diff_must_match_the_stored_hash(self):
        digest = hashlib.sha256(DIFF.encode()).hexdigest()
        record = {"plan": {"diff_sha256": digest}}
        self.assertEqual(validated_review_diff(record, DIFF), DIFF)
        self.assertIsNone(validated_review_diff(record, DIFF + "\nchanged"))

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
