// What the lifecycle engine needs to know about a stored contribution record: the JavaScript
// twin of lifecycle_record.py. The engine works on facts, not on records, so this is the one
// place the app's screens read the ledger's field names for it.

import { lastSendUnconfirmed } from './domain.js'
import { adopt, tick, waitingOn } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'

const TRACKED_TYPES = ['pr', 'issue']

// Comment records have no life on GitHub to follow.
export const tracked = record => Boolean(record) && TRACKED_TYPES.includes(record.type)

// The follow-up grant as the record mirrors it.
function following(record) {
  const block = record.autopilot
  if (!block || typeof block !== 'object' || Array.isArray(block)) return 'off'
  if (!block.enabled) return 'paused'
  return ['responding', 'blocked'].includes(block.state) ? block.state : 'idle'
}

export function factsOf(record) {
  const plan = record.plan && typeof record.plan === 'object' ? record.plan : {}
  return {
    status: record.status ?? null,
    is_update: plan.action === 'pr_update',
    has_pr: Boolean(record.url || record.number),
    unconfirmed: lastSendUnconfirmed(record),
    following: following(record),
  }
}

// The regions a contribution record's vector holds; the others live on their own host objects (a respond result, a review, a run).
const RECORD_REGIONS = Object.keys(TABLES.regions).filter(name => TABLES.regions[name].host === 'record')
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// A region slot the engine can read: a state the tables know, and times it can compare. A deadline belongs to a state that has a deadline
// rule; one on any other state comes from tables this copy does not have (the version may not have moved), so the vector is read as none.
const readableSlot = (name, slot) => {
  // A state that is not a string is no state: property lookup would read the list ['OPEN'] as 'OPEN'.
  if (!isObject(slot) || typeof slot.state !== 'string' || !Object.hasOwn(TABLES.regions[name].states, slot.state) || !Number.isInteger(slot.since)) return false
  return slot.deadline == null || (Number.isInteger(slot.deadline) && Boolean(TABLES.regions[name].states[slot.state].deadline))
}

// The record's stored vector when the engine can read all of it, else null. The field is the record's own to edit: a hand edit or a partial
// write may leave anything in it, and a vector of another table version means other states. One the engine cannot read is not repaired
// and not trusted: the record is read as if it had none, from its facts (the platform's reader does the same, so the two agree).
export function storedVector(record) {
  const stored = record?.lifecycle
  if (!isObject(stored) || stored.v !== TABLES.version || !isObject(stored.regions)) return null
  const names = Object.keys(stored.regions)
  if (names.length !== RECORD_REGIONS.length || !RECORD_REGIONS.every(name => names.includes(name))) return null
  if (!names.every(name => readableSlot(name, stored.regions[name]))) return null
  const history = stored.history || []
  const attention = stored.attention ?? null
  const historyOk = Array.isArray(history) && history.every(isObject)
  return historyOk && (attention === null || (isObject(attention) && Array.isArray(attention.flags))) ? stored : null
}

// The record's lifecycle as it stands now: the stored vector brought in line with the status
// word another writer may have stored, with every passed deadline applied. Null for a record
// the machine does not track. Nothing is written; the caller decides whether to store it.
export function vectorOf(record, now) {
  if (!tracked(record)) return null
  const adopted = adopt(TABLES, storedVector(record), factsOf(record), now)
  return adopted ? tick(TABLES, adopted.vector, now).vector : null
}

export const stateOf = (vector, region) => vector?.regions?.[region]?.state ?? null

// ---- Selectors: what a screen asks of a record. Each derives the vector (nothing is stored)
// and reads the regions, never the status word: an update waiting on a public PR reads
// `prepared` there, because Send claims a record by that word, so "prepared" does not mean
// "not public". `now` is whole seconds; it only moves deadlines, never which side of
// public/private a state is on.
const PUBLIC = ['DRAFT', 'OPEN', 'QUEUED']
const nowSeconds = () => Math.floor(Date.now() / 1000)

// The two regions that say where a contribution stands, or null for a record not tracked.
export function regionsOf(record, now = nowSeconds()) {
  const vector = vectorOf(record, now)
  return vector ? { publication: stateOf(vector, 'publication'), update: stateOf(vector, 'update'), vector } : null
}

export const publicationOf = (record, now) => regionsOf(record, now)?.publication ?? null

// An update to a public PR is reviewed and waits for the owner to send it.
export const updateWaiting = (record, now) => regionsOf(record, now)?.update === 'PREPARED_UPDATE'

// The PR merged or closed before the update went out; the owner chooses what happens to it.
export const strandedUpdate = (record, now) => regionsOf(record, now)?.update === 'STRANDED_UPDATE'

// A finished PR whose lifecycle still waits on the owner. Its status word says merged or closed, so a reader of the word alone files it as done,
// while a region says it is not settled: an update that can no longer go out (`stranded_update`), or a merge into another branch that never
// reached the default branch (`orphaned`). `kind` is the decision kind run.js lists it under. Null for a record that is not held. The owner's
// ways out are lifecycle-write.js `settleExits`.
const HELD = [['update', 'STRANDED_UPDATE', 'stranded_update'], ['publication', 'ORPHANED', 'orphaned']]
export function ownerHeld(record, now) {
  const found = regionsOf(record, now)
  const held = found && HELD.find(([region, state]) => found.vector.regions[region]?.state === state)
  return held ? { kind: held[2], region: held[0], state: held[1] } : null
}

// Whether the record's own state lets it be sent now: a private record waiting to be sent, or
// a public PR with an update waiting; no attention flag, no refusal or send error saved on it.
// An unconfirmed send is neither (its regions are UNCERTAIN, never PREPARED). Callers add the
// review for this exact version, which the record's lifecycle does not know.
export function sendableNow(record, now) {
  const regions = regionsOf(record, now)
  if (!regions) return false
  const waiting = regions.publication === 'PREPARED' || (PUBLIC.includes(regions.publication) && regions.update === 'PREPARED_UPDATE')
  const flags = regions.vector.attention?.flags || []
  return waiting && !flags.length && record.needs_attention !== true && !record.last_submit_error
}

// Every region that owes a move: who it waits on and since when ([] for a record not tracked).
export const waitsOn = (record, now) => {
  const regions = regionsOf(record, now)
  return regions ? waitingOn(TABLES, regions.vector) : []
}
