"""One or more passes of the job's planner over a record, for the tests written in JavaScript.

The screens and the job meet at the stored record: a screen writes it, the job's next pass reads it, and the job's answer is what a
screen reads next. A test that holds only one side proves nothing about that meeting, so a JavaScript test hands this script the
record exactly as the screen stored it and takes back what the job would store.

Standard input: {"record": {...}, "passes": [{"node": {...} | null, "now": 1800000000}, ...]}. A pass is one read of GitHub (`node`, the PR
as the job's batched query returns it; null for a pass that reads nothing) at `now` (whole seconds). Each pass carries what the last
one wrote, as a real job does. Standard output: one object per pass, {"record", "actions", "polled"}: the record after the pass, the calls
the job would make (cleanup, notices) and whether the job reads this record at all. The planner is the job's own: what is printed is what
`lifecycle_job.owed_finish` and `lifecycle_job.plan_record` return, never a restatement of it.
"""
import json
import sys
from datetime import datetime, timezone

import lifecycle_job


def iso(now: int) -> str:
  return datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def one_pass(record: dict, node, now: int) -> tuple[dict, list, bool]:
  """What the job writes and does for one record in one pass: the notice it owes for a PR the app finished, then its read."""
  actions: list = []
  owed = lifecycle_job.owed_finish(record, iso(now))
  if owed:
    record = {**record, **owed["patch"]}
    actions += owed["actions"]
  polled = lifecycle_job.is_polled(record, now)
  if polled:
    plan = lifecycle_job.plan_record(record, node, now, iso(now), {})
    if plan:
      record = {**record, **plan["patch"]}
      actions += plan["actions"]
  return record, actions, polled


def main() -> None:
  request = json.load(sys.stdin)
  record, results = request["record"], []
  for step in request["passes"]:
    record, actions, polled = one_pass(record, step.get("node"), int(step["now"]))
    results.append({"record": record, "actions": actions, "polled": polled})
  json.dump(results, sys.stdout)


if __name__ == "__main__":
  main()
