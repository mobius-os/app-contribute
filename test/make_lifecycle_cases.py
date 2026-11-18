"""Writes test/lifecycle.cases.json and test/lifecycle.lock.json from the tables.

The case file is what keeps the interpreters honest: lifecycle_engine.py and lifecycle-engine.js
must give the stored answer for every step, in this repository and in the platform's copy.
Table-derived cases cover every transition, every deadline, every attention rule and every
bridge row; `refusals` lists every pair the engine must refuse and `statuses` every status word; the scenarios are incidents with a hand-written expectation; the
replay cases are the shapes of real pull-request histories (test/lifecycle.replay-shapes.json).

  python3 test/make_lifecycle_cases.py           # check: exit 1 when the files are stale
  python3 test/make_lifecycle_cases.py --write   # rewrite them
"""
from __future__ import annotations

import hashlib
import itertools
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import lifecycle_engine as engine  # noqa: E402
import lifecycle_tables  # noqa: E402

TABLES = lifecycle_tables.tables()
CASES = ROOT / "test" / "lifecycle.cases.json"
LOCK = ROOT / "test" / "lifecycle.lock.json"
SHAPES = ROOT / "test" / "lifecycle.replay-shapes.json"
T0 = 1_000_000  # an arbitrary start; only differences matter
RECORD = ("publication", "update", "followup")


def first(options: object) -> object:
  return options[0] if isinstance(options, list) else options


def choices(when: dict) -> list:
  """Every combination of the values a `when` accepts, as event data."""
  fields = sorted(when)
  values = [when[field] if isinstance(when[field], list) else [when[field]] for field in fields]
  return [{field: value for field, value in zip(fields, combo) if value is not None}
          for combo in itertools.product(*values)]


class Case:
  """One case: a start vector and steps, each run through the Python engine as it is added."""

  def __init__(self, name: str, states: dict, attention: bool = False, flags: list | None = None):
    self.vector = engine.new_vector(TABLES, states, T0, attention)
    if flags is not None:
      self.vector["attention"]["flags"] = list(flags)
    self.now = T0
    start = {"states": states, "now": T0, "attention": attention, "flags": flags}
    self.data = {"name": name, "start": start, "steps": []}

  def step(self, op: str, payload: dict | None = None, after: int = 60, expect: dict | None = None) -> "Case":
    self.now += after
    result = run(op, self.vector, payload, self.now)
    step = {"op": op, "now": self.now, "payload": payload}
    if result is not None:
      self.vector = result["vector"]
      step["status"] = engine.status_of(TABLES, self.vector) if "publication" in self.vector["regions"] else None
    step["result"] = result
    step["waiting"] = engine.waiting_on(TABLES, self.vector) if result else None
    if expect is not None:
      verify(self.data["name"], self.vector, result, expect)
      step["expect"] = expect
    self.data["steps"].append(step)
    return self

  def event(self, kind: str, data: dict | None = None, source: str = "test", region: str | None = None, **more) -> "Case":
    payload = {"type": kind, "source": source, "data": data or {}}
    if region:
      payload["region"] = region
    return self.step("apply", payload, **more)


def run(op: str, vector: dict | None, payload: dict | None, now: int) -> dict | None:
  if op == "apply":
    return engine.apply(TABLES, vector, payload, now)
  if op == "tick":
    return engine.tick(TABLES, vector, now)
  if op == "observe":
    return engine.observe(TABLES, vector, payload, now)
  return engine.adopt(TABLES, vector, payload, now)


def verify(name: str, vector: dict, result: dict | None, expect: dict) -> None:
  """A hand-written expectation is checked when the case is built, not only stored."""
  states = {region: slot["state"] for region, slot in vector["regions"].items()}
  checks = {
    "states": all(states.get(region) == state for region, state in expect.get("states", {}).items()),
    "refused": "refused" not in expect or ((result or {}).get("refusal") or {}).get("reason") == expect["refused"],
    "flags": "flags" not in expect or vector["attention"]["flags"] == expect["flags"],
    "status": "status" not in expect or engine.status_of(TABLES, vector, expect["status"]) == expect["status"],
    "effects": all(any(e["region"] == r and e["effect"] == n for e in (result or {}).get("effects", []))
                   for r, n in (pair.split(":") for pair in expect.get("effects", []))),
  }
  failed = [key for key, ok in checks.items() if not ok]
  if failed:
    raise AssertionError(f"{name}: expectation {failed} does not hold: {expect} got {states}")


