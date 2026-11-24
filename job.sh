#!/bin/bash
# Contribute — scheduled ledger refresh (cron).
#
# One Python process scans the ledger once (ledger_scan.py) and exits early
# when no record needs scheduled work. It first reconciles prepared PR records
# whose reviewed work already reached the
# target repository's main by another path. Strong commit, reviewed-diff,
# merged-branch, or distinctive-identifier evidence settles an ordinary PR
# with a landing reference; partial identifier evidence only adds a dismissible
# hint. A PR update whose target settled first stays prepared but gains one
# recovery handoff so its remaining private work cannot be mistaken for
# sendable. That pass is independently CAS-safe and never sends a notification.
#
# Reconcile disposable staging checkouts and finish reviewed app-publication
# links for terminal records before the GitHub-dependent work. Both are
# deliberately retryable: the next scheduled pass resumes either outcome
# without asking the owner to repeat the publication decision.
#
# Sends whose outcome GitHub has not confirmed, left with no pane open, get a
# few bounded read-only observations per pass (publication_observe.py); the
# platform settles only an exact outcome, and the job never sends.
#
# Then, for every pr/issue ledger record that is still draft/open, ask GitHub
# for its live state, latest activity, and check status in ONE batched GraphQL
# call (aliased resource() nodes, ~1 rate-limit point total), write back any
# change, and fire a celebratory push the first time something merges. The
# mini-app UI does the same state refresh on open; this keeps the feed and the
# merged-count fresh even when nobody opens the app. When GitHub activity or
# failing checks need follow-up, the job adds a
# `needs_attention` + `attention` payload so the app can offer a targeted agent
# follow-up. Writes use compare-and-swap
# (If-Match on the read's ETag), so the scheduled refresh cannot clobber a
# concurrent writer — the agent claiming/submitting a record, or the app's
# Dismiss button. If a version is unavailable, the record is skipped instead
# of weakening the update to a blind write. On a lost race (412), it is left
# for the app's live refresh and the next scheduled run to reconcile.
#
# Who computes the stored status word is the app's `lifecycle_writer` setting
# (settings.json). Absent or "shadow": exactly the logic above, with the
# lifecycle engine taking notes beside it (lifecycle_shadow.py). "engine": every
# record the job reads goes through the engine (lifecycle_job.py), which stores
# the status word and the `lifecycle` field in the same write and whose effects
# the job performs. Engine mode also follows a PR closed less than 30 days ago
# (it may be reopened), a merge into a side branch until its parent branch
# reaches the default branch (an orphaned one is asked about once a day), and a
# PR whose prepared update has not gone out.
# In either mode a one-time sweep (lifecycle_backfill.py) empties the attention
# left on finished PRs, without a notification. A pull request the app itself
# merged or closed (its receipt marks the record `merged_announced: false` /
# `closed_announced: false`) is told once and its follow-up grant closed out,
# in either mode; an update that was waiting then is stranded, and the receipt's
# `stranded_announced: false` has the job ask the owner and tell them once. If
# GitHub rejects the one batched document (the lifecycle's newer fields), the
# job asks once more with the fields it always asked.
#
# The supervised app-job runner passes the numeric app id as $1 and mints a
# short-lived APP_TOKEN scoped to this installed app. The job keeps the runner's
# API base and pins gh's config/HOME/PATH — without those, gh can't find the
# credential store and would look "not logged in" even on a connected instance.
# gh resolves auth from /data/cli-auth/gh (the boot symlink target), which the
# backend populates only when the owner connects GitHub from Contribute.
#
# Exits 0 quietly when gh is missing, unauthenticated, or there is nothing to
# refresh — an un-connected instance is a normal state, not an error.
set -u

APP_ID="${1:-}"
API_BASE_URL="${API_BASE_URL:-http://localhost:8000}"
APP_TOKEN="${APP_TOKEN:-}"

# gh's auth store lives under its config dir; point straight at it so the lookup
# never depends on cron providing HOME or the ~/.config/gh symlink. Set both
# anyway for any tool that reads HOME, and make sure /usr/local/bin (where gh is
# installed) is on PATH before probing for it.
export HOME="${HOME:-/home/mobius}"
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-/data/cli-auth/gh}"
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH:-}"
export API_BASE_URL APP_TOKEN APP_ID

if [ -z "$APP_ID" ] || [ -z "$APP_TOKEN" ]; then
  # No app id or scoped credential means the supervisor contract is missing.
  exit 0
fi

mkdir -p /data/cron-logs

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export SCRIPT_DIR

# The refresh logic is pure I/O against the local storage API (urllib) plus gh
# for the GraphQL round-trip. A quoted heredoc keeps the shell out of it; all
# inputs arrive via the exported environment. Diagnostics (an unhandled error)
# land in the cron log; every expected failure exits 0 silently above/below.
python3 - <<'PY' 2>>/data/cron-logs/contribute.log
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ["API_BASE_URL"].rstrip("/")
TOKEN = os.environ["APP_TOKEN"]
APP_ID = os.environ["APP_ID"]
PREFIX = "contributions/"
DEFAULT_BRANCH_BY_REPO = {}
BASE_FAILURES_BY_REPO = {}


def _call(method, path, body=None, headers=None, timeout=15):
  url = API + path
  hdrs = {"Authorization": "Bearer " + TOKEN}
  if headers:
    hdrs.update(headers)
  data = None
  if body is not None:
    data = json.dumps(body).encode("utf-8")
    hdrs["Content-Type"] = "application/json"
  req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
  with urllib.request.urlopen(req, timeout=timeout) as resp:
    return resp.read(), resp.headers


def _get_json(path):
  raw, _ = _call("GET", path)
  return json.loads(raw) if raw else None


def _record_path(name):
  return "/api/storage/apps/%s/%s%s" % (APP_ID, PREFIX, name)


# Only records that still need scheduled work are read: live PRs/issues,
# prepared records, terminal records that still hold a staging checkout, and
# merged records awaiting their app connection. Settled history is recognized
# from listing metadata plus the previous pass's summaries (ledger_scan.py).
sys.path.insert(0, os.environ["SCRIPT_DIR"])
from ledger_scan import LedgerScan, awaiting_publication_connection
from github_events import (
  AUTHOR_ATTENTION_TYPES, COMMENT_FIELDS, REVIEW_FIELDS, TRUSTED, UNTRUSTED,
  UNVERIFIED, attention_provenance, latest_events, own_event_urls, review_events,
  standing_changes_request, trusted_changes_request,
)
import job_github

# A PR the owner asked changes on that has new commits (review_again_alerts.py).
# It reads GitHub, not the ledger, so it runs before the empty-ledger exit below,
# and its failure must not stop the passes after it.
import review_again_alerts

try:
  review_again_alerts.Alerts(
    _call, APP_ID, os.environ.get("APP_JOB_STATE_DIR") or None,
  ).run()
