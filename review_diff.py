#!/usr/bin/env python3
"""Write the one canonical reviewed diff that Send and PR updates re-verify.

The platform binds a prepared record to the SHA-256 of exactly this `git diff`
output and recomputes it from `base_sha..head_sha` before pushing. Any other
form yields a fingerprint that can never match: plain `git diff`, and even
`git diff --binary`, abbreviates text blob ids on the `index` lines. Every
writer of `plan.diff_sha256` therefore uses this helper instead of composing
its own command.

Usage:
  python3 review_diff.py <repo> <base_sha> <head_sha> <out.diff>

Prints one JSON object: `diff_sha256`, `bytes`, and `diff_stat`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

# Byte-for-byte the platform's reviewed-branch diff (`_reviewed_branch_diff`).
# Keep these flags and the text-mode decode below aligned with it.
DIFF_ARGS = (
  "-c", "core.quotePath=false",
  "diff",
  "--no-ext-diff",
  "--no-color",
  "--binary",
  "--full-index",
  "--src-prefix=a/",
  "--dst-prefix=b/",
)


def _git(repo: Path, *args: str) -> str:
  return subprocess.run(
    ["git", "-C", str(repo), *args],
    capture_output=True, text=True, check=True,
  ).stdout


def canonical_diff(repo: Path, base_sha: str, head_sha: str) -> bytes:
  """The exact bytes the platform hashes.

  The platform reads git output in text mode and re-encodes it as UTF-8, which
  also normalizes CRLF line endings, so this does the same rather than
  hashing raw stdout.
  """
  return _git(repo, *DIFF_ARGS, f"{base_sha}..{head_sha}").encode("utf-8")


def write_review_diff(
  repo: Path, base_sha: str, head_sha: str, out: Path,
) -> dict[str, object]:
  diff = canonical_diff(repo, base_sha, head_sha)
  if not diff:
    raise ValueError(f"{base_sha}..{head_sha} has no changes")
  out.write_bytes(diff)
  stat = _git(
    repo, "-c", "core.quotePath=false", "diff", "--stat=200",
    f"{base_sha}..{head_sha}",
  ).rstrip("\n")
  return {
    "diff_sha256": hashlib.sha256(diff).hexdigest(),
    "bytes": len(diff),
    "diff_stat": stat,
  }


def main(argv: list[str] | None = None) -> int:
  parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
  parser.add_argument("repo", type=Path)
  parser.add_argument("base_sha")
  parser.add_argument("head_sha")
  parser.add_argument("out", type=Path)
  args = parser.parse_args(argv)
  try:
    result = write_review_diff(args.repo, args.base_sha, args.head_sha, args.out)
  except (subprocess.CalledProcessError, ValueError) as exc:
    detail = getattr(exc, "stderr", None) or str(exc)
    print(f"review_diff: {detail.strip()}", file=sys.stderr)
    return 1
  print(json.dumps(result))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
