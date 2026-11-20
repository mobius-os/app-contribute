// Everything the app waits on, grouped by who it waits on (owner, other, github, platform, agent), each with since and age, and the
// list of what has waited on a machine for longer than its state allows (`stuck`). One pure function over what the screens already hold:
// the contribution records (their lifecycle regions), the PR machine's turn for each PR, the saved Respond answers and the project runs.
// Nothing here reads a clock (`now` is whole seconds), storage or the network.
//
// The `owner` group IS Needs you: it is desk.js needsRows (the one definition the chips, a project's card and the rail badge count),
// so its size is the Needs you number, not a second count. It holds a PR's rows only where the PR machine says the turn is yours (or, for a review
// request, the agent is at work on your review: the request stays yours).
// What the records and answers owe the owner as a step of their own (Send, Update PR) is the Ready list's, or reaches Needs you through the
// attention a region raises (needs_attention), so it is not counted a second time here.
import { deskStanding, needsRows, pullKey } from './desk.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { waitsOn } from './lifecycle-record.js'
import { respondWaitingOn } from './respond-lifecycle.js'
import { runWaitingOn } from './cycle-lifecycle.js'

export const WAIT_GROUPS = ['owner', 'other', 'github', 'platform', 'agent']
// Who a machine is: a wait on one of these has an end of its own, and is stuck when it does not come.
const MACHINES = new Set(['github', 'platform', 'agent'])

const nowSeconds = () => Math.floor(Date.now() / 1000)
const seconds = text => { const at = Date.parse(text || ''); return Number.isFinite(at) ? Math.floor(at / 1000) : null }
const ageOf = (since, now) => (since === null || since === undefined ? null : Math.max(0, now - since))

// How long a state may wait on a machine before it is stuck: the deadline the tables give it, or null when it has none.
export const allowedSeconds = ({ region, state }) => TABLES.regions[region]?.states[state]?.deadline?.seconds ?? null

const item = (source, ref, row, now, extra = {}) => ({ source, ref, region: row.region, state: row.state, waits: row.waits, since: row.since ?? null, age: ageOf(row.since, now), deadline: row.deadline ?? null, ...extra })

// A row of Needs you as an item. Its `since` is the date the row itself has: when GitHub last moved the PR, when the attention was detected,
// when the run was made, or since the run region began.
function ownerItem(row, now) {
  if (row.run) return item('run', row.run, { region: 'run', state: row.run.state, waits: 'owner', since: row.run.since, deadline: row.run.deadline }, now)
  if (row.item) return item('look', row, { region: 'attention', state: row.item.kind, waits: 'owner', since: seconds(row.item.record?.attention?.detected_at) }, now)
  if (row.entry) return item('review', row, { region: 'review', state: row.entry.bucket, waits: 'owner', since: seconds(row.entry.run?.created_at) }, now)
  return item('pr', row, { region: 'pr', state: row.decision?.state || 'reviewer.to_review', waits: 'owner', since: seconds(row.pr.updatedAt) }, now)
}

// Where a PR whose turn is not yours waits: on GitHub's merge queue, on a machine of ours (sending), on the agent at work, or on someone else.
function turnGroup(decision) {
  if (decision.turn === 'agent') return decision.state === 'sending' ? 'platform' : 'agent'
  return decision.waitingOn === 'GitHub' ? 'github' : 'other'
}

function pullItems(pulls, login, facts, now) {
  return pulls.flatMap(pr => {
    const decision = deskStanding(pr, login, facts)
    if (decision.turn === 'you' || decision.turn === 'none') return []
    return [item('pr', pr, { region: 'pr', state: decision.state, waits: turnGroup(decision), since: seconds(pr.updatedAt) }, now, { key: pullKey(pr), who: decision.waitingOn })]
  })
}

const respondKey = result => `${String(result.repo || '').toLowerCase()}#${result.number}`

function answerItems(responses, pulls, now) {
  return (responses || []).flatMap(entry => {
    if (!entry?.result) return []
    const pr = pulls.find(candidate => pullKey(candidate) === respondKey(entry.result)) || null
    return respondWaitingOn(entry, { pr, now }).map(row => item('respond', entry, row, now, { key: respondKey(entry.result) }))
  })
}

// A project run's rows are the ones its reader already made (ui/useProjectRuns.js), or are made here from the cycle record and what the platform said.
const rowsOfRun = (run, now) => run.rows ?? runWaitingOn({ record: run.record, phase: run.phase ?? null, observedAt: run.observedAt ?? null, now })
const runItems = (projectRuns, now) => projectRuns.flatMap(run => run.rows.map(row => item('run', run, row, now, { key: run.key })))

// A record that has its PR is the same work as that PR's row, so it carries the PR's key.
const recordKey = record => { const repo = record.repo || record.plan?.repo; return repo && record.number ? `${String(repo).toLowerCase()}#${record.number}` : record.id }
const recordItems = (records, now) => (records || []).flatMap(record => waitsOn(record, now).map(row => item('record', record, row, now, { key: recordKey(record) })))

const byAge = (left, right) => (right.age ?? -1) - (left.age ?? -1)

// Something that waits on a machine for longer than its state allows. The lazy tick has already moved a state past its deadline to the next
// one, so what is left is a state that renews itself (a queue entry, a run the platform has not answered for): its `since` does not move.
export const isStuck = entry => {
  const limit = allowedSeconds(entry)
  return MACHINES.has(entry.waits) && limit !== null && entry.age !== null && entry.age >= limit
}

// -> { owner, other, github, platform, agent, stuck }, each an array of items { source, ref, region, state, waits, since, age, deadline, key? }
// longest wait first. `pulls` is every PR that concerns the owner (the Desk's `incoming`); `decisions`, `reviewEntries` and `facts` are what
// deskCounts takes (facts: runs, chats, responses, ignored, projectRuns). `projectRuns` is [{ key, record, phase, observedAt }] (a project's
// cycle record, what the platform says about its conversation and when) and `responses` the saved Respond answers.
export function waitingOnGroups({ records = [], pulls = [], decisions = [], reviewEntries = [], responses = [], projectRuns = [], login = '', facts = {}, now = nowSeconds() } = {}) {
  const runs = projectRuns.map(run => ({ ...run, rows: rowsOfRun(run, now) }))
  const known = { ...facts, responses: facts.responses ?? responses, projectRuns: runs }
  const rows = needsRows({ requests: pulls.filter(pr => pr.reviewRequested), pulls, decisions, entries: reviewEntries, login, facts: known })
  const owner = rows.map(row => ownerItem(row, now))
  const machines = [...recordItems(records, now), ...answerItems(known.responses, pulls, now), ...runItems(runs, now)]
  const watched = new Set(machines.filter(entry => MACHINES.has(entry.waits) && entry.key).map(entry => entry.key))
  // A request whose review the agent is at work on is still a row of Needs you (desk.js requestsWaiting), so it is not also a wait on the agent.
  const rowed = new Set(rows.filter(row => row.pr).map(row => pullKey(row.pr)))
  // A PR an answer or a record is already working on shows once, under that work, not again as "an agent is working on it".
  const people = pullItems(pulls, login, known, now).filter(entry => !rowed.has(entry.key) && !(MACHINES.has(entry.waits) && watched.has(entry.key)))
  const waits = [...machines, ...people].filter(entry => entry.waits !== 'owner')
  const groups = Object.fromEntries(WAIT_GROUPS.map(name => [name, (name === 'owner' ? owner : waits.filter(entry => entry.waits === name)).sort(byAge)]))
  return { ...groups, stuck: waits.filter(isStuck).sort(byAge) }
}