def transition_cases() -> list:
  cases = []
  for name, region in TABLES["regions"].items():
    for index, row in enumerate(region["transitions"]):
      for data in choices(row["when"]):
        for draft in ([True, False] if row["to"] in TABLES["targets"] else [None]):
          payload = dict(data, **({} if draft is None else {"is_draft": draft}))
          label = f"transition {name} {row['from']} {row['event']} #{index} {json.dumps(payload, sort_keys=True)}"
          cases.append(Case(label, {name: row["from"]}).event(row["event"], payload).data)
  return cases


def refusal_pairs() -> list:
  """Every (region, state, event of that region) with no row: the engine must refuse each."""
  pairs = []
  for name, region in TABLES["regions"].items():
    alphabet = sorted({row["event"] for row in region["transitions"]})
    for state in region["states"]:
      taken = {row["event"] for row in region["transitions"] if row["from"] == state}
      pairs.extend([name, state, kind] for kind in alphabet if kind not in taken)
  for name, state, kind in pairs:
    Case(f"refused {name} {state} {kind}", {name: state}).event(kind, expect={"refused": "no_transition", "states": {name: state}})
  return pairs


def refusal_cases() -> list:
  unknown = Case("refused unknown event, logged once", {"publication": "OPEN"}).event("NO_SUCH_EVENT", expect={"refused": "unknown_event"})
  return [unknown.event("NO_SUCH_EVENT", expect={"refused": "unknown_event"}).data]


def status_rows() -> list:
  """The status word of every publication and update pair."""
  rows = []
  for pub in TABLES["regions"]["publication"]["states"]:
    for update in TABLES["regions"]["update"]["states"]:
      vector = engine.new_vector(TABLES, {"publication": pub, "update": update}, T0)
      rows.append([pub, update, engine.status_of(TABLES, vector)])
  return rows


def deadline_cases() -> list:
  cases = []
  for name, region in TABLES["regions"].items():
    for state, meta in region["states"].items():
      rule = meta.get("deadline")
      if not rule:
        continue
      case = Case(f"deadline {name} {state}", {name: state})
      case.step("tick", after=rule["seconds"] - 1, expect={"states": {name: state}})
      cases.append(case.step("tick", after=1, expect={"states": {name: rule["to"]}}).data)
  return cases


def attention_cases() -> list:
  cases = []
  everything = TABLES["attention"]["priority"]
  for index, row in enumerate(TABLES["attention"]["rules"]):
    for data in choices(row["when"]):
      for flags in ([], everything):
        label = f"attention {row['event']} #{index} {json.dumps(data, sort_keys=True)} from {len(flags)} flags"
        case = Case(label, {"publication": "OPEN", "update": None, "followup": "IDLE"}, True, flags)
        cases.append(case.event(row["event"], data, region="attention").data)
  return cases


def bridge_cases() -> list:
  cases = []
  for index, row in enumerate(TABLES["seed"]):
    facts = {field: first(value) for field, value in row["facts"].items()}
    case = Case(f"seed #{index} {json.dumps(facts, sort_keys=True)}", {})
    case.vector = None
    case.data["start"] = None  # a record that has no lifecycle yet
    cases.append(case.step("adopt", dict(facts, following="idle")).data)
  for index, row in enumerate(TABLES["status_edges"]):
    states = {"publication": first(row["where"]["publication"]), "update": first(row["where"].get("update")), "followup": None}
    facts = {field: first(value) for field, value in row["facts"].items()}
    cases.append(Case(f"status edge #{index} {json.dumps(states, sort_keys=True)} sees {json.dumps(facts, sort_keys=True)}", states, True)
                 .step("adopt", facts, expect=None if row["corrects"] else {"status": facts["status"]}).data)
  for index, row in enumerate(TABLES["level_edges"]):
    for state in row["where"]:
      for level in choices(row["level"]):
        cases.append(Case(f"level edge #{index} {state} sees {json.dumps(level, sort_keys=True)}",
                          {"publication": state, "update": None, "followup": "IDLE"}, True).step("observe", level).data)
  return cases