except Exception as exc:
  print("contribute: review-again alert error: %s" % exc, file=sys.stderr)

LEDGER = LedgerScan(_call, APP_ID, os.environ.get("APP_JOB_STATE_DIR") or None)

# Who computes the stored status word: "shadow" keeps today's logic
# beside the engine's notes; "engine" stores the engine's status and `lifecycle` in the same
# write (lifecycle_job.py). Anything unreadable in the setting is "shadow".
import lifecycle_job

ENGINE = lifecycle_job.writer_mode(_call, APP_ID) == "engine"
NOW_EPOCH = int(time.time())
now = (
  datetime.datetime.now(datetime.timezone.utc)
  .replace(microsecond=0)
  .isoformat()
  .replace("+00:00", "Z")
)
LEDGER.engine = ENGINE  # engine mode also reads a recently closed PR, a side-branch merge, a due deadline
records = LEDGER.records_needing_work()

# One-time sweep of the attention left on finished PRs (lifecycle_backfill.py). It reads and
# writes only records the ordinary scan skips, sends no notification, and may fail on its own.
import lifecycle_backfill
import lifecycle_shadow

try:
  BACKFILL = lifecycle_backfill.Backfill(
    _call, APP_ID, os.environ.get("APP_JOB_STATE_DIR") or None, ENGINE, NOW_EPOCH, now,
    None if ENGINE else lifecycle_shadow.Shadow(os.environ.get("APP_JOB_STATE_DIR") or None),
  )
  BACKFILL.run(LEDGER.finished_with_leftovers())
  # A record it rewrote carries a stale version here: swap in the record and version its write
  # returned, so its terminal cleanup and app connection do not wait a pass.
  records = [(name, *BACKFILL.refreshed.get(name, (record, etag))) for name, record, etag in records]
except Exception as exc:
  print("contribute: lifecycle backfill error: %s" % exc, file=sys.stderr)
if not records:
  # Nothing live, prepared, awaiting connection, or holding a checkout.
  LEDGER.save()
  sys.exit(0)

# Shadow mode (lifecycle_shadow.py): the lifecycle engine runs beside this job, takes notes
# where it would have stored a different status, and changes nothing. Its failure must never
# stop a pass, and its notes are saved however the pass ends.
import atexit

SHADOW = None


def _shadow(step, *args):
  if SHADOW is None:
    return
  try:
    getattr(SHADOW, step)(*args)
  except Exception as exc:
    print("contribute: lifecycle shadow %s error: %s" % (step, exc), file=sys.stderr)


try:
  # The engine is the writer in engine mode: its notes would only compare it with itself.
  SHADOW = None if ENGINE else lifecycle_shadow.Shadow(os.environ.get("APP_JOB_STATE_DIR") or None)
  if SHADOW is not None:
    atexit.register(_shadow, "save")
except Exception as exc:
  print("contribute: lifecycle shadow unavailable: %s" % exc, file=sys.stderr)
for _name, _record, _etag in records:
  _shadow("read", _record)

# Prepared reconciliation (prepared_reconcile.py) shares this process and this
# one ledger scan, but stays a separate pass from the live-PR polling below:
# different target states, evidence, and failure modes should not turn one
# proven path into a conditional branch of the other, and its failure must not
# stop the passes after it. A record it rewrote carries a stale version here,
# so this pass leaves it to the next run's fresh scan.
import prepared_reconcile

PREPARED_STORAGE = prepared_reconcile.Storage(API, TOKEN, APP_ID)
try:
  prepared_reconcile.run(
    PREPARED_STORAGE, prepared_reconcile.GitHub(), records=records, engine=ENGINE,
  )
except Exception as exc:
  print("contribute: prepared reconciliation error: %s" % exc, file=sys.stderr)
if PREPARED_STORAGE.written:
  records = [item for item in records if item[0] not in PREPARED_STORAGE.written]


TERMINAL_STAGING_STATUSES = frozenset((
  "merged", "closed", "superseded", "commented", "abandoned",
))
CONTRIBUTION_ROOTS = tuple(
  os.path.realpath(path) for path in ("/data/contrib", "/data/contributions")
)


def _terminal_staging_checkout(rec):
  if rec.get("status") not in TERMINAL_STAGING_STATUSES:
    return ""
  plan = rec.get("plan") if isinstance(rec.get("plan"), dict) else {}
  path = plan.get("repo_path")
  if not isinstance(path, str) or not path:
    return ""
  resolved = os.path.realpath(path)
  try:
    inside_staging = any(
      os.path.commonpath((resolved, root)) == root
      for root in CONTRIBUTION_ROOTS
    )
  except ValueError:
    return ""
  return resolved if inside_staging and os.path.isdir(resolved) else ""


CLEANED = set()  # records whose cleanup-staging call succeeded in this pass (it also closes out the grant)


def _reconcile_terminal_staging():
  for _name, rec, _etag in records:
    checkout = _terminal_staging_checkout(rec)
    if not checkout:
      continue
    record_id = urllib.parse.quote(str(rec.get("id") or ""), safe="")
    if not record_id:
      continue
    try:
      raw, _ = _call(
        "POST",
        "/api/github/contributions/%s/%s/cleanup-staging" % (
          APP_ID, record_id,
        ),
        {},
      )
      result = json.loads(raw) if raw else {}
      CLEANED.add(_name)
      if LEDGER.note_cleanup_result(_name, checkout, result):
        print(
          "contribute: terminal staging remains %s" % rec.get("id"),
          file=sys.stderr,
        )
    except Exception as exc:
      print(
        "contribute: terminal staging cleanup %s error: %s" % (
          rec.get("id"), exc,
        ),
        file=sys.stderr,
      )


_reconcile_terminal_staging()
LEDGER.save()


def _finish_publication_connection(rec):
  if not awaiting_publication_connection(rec):
    return
  record_id = urllib.parse.quote(str(rec.get("id") or ""), safe="")
  if not record_id:
    return
  try:
    _call(
      "POST",
      "/api/github/contributions/%s/%s/connect-app" % (
        APP_ID, record_id,
      ),
      {},
    )
  except Exception as exc:
    # The route owns exact proof and leaves the app untouched on failure. Keep
    # the handoff pending so the next supervised pass retries it.
    print(
      "contribute: publication connection %s pending: %s" % (
        rec.get("id"), exc,
      ),
      file=sys.stderr,
    )


for _name, _record, _etag in records:
  _finish_publication_connection(_record)


# Sends GitHub has not confirmed, with no pane or card open to check them: a
# bounded few read-only observations per pass (publication_observe.py). The
# platform reads GitHub and saves only an exact outcome; nothing is sent.
import publication_observe

try:
  publication_observe.Observer(
    _call, APP_ID, os.environ.get("APP_JOB_STATE_DIR") or None,
  ).run([item[1] for item in records])
except Exception as exc:
  print("contribute: publication observation error: %s" % exc, file=sys.stderr)


