#!/bin/bash
# Contribute — scheduled ledger refresh (cron).
#
# First reconcile prepared PR records whose reviewed work already reached the
# target repository's main by another path. Strong commit, reviewed-diff,
# merged-branch, or distinctive-identifier evidence settles an ordinary PR
# with a landing reference; partial identifier evidence only adds a dismissible
# hint. A PR update whose target settled first stays prepared but gains one
# recovery handoff so its remaining private work cannot be mistaken for
# sendable. That pass is independently CAS-safe and never sends a notification.
#
# Reconcile disposable staging checkouts for terminal records before the
# GitHub-dependent work. This is deliberately retryable: a checkout remains on
# disk after a failed cleanup, so the next scheduled pass tries it again.
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

# Keep prepared reconciliation separate from the established live-PR polling
# below: different target states, evidence, and failure modes should not turn
# one proven path into a conditional branch of the other.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
python3 "$SCRIPT_DIR/prepared_reconcile.py" 2>>/data/cron-logs/contribute.log

# The refresh logic is pure I/O against the local storage API (urllib) plus gh
# for the GraphQL round-trip. A quoted heredoc keeps the shell out of it; all
# inputs arrive via the exported environment. Diagnostics (an unhandled error)
# land in the cron log; every expected failure exits 0 silently above/below.
python3 - <<'PY' 2>>/data/cron-logs/contribute.log
import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API = os.environ["API_BASE_URL"].rstrip("/")
TOKEN = os.environ["APP_TOKEN"]
APP_ID = os.environ["APP_ID"]
PREFIX = "contributions/"
DEFAULT_BRANCH_BY_REPO = {}
BASE_FAILURES_BY_REPO = {}


def _call(method, path, body=None, headers=None):
  url = API + path
  hdrs = {"Authorization": "Bearer " + TOKEN}
  if headers:
    hdrs.update(headers)
  data = None
  if body is not None:
    data = json.dumps(body).encode("utf-8")
    hdrs["Content-Type"] = "application/json"
  req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
  with urllib.request.urlopen(req, timeout=15) as resp:
    return resp.read(), resp.headers


def _get_json(path):
  raw, _ = _call("GET", path)
  return json.loads(raw) if raw else None


def _record_path(name):
  return "/api/storage/apps/%s/%s%s" % (APP_ID, PREFIX, name)


def _read_record(name):
  # The storage GET sends an ETag only when the read opts into versioning;
  # that tag is what makes the later PUT compare-and-swap.
  raw, headers = _call("GET", _record_path(name), headers={"x-mobius-version": "1"})
  rec = json.loads(raw) if raw else None
  return rec, headers.get("ETag")


# Enumerate the ledger, paging until the cursor is exhausted. The storage
# list endpoint caps a page at 100 records; reading only the first page would
# silently skip every contribution beyond it (and never refresh/notify them),
# so walk next_cursor like the app's runtime storage.list does. A missing dir
# (nothing recorded yet) is not an error. The page loop is bounded so a
# server bug can't spin it forever.
names = []
cursor = None
for _page in range(2000):
  path = "/api/storage/apps-list/%s/%s?limit=500" % (APP_ID, PREFIX)
  if cursor:
    path += "&cursor=" + urllib.parse.quote(cursor, safe="")
  try:
    listing = _get_json(path)
  except urllib.error.HTTPError as exc:
    if exc.code == 404:
      sys.exit(0)
    raise
  entries = (listing or {}).get("entries") or []
  names.extend(
    e["name"] for e in entries
    if e.get("type") != "dir" and str(e.get("name", "")).endswith(".json")
  )
  cursor = (listing or {}).get("next_cursor")
  if not cursor:
    break

records = []
for name in names:
  try:
    rec, etag = _read_record(name)
  except urllib.error.HTTPError:
    continue
  if isinstance(rec, dict) and rec.get("id"):
    records.append((name, rec, etag))


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
      if not result.get("cleaned") and os.path.isdir(checkout):
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


def _is_target(rec):
  return (
    rec.get("type") in ("pr", "issue")
    and rec.get("status") in ("draft", "open", "landing")
    and isinstance(rec.get("url"), str)
    and rec["url"].startswith("https://github.com/")
  )


targets = [(name, rec, etag) for (name, rec, etag) in records if _is_target(rec)]
if not targets:
  sys.exit(0)

# One document, aliased resource() nodes. JSON string escaping is exactly the
# GraphQL string-literal escaping the url needs.
aliases = {}
parts = []
for i, (name, rec, etag) in enumerate(targets):
  alias = "r%d" % i
  aliases[alias] = (name, rec, etag)
  url_lit = json.dumps(rec["url"])
  parts.append(
    "%s: resource(url: %s) { __typename "
    "... on PullRequest { "
    "state isDraft updatedAt reviewDecision mergeable "
    "comments(last: 10) { nodes { url createdAt author { login } } } "
    "reviews(last: 10) { nodes { url submittedAt state author { login } } } "
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
    "comments(last: 10) { nodes { url createdAt author { login } } } "
    "} }" % (alias, url_lit)
  )
query = "query { " + " ".join(parts) + " }"