def record(name: str, publication: str = "OPEN", update: str | None = None, followup: str = "IDLE", flags: list | None = None) -> Case:
  return Case(f"scenario {name}", {"publication": publication, "update": update, "followup": followup}, True, flags or [])


def scenario_cases() -> list:
  """Incidents from the live ledger, each with the outcome a person expects."""
  main, side = {"base_is_default": True}, {"base_is_default": False}
  s = []
  s.append(record("a closed PR that is reopened is open again", "OPEN").event("CLOSED", source="github", expect={"states": {"publication": "CLOSED", "followup": "CLOSED_OUT"}, "status": "closed"})
           .step("observe", {"pr": "OPEN", "is_draft": False, "queued": False}, expect={"states": {"publication": "OPEN", "followup": "OFF"}, "status": "open", "effects": ["publication:NOTIFY_ONCE"]}).data)
  s.append(record("a closed PR goes quiet after 30 days and a manual Sync revives it", "CLOSED", followup="CLOSED_OUT")
           .step("tick", after=30 * 86400, expect={"states": {"publication": "CLOSED_QUIET"}, "status": "closed"})
           .step("observe", {"pr": "OPEN", "is_draft": True}, expect={"states": {"publication": "DRAFT"}, "status": "draft"}).data)
  s.append(record("merged into a side branch is not on main until that branch lands", "OPEN")
           .event("MERGED", side, "github", expect={"states": {"publication": "MERGED_ELSEWHERE", "followup": "CLOSED_OUT"}, "status": "merged", "effects": ["publication:START_ROUTE_WATCH"]})
           .event("CLOSED", source="github", expect={"states": {"publication": "MERGED_ELSEWHERE"}})
           .event("ROUTE_RESOLVED", {"reached": "after"}, "github", expect={"states": {"publication": "MERGED"}, "effects": ["publication:NOTIFY_ONCE"]}).data)
  s.append(record("merged into a branch that had already landed is orphaned and asks the owner", "OPEN")
           .event("MERGED", side, "github").event("ROUTE_RESOLVED", {"reached": "before"}, "github", expect={"states": {"publication": "ORPHANED"}, "effects": ["publication:REQUEST_OWNER"]})
           .event("OWNER_RELANDS", source="owner", expect={"states": {"publication": "SUPERSEDED"}, "status": "superseded"}).data)
  s.append(record("a side-branch merge with no answer for 14 days is orphaned", "OPEN").event("MERGED", side, "github")
           .step("tick", after=14 * 86400, expect={"states": {"publication": "ORPHANED"}}).data)
  s.append(record("a writer recorded merged before the base was known", "MERGED", followup="CLOSED_OUT")
           .step("observe", {"pr": "MERGED", "base_is_default": False}, expect={"states": {"publication": "MERGED_ELSEWHERE"}}).data)
  s.append(record("staging an update leaves the PR open; the PR merging first strands the update", "OPEN")
           .event("STAGE_UPDATE", source="platform", expect={"states": {"publication": "OPEN", "update": "PREPARED_UPDATE"}, "status": "prepared"})
           .event("MERGED", main, "github", expect={"states": {"publication": "MERGED", "update": "STRANDED_UPDATE", "followup": "CLOSED_OUT"}, "status": "merged",
                                                    "effects": ["publication:NOTIFY_ONCE", "update:NOTIFY_ONCE", "update:REQUEST_OWNER", "followup:TURN_OFF_GRANT"]})
           .event("PRESERVE_AS_NEW", source="owner", expect={"states": {"update": "NONE"}, "effects": ["update:STAGE_NEW_RECORD", "update:RECORD_SUCCESSOR"]}).data)
  s.append(record("a stranded update reminds after 7 days and can be discarded", "MERGED", "STRANDED_UPDATE", "CLOSED_OUT")
           .step("tick", after=7 * 86400, expect={"states": {"update": "STRANDED_UPDATE"}, "effects": ["update:REMIND_OWNER"]})
           .event("DISCARD_UPDATE", source="owner", expect={"states": {"publication": "MERGED", "update": "NONE"}, "status": "merged"}).data)
  s.append(record("discarding an update never touches the live PR", "OPEN", "PREPARED_UPDATE")
           .event("DISCARD_UPDATE", source="owner", expect={"states": {"publication": "OPEN", "update": "NONE"}, "status": "open", "effects": ["update:KEEP_PUBLICATION_UNTOUCHED"]}).data)
  s.append(record("an older app abandons a record whose update was discarded; the PR stays tracked", "OPEN", "PREPARED_UPDATE")
           .step("adopt", {"status": "abandoned", "is_update": True, "has_pr": True}, expect={"states": {"publication": "OPEN", "update": "NONE"}, "status": "open"}).data)
  finished = Case("scenario a PR found already merged closes out a follow-up grant that was left on", {})
  finished.vector, finished.data["start"] = None, None
  s.append(finished.step("adopt", {"status": "merged", "has_pr": True, "following": "idle"},
                         expect={"states": {"publication": "MERGED", "followup": "CLOSED_OUT"}, "status": "merged", "effects": ["followup:TURN_OFF_GRANT"]}).data)
  discarded = Case("scenario a record abandoned when only its update was discarded is a live PR again, then follows GitHub", {})
  discarded.vector, discarded.data["start"] = None, None
  s.append(discarded.step("adopt", {"status": "abandoned", "is_update": True, "has_pr": True}, expect={"states": {"publication": "OPEN", "update": "NONE"}})
           .step("adopt", {"status": "abandoned", "is_update": True, "has_pr": True}, expect={"states": {"publication": "OPEN", "update": "NONE"}})
           .step("observe", {"pr": "CLOSED"}, expect={"states": {"publication": "CLOSED"}, "status": "closed"}).data)
  s.append(record("the follow-up region follows the grant the record mirrors; a finished PR stays closed out", followup="OFF")
           .step("adopt", {"status": "open", "has_pr": True, "following": "idle"}, expect={"states": {"followup": "IDLE"}, "status": "open"})
           .step("adopt", {"status": "open", "has_pr": True, "following": "responding"}, expect={"states": {"followup": "RESPONDING"}})
           .step("adopt", {"status": "open", "has_pr": True, "following": "paused"}, expect={"states": {"followup": "PAUSED"}})
           .step("adopt", {"status": "open", "has_pr": True}, expect={"states": {"followup": "PAUSED"}})
           .step("adopt", {"status": "merged", "has_pr": True, "following": "idle"}, expect={"states": {"publication": "MERGED", "followup": "CLOSED_OUT"}})
           .step("adopt", {"status": "merged", "has_pr": True, "following": "idle"}, expect={"states": {"followup": "CLOSED_OUT"}}).data)
  s.append(record("a refused Update PR is not a lost send", "OPEN", "SENDING_UPDATE")
           .event("UPDATE_REFUSED", source="platform", expect={"states": {"update": "PREPARED_UPDATE"}, "status": "prepared", "effects": ["update:SHOW_REFUSAL"]}).data)
  s.append(record("a lost update answer is read back, never resent", "OPEN", "SENDING_UPDATE")
           .step("tick", after=300, expect={"states": {"update": "UPDATE_UNCERTAIN"}, "status": "submitting", "effects": ["update:START_OBSERVING"]})
           .step("tick", after=600, expect={"states": {"update": "UPDATE_NOT_CONFIRMED"}, "status": "prepared", "effects": ["update:REQUEST_OWNER"]})
           .event("OBSERVED_HEAD", source="github", expect={"states": {"update": "NONE"}, "status": "open"}).data)
  s.append(record("a send whose answer is lost is read back, never resent", "PREPARED", followup="OFF")
           .event("SEND_CONFIRMED", source="owner", expect={"states": {"publication": "SENDING"}, "status": "submitting"})
           .step("tick", after=299, expect={"states": {"publication": "SENDING"}})
           .step("tick", after=1, expect={"states": {"publication": "UNCERTAIN"}, "status": "submitting", "effects": ["publication:START_OBSERVING"]})
           .step("tick", after=600, expect={"states": {"publication": "NOT_CONFIRMED"}, "status": "prepared", "effects": ["publication:REQUEST_OWNER"]})
           .event("SEND_CONFIRMED", source="owner", expect={"refused": "no_transition", "states": {"publication": "NOT_CONFIRMED"}})
           .step("observe", {"pr": "OPEN", "is_draft": True}, expect={"states": {"publication": "DRAFT"}, "status": "draft"}).data)
  s.append(record("a refused send returns to prepared with its reason", "SENDING", followup="OFF")
           .event("SUBMIT_REFUSED", source="platform", expect={"states": {"publication": "PREPARED"}, "status": "prepared", "effects": ["publication:SHOW_REFUSAL"]}).data)
  s.append(record("the merge queue is a state, and merge follows it", "OPEN")
           .step("observe", {"pr": "OPEN", "is_draft": False, "queued": True}, expect={"states": {"publication": "QUEUED"}, "status": "open"})
           .step("tick", after=6 * 3600, expect={"states": {"publication": "QUEUED"}, "effects": ["publication:ASK_GITHUB"]})
           .step("observe", {"pr": "OPEN", "is_draft": False, "queued": False}, expect={"states": {"publication": "OPEN"}})
           .step("observe", {"pr": "MERGED", "base_is_default": True}, expect={"states": {"publication": "MERGED"}, "status": "merged"}).data)
  s.append(record("terminal states never regress: a late open read does not reopen a merged PR", "MERGED", followup="CLOSED_OUT")
           .step("observe", {"pr": "OPEN", "is_draft": False}, expect={"states": {"publication": "MERGED"}, "status": "merged"})
           .event("REOPENED", source="github", expect={"states": {"publication": "MERGED"}}).data)
  s.append(record("a failing check that also fails on the default branch asks for nobody", flags=[])
           .event("CHECKS_CHANGED", {"state": "failing", "all_inherited": True}, "github", expect={"flags": []})
           .event("CHECKS_CHANGED", {"state": "failing", "all_inherited": False}, "github", expect={"flags": ["checks_failed"]})
           .event("CHECKS_CHANGED", {"state": "pending"}, "github", expect={"flags": ["checks_failed"]})
           .event("CHECKS_CHANGED", {"state": "passing"}, "github", expect={"flags": []}).data)
  s.append(record("your own comment is not feedback")
           .event("COMMENTED", {"by_owner": True}, "github", expect={"flags": []})
           .event("COMMENTED", {"by_owner": False, "trusted": True}, "github", expect={"flags": ["github_activity"]})
           .event("COMMENTED", {"by_owner": False, "trusted": False}, "github", expect={"flags": ["github_activity", "outside_activity"]})
           .event("ANSWERED", source="agent", expect={"flags": []}).data)
  s.append(record("an escalation is held on top; Resume clears only it", followup="RESPONDING")
           .event("ESCALATED", source="agent", expect={"flags": ["human_required"], "states": {"followup": "BLOCKED"}})
           .event("COMMENTED", {"by_owner": False, "trusted": True}, "github")
           .event("CHECKS_CHANGED", {"state": "failing"}, "github", expect={"flags": ["human_required", "checks_failed", "github_activity"]})
           .event("RESUME", source="owner", expect={"flags": ["checks_failed", "github_activity"], "states": {"followup": "IDLE"}, "effects": ["followup:CLEAR_ONLY_HUMAN_REQUIRED"]}).data)
  s.append(record("a change request clears when it no longer stands, not only on approval")
           .event("REVIEW_CHANGED", {"changes_requested": True, "trusted": True}, "github", expect={"flags": ["changes_requested"]})
           .event("REVIEW_CHANGED", {"changes_requested": False}, "github", expect={"flags": []}).data)
  s.append(record("a finished PR clears every flag, the waiting ones too", flags=["checks_failed", "github_activity"])
           .event("MERGED", main, "github", expect={"flags": [], "states": {"publication": "MERGED"}}).data)
  s.append(record("staging an update clears the GitHub flags it answers and keeps an escalation", flags=["human_required", "checks_failed", "changes_requested"])
           .event("STAGE_UPDATE", source="platform", expect={"flags": ["human_required"], "states": {"update": "PREPARED_UPDATE"}}).data)
  s.append(record("a follow-up lease that expires returns to idle and updates the mirror", followup="RESPONDING")
           .step("tick", after=45 * 60, expect={"states": {"followup": "IDLE"}, "effects": ["followup:COUNT_FAILURE", "followup:MIRROR"]}).data)
  s.append(record("a second failed round blocks and asks the owner", followup="IDLE")
           .event("ROUND_STARTED", source="platform", expect={"states": {"followup": "RESPONDING"}})
           .event("ROUND_FAILED", {"blocks": False}, "platform", expect={"states": {"followup": "IDLE"}})
           .event("ROUND_STARTED", source="platform").event("ROUND_FAILED", {"blocks": True}, "platform", expect={"states": {"followup": "BLOCKED"}, "effects": ["followup:REQUEST_OWNER"]}).data)
  s.append(Case("scenario a review whose chat died is stalled and asks the owner", {"review": "REVIEWING"})
           .event("CHAT_ENDED", source="platform", expect={"states": {"review": "STALLED"}, "effects": ["review:REQUEST_OWNER"]})
           .event("REVIEW_AGAIN", source="owner", expect={"states": {"review": "REPLACED"}, "effects": ["review:START_NEW_REVIEW"]}).data)
  s.append(Case("scenario a review with no result for an hour is stalled; a late result still counts", {"review": "REVIEWING"})
           .step("tick", after=3600, expect={"states": {"review": "STALLED"}})
           .event("OUTCOME_PROBLEMS", source="agent", expect={"states": {"review": "PROBLEMS"}}).data)
  s.append(Case("scenario a stalled review whose chat works again is reviewing again, with a new hour", {"review": "REVIEWING"})
           .event("CHAT_ENDED", source="platform", expect={"states": {"review": "STALLED"}})
           .event("CHAT_WORKING", source="platform", expect={"states": {"review": "REVIEWING"}})
           .step("tick", after=3599, expect={"states": {"review": "REVIEWING"}})
           .step("tick", after=1, expect={"states": {"review": "STALLED"}}).data)
  s.append(Case("scenario set aside belongs to one review; an obstacle is not finished", {"review": "PROBLEMS"})
           .event("SET_ASIDE", source="owner", expect={"states": {"review": "SET_ASIDE"}})
           .event("HEAD_PUSHED", source="github", expect={"refused": "no_transition"}).data)
  s.append(Case("scenario a review that names an obstacle is not finished", {"review": "REVIEWING"})
           .event("OUTCOME_BLOCKED", source="agent", expect={"states": {"review": "NOT_FINISHED"}}).data)
  s.append(Case("scenario findings answered by a posted reply are answered", {"review": "PROBLEMS"})
           .event("ANSWER_POSTED", source="platform", expect={"states": {"review": "ANSWERED"}}).data)
  s.append(Case("scenario a post cut off by a restart fails after 3 minutes and asks again", {"respond": "POSTING"})
           .event("PROGRESS", source="agent", after=120).step("tick", after=179, expect={"states": {"respond": "POSTING"}})
           .step("tick", after=1, expect={"states": {"respond": "FAILED"}, "effects": ["respond:RELEASE_LOCK", "respond:KEEP_RECEIPTS"]})
           .event("APPROVE", source="owner", expect={"states": {"respond": "APPROVED"}})
           .step("tick", after=30, expect={"states": {"respond": "NOT_STARTED"}, "effects": ["respond:REQUEST_OWNER"]})
           .event("WITHDRAW", source="owner", expect={"states": {"respond": "READY"}}).data)
  s.append(Case("scenario a project run that stopped says so and can start again", {"run": "RUNNING"})
           .event("RUN_STOPPED", source="platform", expect={"states": {"run": "STOPPED"}, "effects": ["run:REQUEST_OWNER"]})
           .event("START", source="owner", expect={"states": {"run": "SENDING"}})
           .step("tick", after=120, expect={"states": {"run": "NOT_SENT"}}).data)
  stray = Case("scenario a stored deadline on a state that has none is never due", {"publication": "OPEN", "update": None, "followup": "IDLE"}, True)
  stray.vector["regions"]["publication"]["deadline"] = T0 + 5
  stray.data["start"]["deadlines"] = {"publication": T0 + 5}
  s.append(stray.step("tick", after=600, expect={"states": {"publication": "OPEN"}}).data)
  s.append(Case("scenario a stopped project run you dismiss no longer waits on you", {"run": "RUNNING"})
           .event("RUN_STOPPED", source="platform", expect={"states": {"run": "STOPPED"}})
           .event("DISMISS", source="owner", expect={"states": {"run": "DONE"}}).data)
  s.append(Case("scenario a proposed verdict for an older version is outdated", {"verdict": "PROPOSED"})
           .event("HEAD_PUSHED", source="github", expect={"states": {"verdict": "OUTDATED"}}).data)
  s.append(Case("scenario a verdict whose answer is lost is read back, then says nothing reached GitHub", {"verdict": "POSTING"})
           .step("tick", after=300, expect={"states": {"verdict": "UNKNOWN"}, "effects": ["verdict:START_OBSERVING"]})
           .step("tick", after=3600, expect={"states": {"verdict": "NOT_DISPATCHED"}}).data)
  return s


