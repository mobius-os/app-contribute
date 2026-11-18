"""The scheduled job's binding to the lifecycle engine: what to read, what to store, what to do.

Pure decisions. Nothing here reads a clock, a file or the network; job.sh makes the one batched
GitHub read, the compare-and-swap write and the calls, and asks this module what they mean.

`lifecycle_writer` in the app's settings decides who computes the stored `status` word. In
"shadow" (the default) the job keeps today's logic and this module is used only for the notes in
lifecycle_shadow.py and for the shared texts. In "engine" every record the job reads goes through
`plan_record`: adopt, observe the GitHub read, tick, then the status word and the `lifecycle`
field are stored in the SAME write the job makes, and the engine's effects become actions.

Effect to action (every effect the job's own moves can raise; the rest are the owner's, the
platform's or an agent's):

| effect (region)                          | what the job does                                          |
|------------------------------------------|------------------------------------------------------------|
| NOTIFY_ONCE (publication, update)        | one notification, text by the event (NOTICES)              |
| REMIND_OWNER (update)                    | one reminder notification                                  |
| CLOSE_OUT_FOLLOWUP, TURN_OFF_GRANT,      | one cleanup-staging call (the platform's close_out: grant  |
| HIDE_CHAT                                | off, chat hidden, checkout removed)                        |
| REQUEST_OWNER                            | `needs_attention` with a plain reason; its notification    |
|                                          | unless a NOTIFY_ONCE of the same region already tells it   |
| START_ROUTE_WATCH                        | the "merged into <branch>" notification; the base branch   |
|                                          | stays on the record (`github_base_ref`) for the route read |
| everything in NOT_ACTED                  | nothing, for the reason given there                        |

Three rules that are not effects. The stranded-update reminder (the table re-arms it every 7 days) is
sent once: its time is kept on the record (`stranded_reminded_at`). A vector that differs from the
stored one only by a clock (a queued PR's 6-hour question, that reminder clock) is not stored by
itself, so those loops never write a record. A PR the app itself merged or closed is told once and
its follow-up grant closed out (`owed_finish`).
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import lifecycle_engine as engine
from job_github import default_branch_of
from ledger_scan import OWED_MARKERS, OWNER_REQUEST, STRANDED_MARKER, owes_finish, owes_stranded
from lifecycle_record import TABLES, facts_of, level_of, stored_vector, tracked

OWN_REGIONS = ("publication", "update")  # the follow-up grant is the platform's: it expires its own lease
FINISHED = frozenset(("MERGED", "MERGED_ELSEWHERE", "ORPHANED", "CLOSED", "CLOSED_QUIET", "SUPERSEDED"))
# ORPHANED is read too, so the table's exit ORPHANED + ROUTE_RESOLVED(after) can fire when the parent
# branch reaches the default branch after all. Bound: ledger_scan returns an ORPHANED record only
# once per ORPHAN_POLL_SECONDS (a day), so it costs at most one lean read a day, not one a pass.
POLLED_PUBLICATION = frozenset(("DRAFT", "OPEN", "QUEUED", "CLOSED", "MERGED_ELSEWHERE", "ORPHANED"))
POLLED_UPDATE = frozenset(("PREPARED_UPDATE", "UPDATE_UNCERTAIN", "UPDATE_NOT_CONFIRMED"))
CLOSE_OUT = frozenset(("CLOSE_OUT_FOLLOWUP", "TURN_OFF_GRANT", "HIDE_CHAT"))
# The stranded-update reminder (the table re-arms it every 7 days for ever) is sent once per strand: the
# time it was sent is kept on the record, and cleared when the update is no longer stranded.
REMINDED = "stranded_reminded_at"

NOT_ACTED = {
  "MIRROR": "written by the platform's close_out, which the cleanup call runs",
  "START_OBSERVING": "publication_observe.py already reads GitHub for an uncertain send; it never sends",
  "ASK_GITHUB": "this pass's batched read is the question",
  "STAMP_PR": "the platform stamps number and url when it confirms a send; the job never writes them",
  "STAMP_FOLLOWUP": "the platform stamps the grant",
  "STAMP_UPDATED": "the platform stamps an update it confirms",
  "STAMP_GRANT": "the platform owns the grant",
  "COUNT_FAILURE": "the platform owns the follow-up round and its lease",
  "CLEAR_ONLY_HUMAN_REQUIRED": "the owner's Resume, through the platform",
}
# Effects the tables raise on events the job never feeds the engine (the owner's buttons, the
# platform's routes, agents): listed so a new effect in the tables cannot go unclassified.
NOT_THE_JOBS = frozenset((
  "CLAIM_RECORD", "DELETE_CHECKOUT_LATER", "RECORD_SUCCESSOR", "SHOW_REFUSAL", "MARK_ATTENTION_ADDRESSED",
  "KEEP_PUBLICATION_UNTOUCHED", "RECORD_NOTE", "STAGE_NEW_RECORD", "TELL_CHAT", "CLEAR_ANSWERED_FINDINGS",
  "ASK_REREVIEW", "KEEP_RECEIPTS", "RELEASE_LOCK", "START_NEW_REVIEW", "WRITE_CYCLE_RECORD", "ASK_PLATFORM",
))
ACTED = {
  "NOTIFY_ONCE": "one notification, text by the event",
  "REMIND_OWNER": "one reminder notification",
  "REQUEST_OWNER": "needs_attention with a plain reason (and its notification unless a NOTIFY_ONCE of the region tells it)",
  "START_ROUTE_WATCH": "the merged-into-<branch> notification; the base branch stays on the record for the route read",
  "CLOSE_OUT_FOLLOWUP": "one cleanup-staging call", "TURN_OFF_GRANT": "one cleanup-staging call", "HIDE_CHAT": "one cleanup-staging call",
}


def _title(record: dict) -> str:
  return record.get("title") or "contribution"


# ---- Texts. The merged and closed ones are today's, word for word.
def merged_notice(record: dict) -> dict:
  return {"title": "Contribution merged 🎉", "body": "Your %s was merged — it ships to everyone 🎉" % _title(record)}


def closed_notice(record: dict) -> dict:
  return {"title": "Contribution closed", "body": "Your %s was closed on GitHub without merging." % _title(record)}


def reopened_notice(record: dict) -> dict:
  return {"title": "Contribution reopened", "body": "Your %s was reopened on GitHub." % _title(record)}


def elsewhere_notice(record: dict, branch: str) -> dict:
  where = branch or "another branch"
  return {"title": "Contribution merged into another branch",
          "body": "Your %s was merged into %s, not on the default branch yet." % (_title(record), where)}


def stranded_notice(record: dict, event: str) -> dict:
  how = "merged" if event == "TARGET_MERGED" else "closed"
  return {"title": "Update could not be sent",
          "body": "The pull request for your %s was %s before the prepared update went out. "
                  "Open it to choose what to do with the changes." % (_title(record), how)}


def reminder_notice(record: dict) -> dict:
  return {"title": "Update still waiting for you",
          "body": "The prepared update for your %s can no longer go out and still needs your decision." % _title(record)}


OWNER_REASONS = {
  ("publication", "NOT_CONFIRMED"): ("Could not confirm the send",
    "Contribute could not confirm that the pull request reached GitHub. It never sends again on its own: open it to check."),
  ("publication", "ORPHANED"): ("Merged into a branch that never landed",
    "The change was merged into another branch that did not reach the default branch. Open it to decide what to do."),
  ("update", "UPDATE_NOT_CONFIRMED"): ("Could not confirm the update",
    "Contribute could not confirm that the update reached the pull request. Open it to check."),
  ("update", "STRANDED_UPDATE"): ("The update can no longer go out",
    "The pull request finished before the update was sent. Open it to choose what to do with the prepared changes."),
}


def owner_attention(record: dict, region: str, vector: dict, now_iso: str) -> dict | None:
  """The attention that shows a region waiting on the owner, with a plain reason. Announced when stored."""
  state = vector["regions"][region]["state"]
  reason = OWNER_REASONS.get((region, state))
  if reason is None:
    return None
  since = vector["regions"][region]["since"]
  return {"type": OWNER_REQUEST, "key": "%s:%s:%s:%s" % (OWNER_REQUEST, region, state, since),
          "title": reason[0], "message": reason[1], "url": record.get("url") or "",
          "detected_at": now_iso, "announced_at": now_iso}


# ---- Attention mirrored into the vector, and the slots a finished PR empties.
def attention_flags(record: dict) -> list:
  """The flags the record's attention slots hold, in the engine's priority order."""
  held = set()
  attention = record.get("attention")
  if record.get("needs_attention") and isinstance(attention, dict):
    held.add(attention.get("type"))
  held.update(item.get("type") for item in record.get("waiting_attention") or [] if isinstance(item, dict))
  if isinstance(record.get("outside_activity"), dict):
    held.add("outside_activity")
  return [flag for flag in TABLES["attention"]["priority"] if flag in held]


def emptied_attention(record: dict, patch: dict) -> dict:
  """What empties both attention slots of a finished PR (the engine's PR_FINISHED rule).

  Only what GitHub, an escalation or the old reconcile note raised goes; an owner request stands
  (the region that asked still waits). Only the slots that hold something are named, so a quiet record stays quiet.
  """
  merged = {**record, **patch}
  out = {}
  attention = merged.get("attention")
  if isinstance(attention, dict) and attention.get("type") != OWNER_REQUEST:
    out.update(needs_attention=False, attention=None)
  elif merged.get("needs_attention") and not isinstance(attention, dict):
    out["needs_attention"] = False
  if merged.get("waiting_attention"):
    out["waiting_attention"] = []
  if merged.get("outside_activity"):
    out["outside_activity"] = None
  return out


# ---- The engine step.
def _merge(total: dict, step: dict) -> dict:
  return {"vector": step["vector"], "effects": total["effects"] + step["effects"]}


def _own_tick(vector: dict, now: int) -> dict:
  """Deadlines of the regions the job owns. The follow-up lease belongs to the platform's sweeper:
  its deadline is set aside for the tick, so it neither moves nor leaves a history entry."""
  followup = vector["regions"]["followup"]
  masked = {**vector, "regions": {**vector["regions"], "followup": {**followup, "deadline": None}}}
  ticked = engine.tick(TABLES, masked, now)
  regions = {**ticked["vector"]["regions"], "followup": ticked["vector"]["regions"]["followup"] | {"deadline": followup.get("deadline")}}
  return {"vector": {**ticked["vector"], "regions": regions}, "effects": ticked["effects"]}


def _epoch(value: Any) -> int | None:
  try:
    return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp())
  except ValueError:
    return None


def _anchored(adopted: dict, record: dict, now: int) -> dict:
  """A closed PR seen for the first time was not closed just now: its 30 days of watching start
  from when the record was last written (the job's own close write), not from this pass."""
  seeded = any(entry["type"] in ("SEEDED", "RESEEDED") for entry in adopted["log"])
  slot = adopted["vector"]["regions"]["publication"]
  closed = _epoch(record.get("updated_at"))
  if not (seeded and slot["state"] == "CLOSED" and slot.get("deadline") and closed and closed < now):
    return adopted
  seconds = TABLES["regions"]["publication"]["states"]["CLOSED"]["deadline"]["seconds"]
  moved = {**slot, "since": closed, "deadline": closed + seconds}
  vector = {**adopted["vector"], "regions": {**adopted["vector"]["regions"], "publication": moved}}
  return {**adopted, "vector": vector}


def engine_step(record: dict, node: Any, now: int, route: dict | None = None) -> dict | None:
  """adopt, observe, route, tick: the vector the record should now store and the effects it raised.

  None for a record the machine does not track. `route` is ROUTE_RESOLVED data read for a PR that
  was merged into another branch.
  """
  if not tracked(record):
    return None
  adopted = engine.adopt(TABLES, stored_vector(record), facts_of(record), now)
  if adopted is None:
    return None
  adopted = _anchored(adopted, record, now)
  total = {"vector": adopted["vector"], "effects": list(adopted["effects"])}
  level = level_of(node, default_branch_of(node)) if node is not None else None
  if level is not None:
    total = _merge(total, engine.observe(TABLES, total["vector"], level, now))
  if route is not None:
    event = {"type": "ROUTE_RESOLVED", "source": "github", "region": "publication", "data": route, "inferred": True}
    step = engine.apply(TABLES, total["vector"], event, now)
    total = total if step["refusal"] else _merge(total, step)
  return _merge(total, _own_tick(total["vector"], now))


def publication_of(vector: dict) -> str:
  return vector["regions"]["publication"]["state"]


def is_polled(record: dict, now: int, vector: dict | None = None) -> bool:
  """Whether the engine-mode job asks GitHub about this record: a live or recently closed PR, a merge
  into a side branch still waiting for its parent, or a PR with an update that has not gone out."""
  url = record.get("url")
  if not (tracked(record) and isinstance(url, str) and url.startswith("https://github.com/")):
    return False
  vector = vector or _loaded(record, now)
  regions = vector["regions"] if vector else {}
  return bool(regions) and (
    regions["publication"]["state"] in POLLED_PUBLICATION or regions["update"]["state"] in POLLED_UPDATE)


def is_lean(record: dict, now: int) -> bool:
  """A polled PR that is already over (closed, merged into a side branch, or such a merge that never
  landed): the read asks only its state, so the one batched document stays about one rate-limit point
  however many are watched."""
  vector = _loaded(record, now)
  return bool(vector) and publication_of(vector) in ("CLOSED", "MERGED_ELSEWHERE", "ORPHANED")


def _loaded(record: dict, now: int) -> dict | None:
  step = engine_step(record, None, now)
  return step["vector"] if step else None


def watching_route(record: dict) -> str:
  """The branch a PR merged into while it waits for its parent to reach the default branch (or, once
  the owner was asked, in case it does after all), or ""."""
  stored = stored_vector(record)
  state = stored["regions"]["publication"]["state"] if stored else None
  return str(record.get("github_base_ref") or "") if state in ("MERGED_ELSEWHERE", "ORPHANED") else ""


# ---- What a step means for the write and for the calls after it.
def _notices(record: dict, effect: dict, node: Any) -> list:
  region, kind, event = effect["region"], effect["effect"], effect["event"]
  if kind == "NOTIFY_ONCE" and region == "update":
    return [stranded_notice(record, event)]
  if kind == "NOTIFY_ONCE" and event == "ROUTE_RESOLVED" and record.get("merged_announced"):
    return []  # the one-time sweep found this merge after the old job had already said "shipped"
  if kind == "NOTIFY_ONCE":
    return [{"CLOSED": closed_notice, "REOPENED": reopened_notice}.get(event, merged_notice)(record)]
  if kind == "START_ROUTE_WATCH":
    return [elsewhere_notice(record, str((node or {}).get("baseRefName") or record.get("github_base_ref") or ""))]
  # The table re-arms the reminder every 7 days; the owner is reminded once (REMINDED).
  return [reminder_notice(record)] if kind == "REMIND_OWNER" and not record.get(REMINDED) else []


def _requests(record: dict, effects: list, vector: dict, now_iso: str) -> list:
  told = {e["region"] for e in effects if e["effect"] == "NOTIFY_ONCE"}
  found = []
  for effect in effects:
    if effect["effect"] == "REQUEST_OWNER" and effect["region"] in OWN_REGIONS:
      attention = owner_attention(record, effect["region"], vector, now_iso)
      if attention:
        found.append((attention, effect["region"] not in told))
  return found


def _settled_request(record: dict, vector: dict) -> bool:
  """A standing owner request whose region no longer waits: the owner (or GitHub) moved it."""
  attention = record.get("attention")
  if not (isinstance(attention, dict) and attention.get("type") == OWNER_REQUEST):
    return False
  _, region, state, _ = (str(attention.get("key")) + ":::").split(":", 3)
  slot = vector["regions"].get(region)
  return not slot or slot["state"] != state


def _request_patch(record: dict, patch: dict, attention: dict) -> dict:
  """The owner's request takes the attention slot; what stood there is parked, never lost.

  The job's own parking (`waiting_attention`, as `_waiting_blockers` in job.sh): the displaced
  attention returns when the slot frees. An older owner request is simply replaced.
  """
  merged = {**record, **patch}
  current = merged.get("attention")
  out = {"needs_attention": True, "attention": attention}
  if merged.get("needs_attention") and isinstance(current, dict) and current.get("type") != OWNER_REQUEST:
    waiting = [item for item in merged.get("waiting_attention") or []
               if isinstance(item, dict) and item.get("type") != current.get("type")]
    out["waiting_attention"] = waiting + [current]
  return out


def _reminded(record: dict, vector: dict, effects: list, now_iso: str) -> dict:
  """Remember that the stranded-update reminder went out, and forget it when the update is no longer stranded."""
  if any(e["effect"] == "REMIND_OWNER" for e in effects) and not record.get(REMINDED):
    return {REMINDED: now_iso}
  stranded = vector["regions"]["update"]["state"] == "STRANDED_UPDATE"
  return {REMINDED: None} if record.get(REMINDED) and not stranded else {}


def _standing(vector: dict | None) -> tuple:
  """What a vector says apart from its clocks: every region's state and the attention flags."""
  if not isinstance(vector, dict):
    return ()
  states = {name: (slot or {}).get("state") for name, slot in (vector.get("regions") or {}).items()}
  return (states, vector.get("attention") or {})


def _worth_storing(record: dict, patch: dict, vector: dict) -> bool:
  """Whether the vector goes into this write. A vector that differs only by a clock (the 6-hour
  question of a queued PR, the 7-day reminder clock of a stranded update, the history of those moves)
  is not a reason to write the record: it is stored only when the write is made anyway."""
  stored = stored_vector(record)
  if vector == stored:
    return False
  return bool(patch) or _standing(stored) != _standing(vector)


def plan_record(record: dict, node: Any, now: int, now_iso: str, attention: dict,
                route: dict | None = None) -> dict | None:
  """The engine-mode decision for one record the job read.

  `attention` is the job's own attention patch for this read. Returns {"patch", "actions",
  "status"}, or None when the machine does not track the record. The patch carries the derived
  status word and the `lifecycle` field only when they changed, so a quiet record stays quiet.
  """
  step = engine_step(record, node, now, route)
  if step is None:
    return None
  vector, effects = step["vector"], step["effects"]
  patch = dict(attention)
  # The stored word goes in so a writer's own word the table accepts (the platform's `landing` claim
  # on an open PR) is kept: only a finished PR moves it.
  status = engine.status_of(TABLES, vector, record.get("status"))
  if status and status != record.get("status"):
    patch["status"] = status
  kinds = {e["effect"] for e in effects}
  if publication_of(vector) in FINISHED:
    patch.update(emptied_attention(record, patch))
  requests = _requests(record, effects, vector, now_iso)
  if requests:
    patch.update(_request_patch(record, patch, requests[-1][0]))
  elif "attention" not in patch and _settled_request(record, vector):
    patch.update(needs_attention=False, attention=None)
  actions = actions_of(record, node, effects, requests)
  patch.update(_reminded(record, vector, effects, now_iso))
  final = {**record, **patch}
  vector = {**vector, "attention": {"flags": attention_flags(final)}}
  if _worth_storing(record, patch, vector):
    patch["lifecycle"] = vector
  return {"patch": patch, "actions": actions, "status": status, "kinds": kinds, "vector": vector}


def _owed_finish_notice(record: dict) -> dict:
  merged = record.get("status") == "merged"
  actions = [{"do": "cleanup"}] if facts_of(record)["following"] in ("idle", "responding", "blocked") else []
  actions.append({"do": "notify", **(merged_notice(record) if merged else closed_notice(record))})
  return {"patch": {OWED_MARKERS[record["status"]]: True}, "actions": actions}


def _owed_stranded_request(record: dict, now_iso: str) -> dict:
  """The request and the one notice the app's receipt could not raise: the job's own pattern for a stranded update."""
  attention = owner_attention(record, "update", stored_vector(record), now_iso)
  patch = {STRANDED_MARKER: True, **_request_patch(record, {}, attention)}
  return {"patch": patch, "actions": [{"do": "notify", **stranded_notice(record, "TARGET_MERGED" if record.get("status") == "merged" else "TARGET_CLOSED")}]}


def owed_finish(record: dict, now_iso: str) -> dict | None:
  """What a PR the app itself finished (its own Merge or Close) still owes.

  The app's receipt path stores the record merged or closed at once, so the job later finds a
  finished record and would never tell the owner or close out the follow-up grant. How such a record
  is told from one finished before this build, or by the job: the receipt writes `merged_announced`
  or `closed_announced` as `false`, "finished here, not told yet"; every other writer leaves the key
  absent, and the job sets it `true` once it has told. Only an explicit `false` is owed anything, so
  nothing finished earlier is ever announced, and a second pass finds nothing. An update that was
  waiting when the app finished the PR is stranded by it and owes its own request and notice the same
  way (`stranded_announced`).

  Returns {"patch", "actions"}: the markers (written first), then the grant close-out (when the
  follow-up is still on) and the notices. None when nothing is owed.
  """
  owed = ([_owed_finish_notice(record)] if owes_finish(record) else []) + (
    [_owed_stranded_request(record, now_iso)] if owes_stranded(record) else [])
  if not owed:
    return None
  return {"patch": {key: value for part in owed for key, value in part["patch"].items()},
          "actions": [action for part in owed for action in part["actions"]]}


def actions_of(record: dict, node: Any, effects: list, requests: list) -> list:
  """The calls to make after the write, in today's order: cleanup, connect, then the notices."""
  kinds = {e["effect"] for e in effects}
  actions = []
  if kinds & CLOSE_OUT:
    actions.append({"do": "cleanup"})
  if any(e["effect"] == "NOTIFY_ONCE" and e["region"] == "publication" and e["event"] in ("MERGED", "ROUTE_RESOLVED")
         for e in effects):
    actions.append({"do": "connect_app"})  # a true merge only: a side-branch merge has not reached the default branch
  seen = set()
  for effect in effects:
    for notice in _notices(record, effect, node):
      if notice["title"] not in seen:
        seen.add(notice["title"])
        actions.append({"do": "notify", **notice})
  actions.extend({"do": "notify", "title": a["title"], "body": "%s — %s" % (_title(record), a["message"])}
                 for a, loud in requests if loud)
  return actions


def today_actions(record: dict, was: str | None, new_status: str | None) -> list:
  """Shadow mode: the calls today's job makes after a status it wrote, unchanged."""
  if new_status not in ("merged", "closed"):
    return []
  actions = [{"do": "cleanup"}] + ([{"do": "connect_app"}] if new_status == "merged" else [])
  if new_status == "merged" and was != "merged":
    actions.append({"do": "notify", **merged_notice(record)})
  if new_status == "closed" and was != "closed":
    actions.append({"do": "notify", **closed_notice(record)})
  return actions


def writer_mode(call: Any, app_id: str) -> str:
  """"engine" only when the app's settings say so. Anything unreadable is "shadow": never fail a pass."""
  try:
    raw, _ = call("GET", "/api/storage/apps/%s/settings.json" % app_id)
    settings = json.loads(raw) if raw else None
  except Exception:
    return "shadow"
  return "engine" if isinstance(settings, dict) and settings.get("lifecycle_writer") == "engine" else "shadow"