try:
  out = subprocess.run(
    ["gh", "api", "graphql", "-f", "query=" + query],
    capture_output=True, text=True, timeout=30,
  )
except Exception:
  sys.exit(0)
if out.returncode != 0:
  # gh error (rate limit, revoked token, org restriction) — leave state as-is.
  sys.exit(0)
try:
  data = (json.loads(out.stdout) or {}).get("data") or {}
except Exception:
  sys.exit(0)


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


def _all_nodes(conn):
  nodes = conn.get("nodes") if isinstance(conn, dict) else None
  return [n for n in nodes if isinstance(n, dict)] if isinstance(nodes, list) else []


def _author_login(node):
  author = node.get("author") if isinstance(node, dict) else None
  return author.get("login") if isinstance(author, dict) else ""


def _author_name(node):
  return _author_login(node) or "GitHub"


def _latest_event(node, ignore_urls=None):
  # Scan the last N comments/reviews and pick the newest. The platform mirrors
  # exact URLs returned by its own reply calls, so skip only those events—not
  # every comment written under the owner's GitHub identity.
  if not isinstance(node, dict):
    return None
  ignored = ignore_urls if isinstance(ignore_urls, set) else set()
  events = []
  for comment in _all_nodes(node.get("comments")):
    if not comment.get("createdAt"):
      continue
    if comment.get("url") in ignored:
      continue
    events.append({
      "kind": "comment",
      "at": comment["createdAt"],
      "url": comment.get("url") or "",
      "author": _author_name(comment),
    })
  for review in _all_nodes(node.get("reviews")):
    if not review.get("submittedAt"):
      continue
    if review.get("url") in ignored:
      continue
    events.append({
      "kind": "review",
      "state": review.get("state") or "",
      "at": review["submittedAt"],
      "url": review.get("url") or "",
      "author": _author_name(review),
    })
  if not events:
    return None
  return max(events, key=lambda e: e["at"])


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


def _record_head(rec):
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