def replay_cases() -> list:
  cases = []
  ends = {"MERGED": ["MERGED"], "CLOSED": ["CLOSED"], "OPEN": ["OPEN", "DRAFT", "QUEUED"]}
  for index, shape in enumerate(json.loads(SHAPES.read_text())["shapes"]):
    case = Case(f"replay shape #{index} seen in {shape['histories']} real histories", {"publication": shape["initial"], "update": None, "followup": "IDLE"}, True)
    for event in shape["events"]:
      case.event(event["type"], event["data"], "github")
    state = case.vector["regions"]["publication"]["state"]
    refused = [step for step in case.data["steps"] if step["result"]["refusal"]]
    orphaned = shape["ends"] == "ORPHANED" and state == "ORPHANED"
    if refused or not (orphaned or state in ends[shape["github"]]):
      raise AssertionError(f"{case.data['name']}: ends {state}, GitHub says {shape['github']}, refused {len(refused)}")
    cases.append(case.data)
  return cases


def build() -> dict:
  groups = [transition_cases(), refusal_cases(), deadline_cases(), attention_cases(), bridge_cases(), scenario_cases(), replay_cases()]
  return {"version": TABLES["version"], "cases": [case for group in groups for case in group],
          "refusals": refusal_pairs(), "statuses": status_rows()}