def _is_target(rec):
  on_github = (
    rec.get("type") in ("pr", "issue")
    and isinstance(rec.get("url"), str)
    and rec["url"].startswith("https://github.com/")
  )
  if not on_github:
    return False
  if rec.get("status") in ("draft", "open", "landing"):
    return True
  # Engine mode also follows a recently closed PR (it may be reopened), a merge into a
  # side branch, and a PR whose prepared update has not gone out (lifecycle_job.is_polled).
  return ENGINE and lifecycle_job.is_polled(rec, NOW_EPOCH)


def _repo_slug(rec):
  repo = rec.get("repo")
  if isinstance(repo, str):
    repo = repo.strip()
    parts = repo.split("/")
    if len(parts) == 2 and parts[0] and parts[1]:
      return repo
  url = rec.get("url")
  if isinstance(url, str):
    parts = urllib.parse.urlparse(url).path.strip("/").split("/")
    if len(parts) >= 2 and parts[0] and parts[1]:
      return "%s/%s" % (parts[0], parts[1])
  return ""


targets = [(name, rec, etag) for (name, rec, etag) in records if _is_target(rec)]
# A PR the app itself merged or closed is found finished, and nothing here would ever tell the
# owner or close out its follow-up grant. The app's receipt marks it (lifecycle_job.owed_finish).
OWED = [(name, rec, etag, owed) for (name, rec, etag) in records
        if (owed := lifecycle_job.owed_finish(rec, now))]
# Engine mode also moves the records that need no GitHub read (a send nobody confirmed, a
# deadline that has passed), so it runs on, even with nothing to ask GitHub about.
if not targets:
  if not ENGINE and not OWED:
    sys.exit(0)

# One document, aliased resource() nodes. JSON string escaping is exactly the
# GraphQL string-literal escaping the url needs.
aliases = {}
lean = set()
for i, (name, rec, etag) in enumerate(targets):
  aliases["r%d" % i] = (name, rec, etag)
  if ENGINE and lifecycle_job.is_lean(rec, NOW_EPOCH):
    lean.add(name)


def _resource(alias, name, rec, extended):
  # `extended` asks the lifecycle's newer fields too; without it the selection is exactly what
  # this job asked before the lifecycle (the retry after GitHub rejected the newer fields).
  if name in lean:
    return job_github.lean_alias(alias, rec["url"], extended)
  return (
    "%(alias)s: resource(url: %(url)s) { __typename "
    "... on PullRequest { "
    "state isDraft updatedAt reviewDecision mergeable "
    "%(extra)s"
    "comments(last: 10) { nodes { %(comment)s } } "
    "reviews(last: 10) { nodes { %(review)s } } "
    "commits(last: 1) { nodes { commit { statusCheckRollup { "
    "state "
    "contexts(first: 30) { nodes { __typename "
    "... on CheckRun { name conclusion detailsUrl } "
    "... on StatusContext { context state targetUrl } "
    "} } "
    "} } } } "
    "} "
    "... on Issue { "
    "state updatedAt "
    "comments(last: 10) { nodes { %(comment)s } } "
    "} }" % {
      "alias": alias, "url": json.dumps(rec["url"]),
      "comment": COMMENT_FIELDS, "review": REVIEW_FIELDS,
      "extra": job_github.PR_EXTRA_FIELDS if extended else "",
    }
  )


def _document(extended):
  parts = [_resource(alias, name, rec, extended) for alias, (name, rec, _etag) in aliases.items()]
  return "query { " + (job_github.VIEWER_FIELD if extended else "") + " ".join(parts) + " }"


def _graphql(query):
  # The finished gh process, or None when gh could not be run at all (missing, timed out).
  try:
    return subprocess.run(
      ["gh", "api", "graphql", "-f", "query=" + query],
      capture_output=True, text=True, timeout=30,
    )
  except Exception:
    return None


def _answered(out):
  # (data, rejected). `data` is None when GitHub could not be read: leave state as-is (rate limit,
  # revoked token, org restriction, an outage), exactly as an unreadable answer always did. `rejected`
  # says GitHub refused the document: its answer holds `errors` and no data (gh exits non-zero then
  # too, and prints that answer). That is the one case the older, smaller document is worth a second
  # try; a non-zero exit with no such answer is an outage, and asking again would only fail again.
  if out is None:
    return None, False
  try:
    body = json.loads(out.stdout) or {}
    data = body.get("data")
    rejected = bool(body.get("errors") and not data)
  except Exception:
    return None, False
  if out.returncode != 0:
    return None, rejected
  return (data or {}), rejected


def _read_github():
  # One request. If GitHub rejects the document, ONE more in the same pass with the fields this job
  # always asked, so alerts, attention and notices still run (the newer states then see "not known").
  data, rejected = _answered(_graphql(_document(True)))
  if rejected:
    data, _ = _answered(_graphql(_document(False)))
  return data


# A PR merged into a side branch waits for the PR whose head branch is that branch. That lookup is a
# document of its own: a repository the token can no longer read makes `repository(...)` fail, and
# that must not take the read of every other record down with it.
routes = {}
if ENGINE:
  for i, (name, rec, etag) in enumerate(targets):
    if lifecycle_job.watching_route(rec) and _repo_slug(rec):
      routes[name] = "p%d" % i


def _read_routes():
  # Whatever a partial answer still holds is used (gh exits non-zero when one repository is unreadable).
  parts = [
    job_github.route_alias(alias, _repo_slug(rec), lifecycle_job.watching_route(rec))
    for name, rec, _etag in targets if (alias := routes.get(name))
  ]
  out = _graphql("query { " + " ".join(parts) + " }") if parts else None
  try:
    return (json.loads(out.stdout) or {}).get("data") or {} if out is not None else {}
  except Exception:
    return {}


data = _read_github() if targets else {}
if data is None:
  data = {}
  aliases = {}
route_data = _read_routes() if aliases else {}
# The signed-in owner, from the same read: their own comments and reviews are not feedback.
VIEWER = job_github.viewer_login(data)


def _live_status(node):
  # Mirrors domain.js liveStatusFor; keep the two in step. None = no verdict
  # (deleted, inaccessible, unexpected type) → the record is left unchanged.
  if not isinstance(node, dict):
    return None
  kind = node.get("__typename")
  if kind == "PullRequest":
    state = node.get("state")
    if state == "MERGED":
      return "merged"
    if state == "CLOSED":
      return "closed"
    if state == "OPEN":
      return "draft" if node.get("isDraft") else "open"
    return None
  if kind == "Issue":
    state = node.get("state")
    if state == "CLOSED":
      return "closed"
    if state == "OPEN":
      return "open"
  return None


def _first_node(conn):
  nodes = conn.get("nodes") if isinstance(conn, dict) else None
  if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict):
    return nodes[0]
  return None


