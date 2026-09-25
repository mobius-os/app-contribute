"""The reviewed-diff fingerprint must match what Send and /update recompute."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("review_diff", ROOT / "review_diff.py")
review_diff = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(review_diff)


def git(repo: Path, *args: str) -> str:
  return subprocess.run(
    ["git", "-C", str(repo), *args], capture_output=True, text=True, check=True,
  ).stdout.strip()


class ReviewDiffTest(unittest.TestCase):
  def setUp(self) -> None:
    self.tmp = tempfile.TemporaryDirectory()
    self.repo = Path(self.tmp.name) / "repo"
    self.repo.mkdir()
    git(self.repo, "init", "-q")
    git(self.repo, "config", "user.email", "test@example.com")
    git(self.repo, "config", "user.name", "Test")
    (self.repo / "app.py").write_text("value = 1\n")
    (self.repo / "windows.txt").write_bytes(b"one\r\n")
    git(self.repo, "add", ".")
    git(self.repo, "commit", "-qm", "base")
    self.base = git(self.repo, "rev-parse", "HEAD")
    (self.repo / "app.py").write_text("value = 2\n")
    (self.repo / "windows.txt").write_bytes(b"one\r\ntwo\r\n")
    git(self.repo, "commit", "-qam", "change")
    self.head = git(self.repo, "rev-parse", "HEAD")

  def tearDown(self) -> None:
    self.tmp.cleanup()

  def test_writes_the_exact_platform_fingerprint(self) -> None:
    out = Path(self.tmp.name) / "record.diff"
    result = review_diff.write_review_diff(self.repo, self.base, self.head, out)
    written = out.read_bytes()
    self.assertEqual(result["diff_sha256"], hashlib.sha256(written).hexdigest())
    self.assertEqual(result["bytes"], len(written))
    # The platform's _reviewed_branch_diff: these flags, read as text, UTF-8.
    platform = subprocess.run(
      ["git", "-C", str(self.repo), "-c", "core.quotePath=false", "diff",
       "--no-ext-diff", "--no-color", "--binary", "--full-index",
       "--src-prefix=a/", "--dst-prefix=b/", f"{self.base}..{self.head}"],
      capture_output=True, text=True, check=True,
    ).stdout.encode("utf-8")
    self.assertEqual(written, platform)
    self.assertNotIn(b"\r\n", written)
    self.assertIn("2 files changed", result["diff_stat"])

  def test_full_blob_ids_distinguish_it_from_improvised_diffs(self) -> None:
    written = review_diff.canonical_diff(self.repo, self.base, self.head)
    self.assertRegex(written.decode(), r"(?m)^index [0-9a-f]{40}\.\.[0-9a-f]{40} ")
    improvised = subprocess.run(
      ["git", "-C", str(self.repo), "diff", "--binary", f"{self.base}..{self.head}"],
      capture_output=True, check=True,
    ).stdout
    self.assertNotEqual(
      hashlib.sha256(written).hexdigest(), hashlib.sha256(improvised).hexdigest(),
    )

  def test_cli_prints_json_and_rejects_empty_ranges(self) -> None:
    out = Path(self.tmp.name) / "cli.diff"
    cli = [str(ROOT / "review_diff.py"), str(self.repo)]
    ok = subprocess.run(
      ["python3", *cli, self.base, self.head, str(out)],
      capture_output=True, text=True,
    )
    self.assertEqual(ok.returncode, 0, ok.stderr)
    self.assertEqual(
      json.loads(ok.stdout)["diff_sha256"], hashlib.sha256(out.read_bytes()).hexdigest(),
    )
    empty = subprocess.run(
      ["python3", *cli, self.head, self.head, str(out)], capture_output=True, text=True,
    )
    self.assertEqual(empty.returncode, 1)
    self.assertIn("no changes", empty.stderr)

  def test_every_fingerprint_writer_uses_the_helper(self) -> None:
    for name in ("attached-work.md", "review-followup.md", "contributing/branch.md"):
      text = (ROOT / name).read_text()
      self.assertIn("/data/apps/contribute/review_diff.py", text, name)
      self.assertNotRegex(text, r"sha256sum[^\n]*\.diff", name)
    self.assertIn("review-status", (ROOT / "attached-work.md").read_text())
    flags = " ".join(review_diff.DIFF_ARGS)
    self.assertTrue(re.search(r"--full-index --src-prefix=a/ --dst-prefix=b/", flags))


if __name__ == "__main__":
  unittest.main()