def sha256(data: bytes) -> str:
  return hashlib.sha256(data).hexdigest()


def rendered() -> tuple[str, str]:
  problems = engine.check_tables(TABLES)
  if problems:
    raise AssertionError(f"the tables break their own rules: {problems}")
  cases = json.dumps(build(), sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
  lock = {
    "version": TABLES["version"],
    "tables_sha256": sha256(lifecycle_tables.canonical_json().encode()),
    "cases_sha256": sha256(cases.encode()),
    "tables_py_sha256": sha256((ROOT / "lifecycle_tables.py").read_bytes()),
    "engine_py_sha256": sha256((ROOT / "lifecycle_engine.py").read_bytes()),
  }
  return cases, json.dumps(lock, indent=1, sort_keys=True) + "\n"


def main() -> int:
  cases, lock = rendered()
  if "--write" in sys.argv:
    CASES.write_text(cases)
    LOCK.write_text(lock)
    (ROOT / "lifecycle-tables.js").write_text(lifecycle_tables.javascript_module())
    return 0
  stale = [path.name for path, text in ((CASES, cases), (LOCK, lock)) if not path.exists() or path.read_text() != text]
  if stale:
    print("stale: " + ", ".join(stale) + " (run with --write)")
  return 1 if stale else 0


if __name__ == "__main__":
  sys.exit(main())