def _status_rollup(node):
  commits = node.get("commits") if isinstance(node, dict) else None
  latest = _first_node(commits)
  commit = latest.get("commit") if isinstance(latest, dict) else None
  return commit.get("statusCheckRollup") if isinstance(commit, dict) else None


def _check_state(node):
  rollup = _status_rollup(node)
  state = rollup.get("state") if isinstance(rollup, dict) else ""
  return state or ""


def _failing_checks(node):
  rollup = _status_rollup(node)
  contexts = rollup.get("contexts") if isinstance(rollup, dict) else None
  nodes = contexts.get("nodes") if isinstance(contexts, dict) else None
  if not isinstance(nodes, list):
    return []
  checks = []
  seen = set()
  for ctx in nodes:
    if not isinstance(ctx, dict):
      continue
    kind = ctx.get("__typename")
    if kind == "CheckRun":
      state = str(ctx.get("conclusion") or "").upper()
      name = str(ctx.get("name") or "").strip()
      url = str(ctx.get("detailsUrl") or "")
    elif kind == "StatusContext":
      state = str(ctx.get("state") or "").upper()
      name = str(ctx.get("context") or "").strip()
      url = str(ctx.get("targetUrl") or "")
    else:
      continue
    if state not in ("FAILURE", "ERROR") or not name:
      continue
    key = (name, url)
    if key in seen:
      continue
    seen.add(key)
    checks.append({"name": name, "url": url})
  return checks


def _record_head(rec, node=None):
  # GitHub's head when this read has it: a push made outside the platform must
  # change the key. The ledger's head is the fallback for a read without it.
  live = node.get("headRefOid") if isinstance(node, dict) else None
  if isinstance(live, str) and live:
    return live
  plan = rec.get("plan") if isinstance(rec.get("plan"), dict) else {}
  return str(plan.get("head_sha") or rec.get("head_sha") or rec.get("branch") or "")


def _gh_json(args, timeout=20):
  try:
    out = subprocess.run(
      ["gh", "api"] + args,
      capture_output=True, text=True, timeout=timeout,
    )
  except Exception:
    return None
  if out.returncode != 0:
    return None
  try:
    return json.loads(out.stdout) if out.stdout else None
  except Exception:
    return None


def _default_branch(repo):
  if repo in DEFAULT_BRANCH_BY_REPO:
    return DEFAULT_BRANCH_BY_REPO[repo]
  branch = None
  info = _gh_json(["repos/%s" % repo], timeout=15)
  if isinstance(info, dict):
    value = info.get("default_branch")
    if isinstance(value, str) and value:
      branch = value
  DEFAULT_BRANCH_BY_REPO[repo] = branch
  return branch


def _base_failed_checks(repo):
  if repo in BASE_FAILURES_BY_REPO:
    return BASE_FAILURES_BY_REPO[repo]
  branch = _default_branch(repo)
  if not branch:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  endpoint = (
    "repos/%s/actions/runs?per_page=1&status=completed&branch=%s" %
    (repo, urllib.parse.quote(branch, safe=""))
  )
  runs = _gh_json([endpoint], timeout=20)
  workflows = runs.get("workflow_runs") if isinstance(runs, dict) else None
  if not isinstance(workflows, list) or not workflows:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  run_id = workflows[0].get("id") if isinstance(workflows[0], dict) else None
  if not run_id:
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  jobs = _gh_json(
    ["repos/%s/actions/runs/%s/jobs?per_page=50" % (repo, run_id)],
    timeout=30,
  )
  job_nodes = jobs.get("jobs") if isinstance(jobs, dict) else None
  if not isinstance(job_nodes, list):
    BASE_FAILURES_BY_REPO[repo] = None
    return None
  failed = set()
  for job in job_nodes:
    if not isinstance(job, dict):
      continue
    conclusion = str(job.get("conclusion") or "").lower()
    if conclusion in ("failure", "error", "startup_failure", "timed_out", "action_required"):
      name = str(job.get("name") or "").strip()
      if name:
        failed.add(name)
  BASE_FAILURES_BY_REPO[repo] = {"branch": branch, "failed": failed}
  return BASE_FAILURES_BY_REPO[repo]


def _classified_failing_checks(rec, node):
  checks = _failing_checks(node)
  if not checks:
    return [], ""
  base = None
  if node.get("__typename") == "PullRequest":
    repo = _repo_slug(rec)
    if repo:
      base = _base_failed_checks(repo)
  failed = base.get("failed") if isinstance(base, dict) else None
  branch = base.get("branch") if isinstance(base, dict) else ""
  classified = []
  for check in checks:
    item = dict(check)
    classification = "unknown"
    if isinstance(failed, set):
      classification = "inherited" if item.get("name") in failed else "suspect-pr-caused"
    item["classification"] = classification
    classified.append(item)
  return classified, (branch or "")


def _all_inherited(checks):
  # Failing checks that ALL also fail on the default branch are not this PR's
  # doing. An empty list proves nothing, so it is never "all inherited".
  return bool(checks) and all(c.get("classification") == "inherited" for c in checks)


def _checks_message(checks, branch):
  if not checks:
    return "The latest GitHub checks are failing."
  parts = []
  for check in checks:
    name = check.get("name") or "check"
    classification = check.get("classification")
    if classification == "inherited":
      parts.append("%s (also failing on %s - inherited)" % (name, branch or "base"))
    elif classification == "suspect-pr-caused":
      parts.append("%s (suspect)" % name)
    elif classification == "unknown":
      parts.append("%s (unknown)" % name)
    else:
      parts.append(name)
  return "Checks failing: %s." % ", ".join(parts)


def _is_autopilot(rec):
  block = rec.get("autopilot") if isinstance(rec.get("autopilot"), dict) else None
  return bool(block and block.get("enabled"))


# Each blocker clears only when GitHub shows its own condition resolved;
# feedback and unknown reasons stay until handled or dismissed (new GitHub
# activity: see _activity_answered).
_RESOLVED_WHEN = {
  "checks_failed": lambda checks, mergeable, review: checks == "SUCCESS",
  "merge_conflict": lambda checks, mergeable, review: mergeable == "MERGEABLE",
  "changes_requested": lambda checks, mergeable, review: review not in (None, "CHANGES_REQUESTED"),
}


def _attention_resolved(attention, check_state, mergeable, review_decision):
  resolved = _RESOLVED_WHEN.get(attention.get("type"))
  return bool(resolved and resolved(check_state, mergeable, review_decision))


# The platform's SETTLED_OUTCOMES (contribution_autopilot.py): rounds that
# pushed, replied, marked the event handled, or (ask-before-push) prepared the
# fix for the owner's Update PR press.
_SETTLED_ROUNDS = frozenset(("pushed", "replied", "handled", "prepared"))


def _round_answered(rec, key):
  block = rec.get("autopilot") if isinstance(rec.get("autopilot"), dict) else {}
  return any(
    isinstance(entry, dict) and entry.get("attention_key") == key
    and entry.get("outcome") in _SETTLED_ROUNDS
    for entry in block.get("rounds") or []
  )


