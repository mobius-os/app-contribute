"""Incremental ledger scan for the scheduled job.

Every scheduled pass needs to know which contribution records still need
work, but nearly every record is settled history that never changes again.
Reading every body through the storage API cost thousands of requests per
run on a long-lived ledger (about 40 s of server work per pass for ~1,700
records, twice per run, every 15 minutes).

A listing is metadata only. A record's body is re-read only when its size or
modification time changed since the previous run, and each body is reduced to
the few fields that decide scheduled work. A file that is not a record (stray
list, malformed JSON) is remembered as needing no work until it changes. Those
summaries live in the runner's per-app ``APP_JOB_STATE_DIR``: derived,
job-private state whose loss costs one full read, never correctness. Records that need work are always
returned with a freshly read storage version, so compare-and-swap writes are
unchanged.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
from collections.abc import Callable
from datetime import datetime
from typing import Any

import lifecycle_engine as engine
from lifecycle_record import TABLES, facts_of, stored_vector


PREFIX = "contributions/"
STATE_FILE = "ledger-scan.json"
# 2: a refusal saved before kept_for was understood may be a kept checkout;
# starting from a fresh read drops those once instead of keeping them forever.
# 3: summaries also carry what the engine-mode job needs to decide a read (the lifecycle's
# publication and update states and next deadline, when a closed record closed, whether an
# attention slot is left on a finished one).
# 4: ... and whether the status word another writer stored disagrees with the stored vector (the
# record is then handed to the job once, so adopt() can explain it), whether a finish the app wrote
# itself is still to be told, and the day an ORPHANED record was last read.
SCHEMA = 4

# Records the job polls, reconciles, or settles on every pass. A record still
# `submitting` may hold a send GitHub has not confirmed (publication_observe.py).
LIVE_STATUSES = frozenset(("draft", "open", "landing", "prepared", "submitting"))
# Terminal records still owe cleanup while their disposable checkout exists.
TERMINAL_STATUSES = frozenset((
    "merged", "closed", "superseded", "commented", "abandoned",
))
# A pull request that is over: nothing on it may still ask for attention.
FINISHED_STATUSES = frozenset(("merged", "closed", "superseded"))
# The attention type that shows a lifecycle region waiting on the owner. It stands on a finished
# record on purpose (a stranded update, a merge that never landed), so it is never a leftover.
OWNER_REQUEST = "owner_request"
# In engine mode a closed PR is read for this long, in case it is reopened (the Publication
# region's CLOSED deadline); then it is no longer polled.
CLOSED_WATCH_SECONDS = 30 * 24 * 3600
# A merge into another branch has not shipped: the connection to the new repo waits for the real one.
NOT_SHIPPED = ("MERGED_ELSEWHERE", "ORPHANED")
# A merge that never reached the default branch (ORPHANED) may still do so after all, when its parent
# branch lands: the engine-mode job asks GitHub about such a record this often, no oftener.
ORPHAN_POLL_SECONDS = 24 * 3600
# The pull request the app itself merged or closed (its Merge or Close receipt) stores the marker
# below as `false`, "finished here and not told yet"; the job tells once and stores `true`. A record
# finished any other way, or before the marker existed, has no such key and owes nothing.
OWED_MARKERS = {"merged": "merged_announced", "closed": "closed_announced"}
# The same marker for an update that was waiting when the app merged or closed the PR: stranded now, and not yet asked about.
STRANDED_MARKER = "stranded_announced"

# File clocks are coarse, so two same-size writes can share one modified_at.
# Like git's "racily clean" rule, a body whose modified_at is this close to
# the scan is not trusted to match that metadata next pass; it is re-read.
RACY_SECONDS = 2

Call = Callable[..., tuple[bytes, Any]]


def _region(record: dict[str, Any], name: str) -> dict[str, Any]:
    """A region of the record's stored vector, `{}` when it has none the engine can read (lifecycle_record.stored_vector)."""
    life = stored_vector(record)
    return life["regions"][name] if life else {}


