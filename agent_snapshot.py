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
ALLOWED_REVIEW_ROOTS = (
  Path("/data/platform"), Path("/data/contrib"), Path("/data/contributions"),
)


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
  selected: dict[str, tuple[Path, dict[str, Any]]] = {}
  for path in sorted(ledger.glob("*.json")):
    try:
      record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
      continue
    if not isinstance(record, dict) or not record.get("id"):
      continue
    record_id = str(record["id"])
    if path.name not in {f"{record_id}.json", f"{record_id}.record.json"}:
      continue
    current = selected.get(record_id)
    if current is None or _candidate_owns_record(current, (path, record)):
      selected[record_id] = (path, record)
  records = [
    record for _path, record in selected.values()
    if record.get("status") in ACTIVE
  ]
  records.sort(key=_dependency_key)
  return records[:limit]


def _source_file_path(source_root: str, value: object) -> str:
  if not isinstance(value, str) or not value.strip():
    return ""
  path = Path(value.strip())
  if path.is_absolute():
    return str(path)
  if not source_root:
    return ""
  return str(Path(source_root) / path)


def relevant_records(
  records: list[dict[str, Any]], work: dict[str, Any],
) -> list[dict[str, Any]]:
  """Return the small active-ledger slice that can overlap attached work."""
  source_chat_id = str(work.get("source_chat_id") or "")
  intent = str(work.get("intent") or "")
  requested_ids = {
    str(value) for value in work.get("record_ids") or [] if value
  }
  roots = {
    str(value).rstrip("/") for value in work.get("project_roots") or []
    if isinstance(value, str) and value.strip()
  }
  scoped_paths = {
    str(item.get("path")) for item in work.get("paths") or []
    if isinstance(item, dict) and isinstance(item.get("path"), str)
  }
  selected = []
  for record in records:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    record_id = str(record.get("id") or "")
    source_root = str(plan.get("source_repo_path") or "").rstrip("/")
    files = {
      path for value in plan.get("files") or []
      if (path := _source_file_path(source_root, value))
    }
    chat_ids = {
      str(value) for value in record.get("chat_ids") or [] if value
    }
    if record.get("chat_id"):
      chat_ids.add(str(record["chat_id"]))
    selected_by_id = record_id in requested_ids
    selected_by_chat = bool(source_chat_id and source_chat_id in chat_ids)
    selected_by_path = bool(scoped_paths & files)
    selected_by_project = bool(
      intent == "project" and source_root and source_root in roots
    )
    if selected_by_id or selected_by_chat or selected_by_path or selected_by_project:
      selected.append(record)
  return selected


def work_view(record: dict[str, Any], order: int) -> dict[str, Any]:
  """Project one record into the fields private preparation actually needs."""
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  quality = (
    record.get("quality_review")
    if isinstance(record.get("quality_review"), dict)
    else {}
  )
  local = local_item(record, order)
  return {
    "id": local.id,
    "type": local.kind,
    "status": local.status,
    "repo": local.repo,
    "title": str(record.get("title") or ""),
    "summary": str(record.get("summary") or ""),
    "chat_id": str(record.get("chat_id") or ""),
    "chat_ids": [str(value) for value in record.get("chat_ids") or [] if value],
    "plan": {
      key: plan.get(key) for key in (
        "action", "source_repo_path", "repo_path", "files", "branch",
        "base_sha", "head_sha", "stack",
      ) if plan.get(key) not in (None, "", [], {})
    },
    "quality_review": {
      key: quality.get(key) for key in ("state", "reviewed_head_sha")
      if quality.get(key) not in (None, "")
    },
    "local": {
      "actual_head": local.actual_head,
      "revision_matches": local.revision_matches,
      "worktree_clean": local.worktree_clean,
    },
  }


def parse_work(raw: str) -> dict[str, Any]:
  try:
    work = json.loads(raw)
  except json.JSONDecodeError as exc:
    raise ValueError(f"work manifest is not valid JSON: {exc}") from exc
  if not isinstance(work, dict) or work.get("v") != 1:
    raise ValueError("work manifest must be a version 1 object")
  if not isinstance(work.get("source_chat_id"), str):
    raise ValueError("work manifest needs source_chat_id")
  for key in ("paths", "record_ids", "project_roots"):
    if not isinstance(work.get(key), list):
      raise ValueError(f"work manifest needs a {key} array")
  return work


def _candidate_owns_record(
  current: tuple[Path, dict[str, Any]],
  candidate: tuple[Path, dict[str, Any]],
) -> bool:
  current_path, current_record = current
  candidate_path, candidate_record = candidate
  record_id = str(candidate_record["id"])
  current_canonical = current_path.name == f"{record_id}.json"
  candidate_canonical = candidate_path.name == f"{record_id}.json"
  if candidate_canonical != current_canonical:
    return candidate_canonical
  current_time = str(
    current_record.get("updated_at") or current_record.get("created_at") or ""
  )
  candidate_time = str(
    candidate_record.get("updated_at") or candidate_record.get("created_at") or ""
  )
  return candidate_time > current_time


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


def safe_repo_path(value: object) -> str:
  """Confine ledger-authored checkout paths before any Git process reads them."""
  if not isinstance(value, str) or not value.strip() or "\x00" in value:
    return ""
  try:
    path = Path(value.strip()).resolve(strict=False)
  except (OSError, RuntimeError):
    return ""
  if any(path == root or root in path.parents for root in ALLOWED_REVIEW_ROOTS):
    return str(path)
  apps = Path("/data/apps")
  try:
    relative = path.relative_to(apps)
  except ValueError:
    return ""
  return str(path) if relative.parts and not relative.parts[0].isdigit() else ""


def local_item(record: dict[str, Any], order: int) -> Item:
  plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
  stack = plan.get("stack") if isinstance(plan.get("stack"), dict) else {}
  repo_path = safe_repo_path(plan.get("repo_path"))
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
  parser.add_argument(
    "--work-json",
    help="return only records relevant to one attached contribution-work manifest",
  )
  args = parser.parse_args()
  try:
    work = parse_work(args.work_json) if args.work_json is not None else None
    ledger = args.ledger_dir or find_ledger(args.db)
    limit = 500 if work is not None else max(1, min(args.limit, 500))
    records = load_active(ledger, limit)
  except (OSError, sqlite3.Error, RuntimeError, ValueError) as exc:
    print(f"agent_snapshot: {exc}", file=sys.stderr)
    return 1
  if work is not None:
    matches = relevant_records(records, work)
    print(json.dumps({
      "schema": 2,
      "source_chat_id": work["source_chat_id"],
      "active_total": len(records),
      "matching": len(matches),
      "records": [
        work_view(record, index) for index, record in enumerate(matches, 1)
      ],
    }, indent=2, sort_keys=True))
    return 0
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