# A "new GitHub activity" note names an event someone may still owe an answer
# to, so it is never dropped on a guess. It clears on proof it was dealt with:
# a settled round that named its key, or an approval at or after the event
# (the approval of a reviewer's own review is not an unanswered question).
# A merged or closed PR clears every note where the status changes.
def _activity_answered(rec, attention, node, review_decision, own_urls=()):
  if attention.get("type") != "github_activity":
    return False
  if _round_answered(rec, attention.get("key")) or attention.get("url") in own_urls:
    # Your own words are never feedback: a note that names one was raised
    # before the owner's login was known, and nobody owes it an answer.
    return True
  since = str(attention.get("event_at") or attention.get("detected_at") or "")
  return review_decision == "APPROVED" and any(
    event.get("state") == "APPROVED" and event["at"] >= since
    for event in review_events(node)
  )


def _without_type(items: list, kind: str) -> list:
  return [item for item in items if item.get("type") != kind]


# One attention slot holds one reason. A blocker displaced by a newer reason
# waits while GitHub still shows it, and returns, already announced, once the
# slot frees: a blocker is never lost and never pushed twice.
def _waiting_blockers(rec: dict, current: dict, attention: dict | None,
                      slot_free: bool, state: tuple, held: bool = False) -> tuple:
  waiting = [
    item for item in (rec.get("waiting_attention") or [])
    if isinstance(item, dict) and not _attention_resolved(item, *state)
  ]
  if not attention:
    return (waiting[0], waiting[1:]) if slot_free and waiting else (None, waiting)
  waiting = _without_type(waiting, attention.get("type"))
  if held:
    # An escalation keeps the slot until the owner resumes: what arrives
    # later waits behind it and is never lost, never replacing it.
    return None, waiting + [attention]
  displaced = (
    not slot_free and current.get("type") in _RESOLVED_WHEN
    and current.get("type") != attention.get("type")
  )
  if displaced:
    waiting = _without_type(waiting, current.get("type")) + [current]
  return None, waiting


def _ignored_event_urls(rec):
  block = rec.get("autopilot") if _is_autopilot(rec) else {}
  return set(
    str(url) for url in (block.get("ignored_event_urls") or [])
    if isinstance(url, str) and url
  )


GITHUB_EVENT_LOOKUPS = {}


def _fetch_github_event(api_path):
  # One exact comment or review, at most once per pass (refresh and delivery
  # both ask). None means GitHub reports it gone; any other failure raises,
  # so the event stays unverified rather than looking untrusted.
  if api_path not in GITHUB_EVENT_LOOKUPS:
    try:
      out = subprocess.run(
        ["gh", "api", api_path], capture_output=True, text=True, timeout=20,
      )
      if out.returncode == 0:
        GITHUB_EVENT_LOOKUPS[api_path] = json.loads(out.stdout)
      elif re.search(r"\(HTTP (404|410)\)", out.stderr or ""):
        GITHUB_EVENT_LOOKUPS[api_path] = None
      else:
        GITHUB_EVENT_LOOKUPS[api_path] = RuntimeError(
          (out.stderr or "gh api failed").strip()[:200]
        )
    except Exception as exc:
      GITHUB_EVENT_LOOKUPS[api_path] = exc
  result = GITHUB_EVENT_LOOKUPS[api_path]
  if isinstance(result, Exception):
    raise result
  return result


def _attention_provenance(rec, attention, node, ignore_urls):
  # Autopilot may act on a pending attention only when its provenance holds
  # now: failing checks come from GitHub's rollup, while an author attention
  # must name an event GitHub reports as a trusted author's
  # (github_events.attention_provenance). The stored type alone proves nothing
  # (records written before authors were classified carry github_activity for
  # anyone's comment).
  kind = attention.get("type") if isinstance(attention, dict) else None
  if kind not in ACTIONABLE_ATTENTION:
    return UNTRUSTED
  if kind not in AUTHOR_ATTENTION_TYPES:
    return TRUSTED
  return attention_provenance(
    attention, node, rec.get("url"), _fetch_github_event, ignore_urls,
  )


# Whose words never count as feedback: every comment and review the signed-in owner wrote
# (`viewer { login }`, read in the same batched document), besides the exact replies Möbius itself
# posted (`autopilot.ignored_event_urls`, merged in by `_ignored_event_urls`). An earlier rule let the
# owner's other comments count; most "new activity" notices were then about the owner's own words.
# The cost: a comment the owner writes to steer the follow-up agent no longer wakes it. This one
# function is the whole rule.
def _owner_words(node):
  return own_event_urls(node, VIEWER)


def _rule_checks(check_state, failing_checks):
  # Failures that ALL also fail on the default branch are not this PR's doing: the rules see them
  # as passing, so none is raised and a standing one clears. (inherited_only, the state the rules read)
  inherited_only = _all_inherited(failing_checks)
  return inherited_only, ("SUCCESS" if inherited_only else check_state)


def _held_slot(rec, resolved, current_attention):
  # An escalation or an owner request keeps the slot until the owner moves it; what arrives
  # later waits behind it.
  return (
    bool(rec.get("needs_attention")) and not resolved
    and current_attention.get("type") in ("human_required", "owner_request")
  )


def _checks_item(rec, check_state, failing_checks, base_branch, head):
  # The checks_failed attention for the head GitHub reports.
  return {
    "type": "checks_failed",
    "key": "checks_failed:%s:%s" % (check_state, head),
    "title": "Checks failed",
    "message": _checks_message(failing_checks, base_branch),
    "url": rec.get("url") or "",
    "detected_at": now,
  }


def _refreshed_checks(current_attention, checks_attention):
  # The same failure standing on the record, its text brought up to date (None when nothing changed).
  refreshed = dict(current_attention)
  refreshed.update({key: checks_attention[key] for key in ("type", "key", "title", "message", "url")})
  if not refreshed.get("detected_at"):
    refreshed["detected_at"] = now
  return refreshed if refreshed != current_attention else None