def awaiting_publication_connection(record: dict[str, Any]) -> bool:
    """A merged record whose app still has to be connected to its new repo.

    Only a merge that reached the default branch counts: one into a side branch has not shipped.
    """
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    handoff = (
        plan.get("after_merge") if isinstance(plan.get("after_merge"), dict) else {}
    )
    connection = (
        record.get("publication_connection")
        if isinstance(record.get("publication_connection"), dict)
        else {}
    )
    return (
        record.get("status") == "merged"
        and _region(record, "publication").get("state") not in NOT_SHIPPED
        and handoff.get("action") == "connect_app"
        and connection.get("status") not in ("connected", "connected_conflict")
    )


def owes_finish(record: dict[str, Any]) -> bool:
    """The app finished this PR itself and the job has not told the owner yet (see OWED_MARKERS).

    A merge into a side branch is not told here: the engine's own route watch says it, and says "shipped"
    only when the parent branch lands.
    """
    marker = OWED_MARKERS.get(record.get("status"))
    return bool(marker) and record.get(marker) is False and _region(record, "publication").get("state") not in NOT_SHIPPED


def _epoch(value: Any) -> int | None:
    try:
        return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


def asks_about_stranded_update(record: dict[str, Any]) -> bool:
    """The owner already has a request for the stranded update (its key names the region and the state)."""
    attention = record.get("attention")
    return (
        isinstance(attention, dict)
        and attention.get("type") == OWNER_REQUEST
        and str(attention.get("key") or "").startswith("%s:update:STRANDED_UPDATE:" % OWNER_REQUEST)
    )


def owes_stranded(record: dict[str, Any]) -> bool:
    """The app's own Merge or Close stranded a waiting update and the job has not asked the owner yet.

    Only an explicit `false` (STRANDED_MARKER) is owed: a record the job stranded itself raised its request and
    its notice in the same write and never carries the key.
    """
    return (
        record.get(STRANDED_MARKER) is False
        and _region(record, "update").get("state") == "STRANDED_UPDATE"
        and not asks_about_stranded_update(record)
    )


def has_attention_leftover(record: dict[str, Any]) -> bool:
    """Any attention slot still holds a reason GitHub or an escalation raised."""
    attention = record.get("attention")
    owner_only = isinstance(attention, dict) and attention.get("type") == OWNER_REQUEST
    waiting = [item for item in record.get("waiting_attention") or [] if isinstance(item, dict)]
    return bool(
        (record.get("needs_attention") and not owner_only)
        or (attention and not owner_only)
        or waiting
        or record.get("outside_activity")
    )


def _status_differs(record: dict[str, Any]) -> bool:
    """Another writer changed the status word over the stored vector (the platform's routes in shadow
    mode, an older app): the vector no longer says what the word says. Only a record the engine can
    explain counts, so the answer is "once": the job's next write stores a vector that agrees."""
    stored = stored_vector(record)
    if stored is None:
        return False
    try:
        word = engine.status_of(TABLES, stored, record.get("status"))
        return bool(word) and word != record.get("status") and engine.adopt(TABLES, stored, facts_of(record), 0) is not None
    except (KeyError, TypeError, AttributeError):
        return False


def _rearms(record: dict[str, Any], name: str, slot: dict[str, Any]) -> bool:
    """A deadline whose exit leads back into the same state is no work in itself: a queued PR is read
    every pass anyway, and a stranded update is reminded once (the job's REMINDED marker)."""
    state = slot.get("state")
    return (name, state) == ("publication", "QUEUED") or (
        (name, state) == ("update", "STRANDED_UPDATE") and bool(record.get("stranded_reminded_at")))


def _lifecycle_summary(record: dict[str, Any]) -> dict[str, Any] | None:
    publication, update = _region(record, "publication"), _region(record, "update")
    if not publication.get("state"):
        return None
    slots = (("publication", publication), ("update", update))
    deadlines = [slot["deadline"] for name, slot in slots if isinstance(slot.get("deadline"), int) and not _rearms(record, name, slot)]
    return {
        "publication": publication["state"], "update": update.get("state"),
        "since": publication.get("since"), "due": min(deadlines) if deadlines else None,
        "mismatch": _status_differs(record),
    }


