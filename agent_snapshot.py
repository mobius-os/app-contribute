#!/usr/bin/env python3
"""One bounded agent view of active contribution state.

The Contribute UI already batches its feed and live refresh. This companion
keeps chat agents from reconstructing the same queue through one `gh` command
per pull request. It reads the local ledger, verifies prepared branch tips, and
uses one GraphQL request for every public pull request in the snapshot.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from typing import Any


ACTIVE = {"prepared", "submitting", "draft", "open", "landing"}
DB_PATH = Path("/data/db/ultimate.db")


@dataclass
class Item:
  order: int
  id: str
  kind: str
  repo: str
  number: int | None
  status: str
  branch: str
  expected_head: str
  actual_head: str
  revision_matches: bool | None
  worktree_clean: bool | None
  stack_id: str
  stack_position: int | None
  stack_total: int | None
  parent_id: str
  live_state: str
  draft: bool | None
  mergeable: str
  ci: str
  live_head: str


def find_ledger(db_path: Path = DB_PATH) -> Path:
  with sqlite3.connect(db_path) as con:
    row = con.execute(
      "SELECT id FROM apps WHERE slug = 'contribute' AND deleted_at IS NULL "
      "ORDER BY id LIMIT 1"
    ).fetchone()
  if not row:
    raise RuntimeError("Contribute is not installed")
  return Path("/data/apps") / str(row[0]) / "contributions"


def load_active(ledger: Path, limit: int = 100) -> list[dict[str, Any]]:
  records = []
  for path in sorted(ledger.glob("*.json")):
    if path.name.endswith(".record.json"):
      continue
    try:
      record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
      continue
    if not isinstance(record, dict) or not record.get("id"):
      continue
    if path.name != f'{record["id"]}.json':
      continue
    if record.get("status") in ACTIVE:
      records.append(record)
  records.sort(key=_dependency_key)
  return records[:limit]


def _dependency_key(record: dict[str, Any]) -> tuple:
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  stack = plan.get("stack") if isinstance(plan.get("stack"), dict) else {}
  stack_id = str(stack.get("id") or "")
  position = _integer(stack.get("position")) or 0
  created = str(record.get("created_at") or "")
  # Keep dependent layers together and ordered; independent work follows its
  # ordinary creation order without inventing dependencies.
  return (0, stack_id, position, created) if stack_id else (1, created, str(record.get("id")))


def _integer(value: Any) -> int | None:
  try:
    return int(value) if value is not None else None
  except (TypeError, ValueError):
    return None


def _git(repo: str, *args: str) -> str:
  if not repo:
    return ""
  try:
    return subprocess.run(
      ["git", "-C", repo, *args],
      check=True,
      capture_output=True,
      text=True,
      timeout=10,
    ).stdout.strip()
  except (OSError, subprocess.SubprocessError):
    return ""


def local_item(record: dict[str, Any], order: int) -> Item:
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  stack = plan.get("stack") if isinstance(plan.get("stack"), dict) else {}
  repo_path = str(plan.get("repo_path") or "")
  branch = str(plan.get("branch") or record.get("branch") or "")
  expected = str(plan.get("head_sha") or "")
  actual = _git(repo_path, "rev-parse", "--verify", f"{branch}^{{commit}}") if branch else ""
  clean = None
  if repo_path:
    status = _git(repo_path, "status", "--porcelain=v1", "--untracked-files=all")
    clean = not bool(status)
  matches = (actual == expected) if actual and expected else None
  return Item(
    order=order,
    id=str(record.get("id") or ""),
    kind=str(record.get("type") or ""),
    repo=str(record.get("repo") or plan.get("repo") or ""),
    number=_integer(record.get("number")),
    status=str(record.get("status") or ""),
    branch=branch,
    expected_head=expected,
    actual_head=actual,
    revision_matches=matches,
    worktree_clean=clean,
    stack_id=str(stack.get("id") or ""),
    stack_position=_integer(stack.get("position")),
    stack_total=_integer(stack.get("total")),
    parent_id=str(stack.get("parent_record_id") or ""),
    live_state="",
    draft=None,
    mergeable="",
    ci="",
    live_head="",
  )


def build_graphql(items: list[Item]) -> tuple[str, dict[str, str]]:
  fields = []
  aliases = {}
  for item in items:
    if item.kind != "pr" or not item.number or "/" not in item.repo:
      continue
    owner, name = item.repo.split("/", 1)
    if not owner or not name:
      continue
    alias = f"c{item.order}"
    aliases[alias] = item.id
    fields.append(
      f'{alias}: repository(owner:{json.dumps(owner)},name:{json.dumps(name)}){{'
      f"pullRequest(number:{item.number}){{state isDraft mergeable headRefOid "
      "statusCheckRollup{state}}}"
    )
  return "query ContributionSnapshot{" + " ".join(fields) + "}", aliases


def fetch_graphql(query: str) -> tuple[dict[str, Any], str]:
  if query.endswith("{}"):  # no public PRs
    return {}, ""
  try:
    result = subprocess.run(
      ["gh", "api", "graphql", "-f", f"query={query}"],
      check=False,
      capture_output=True,
      text=True,
      timeout=30,
    )
  except (OSError, subprocess.TimeoutExpired) as exc:
    return {}, str(exc)
  try:
    body = json.loads(result.stdout)
  except json.JSONDecodeError:
    return {}, (result.stderr or "GitHub returned invalid JSON").strip()
  data = body.get("data") if isinstance(body.get("data"), dict) else {}
  # GraphQL is intentionally field-isolated: a deleted/inaccessible PR may
  # make `gh` exit non-zero while stdout still contains every healthy sibling.
  # Keep that partial batch and report the one warning instead of discarding it
  # and falling back to per-PR calls.
  warning = (result.stderr or "").strip() if result.returncode else ""
  return data, warning


def merge_live(items: list[Item], data: dict[str, Any], aliases: dict[str, str]) -> None:
  by_id = {item.id: item for item in items}
  for alias, record_id in aliases.items():
    repository = data.get(alias)
    pr = repository.get("pullRequest") if isinstance(repository, dict) else None
    item = by_id.get(record_id)
    if not item or not isinstance(pr, dict):
      continue
    item.live_state = str(pr.get("state") or "")
    item.draft = bool(pr.get("isDraft"))
    item.mergeable = str(pr.get("mergeable") or "")
    item.live_head = str(pr.get("headRefOid") or "")
    rollup = pr.get("statusCheckRollup")
    item.ci = str(rollup.get("state") or "") if isinstance(rollup, dict) else "NONE"


def short_sha(value: str) -> str:
  return value[:10] if value else "—"


def render(items: list[Item], warning: str = "") -> str:
  lines = [f"CONTRIBUTE SNAPSHOT — {len(items)} active item(s)"]
  lines.append("-" * 46)
  if warning:
    lines.append(f"GitHub: partial ({warning.splitlines()[0][:120]})")
  for item in items:
    target = f"#{item.number}" if item.number else "private"
    lines.append(f"{item.order:02d}. {item.id}  {item.status}  {item.repo} {target}")
    revision = "match" if item.revision_matches else (
      "DRIFT" if item.revision_matches is False else "n/a"
    )
    cleanliness = "clean" if item.worktree_clean else (
      "working changes" if item.worktree_clean is False else "n/a"
    )
    lines.append(
      f"    revision {revision}: expected {short_sha(item.expected_head)} / "
      f"local {short_sha(item.actual_head)}  ·  {cleanliness}"
    )
    if item.kind == "pr" and item.number:
      state = ("DRAFT" if item.draft else item.live_state) or "unknown"
      lines.append(
        f"    review {state}  ·  merge {item.mergeable or 'unknown'}  ·  "
        f"CI {item.ci or 'unknown'}  ·  GitHub head {short_sha(item.live_head)}"
      )
    if item.stack_id:
      lines.append(
        f"    dependency {item.stack_id} {item.stack_position or '?'}"
        f"/{item.stack_total or '?'}  ·  parent {item.parent_id or 'main'}"
      )
  return "\n".join(lines)


def main() -> int:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--ledger-dir", type=Path)
  parser.add_argument("--db", type=Path, default=DB_PATH)
  parser.add_argument("--limit", type=int, default=100)
  parser.add_argument("--json", action="store_true")
  parser.add_argument("--offline", action="store_true", help="skip the one GitHub batch")
  args = parser.parse_args()
  try:
    ledger = args.ledger_dir or find_ledger(args.db)
    records = load_active(ledger, max(1, min(args.limit, 500)))
  except (OSError, sqlite3.Error, RuntimeError) as exc:
    print(f"agent_snapshot: {exc}", file=sys.stderr)
    return 1
  items = [local_item(record, index) for index, record in enumerate(records, 1)]
  query, aliases = build_graphql(items)
  data, warning = ({}, "") if args.offline else fetch_graphql(query)
  merge_live(items, data, aliases)
  if args.json:
    print(json.dumps({
      "schema": 1,
      "active": len(items),
      "github_warning": warning or None,
      "items": [asdict(item) for item in items],
    }, indent=2, sort_keys=True))
  else:
    print(render(items, warning))
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