def _attention_update(rec, node):
  patch = {}
  if not isinstance(node, dict):
    return patch

  def set_if_changed(key, value):
    if (value or rec.get(key)) and rec.get(key) != value:
      patch[key] = value

  own_urls = _owner_words(node)
  ignore_urls = _ignored_event_urls(rec) | own_urls

  check_state = _check_state(node)
  failing_checks, base_branch = _classified_failing_checks(rec, node)
  inherited_only, check_rule_state = _rule_checks(check_state, failing_checks)
  set_if_changed("last_check_rollup_state", check_state)
  set_if_changed("failing_checks", failing_checks)

  review_decision = node.get("reviewDecision") or ""
  # None when the read did not ask: "no change request stands" is then unknown. A null decision (a repository with no review rule) says
  # no more than that: a request a trusted reviewer's newest review still makes stands, and only the reviews can say it does not.
  review_state = review_decision if "reviewDecision" in node else None
  if "reviewDecision" in node and not review_decision and standing_changes_request(node, ignore_urls=ignore_urls):
    review_state = "CHANGES_REQUESTED"
  previous_review = rec.get("last_review_decision")
  set_if_changed("last_review_decision", review_decision)

  # Merge-conflict detection (autopilot event). GitHub reports MERGEABLE /
  # CONFLICTING / UNKNOWN; only a definite CONFLICTING is actionable.
  mergeable = node.get("mergeable") or ""
  previous_mergeable = rec.get("last_mergeable")
  set_if_changed("last_mergeable", mergeable)

  latest, latest_trusted = latest_events(node, ignore_urls=ignore_urls)
  changes_request = trusted_changes_request(node, ignore_urls=ignore_urls)
  baseline = (
    rec.get("last_github_activity_at") or
    rec.get("submitted_at") or
    rec.get("updated_at") or
    rec.get("created_at") or
    ""
  )
  if latest and latest["at"] > str(rec.get("last_github_activity_at") or ""):
    patch["last_github_activity_at"] = latest["at"]

  current_attention = (
    rec.get("attention") if isinstance(rec.get("attention"), dict) else {}
  )
  resolved = _attention_resolved(
    current_attention, check_rule_state, mergeable, review_state
  ) or _activity_answered(rec, current_attention, node, review_decision, own_urls)
  if resolved:
    patch["needs_attention"] = False
    patch["attention"] = None
  # Actionable work still waiting for its round (or its owner) keeps the one
  # attention slot until it is handled or dismissed. Later outside activity
  # is reported beside it, never in place of it. Work GitHub could not be
  # asked about this pass keeps the slot too; only proof of an untrusted or
  # deleted event gives it up.
  pending_work = (
    bool(rec.get("needs_attention")) and "attention" not in patch
    and _attention_provenance(rec, current_attention, node, ignore_urls) != UNTRUSTED
  )
  if check_rule_state == "SUCCESS" and rec.get("last_checks_attention_key"):
    patch["last_checks_attention_key"] = None
  if mergeable == "MERGEABLE" and rec.get("last_conflict_attention_key"):
    patch["last_conflict_attention_key"] = None
  # One attention slot holds one reason. A conflict that arrived while another
  # reason held the slot is raised once the slot frees, so it is never lost.
  slot_free = resolved or not (rec.get("needs_attention") and current_attention)
  held = _held_slot(rec, resolved, current_attention)
  head = _record_head(rec, node)
  conflict_key = "merge_conflict:%s" % head
  conflict_pending = (
    mergeable == "CONFLICTING"
    and conflict_key not in (
      rec.get("last_conflict_attention_key"), current_attention.get("key"))
  )

  attention = None
  checks_attention = None
  if check_state in ("FAILURE", "ERROR") and not inherited_only:
    checks_attention = _checks_item(rec, check_state, failing_checks, base_branch, head)
  # Raise per checks KEY (state + head sha), not per raw state transition: an
  # autopilot follow-up push that fails again must fire for the NEW head even
  # though the stored rollup state never left FAILURE. The platform dedupes
  # response rounds by this same key (last_handled_attention_key), so
  # re-raising an already-handled key stays a quiet no-op.
  if checks_attention and rec.get("last_checks_attention_key") != checks_attention["key"]:
    attention = checks_attention
    patch["last_checks_attention_key"] = checks_attention["key"]
  elif (
    review_decision == "CHANGES_REQUESTED"
    and previous_review != "CHANGES_REQUESTED"
    and changes_request
  ):
    attention = {
      "type": "changes_requested",
      "key": "changes_requested:%s" % changes_request["at"],
      "title": "Changes requested",
      "message": "A GitHub review requested changes.",
      "url": changes_request.get("url") or rec.get("url") or "",
      "detected_at": now,
    }
  elif latest_trusted and latest_trusted["at"] > str(baseline):
    # Only a repository owner, member or collaborator can start an autopilot
    # round (github_events.py); this event is one of theirs.
    label = "review" if latest_trusted["kind"] == "review" else "comment"
    attention = {
      "type": "github_activity",
      "key": "github_activity:%s" % latest_trusted["at"],
      "title": "New GitHub activity",
      "message": "New %s from %s." % (label, latest_trusted["author"]),
      "url": latest_trusted.get("url") or rec.get("url") or "",
      "event_at": latest_trusted["at"],
      "detected_at": now,
    }
  elif latest and latest["at"] > str(baseline):
    # Someone without standing in the repository commented. Tell the owner;
    # never start a round from it (outside_activity is not actionable).
    label = "review" if latest["kind"] == "review" else "comment"
    outside = {
      "type": "outside_activity",
      "key": "outside_activity:%s" % latest["at"],
      "title": "New GitHub activity",
      "message": (
        "New %s from %s, who is not a maintainer of this repository. "
        "Autopilot will not act on it." % (label, latest["author"])
      ),
      "url": latest.get("url") or rec.get("url") or "",
      "event_at": latest["at"],
      "detected_at": now,
    }
    if pending_work or held:
      patch["outside_activity"] = outside
    else:
      attention = outside
  elif conflict_pending and (previous_mergeable != "CONFLICTING" or slot_free):
    patch["last_conflict_attention_key"] = conflict_key
    attention = {
      "type": "merge_conflict",
      "key": conflict_key,
      "title": "Needs a refresh to merge",
      "message": "New upstream changes conflict with this contribution.",
      "url": rec.get("url") or "",
      "detected_at": now,
    }

  if (
    not attention
    and checks_attention
    and current_attention.get("type") == "checks_failed"
    and current_attention.get("key") == checks_attention["key"]
  ):
    refreshed = _refreshed_checks(current_attention, checks_attention)
    if refreshed:
      patch["attention"] = refreshed

  restored, waiting = _waiting_blockers(
    rec, current_attention, attention, slot_free,
    (check_rule_state, mergeable, review_state), held)
  set_if_changed("waiting_attention", waiting)
  attention = None if held else (attention or restored)

  if (
    not attention
    and not resolved
    and rec.get("needs_attention")
    and current_attention.get("type") in AUTHOR_ATTENTION_TYPES
    and not pending_work
  ):
    # Pending author attention without trusted provenance (written before
    # authors were classified, its author lost standing, or the event was
    # deleted) is kept for the owner as notification-only. A notice already
    # announced stays announced.
    downgraded = dict(current_attention)
    downgraded.update({
      "type": "outside_activity",
      "title": "New GitHub activity",
      "key": "outside_activity:%s" % str(
        current_attention.get("key") or ""
      ).split(":", 1)[-1],
      "message": (
        "GitHub activity that could not be confirmed as coming from a "
        "maintainer of this repository. Autopilot will not act on it."
      ),
      "downgraded_from": current_attention.get("type"),
    })
    patch["attention"] = downgraded

  if attention:
    patch["needs_attention"] = True
    patch["attention"] = attention
  return patch