def summarize(record: dict[str, Any]) -> dict[str, Any]:
    """Keep only the fields that decide whether a record needs scheduled work."""
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    repo_path = plan.get("repo_path")
    life = _lifecycle_summary(record)
    closed = record.get("status") == "closed"
    return {
        "status": record.get("status"),
        "repo_path": repo_path if isinstance(repo_path, str) else "",
        "awaiting_connection": awaiting_publication_connection(record),
        "lifecycle": life,
        "closed_at": (life and life["publication"] == "CLOSED" and life["since"]) or _epoch(record.get("updated_at"))
        if closed else None,
        "leftover": record.get("status") in FINISHED_STATUSES and has_attention_leftover(record),
        "owed": owes_finish(record) or owes_stranded(record),
    }


def _settled_before(modified_at: Any, moment: float) -> bool:
    try:
        stamp = datetime.fromisoformat(str(modified_at)).timestamp()
    except ValueError:
        return False
    return stamp < moment - RACY_SECONDS


def _checkout_mtime(path: str) -> int | None:
    try:
        return os.stat(path).st_mtime_ns if path and os.path.isdir(path) else None
    except OSError:
        return None


def orphan_poll_due(summary: dict[str, Any], now: float) -> bool:
    """An ORPHANED record not read for a day (or never): see ORPHAN_POLL_SECONDS."""
    life = summary.get("lifecycle")
    return bool(life) and life["publication"] == "ORPHANED" and now - (summary.get("orphan_polled_at") or 0) >= ORPHAN_POLL_SECONDS


def watched_in_engine_mode(summary: dict[str, Any], now: float) -> bool:
    """A finished record the engine-mode job still reads: a PR closed less than 30 days ago (it may
    be reopened), a merge waiting for its parent branch, an orphaned one once a day, a deadline that has
    come due (a stranded update's reminder), or a status word another writer changed over the vector."""
    life = summary.get("lifecycle")
    if life:
        due = life.get("due")
        return (life["publication"] in ("CLOSED", "MERGED_ELSEWHERE") or bool(life.get("mismatch"))
                or orphan_poll_due(summary, now) or (due is not None and due <= now))
    closed = summary.get("closed_at")
    return closed is not None and now - closed < CLOSED_WATCH_SECONDS


def needs_scheduled_work(summary: dict[str, Any], engine: bool = False, now: float | None = None) -> bool:
    status = summary.get("status")
    if status in LIVE_STATUSES or summary.get("awaiting_connection") or summary.get("owed"):
        return True
    if engine and watched_in_engine_mode(summary, time.time() if now is None else now):
        return True
    if status not in TERMINAL_STATUSES:
        return False
    checkout = _checkout_mtime(summary.get("repo_path") or "")
    if checkout is None:
        return False
    # The server refuses cleanup when it cannot prove the checkout is
    # disposable. That verdict holds until the record or its checkout changes.
    return summary.get("cleanup_refused_checkout_mtime") != checkout


