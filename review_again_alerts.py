"""Tell the owner when a PR they asked changes on has new commits.

Contribute shows "New commits · review again" only while it is open, so a
change request can stand on a PR for days after its author fixed everything.
This scheduled pass reads the open PRs the owner reviewed and sends one
notification per new head of each PR where the owner's own change request
still stands on an older commit.

It only reads GitHub and sends notifications; it never reviews, dismisses or
posts anything.

State lives in the runner's per-app ``APP_JOB_STATE_DIR``. A pass with no
saved state (the first one, or after the state was lost) records what it
sees without notifying, so it can never announce a backlog at once. Without
a state directory nothing is sent, because a repeat could not be prevented.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from typing import Any, Callable

SCHEMA = 1
STATE_FILE = "review-again-alerts.json"
# One page of the most recently updated PRs the owner reviewed: a pass is one request.
QUERY = """
query ContributeReviewAgainAlerts {
  viewer { login }
  search(query: "is:pr is:open reviewed-by:@me -author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) {
    nodes { ... on PullRequest {
      number title headRefOid
      repository { nameWithOwner }
      author { login }
      latestOpinionatedReviews(first: 30) { nodes { state author { login } commit { oid } } }
    } }
  }
}
"""
_REPO = re.compile(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")

Call = Callable[..., Any]


def read_github() -> dict[str, Any] | None:
    """The owner's reviewed PRs as GitHub shows them now, or None when it cannot be read."""
    try:
        out = subprocess.run(["gh", "api", "graphql", "-f", "query=" + QUERY],
                             capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout).get("data") if out.returncode == 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _same(left: Any, right: Any) -> bool:
    return bool(left) and str(left).lower() == str(right).lower()


def stale_change_requests(data: dict[str, Any]) -> list[dict[str, Any]]:
    """The PRs whose head moved past the commit the owner asked changes on."""
    me = (data.get("viewer") or {}).get("login")
    found = []
    for pull in (data.get("search") or {}).get("nodes") or []:
        repo = (pull.get("repository") or {}).get("nameWithOwner") or ""
        head = pull.get("headRefOid")
        reviews = (pull.get("latestOpinionatedReviews") or {}).get("nodes") or []
        mine = next((r for r in reviews if _same((r.get("author") or {}).get("login"), me)), None)
        if not mine or mine.get("state") != "CHANGES_REQUESTED" or not head or not _REPO.fullmatch(repo):
            continue
        reviewed = (mine.get("commit") or {}).get("oid")
        if reviewed and reviewed != head:
            found.append({"key": "%s#%s" % (repo.lower(), pull.get("number")), "repo": repo,
                          "number": pull.get("number"), "title": pull.get("title") or "",
                          "author": (pull.get("author") or {}).get("login") or "The author", "head": head})
    return found


def notification(app_id: str, pull: dict[str, Any]) -> dict[str, str]:
    """One push per PR: a newer one replaces the older on the device (same tag)."""
    owner, _, name = pull["repo"].partition("/")
    intent = "pr:%s:%s:%s" % (owner, name, pull["number"])
    title = (" " + pull["title"]) if pull["title"] else ""
    body = "%s pushed new commits to #%s%s since you asked for changes. Review again." % (
        pull["author"], pull["number"], title)
    target = "/shell/?app=%s" % app_id
    return {"title": "New commits on a PR you reviewed", "body": body[:1000],
            "target": target + "&intent=" + intent if len(intent) <= 128 else target,
            **({"tag": intent} if len(intent) <= 128 else {})}


class Alerts:
    def __init__(self, call: Call, app_id: str, state_dir: str | None,
                 read: Callable[[], dict[str, Any] | None] = read_github):
        self._call = call
        self._app_id = app_id
        self._read = read
        self._path = os.path.join(state_dir, STATE_FILE) if state_dir else None
        self.sent: list[str] = []

    def _load(self) -> dict[str, str] | None:
        """The head last announced per PR, or None when no pass has recorded any yet."""
        try:
            with open(self._path, encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, ValueError):
            return None
        heads = state.get("heads") if isinstance(state, dict) and state.get("schema") == SCHEMA else None
        return heads if isinstance(heads, dict) else None

    def _save(self, heads: dict[str, str]) -> None:
        directory = os.path.dirname(self._path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".review-again-alerts-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"schema": SCHEMA, "heads": heads}, handle)
            os.replace(tmp, self._path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _announce(self, pull: dict[str, Any]) -> bool:
        try:
            self._call("POST", "/api/notifications/send", notification(self._app_id, pull))
        except Exception:
            return False
        self.sent.append(pull["key"])
        return True

    def run(self) -> None:
        if not self._path:
            return
        data = self._read()
        if not data:
            return
        known = self._load()
        heads = {}
        for pull in stale_change_requests(data):
            previous = None if known is None else known.get(pull["key"])
            if known is None or previous == pull["head"] or self._announce(pull):
                heads[pull["key"]] = pull["head"]
            elif previous:
                # A send that failed keeps its old entry, so the next pass tries this head again.
                heads[pull["key"]] = previous
        self._save(heads)