# A push about one contribution opens that contribution, not the app's front
# page. `review:<id>` is the app-intent the shell delivers to index.jsx, which
# selects the record in whichever section it currently sits. The complete
# shell intent is at most 128 characters, including the seven in `review:`.
_RECORD_INTENT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,120}")


# A pull-request record that already has a public PR opens that PR's own page
# (`pr:<owner>:<repo>:<number>`, the notification-safe spelling of chat's
# `pull-request:owner/repo#N`; ":" cannot occur in a GitHub owner or repo name).
_REPO_PART = re.compile(r"[A-Za-z0-9_.-]{1,100}")


def _record_target(rec):
  owner, _, name = str(rec.get("repo") or "").partition("/")
  number = rec.get("number")
  intent = "pr:%s:%s:%s" % (owner, name, number)
  if (
    rec.get("type") == "pr"
    and _REPO_PART.fullmatch(owner) and _REPO_PART.fullmatch(name)
    and owner.strip(".") and name.strip(".")
    and isinstance(number, int) and not isinstance(number, bool) and number > 0
    and len(intent) <= 128
  ):
    return "/shell/?app=%s&intent=%s" % (APP_ID, intent)
  record_id = str(rec.get("id") or "")
  if _RECORD_INTENT_ID.fullmatch(record_id):
    return "/shell/?app=%s&intent=review:%s" % (APP_ID, record_id)
  return "/shell/?app=%s" % APP_ID


def _notify_attention(rec, attention):
  title = attention.get("title") or "Contribution needs attention"
  body = rec.get("title") or rec.get("repo") or "A contribution"
  message = attention.get("message")
  if message:
    body = "%s — %s" % (body, message)
  _call("POST", "/api/notifications/send", {
    "title": title,
    "body": body,
    "source_id": str(rec.get("id") or ""),
    "target": _record_target(rec),
  })


# Attention types the background loop handles autonomously. Mirrors
# autopilot.js ACTIONABLE_ATTENTION — keep the two in step.
ACTIONABLE_ATTENTION = frozenset((
  "changes_requested", "checks_failed", "github_activity",
))


def _respond_autopilot(rec, attention):
  # Ask the platform to run a background response round for this record's new
  # review event. Returns True when the event is handled by the loop (claimed,
  # deduped, escalated, or retrying) — meaning DON'T notify.
  # Returns False when the platform cannot or will not act autonomously (older
  # platform, missing grant, or permanent request failure), so the caller falls
  # back to the classic notification.
  path = "/api/github/contributions/%s/%s/respond" % (
    APP_ID, urllib.parse.quote(str(rec.get("id") or ""), safe=""),
  )
  try:
    raw, _ = _call("POST", path, {"attention": attention})
    try:
      result = json.loads(raw) if raw else {}
    except (TypeError, json.JSONDecodeError):
      result = {}
    # A stale/forged display mirror must not hide the review from the owner.
    # The platform's DB grant is authoritative, so fall back to the classic
    # notification when it says this record was never granted (or was paused).
    if isinstance(result, dict) and result.get("status") == "not_granted":
      return False
    return True
  except urllib.error.HTTPError as exc:
    if 400 <= exc.code < 500 and exc.code not in (409, 429):
      # Old backend (404), rejected authority (401/403), or invalid durable
      # attention: this pass cannot act autonomously, so preserve the classic
      # owner-visible path. Busy and rate-limited rounds remain quiet retries.
      return False
    # 409 (already handled / in flight), 429, and server failures are normal
    # retry states the next pass reconciles; never notify for them.
    return True
  except Exception:
    # Transient error — leave the attention on the record for the next pass.
    return True


def _read_record(path):
  raw, headers = _call("GET", path, headers={"x-mobius-version": "1"})
  return json.loads(raw), headers.get("ETag")


def _confirm_announced(path, rec, etag, slot, pending):
  # /notifications/send has no idempotency key (a tag only groups OS
  # pushes). Confirm only a successful response, never merely detection or
  # a transient /respond result. An ambiguous send or a crash before this
  # CAS can still repeat a notification; exactly-once needs endpoint support.
  # Returns the record and version this job last saw.
  for attempt in range(3):
    current = rec.get(slot)
    if (
      not _is_target(rec)
      or (slot == "attention" and not rec.get("needs_attention"))
      or not isinstance(current, dict)
      or (current.get("key"), current.get("detected_at"))
        != (pending.get("key"), pending.get("detected_at"))
      or current.get("announced_at")
    ):
      return rec, etag
    updated = dict(rec)
    updated[slot] = dict(current, announced_at=now)
    try:
      _, headers = _call("PUT", path, updated, headers={"If-Match": etag})
      return updated, headers.get("ETag")
    except urllib.error.HTTPError as exc:
      if exc.code != 412 or attempt == 2:
        raise
    # Merge only confirmation into a fresh record; never restore a stale
    # attention or overwrite unrelated changes from another writer.
    rec, etag = _read_record(path)
    if not etag:
      return rec, None
  return rec, etag


def _deliver_attention(name, node):
  # A prior pass may have durably written the attention but lost delivery.
  # Detection is not delivery. The scheduled runner owns single-flight for
  # this app; the record owns confirmation across runs. Re-read before routing
  # so a concurrent Dismiss, escalation or terminal transition stays in charge.
  path = _record_path(name)
  try:
    rec, etag = _read_record(path)
    if not etag or not _is_target(rec):
      return
    pending = rec.get("attention")
    if (
      rec.get("needs_attention")
      and isinstance(pending, dict) and pending.get("key")
      # /escalate owns human_required delivery, not this job.
      and pending.get("type") != "human_required"
    ):
      # Only work whose trusted provenance holds against this pass's GitHub
      # read reaches /respond; anything else is notification-only. Work
      # GitHub could not be asked about waits quietly for the next pass, like
      # a transient /respond failure: no round, and no fallback notice.
      provenance = (
        _attention_provenance(rec, pending, node, _ignored_event_urls(rec))
        if _is_autopilot(rec) else UNTRUSTED
      )
      held = provenance == UNVERIFIED
      routed = provenance == TRUSTED and _respond_autopilot(rec, pending)
      # Legacy attention has no delivery proof either; announce it once
      # rather than infer success from its presence on the record.
      if not (held or routed) and not pending.get("announced_at"):
        _notify_attention(rec, pending)
        rec, etag = _confirm_announced(path, rec, etag, "attention", pending)
    # Outside activity that arrived while actionable work held the attention
    # slot is reported on its own, once, without displacing that work.
    # Without a version (lost confirmation), the next pass delivers it.
    outside = rec.get("outside_activity")
    if (
      etag and _is_target(rec) and isinstance(outside, dict)
      and outside.get("key") and not outside.get("announced_at")
    ):
      _notify_attention(rec, outside)
      _confirm_announced(path, rec, etag, "outside_activity", outside)
  except Exception as exc:
    print("contribute: attention delivery %s pending: %s" % (name, exc),
          file=sys.stderr)