class LedgerScan:
    """One pass's view of the ledger, backed by the previous pass's summaries."""

    def __init__(self, call: Call, app_id: str, state_dir: str | None):
        self._call = call
        self._app_id = app_id
        self._state_path = (
            os.path.join(state_dir, STATE_FILE) if state_dir else None
        )
        self._entries: dict[str, dict[str, Any]] = {}
        self._changed = False
        self.engine = False  # the job sets it from the app's `lifecycle_writer` setting

    def _record_path(self, name: str) -> str:
        return "/api/storage/apps/%s/%s%s" % (self._app_id, PREFIX, name)

    def _list(self) -> dict[str, tuple[int, str]] | None:
        listed: dict[str, tuple[int, str]] = {}
        cursor = None
        for _page in range(2000):
            path = "/api/storage/apps-list/%s/%s?limit=500" % (self._app_id, PREFIX)
            if cursor:
                path += "&cursor=" + urllib.parse.quote(cursor, safe="")
            try:
                raw, _ = self._call("GET", path)
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    return None
                raise
            page = json.loads(raw) if raw else {}
            for entry in page.get("entries") or []:
                name = str(entry.get("name", ""))
                # The platform lists a folder as "directory"; "dir" is what this guard was first written for.
                if entry.get("type") not in ("dir", "directory") and name.endswith(".json"):
                    listed[name] = (entry.get("size"), entry.get("modified_at"))
            cursor = page.get("next_cursor")
            if not cursor:
                return listed
        return listed

    def _read(self, name: str) -> tuple[dict[str, Any] | None, str | None]:
        # Storage sends an ETag only when a read opts into versioning; that
        # tag is what makes the caller's later PUT compare-and-swap.
        raw, headers = self._call(
            "GET", self._record_path(name), headers={"x-mobius-version": "1"},
        )
        try:
            record = json.loads(raw) if raw else None
        except ValueError:
            record = None
        if not isinstance(record, dict) or not record.get("id"):
            record = None
        return record, headers.get("ETag")

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self._state_path:
            return {}
        try:
            with open(self._state_path, encoding="utf-8") as handle:
                state = json.load(handle)
        except (OSError, ValueError):
            return {}
        if not isinstance(state, dict) or state.get("schema") != SCHEMA:
            return {}
        entries = state.get("entries")
        return entries if isinstance(entries, dict) else {}

    def finished_with_leftovers(self) -> list[str]:
        """Names of finished PRs whose body still holds an attention slot (for the one-time backfill)."""
        return sorted(name for name, entry in self._entries.items() if entry["summary"].get("leftover"))

    def records_needing_work(
        self, engine: bool | None = None, now: float | None = None,
    ) -> list[tuple[str, dict[str, Any], str | None]]:
        """Return (name, record, version) for every record needing scheduled work.

        In engine mode that also covers a recently closed PR, a merge into a side branch and a
        deadline that has come due (see `watched_in_engine_mode`).
        """
        started = time.time()
        listed = self._list()
        if listed is None:
            return []
        previous = self._load()
        fresh: dict[str, tuple[dict[str, Any], str | None]] = {}
        entries: dict[str, dict[str, Any]] = {}
        for name, (size, modified_at) in listed.items():
            known = previous.get(name)
            if (
                isinstance(known, dict)
                and known.get("size") == size
                and known.get("modified_at") == modified_at
                and isinstance(known.get("summary"), dict)
            ):
                entries[name] = known
                continue
            try:
                record, version = self._read(name)
            except urllib.error.HTTPError:
                continue
            if record:
                fresh[name] = (record, version)
            entries[name] = {
                "size": size,
                "modified_at": (
                    modified_at if _settled_before(modified_at, started) else None
                ),
                "summary": summarize(record or {}),
            }
        self._changed = entries != previous
        self._entries = entries
        return self._due(fresh, self.engine if engine is None else engine, started)

    def _due(
        self, fresh: dict[str, tuple[dict[str, Any], str | None]], engine: bool, started: float,
    ) -> list[tuple[str, dict[str, Any], str | None]]:
        """The records that need work, each with a fresh body and version (read now if the scan did not)."""
        work = []
        for name, entry in self._entries.items():
            if not needs_scheduled_work(entry["summary"], engine, started):
                continue
            if name in fresh:
                record, version = fresh[name]
            else:
                try:
                    record, version = self._read(name)
                except urllib.error.HTTPError:
                    continue
                if not record:
                    continue
            work.append((name, record, version))
            if engine and orphan_poll_due(entry["summary"], started):
                entry["summary"]["orphan_polled_at"] = int(started)  # the daily bound: not asked again for a day
                self._changed = True
        return work

    def note_cleanup_result(self, name: str, checkout: str, result: dict) -> bool:
        """Remember a refused cleanup; True when it is a new refusal to report.

        A checkout the server kept for another unfinished contribution
        (``kept_for``) is not a refusal: it may be removed once that one
        finishes, so the record is asked about again on the next pass.
        """
        if result.get("cleaned") or result.get("kept_for") or not os.path.isdir(checkout):
            return False
        return self.note_cleanup_refused(name, checkout)

    def note_cleanup_refused(self, name: str, checkout: str) -> bool:
        """Remember a refusal; True when it is new rather than a repeat."""
        entry = self._entries.get(name)
        mtime = _checkout_mtime(checkout)
        if not entry or mtime is None:
            return True
        summary = entry["summary"]
        if summary.get("cleanup_refused_checkout_mtime") == mtime:
            return False
        summary["cleanup_refused_checkout_mtime"] = mtime
        self._changed = True
        return True

    def save(self) -> None:
        """Persist summaries only when they changed; never rewrite an idle ledger."""
        if not self._state_path or not self._changed:
            return
        directory = os.path.dirname(self._state_path)
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=directory, prefix=".ledger-scan-")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"schema": SCHEMA, "entries": self._entries}, handle)
            os.replace(tmp, self._state_path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        self._changed = False