def _attention_update(rec, node):
  patch = {}
  notify = None
  if not isinstance(node, dict):
    return patch, notify

  def set_if_changed(key, value):
    if (value or rec.get(key)) and rec.get(key) != value:
      patch[key] = value

  block = rec.get("autopilot") if _is_autopilot(rec) else {}
  ignore_urls = set(
    str(url) for url in (block.get("ignored_event_urls") or [])
    if isinstance(url, str) and url
  )

  check_state = _check_state(node)
  failing_checks, base_branch = _classified_failing_checks(rec, node)
  set_if_changed("last_check_rollup_state", check_state)
  set_if_changed("failing_checks", failing_checks)

  review_decision = node.get("reviewDecision") or ""
  previous_review = rec.get("last_review_decision")
  set_if_changed("last_review_decision", review_decision)

  # Merge-conflict detection (autopilot event). GitHub reports MERGEABLE /
  # CONFLICTING / UNKNOWN; only a definite CONFLICTING is actionable.
  mergeable = node.get("mergeable") or ""
  previous_mergeable = rec.get("last_mergeable")
  set_if_changed("last_mergeable", mergeable)

  latest = _latest_event(node, ignore_urls=ignore_urls)
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
  if (
    current_attention.get("type") == "checks_failed"
    and check_state == "SUCCESS"
  ):
    patch["needs_attention"] = False
    patch["attention"] = None
  if check_state == "SUCCESS" and rec.get("last_checks_attention_key"):
    patch["last_checks_attention_key"] = None

  attention = None
  checks_attention = None
  if check_state in ("FAILURE", "ERROR"):
    checks_attention = {
      "type": "checks_failed",
      "key": "checks_failed:%s:%s" % (check_state, _record_head(rec)),
      "title": "Checks failed",
      "message": _checks_message(failing_checks, base_branch),
      "url": rec.get("url") or "",
      "detected_at": now,
    }
  # Raise per checks KEY (state + head sha), not per raw state transition: an
  # autopilot follow-up push that fails again must fire for the NEW head even
  # though the stored rollup state never left FAILURE. The platform dedupes
  # response rounds by this same key (last_handled_attention_key), so
  # re-raising an already-handled key stays a quiet no-op.
  if checks_attention and rec.get("last_checks_attention_key") != checks_attention["key"]:
    attention = checks_attention
    patch["last_checks_attention_key"] = checks_attention["key"]
  elif review_decision == "CHANGES_REQUESTED" and previous_review != "CHANGES_REQUESTED":
    attention = {
      "type": "changes_requested",
      "key": "changes_requested:%s" % (latest["at"] if latest else now),
      "title": "Changes requested",
      "message": "A GitHub review requested changes.",
      "url": (latest or {}).get("url") or rec.get("url") or "",
      "detected_at": now,
    }
  elif latest and latest["at"] > str(baseline):
    label = "review" if latest["kind"] == "review" else "comment"
    message = "New %s from %s." % (label, latest["author"])
    attention = {
      "type": "github_activity",
      "key": "github_activity:%s" % latest["at"],
      "title": "New GitHub activity",
      "message": message,
      "url": latest.get("url") or rec.get("url") or "",
      "event_at": latest["at"],
      "detected_at": now,
    }
  elif mergeable == "CONFLICTING" and previous_mergeable != "CONFLICTING":
    attention = {
      "type": "merge_conflict",
      "key": "merge_conflict:%s" % _record_head(rec),
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
    refreshed = dict(current_attention)
    refreshed.update({
      "type": checks_attention["type"],
      "key": checks_attention["key"],
      "title": checks_attention["title"],
      "message": checks_attention["message"],
      "url": checks_attention["url"],
    })
    if not refreshed.get("detected_at"):
      refreshed["detected_at"] = now
    if refreshed != current_attention:
      patch["attention"] = refreshed

  if attention:
    patch["needs_attention"] = True
    patch["attention"] = attention
    if current_attention.get("key") != attention["key"]:
      notify = attention
  return patch, notify


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
    "target": "/shell/?app=%s" % APP_ID,
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


now = (
  datetime.datetime.now(datetime.timezone.utc)
  .replace(microsecond=0)
  .isoformat()
  .replace("+00:00", "Z")
)

for alias, (name, rec, etag) in aliases.items():
  node = data.get(alias)
  new_status = _live_status(node)
  patch, attention_notice = _attention_update(rec, node)
  was = rec.get("status")
  if was == "landing" and new_status in ("open", "draft"):
    new_status = None
  if new_status and new_status != was:
    patch["status"] = new_status
    if new_status in ("merged", "closed"):
      patch["needs_attention"] = False
      patch["attention"] = None
  if not patch:
    # A prior pass may have durably written the attention and then lost the
    # /respond call. Retry that same stable key until the platform claims or
    # dedupes it; otherwise one transient restart silently strands the review.
    pending = (
      rec.get("attention")
      if rec.get("needs_attention") and isinstance(rec.get("attention"), dict)
      else None
    )
    if (
      pending
      and _is_autopilot(rec)
      and pending.get("type") in ACTIONABLE_ATTENTION
    ):
      _respond_autopilot(rec, pending)
    continue
  if not etag:
    print("contribute: skip %s — storage version unavailable" % name,
          file=sys.stderr)
    continue
  # One conditional write. If-Match pins the exact version this run read (and
  # computed the GraphQL verdict from), so a concurrent writer — the agent
  # claiming/submitting a record, the app's Dismiss — cannot be clobbered.
  # dict(rec) reapplies ONLY this job's own fields (status, attention,
  # observed GitHub state, updated_at) and preserves whatever fields other
  # writers added. On a 412 the record changed under us — skip it and let the
  # app's live refresh and the next scheduled run re-read and reapply if it still
  # needs it, rather than fight for the write.
  updated = dict(rec)
  updated.update(patch)
  updated["updated_at"] = now
  headers = {"If-Match": etag}
  try:
    _call("PUT", _record_path(name), updated, headers=headers)
  except urllib.error.HTTPError as exc:
    if exc.code == 412:
      print("contribute: skip %s — changed under refresh (412)" % name,
            file=sys.stderr)
    else:
      print("contribute: PUT %s failed (%s)" % (name, exc.code), file=sys.stderr)
    continue
  except Exception as exc:
    print("contribute: PUT %s error: %s" % (name, exc), file=sys.stderr)
    continue
  if new_status in ("merged", "closed"):
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
  # Attention routing. For an autopilot record we hand actionable events to the
  # background loop (POST /respond) and stay SILENT — the owner is normally
  # contacted only on merged / closed / human_required (the last sent
  # server-side by /escalate). For a classic record, or an autopilot event the
  # loop cannot handle, notify exactly as before.
  attention_to_route = attention_notice
  if (
    not attention_to_route
    and updated.get("needs_attention")
    and isinstance(updated.get("attention"), dict)
  ):
    attention_to_route = updated["attention"]
  if attention_to_route:
    handled = False
    if (
      _is_autopilot(updated)
      and attention_to_route.get("type") in ACTIONABLE_ATTENTION
    ):
      handled = _respond_autopilot(updated, attention_to_route)
    if not handled:
      try:
        _notify_attention(updated, attention_to_route)
      except Exception:
        pass
  if new_status == "merged" and was != "merged":
    title = rec.get("title") or "contribution"
    try:
      _call("POST", "/api/notifications/send", {
        "title": "Contribution merged 🎉",
        "body": "Your %s was merged — it ships to everyone 🎉" % title,
        "source_id": str(rec.get("id") or ""),
        "target": "/shell/?app=%s" % APP_ID,
      })
    except Exception:
      pass
  # PR rejected: a close without a merge is a terminal outcome the owner should
  # hear about once (parity with the merged 🎉 notification). Non-autopilot
  # records historically got no close notification; sending it for all closed
  # PRs is strictly more informative and never noisy (one per record, ever).
  if new_status == "closed" and was != "closed":
    title = rec.get("title") or "contribution"
    try:
      _call("POST", "/api/notifications/send", {
        "title": "Contribution closed",
        "body": "Your %s was closed on GitHub without merging." % title,
        "source_id": str(rec.get("id") or ""),
        "target": "/shell/?app=%s" % APP_ID,
      })
    except Exception:
      pass
PY

exit 0
