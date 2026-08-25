#!/usr/bin/env python3
"""Reconcile prepared PRs that landed elsewhere or lost their update target.

This is deliberately separate from job.sh's draft/open polling. It only reads
prepared PR records. Exact landing evidence settles ordinary PRs; a settled
target leaves an unsent PR update visible for agent recovery. Every write uses
the storage version originally read, so a concurrent send, dismiss, or agent
refresh always wins.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


PREFIX = "contributions/"
IDENTIFIER_PATTERNS = (
    re.compile(r"\b(?:async\s+)?function\s+([A-Za-z_$][\w$]{9,})"),
    re.compile(r"\b(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]{9,})"),
    re.compile(r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]{9,})\s*(?:=|:)"),
    re.compile(r"\bdef\s+([A-Za-z_][\w]{9,})\s*\("),
    re.compile(r"\bclass\s+([A-Za-z_][\w]{9,})\s*(?:\(|:)"),
    re.compile(r"\.([a-z][a-z0-9_-]{11,})(?=[\s,{:#.[])"),
)


def utc_now() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def repo_slug(record: dict[str, Any]) -> str:
    value = record.get("repo")
    if not isinstance(value, str):
        return ""
    parts = value.strip().split("/")
    return value.strip() if len(parts) == 2 and all(parts) else ""


def is_prepared_pr(record: dict[str, Any]) -> bool:
    plan = record.get("plan")
    return (
        record.get("type") == "pr"
        and record.get("status") == "prepared"
        and isinstance(plan, dict)
        and plan.get("action", "pr") in ("pr", "pr_update")
        and bool(repo_slug(record))
    )


def validated_review_diff(record: dict[str, Any], diff_text: str | None) -> str | None:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    expected = str(plan.get("diff_sha256") or "").lower()
    if not expected or not diff_text:
        return None
    actual = hashlib.sha256(diff_text.encode("utf-8")).hexdigest()
    return diff_text if actual == expected else None


def patch_id(diff_text: str | None) -> str:
    if not diff_text:
        return ""
    try:
        result = subprocess.run(
            ["git", "patch-id", "--stable"],
            input=diff_text,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except Exception:
        return ""
    if result.returncode != 0 or not result.stdout.strip():
        return ""
    return result.stdout.split()[0]


def distinctive_identifiers(diff_text: str | None) -> dict[str, set[str]]:
    """Return declaration-like added identifiers, grouped by destination file."""
    if not diff_text:
        return {}
    result: dict[str, set[str]] = {}
    path = ""
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
            continue
        if not path or not line.startswith("+") or line.startswith("+++"):
            continue
        added = line[1:]
        for pattern in IDENTIFIER_PATTERNS:
            for match in pattern.finditer(added):
                result.setdefault(path, set()).add(match.group(1))
    return result


def distinctive_added_lines(diff_text: str | None) -> dict[str, list[str]]:
    """Select literal additions useful for locating a landing commit."""
    if not diff_text:
        return {}
    result: dict[str, list[str]] = {}
    path = ""
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
            continue
        if not path or not line.startswith("+") or line.startswith("+++"):
            continue
        value = line[1:].strip()
        if (
            len(value) < 20
            or value in ("{", "}", "(", ")", "[", "]")
            or value.startswith(("//", "#", "/*", "*", "import ", "from "))
        ):
            continue
        if value not in result.setdefault(path, []):
            result[path].append(value)
    return result


def identifier_presence(
    identifiers: dict[str, set[str]],
    main_files: dict[str, str | None],
) -> tuple[int, int, float]:
    total = sum(len(values) for values in identifiers.values())
    if total == 0:
        return 0, 0, 0.0
    present = sum(
        1
        for path, values in identifiers.items()
        for value in values
        if value in (main_files.get(path) or "")
    )
    return present, total, present / total


def identifier_set_presence(
    identifiers: dict[str, set[str]],
    available: dict[str, set[str]],
) -> tuple[int, int, float]:
    total = sum(len(values) for values in identifiers.values())
    if total == 0:
        return 0, 0, 0.0
    present = sum(
        len(values.intersection(available.get(path, set())))
        for path, values in identifiers.items()
    )
    return present, total, present / total


def strong_identifier_presence(present: int, total: int, ratio: float) -> bool:
    return total >= 4 and present >= 4 and ratio >= 0.8


def partial_identifier_presence(present: int, total: int, ratio: float) -> bool:
    return total >= 2 and present >= 2 and ratio >= 0.5


def branch_match_is_current(record: dict[str, Any], pull: dict[str, Any]) -> bool:
    """Reject an old merged PR when a branch name has since been reused."""
    created_at = record.get("created_at")
    merged_at = pull.get("merged_at")
    if not isinstance(created_at, str) or not isinstance(merged_at, str):
        return False
    try:
        created = dt.datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        merged = dt.datetime.fromisoformat(merged_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return merged >= created


@dataclass(frozen=True)
class Landing:
    status: str
    matched_by: str
    pull: dict[str, Any] | None = None
    commit_sha: str = ""


class Storage:
    def __init__(self, api: str, token: str, app_id: str):
        self.api = api.rstrip("/")
        self.token = token
        self.app_id = app_id

    def call(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[bytes, Any]:
        request_headers = {"Authorization": "Bearer " + self.token}
        if headers:
            request_headers.update(headers)
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.api + path,
            data=data,
            headers=request_headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read(), response.headers

    def record_path(self, name: str) -> str:
        return f"/api/storage/apps/{self.app_id}/{PREFIX}{name}"

    def list_names(self) -> list[str]:
        names: list[str] = []
        cursor = None
        for _ in range(2000):
            path = f"/api/storage/apps-list/{self.app_id}/{PREFIX}?limit=500"
            if cursor:
                path += "&cursor=" + urllib.parse.quote(cursor, safe="")
            try:
                raw, _ = self.call("GET", path)
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    return []
                raise
            page = json.loads(raw) if raw else {}
            names.extend(
                item["name"]
                for item in page.get("entries") or []
                if item.get("type") != "dir"
                and str(item.get("name", "")).endswith(".json")
            )
            cursor = page.get("next_cursor")
            if not cursor:
                break
        return names

    def read_record(self, name: str) -> tuple[dict[str, Any] | None, str | None]:
        raw, headers = self.call(
            "GET",
            self.record_path(name),
            headers={"x-mobius-version": "1"},
        )
        record = json.loads(raw) if raw else None
        return (record if isinstance(record, dict) else None), headers.get("ETag")

    def read_diff(self, name: str) -> str | None:
        diff_name = name[:-5] + ".diff"
        try:
            raw, _ = self.call("GET", self.record_path(diff_name))
        except urllib.error.HTTPError:
            return None
        return raw.decode("utf-8", errors="replace") if raw else None

    def write_record(self, name: str, record: dict[str, Any], etag: str) -> bool:
        try:
            self.call(
                "PUT",
                self.record_path(name),
                record,
                headers={"If-Match": etag},
            )
            return True
        except urllib.error.HTTPError as error:
            if error.code == 412:
                print(
                    f"contribute: skip {name} — changed under prepared reconciliation (412)",
                    file=sys.stderr,
                )
                return False
            raise


class GitHub:
    def __init__(self):
        self.repo_info_cache: dict[str, tuple[str, str] | None] = {}
        self.pulls_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.pull_cache: dict[tuple[str, int], dict[str, Any] | None] = {}
        self.branch_pull_cache: dict[tuple[str, str, str], dict[str, Any] | None] = {}
        self.content_cache: dict[tuple[str, str, str], str | None] = {}

    @staticmethod
    def _run(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str] | None:
        try:
            return subprocess.run(
                ["gh", "api"] + args,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except Exception:
            return None

    def json(self, endpoint: str, timeout: int = 30) -> Any:
        result = self._run([endpoint], timeout=timeout)
        if not result or result.returncode != 0:
            return None
        try:
            return json.loads(result.stdout) if result.stdout else None
        except json.JSONDecodeError:
            return None

    def text(self, endpoint: str, accept: str, timeout: int = 45) -> str:
        result = self._run(["-H", f"Accept: {accept}", endpoint], timeout=timeout)
        return result.stdout if result and result.returncode == 0 else ""

    def repo_info(self, repo: str) -> tuple[str, str] | None:
        if repo in self.repo_info_cache:
            return self.repo_info_cache[repo]
        info = self.json(f"repos/{repo}")
        branch = info.get("default_branch") if isinstance(info, dict) else None
        if not isinstance(branch, str) or not branch:
            self.repo_info_cache[repo] = None
            return None
        commit = self.json(
            f"repos/{repo}/commits/{urllib.parse.quote(branch, safe='')}",
        )
        sha = commit.get("sha") if isinstance(commit, dict) else None
        value = (branch, sha) if isinstance(sha, str) and sha else None
        self.repo_info_cache[repo] = value
        return value

    def merged_pulls(self, repo: str, base: str) -> list[dict[str, Any]]:
        key = (repo, base)
        if key in self.pulls_cache:
            return self.pulls_cache[key]
        endpoint = (
            f"repos/{repo}/pulls?state=closed&base={urllib.parse.quote(base, safe='')}"
            "&sort=updated&direction=desc&per_page=100"
        )
        rows = self.json(endpoint)
        pulls = [
            row for row in (rows if isinstance(rows, list) else [])
            if isinstance(row, dict) and row.get("merged_at")
        ]
        self.pulls_cache[key] = pulls
        return pulls

    def pull(self, repo: str, number: int) -> dict[str, Any] | None:
        key = (repo, number)
        if key not in self.pull_cache:
            value = self.json(f"repos/{repo}/pulls/{number}")
            self.pull_cache[key] = value if isinstance(value, dict) else None
        return self.pull_cache[key]

    def branch_pull(self, repo: str, base: str, branch: str) -> dict[str, Any] | None:
        key = (repo, base, branch)
        if key in self.branch_pull_cache:
            return self.branch_pull_cache[key]
        for pull in self.merged_pulls(repo, base):
            head = pull.get("head") if isinstance(pull.get("head"), dict) else {}
            if head.get("ref") == branch:
                self.branch_pull_cache[key] = pull
                return pull
        query = f"repo:{repo} is:pr is:merged head:{branch}"
        search = self.json(
            "search/issues?q=" + urllib.parse.quote(query, safe="") + "&per_page=10",
        )
        for item in (search.get("items") if isinstance(search, dict) else []) or []:
            number = item.get("number") if isinstance(item, dict) else None
            if not number:
                continue
            pull = self.json(f"repos/{repo}/pulls/{number}")
            if not isinstance(pull, dict) or not pull.get("merged_at"):
                continue
            head = pull.get("head") if isinstance(pull.get("head"), dict) else {}
            if head.get("ref") == branch and (pull.get("base") or {}).get("ref") == base:
                self.branch_pull_cache[key] = pull
                return pull
        self.branch_pull_cache[key] = None
        return None

    def main_file(self, repo: str, branch: str, path: str) -> str | None:
        key = (repo, branch, path)
        if key not in self.content_cache:
            endpoint = (
                f"repos/{repo}/contents/{urllib.parse.quote(path, safe='/')}"
                f"?ref={urllib.parse.quote(branch, safe='')}"
            )
            text = self.text(endpoint, "application/vnd.github.raw+json")
            self.content_cache[key] = text or None
        return self.content_cache[key]

    def head_is_on_main(self, repo: str, head_sha: str, main: str) -> bool:
        if not head_sha:
            return False
        compare = self.json(
            f"repos/{repo}/compare/{urllib.parse.quote(head_sha, safe='')}"
            f"...{urllib.parse.quote(main, safe='')}",
        )
        merge_base = compare.get("merge_base_commit") if isinstance(compare, dict) else None
        return isinstance(merge_base, dict) and merge_base.get("sha") == head_sha

    def pull_for_commit(
        self,
        repo: str,
        sha: str,
        base: str,
    ) -> dict[str, Any] | None:
        rows = self.json(f"repos/{repo}/commits/{sha}/pulls")
        for pull in rows if isinstance(rows, list) else []:
            if (
                isinstance(pull, dict)
                and pull.get("merged_at")
                and (pull.get("base") or {}).get("ref") == base
            ):
                return pull
        return None


class LocalMain:
    """One fetched main history per repo, shared by every prepared record."""

    def __init__(self, repo_paths: dict[str, list[str]]):
        self.repo_paths = repo_paths
        self.ready: dict[tuple[str, str], str | None] = {}
        self.patch_maps: dict[tuple[str, str], dict[str, str]] = {}
        self.file_cache: dict[tuple[str, str, str], str | None] = {}
        self.review_base_file_cache: dict[tuple[str, str, str], str | None] = {}

    @staticmethod
    def _git(path: str, args: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str] | None:
        try:
            return subprocess.run(
                ["git", "-C", path] + args,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except Exception:
            return None

    def ensure(self, repo: str, base: str, main_sha: str) -> str | None:
        key = (repo, main_sha)
        if key in self.ready:
            return self.ready[key]
        for path in self.repo_paths.get(repo, []):
            probe = self._git(path, ["rev-parse", "--git-dir"], timeout=10)
            if not probe or probe.returncode != 0:
                continue
            present = self._git(path, ["cat-file", "-e", f"{main_sha}^{{commit}}"], timeout=10)
            if not present or present.returncode != 0:
                fetched = self._git(
                    path,
                    [
                        "fetch",
                        "--quiet",
                        f"https://github.com/{repo}.git",
                        f"refs/heads/{base}",
                    ],
                    timeout=90,
                )
                if not fetched or fetched.returncode != 0:
                    continue
                present = self._git(path, ["cat-file", "-e", f"{main_sha}^{{commit}}"], timeout=10)
                if not present or present.returncode != 0:
                    continue
            self.ready[key] = path
            return path
        self.ready[key] = None
        return None

    def patch_commit(self, repo: str, base: str, main_sha: str, reviewed_patch_id: str) -> str:
        if not reviewed_patch_id:
            return ""
        key = (repo, main_sha)
        if key not in self.patch_maps:
            path = self.ensure(repo, base, main_sha)
            mapping: dict[str, str] = {}
            if path:
                log = self._git(
                    path,
                    ["log", "-p", "--no-merges", "-n", "500", main_sha],
                    timeout=90,
                )
                if log and log.returncode == 0:
                    try:
                        result = subprocess.run(
                            ["git", "patch-id", "--stable"],
                            input=log.stdout,
                            capture_output=True,
                            text=True,
                            timeout=60,
                        )
                    except Exception:
                        result = None
                    if result and result.returncode == 0:
                        for line in result.stdout.splitlines():
                            fields = line.split()
                            if len(fields) >= 2:
                                mapping[fields[0]] = fields[1]
            self.patch_maps[key] = mapping
        return self.patch_maps[key].get(reviewed_patch_id, "")

    def reverse_patch_present(
        self,
        repo: str,
        base: str,
        main_sha: str,
        review_diff: str | None,
    ) -> bool:
        path = self.ensure(repo, base, main_sha)
        if not path or not review_diff:
            return False
        fd, index_path = tempfile.mkstemp(prefix="contribute-reconcile-index-")
        os.close(fd)
        os.unlink(index_path)
        env = dict(os.environ)
        env["GIT_INDEX_FILE"] = index_path
        try:
            read_tree = subprocess.run(
                ["git", "-C", path, "read-tree", main_sha],
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )
            if read_tree.returncode != 0:
                return False
            checked = subprocess.run(
                ["git", "-C", path, "apply", "--reverse", "--check", "--cached", "--binary"],
                input=review_diff,
                capture_output=True,
                text=True,
                timeout=30,
                env=env,
            )
            return checked.returncode == 0
        except Exception:
            return False
        finally:
            try:
                os.unlink(index_path)
            except FileNotFoundError:
                pass

    def landing_commit_for_diff(
        self,
        repo: str,
        base: str,
        main_sha: str,
        review_diff: str | None,
    ) -> str:
        path = self.ensure(repo, base, main_sha)
        lines = distinctive_added_lines(review_diff)
        if not path or not lines:
            return ""
        scores: dict[str, int] = {}
        probes = 0
        for file_path, values in lines.items():
            for value in sorted(values, key=len, reverse=True)[:3]:
                result = self._git(
                    path,
                    [
                        "log",
                        "--format=%H",
                        "-n",
                        "8",
                        "-S",
                        value,
                        main_sha,
                        "--",
                        file_path,
                    ],
                    timeout=30,
                )
                probes += 1
                if result and result.returncode == 0:
                    for sha in set(result.stdout.splitlines()):
                        scores[sha] = scores.get(sha, 0) + 1
                if probes >= 8:
                    break
            if probes >= 8:
                break
        if not scores:
            return ""
        sha, score = max(scores.items(), key=lambda item: item[1])
        required = 1 if probes == 1 else 2
        return sha if score >= required else ""

    def main_file(self, repo: str, base: str, main_sha: str, path: str) -> str | None:
        key = (repo, main_sha, path)
        if key in self.file_cache:
            return self.file_cache[key]
        local_path = self.ensure(repo, base, main_sha)
        if not local_path:
            self.file_cache[key] = None
            return None
        result = self._git(local_path, ["show", f"{main_sha}:{path}"], timeout=20)
        text = result.stdout if result and result.returncode == 0 else None
        self.file_cache[key] = text
        return text

    def identifiers_introduced_after_base(
        self,
        repo: str,
        base: str,
        main_sha: str,
        review_base_sha: str,
        identifiers: dict[str, set[str]],
    ) -> dict[str, set[str]]:
        """Keep only identifiers absent before the reviewed change."""
        local_path = self.ensure(repo, base, main_sha)
        if not local_path or not review_base_sha:
            return {}
        present = self._git(
            local_path,
            ["cat-file", "-e", f"{review_base_sha}^{{commit}}"],
            timeout=10,
        )
        if not present or present.returncode != 0:
            return {}

        introduced: dict[str, set[str]] = {}
        for file_path, values in identifiers.items():
            key = (repo, review_base_sha, file_path)
            if key not in self.review_base_file_cache:
                result = self._git(
                    local_path,
                    ["show", f"{review_base_sha}:{file_path}"],
                    timeout=20,
                )
                self.review_base_file_cache[key] = (
                    result.stdout if result and result.returncode == 0 else None
                )
            base_text = self.review_base_file_cache[key] or ""
            new_values = {value for value in values if value not in base_text}
            if new_values:
                introduced[file_path] = new_values
        return introduced

    def identifier_commit(
        self,
        repo: str,
        base: str,
        main_sha: str,
        review_base_sha: str,
        identifiers: dict[str, set[str]],
    ) -> str:
        path = self.ensure(repo, base, main_sha)
        values = sorted({value for group in identifiers.values() for value in group})
        paths = sorted(identifiers)
        if not path or not review_base_sha or not values or not paths:
            return ""
        regex = "(" + "|".join(re.escape(value) for value in values) + ")"
        candidates = self._git(
            path,
            [
                "log",
                "--format=%H",
                "-n",
                "30",
                "-G",
                regex,
                f"{review_base_sha}..{main_sha}",
                "--",
            ] + paths,
            timeout=45,
        )
        if not candidates or candidates.returncode != 0:
            return ""
        for sha in dict.fromkeys(candidates.stdout.splitlines()):
            shown = self._git(
                path,
                [
                    "show",
                    "--format=",
                    "--no-ext-diff",
                    "--unified=0",
                    sha,
                    "--",
                ] + paths,
                timeout=20,
            )
            if not shown or shown.returncode != 0:
                continue
            added_identifiers = distinctive_identifiers(shown.stdout)
            if strong_identifier_presence(
                *identifier_set_presence(identifiers, added_identifiers),
            ):
                return sha
        return ""


def pull_reference(pull: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(pull, dict):
        return None
    number = pull.get("number")
    url = pull.get("html_url")
    if not number or not isinstance(url, str):
        return None
    return {
        "number": number,
        "url": url,
        "title": pull.get("title") or "",
        "merged_at": pull.get("merged_at") or "",
    }


def exact_landing(
    github: GitHub,
    local: LocalMain,
    repo: str,
    base: str,
    main_sha: str,
    record: dict[str, Any],
    review_diff: str | None,
) -> Landing | None:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    head_sha = str(plan.get("head_sha") or "")
    branch = str(plan.get("branch") or record.get("branch") or "")
    reviewed_patch_id = patch_id(review_diff)

    branch_pull = github.branch_pull(repo, base, branch) if branch else None
    if branch_pull:
        pull_head = branch_pull.get("head") if isinstance(branch_pull.get("head"), dict) else {}
        if head_sha and pull_head.get("sha") == head_sha:
            return Landing("merged", "reviewed_commit", pull=branch_pull, commit_sha=head_sha)

    if head_sha and github.head_is_on_main(repo, head_sha, main_sha):
        pull = github.pull_for_commit(repo, head_sha, base)
        return Landing("merged", "reviewed_commit", pull=pull, commit_sha=head_sha)

    landed_commit = local.patch_commit(repo, base, main_sha, reviewed_patch_id)
    if landed_commit:
        pull = github.pull_for_commit(repo, landed_commit, base)
        return Landing("merged", "reviewed_diff", pull=pull, commit_sha=landed_commit)

    if local.reverse_patch_present(repo, base, main_sha, review_diff):
        landed_commit = local.landing_commit_for_diff(
            repo,
            base,
            main_sha,
            review_diff,
        )
        pull = github.pull_for_commit(repo, landed_commit, base) if landed_commit else None
        return Landing(
            "merged",
            "reviewed_diff_on_main",
            pull=pull,
            commit_sha=landed_commit or main_sha,
        )

    if (
        plan.get("action", "pr") == "pr"
        and branch_pull
        and branch_match_is_current(record, branch_pull)
    ):
        return Landing("superseded", "merged_branch", pull=branch_pull, commit_sha=head_sha)
    return None


def update_target_probe(
    record: dict[str, Any],
    pull: dict[str, Any] | None,
) -> dict[str, str]:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    if plan.get("action") != "pr_update" or not isinstance(pull, dict):
        return {}
    head = pull.get("head") if isinstance(pull.get("head"), dict) else {}
    return {
        "target_state": str(pull.get("state") or ""),
        "target_head_sha": str(head.get("sha") or ""),
        "target_updated_at": str(pull.get("updated_at") or ""),
    }


def settled_update_attention(
    record: dict[str, Any],
    pull: dict[str, Any] | None,
    now: str,
) -> dict[str, Any] | None:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    if plan.get("action") != "pr_update" or not isinstance(pull, dict):
        return None
    state = str(pull.get("state") or "").lower()
    merged = bool(pull.get("merged_at"))
    if not merged and state != "closed":
        return None
    number = pull.get("number") or record.get("number")
    label = f"Pull request #{number}" if number else "The pull request"
    outcome = "merged" if merged else "closed"
    url = pull.get("html_url") or record.get("url") or ""
    return {
        "needs_attention": True,
        "attention": {
            "type": "review_target_settled",
            "key": f"review_target_settled:{number or ''}:{outcome}",
            "title": f"{label} already {outcome}",
            "message": (
                "This private update can no longer use Update PR. Ask your agent "
                "to preserve the remaining changes in a new reviewed contribution."
            ),
            "url": url if isinstance(url, str) else "",
            "detected_at": now,
        },
        "updated_at": now,
    }


def identifier_landing(
    github: GitHub,
    local: LocalMain,
    repo: str,
    base: str,
    main_sha: str,
    review_base_sha: str,
    identifiers: dict[str, set[str]],
) -> tuple[Landing | None, dict[str, Any] | None]:
    introduced = local.identifiers_introduced_after_base(
        repo,
        base,
        main_sha,
        review_base_sha,
        identifiers,
    )
    if not introduced:
        return None, None

    main_files = {
        path: (
            local.main_file(repo, base, main_sha, path)
            or github.main_file(repo, base, path)
        )
        for path in introduced
    }
    present, total, ratio = identifier_presence(introduced, main_files)
    if not partial_identifier_presence(present, total, ratio):
        return None, None

    landed_commit = ""
    landing_pull = None
    if strong_identifier_presence(present, total, ratio):
        landed_commit = local.identifier_commit(
            repo,
            base,
            main_sha,
            review_base_sha,
            introduced,
        )
        if landed_commit:
            landing_pull = github.pull_for_commit(repo, landed_commit, base)
            return Landing(
                "superseded",
                "distinctive_identifiers",
                pull=landing_pull,
                commit_sha=landed_commit,
            ), None

    hint = {
        "type": "already_landed",
        "title": "Possible overlap on main",
        "message": (
            f"{present} of {total} distinctive identifiers appear on {base}, "
            "but no attributable landing after the reviewed base was proven."
        ),
        "main_identifiers_present": present,
        "main_identifiers_total": total,
        "landing_pr": pull_reference(landing_pull),
    }
    return None, hint


def landing_patch(
    record: dict[str, Any],
    landing: Landing,
    repo: str,
    main_sha: str,
    now: str,
) -> dict[str, Any]:
    reference = pull_reference(landing.pull)
    patch: dict[str, Any] = {
        "status": landing.status,
        "needs_attention": False,
        "attention": None,
        "reconciliation_hint": None,
        "reconciliation": {
            "outcome": landing.status,
            "matched_by": landing.matched_by,
            "confidence": "strong",
            "detected_at": now,
            "main_sha": main_sha,
            "landing_pr": reference,
        },
        "updated_at": now,
    }
    if reference:
        patch["number"] = reference["number"]
        patch["url"] = reference["url"]
    elif landing.commit_sha:
        patch["url"] = f"https://github.com/{repo}/commit/{landing.commit_sha}"
        patch["reconciliation"]["landing_commit"] = {
            "sha": landing.commit_sha,
            "url": patch["url"],
        }
    return patch


def reconcile_record(
    github: GitHub,
    local: LocalMain,
    storage: Storage,
    name: str,
    record: dict[str, Any],
    now: str,
) -> dict[str, Any] | None:
    repo = repo_slug(record)
    info = github.repo_info(repo)
    if not info:
        return None
    base, main_sha = info
    previous_probe = (
        record.get("reconciliation_probe")
        if isinstance(record.get("reconciliation_probe"), dict)
        else {}
    )
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    target_pull = None
    if plan.get("action") == "pr_update":
        try:
            number = int(record.get("number") or 0)
        except (TypeError, ValueError):
            number = 0
        if number > 0:
            target_pull = github.pull(repo, number)
    probe = {"main_sha": main_sha, **update_target_probe(record, target_pull)}
    if all(previous_probe.get(key) == value for key, value in probe.items()):
        return None

    raw_diff = storage.read_diff(name)
    review_diff = validated_review_diff(record, raw_diff)
    landing = exact_landing(github, local, repo, base, main_sha, record, review_diff)
    hint = None
    if not landing and review_diff and plan.get("action", "pr") == "pr":
        landing, hint = identifier_landing(
            github,
            local,
            repo,
            base,
            main_sha,
            str(plan.get("base_sha") or ""),
            distinctive_identifiers(review_diff),
        )

    patch: dict[str, Any] = {
        "reconciliation_probe": {**probe, "checked_at": now},
    }
    if landing:
        patch.update(landing_patch(record, landing, repo, main_sha, now))
    elif settled := settled_update_attention(record, target_pull, now):
        patch.update(settled)
    elif hint:
        hint["detected_at"] = now
        hint["main_sha"] = main_sha
        patch["reconciliation_hint"] = hint
        patch["updated_at"] = now
    elif (
        plan.get("action") == "pr_update"
        and isinstance(record.get("attention"), dict)
        and record["attention"].get("type") == "review_target_settled"
        and isinstance(target_pull, dict)
        and str(target_pull.get("state") or "").lower() == "open"
    ):
        patch.update({"needs_attention": False, "attention": None, "updated_at": now})
    return patch


def run(storage: Storage, github: GitHub, dry_run: bool = False) -> dict[str, int]:
    counts = {
        "checked": 0,
        "merged": 0,
        "superseded": 0,
        "hinted": 0,
        "attention": 0,
        "written": 0,
    }
    now = utc_now()
    prepared: list[tuple[str, dict[str, Any], str]] = []
    for name in storage.list_names():
        try:
            record, etag = storage.read_record(name)
        except urllib.error.HTTPError:
            continue
        if not record or not is_prepared_pr(record):
            continue
        if not etag:
            print(
                f"contribute: skip {name} — storage version unavailable",
                file=sys.stderr,
            )
            continue
        prepared.append((name, record, etag))

    repo_paths: dict[str, list[str]] = {}
    for _, record, _ in prepared:
        plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
        path = plan.get("repo_path")
        repo = repo_slug(record)
        if isinstance(path, str) and path and path not in repo_paths.setdefault(repo, []):
            repo_paths[repo].append(path)
    local = LocalMain(repo_paths)

    for name, record, etag in prepared:
        patch = reconcile_record(github, local, storage, name, record, now)
        if not patch:
            continue
        counts["checked"] += 1
        status = patch.get("status")
        if status in ("merged", "superseded"):
            counts[status] += 1
        if patch.get("reconciliation_hint"):
            counts["hinted"] += 1
        if (patch.get("attention") or {}).get("type") == "review_target_settled":
            counts["attention"] += 1
        updated = dict(record)
        updated.update(patch)
        if dry_run:
            print(json.dumps({
                "record": record.get("id"),
                "repo": record.get("repo"),
                "result": status or (
                    "hint" if patch.get("reconciliation_hint")
                    else "attention" if patch.get("needs_attention")
                    else "no_match"
                ),
                "matched_by": (patch.get("reconciliation") or {}).get("matched_by"),
            }))
            continue
        if storage.write_record(name, updated, etag):
            counts["written"] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    app_id = os.environ.get("APP_ID", "")
    api = os.environ.get("API_BASE_URL", "http://localhost:8000")
    token = os.environ.get("SERVICE_TOKEN", "")
    if not app_id or not token:
        return 0
    counts = run(Storage(api, token, app_id), GitHub(), dry_run=args.dry_run)
    if args.dry_run:
        print(json.dumps({"summary": counts}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
