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

GitHub returns both connections a page at a time. The search window is the
most recently updated PRs only, and a PR's opinionated reviews can run past
the first page, so this pass treats a truncated read as partial: it pages a
PR's reviews until it finds the owner's opinion, and it keeps a saved head for
a PR merely absent from a short search window, forgetting one only when the
PR is seen and confirmed to no longer be waiting.
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
_REVIEW_PAGE = 30
# One page of the most recently updated PRs the owner reviewed: a pass is one request.
SEARCH_QUERY = """
query ContributeReviewAgainAlerts {
  viewer { login }
  search(query: "is:pr is:open reviewed-by:@me -author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) {
    pageInfo { hasNextPage }
    nodes { ... on PullRequest {
      number title headRefOid
      repository { nameWithOwner }
      author { login }
      latestOpinionatedReviews(first: %d) {
        pageInfo { hasNextPage endCursor }
        nodes { state author { login } commit { oid } }
      }
    } }
  }
}
""" % _REVIEW_PAGE
# Page one PR's opinionated reviews further when the owner's is past the first page.
REVIEWS_QUERY = """
query ContributeReviewAgainReviews($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      latestOpinionatedReviews(first: %d, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { state author { login } commit { oid } }
      }
    }
  }
}
""" % _REVIEW_PAGE
_REPO = re.compile(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")

Call = Callable[..., Any]
RunGraphql = Callable[..., Any]


def _run_graphql(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """One GraphQL request's ``data``, or None when GitHub cannot be read."""
    args = ["gh", "api", "graphql", "-f", "query=" + query]
    for key, value in (variables or {}).items():
        if value is None:
            continue
        args += ["-F" if isinstance(value, int) else "-f", "%s=%s" % (key, value)]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout).get("data") if out.returncode == 0 else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _owner_review_present(nodes: list[dict[str, Any]], me: Any) -> bool:
    return any(_same((node.get("author") or {}).get("login"), me) for node in nodes)


def _page_in_owner_review(pull: dict[str, Any], me: Any, run: RunGraphql) -> None:
    """Follow the review connection for one PR until the owner's opinion shows or it ends.

    The PR's ``pageInfo.hasNextPage`` afterwards says whether the owner's
    opinion is still unknown because a later page could not be read (a failed
    request, or a cursor that did not advance): ``unfinished_keys`` reports it.
    """
    connection = pull.get("latestOpinionatedReviews") or {}
    nodes = list(connection.get("nodes") or [])
    page = connection.get("pageInfo") or {}
    repo = (pull.get("repository") or {}).get("nameWithOwner") or ""
    owner, _, name = repo.partition("/")
    number = pull.get("number")
    seen_cursors: set[str] = set()
    while (owner and name and isinstance(number, int)
           and page.get("hasNextPage") and not _owner_review_present(nodes, me)):
        cursor = page.get("endCursor")
        if not cursor or cursor in seen_cursors:
            break
        seen_cursors.add(cursor)
        data = run(REVIEWS_QUERY, {"owner": owner, "name": name, "number": number, "after": cursor})
        connection = (((data or {}).get("repository") or {}).get("pullRequest") or {}).get("latestOpinionatedReviews")
        if not connection:
            break
        nodes.extend(connection.get("nodes") or [])
        page = connection.get("pageInfo") or {}
    unfinished = bool(page.get("hasNextPage")) and not _owner_review_present(nodes, me)
    pull["latestOpinionatedReviews"] = {"nodes": nodes, "pageInfo": {"hasNextPage": unfinished}}


def read_github(run: RunGraphql = _run_graphql) -> dict[str, Any] | None:
    """The owner's reviewed PRs as GitHub shows them now, or None when it cannot be read.

    Each PR's opinionated reviews are paged until the owner's own review is
    found or the connection is exhausted, so a change request is never missed
    for sitting past the first review page.
    """
    data = run(SEARCH_QUERY)
    if not data:
        return None
    me = (data.get("viewer") or {}).get("login")
    for pull in (data.get("search") or {}).get("nodes") or []:
        _page_in_owner_review(pull, me, run)
    return data


def _same(left: Any, right: Any) -> bool:
    return bool(left) and str(left).lower() == str(right).lower()


def _pull_key(repo: str, number: Any) -> str:
    return "%s#%s" % (repo.lower(), number)


def window_keys(data: dict[str, Any]) -> set[str]:
    """Every valid PR key the search window actually returned this pass."""
    keys = set()
    for pull in (data.get("search") or {}).get("nodes") or []:
        repo = (pull.get("repository") or {}).get("nameWithOwner") or ""
        if _REPO.fullmatch(repo):
            keys.add(_pull_key(repo, pull.get("number")))
    return keys


def unfinished_keys(data: dict[str, Any]) -> set[str]:
    """The PRs whose review read stopped early, so the owner's opinion on them is unknown."""
    keys = set()
    for pull in (data.get("search") or {}).get("nodes") or []:
        repo = (pull.get("repository") or {}).get("nameWithOwner") or ""
        page = (pull.get("latestOpinionatedReviews") or {}).get("pageInfo") or {}
        if page.get("hasNextPage") and _REPO.fullmatch(repo):
            keys.add(_pull_key(repo, pull.get("number")))
    return keys


def window_is_complete(data: dict[str, Any]) -> bool:
    """True when the search returned every eligible PR, not just one page of them."""
    return not ((data.get("search") or {}).get("pageInfo") or {}).get("hasNextPage")


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
            found.append({"key": _pull_key(repo, pull.get("number")), "repo": repo,
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
        heads: dict[str, str] = {}
        for pull in stale_change_requests(data):
            previous = None if known is None else known.get(pull["key"])
            if known is None or previous == pull["head"] or self._announce(pull):
                heads[pull["key"]] = pull["head"]
            elif previous:
                # A send that failed keeps its old entry, so the next pass tries this head again.
                heads[pull["key"]] = previous
        if known is not None:
            # Keep the saved head of every PR this pass could not judge, so a
            # later pass on the same head is not announced a second time: one
            # a short search window hid, and one whose review pages did not all load.
            undecided = unfinished_keys(data)
            if not window_is_complete(data):
                undecided |= set(known) - window_keys(data)
            for key in undecided - set(heads):
                if key in known:
                    heads[key] = known[key]
        self._save(heads)