# Fields the job keeps for itself: a write that changes only these does not count as the
# record having been touched (`updated_at` stays), so a quiet record stays quiet. The told-once
# markers and the reminder time are the job's own books too.
BOOKKEEPING = frozenset((
  "lifecycle", "github_head_sha", "github_base_ref", "merged_announced", "closed_announced",
  "stranded_reminded_at", "stranded_announced",
))
# The two details that follow GitHub's own (job_github.saved_fields) are books too: a write made of
# these and BOOKKEEPING alone says nothing about attention, so it never decides whether one is delivered.
FOLLOWS_GITHUB = frozenset(("publication_stage", "title"))


def _write_record(name, rec, etag, patch):
  # One conditional write. If-Match pins the exact version this run read (and
  # computed the GraphQL verdict from), so a concurrent writer — the agent
  # claiming/submitting a record, the app's Dismiss — cannot be clobbered.
  # dict(rec) reapplies ONLY this job's own fields (status, attention,
  # observed GitHub state, updated_at) and preserves whatever fields other
  # writers added. On a 412 the record changed under us — skip it and let the
  # app's live refresh and the next scheduled run re-read and reapply if it still
  # needs it, rather than fight for the write. Returns the record written, or None.
  if not etag:
    print("contribute: skip %s — storage version unavailable" % name,
          file=sys.stderr)
    return None
  updated = dict(rec)
  updated.update(patch)
  if set(patch) - BOOKKEEPING:
    updated["updated_at"] = now
  try:
    _call("PUT", _record_path(name), updated, headers={"If-Match": etag})
  except urllib.error.HTTPError as exc:
    if exc.code == 412:
      print("contribute: skip %s — changed under refresh (412)" % name,
            file=sys.stderr)
    else:
      print("contribute: PUT %s failed (%s)" % (name, exc.code), file=sys.stderr)
    return None
  except Exception as exc:
    print("contribute: PUT %s error: %s" % (name, exc), file=sys.stderr)
    return None
  return updated


def _cleanup_staging(name, rec):
  try:
    _call(
      "POST",
      "/api/github/contributions/%s/%s/cleanup-staging" % (
        APP_ID, urllib.parse.quote(str(rec.get("id") or ""), safe=""),
      ),
      {},
    )
  except Exception as exc:
    print("contribute: staging cleanup %s failed: %s" % (name, exc),
          file=sys.stderr)


def _send_notice(rec, notice):
  # One per event, after the write that recorded the event. A failed send is
  # swallowed: the record already moved, so it is never retried (as before).
  try:
    _call("POST", "/api/notifications/send", {
      "title": notice["title"],
      "body": notice["body"],
      "source_id": str(rec.get("id") or ""),
      "target": _record_target(rec),
    })
  except Exception:
    pass


def _run_actions(name, rec, updated, node, actions, deliver=True):
  # What a stored move calls for, in the order it always had: close out the
  # follow-up, connect the app after a true merge, deliver attention, then tell
  # the owner. lifecycle_job.py names where each action comes from.
  for action in actions:
    if action["do"] == "cleanup":
      _cleanup_staging(name, rec)
    elif action["do"] == "connect_app":
      _finish_publication_connection(updated)
  if deliver:
    _deliver_attention(name, node)
  for action in actions:
    if action["do"] == "notify":
      _send_notice(rec, action)


def _route_of(name, node):
  # ROUTE_RESOLVED data for a side-branch merge, from the parent read (`_read_routes`).
  if name not in routes or not isinstance(node, dict):
    return None
  return job_github.route_resolution(
    str(node.get("mergedAt") or ""), job_github.default_branch_of(node) or "",
    job_github.parents_of(route_data.get(routes[name])),
  )


def _decide(name, rec, node, patch):
  # (patch, actions) for one record the GitHub read covered. In shadow mode the
  # status word is today's; in engine mode the engine's, with its effects.
  was = rec.get("status")
  if ENGINE:
    plan = lifecycle_job.plan_record(rec, node, NOW_EPOCH, now, patch, _route_of(name, node))
    return (plan["patch"], plan["actions"]) if plan else (patch, [])
  new_status = _live_status(node)
  if was == "landing" and new_status in ("open", "draft"):
    new_status = None
  _shadow("observed", rec, node, new_status or was, job_github.default_branch_of(node))
  if new_status and new_status != was:
    patch["status"] = new_status
    if new_status in ("merged", "closed"):
      patch["needs_attention"] = False
      patch["attention"] = None
      patch.update(lifecycle_job.emptied_attention(rec, patch))
  return patch, lifecycle_job.today_actions(rec, was, new_status)


def _owed_finish_pass():
  # In both modes: the marker first (compare-and-swap, so a lost race tells nobody twice), then
  # the grant close-out (unless this pass's terminal cleanup already made that call) and the notice.
  for name, rec, etag, owed in OWED:
    updated = _write_record(name, rec, etag, owed["patch"])
    if updated is not None:
      actions = [a for a in owed["actions"] if not (a["do"] == "cleanup" and name in CLEANED)]
      _run_actions(name, rec, updated, None, actions, deliver=False)


def _engine_idle_pass():
  # Records the job read that need no GitHub read: a send nobody confirmed, a deadline that
  # passed, a record seen for the first time. Written only when the engine has something to say.
  polled = set(item[0] for item in targets) | set(item[0] for item in OWED)
  for name, rec, etag in records:
    plan = None if name in polled else lifecycle_job.plan_record(rec, None, NOW_EPOCH, now, {})
    if not plan or not plan["patch"]:
      continue
    updated = _write_record(name, rec, etag, plan["patch"])
    if updated is not None:
      _run_actions(name, rec, updated, None, plan["actions"], deliver=False)


_owed_finish_pass()
if ENGINE:
  _engine_idle_pass()

for alias, (name, rec, etag) in aliases.items():
  node = data.get(alias)
  # A finished PR has no attention to decide; only its state is read.
  patch, actions = _decide(name, rec, node, {} if name in lean else _attention_update(rec, node))
  if patch:
    # Part of a write the job makes anyway, never a write of its own.
    patch.update(job_github.saved_fields({**rec, **patch}, node))
  if not patch:
    _deliver_attention(name, node)
    continue
  updated = _write_record(name, rec, etag, patch)
  if updated is not None:
    _run_actions(name, rec, updated, node, actions)
  elif set(patch) <= BOOKKEEPING | FOLLOWS_GITHUB:
    # A write that only keeps the job's own books never holds back a delivery that was due before
    # it: an empty patch always delivered, and the same record must not lose that to a lost race.
    _deliver_attention(name, node)
PY

exit 0
