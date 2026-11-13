"""Runs the Python tests in several processes at once.

unittest runs one test after another, and the respond tests drive real git repositories, so a
serial run took longer than every JavaScript test together. The tests are dealt out one by one
rather than file by file, because a single class holds most of the time.
"""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
import unittest

TEST_DIR = Path(__file__).resolve().parent
ROOT = TEST_DIR.parent  # some test modules import the app's modules by name, as `discover` from the root lets them
MAX_PROCESSES = 8  # past this the slowest single test, not the queue, sets the wait


def test_ids(suite: unittest.TestSuite) -> list[str]:
  ids: list[str] = []
  for item in suite:
    ids.extend(test_ids(item) if isinstance(item, unittest.TestSuite) else [item.id()])
  return ids


def start(ids: list[str]) -> subprocess.Popen:
  return subprocess.Popen(
    [sys.executable, "-m", "unittest", *ids], cwd=ROOT, env={**os.environ, "PYTHONPATH": str(TEST_DIR)},
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def tests_run(output: str) -> int:
  found = re.search(r"^Ran (\d+) tests? in", output, re.MULTILINE)
  return int(found.group(1)) if found else 0


def main() -> int:
  sys.path.insert(0, str(ROOT))
  ids = sorted(test_ids(unittest.defaultTestLoader.discover(str(TEST_DIR), pattern="test_*.py")))
  count = min(MAX_PROCESSES, os.cpu_count() or 1, len(ids))
  runs = [start(ids[shard::count]) for shard in range(count)]
  outputs = [run.communicate()[0] for run in runs]
  failed = [output for run, output in zip(runs, outputs) if run.returncode != 0]
  for output in failed:
    print(output)
  ran = sum(tests_run(output) for output in outputs)
  print(f"Python: ran {ran} of {len(ids)} tests in {count} processes, {len(failed)} with failures")
  # A process that ran fewer tests than it was dealt must not pass for green.
  return 0 if ids and not failed and ran == len(ids) else 1


if __name__ == "__main__":
  sys.exit(main())
