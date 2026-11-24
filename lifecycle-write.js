// The engine-mode writer for a contribution record the app changes itself (the status word comes from the
// engine only when `lifecycle_writer` is "engine"): one owner action becomes one engine event, and the
// result is the record with its `lifecycle` and the status word that lifecycle derives, to be
// stored in the same compare-and-swap write. Pure: storage.js reads the record and writes it.
import { allowed, apply, statusOf } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { regionsOf } from './lifecycle-record.js'
import { validRecordId } from './chat-blocks.js'

const nowSeconds = () => Math.floor(Date.now() / 1000)

// Discard means two things. An update waiting on a public pull request is dropped and the PR lives
// on, tracked as before (DISCARD_UPDATE); work that was never sent is abandoned (DISCARD). The tables
// say which one applies to the record's state, so a live PR is never written `abandoned`.
const DISCARDS = [{ type: 'DISCARD_UPDATE', region: 'update' }, { type: 'DISCARD', region: 'publication' }]

// The job's question to the owner (an `owner_request` attention, key `owner_request:<region>:<state>:<since>`) is settled once its region no
// longer holds the state it was raised for. The job clears such a request when it next reads the record, but it never reads a finished PR's
// record again once the update is gone, so an owner's own action must clear it in the write that settles it (the twin of lifecycle_job.py
// `_settled_request`). Any other attention stays.
export function withoutSettledRequest(record, vector) {
  const attention = record.attention
  if (!(attention && typeof attention === 'object' && attention.type === 'owner_request')) return record
  const [, region, state] = `${attention.key}:::`.split(':')
  if (vector.regions[region]?.state === state) return record
  return { ...record, needs_attention: false, attention: null }
}

// The record after the owner discards it, or null when its state accepts neither.
export function discardRecord(record, now = nowSeconds()) {
  const found = regionsOf(record, now)
  const event = found && DISCARDS.find(({ type }) => allowed(TABLES, found.vector, type))
  if (!event) return null
  const step = apply(TABLES, found.vector, { ...event, source: 'owner' }, now)
  if (step.refusal) return null
  return withoutSettledRequest({ ...record, lifecycle: step.vector, status: statusOf(TABLES, step.vector, record.status) }, step.vector)
}

// Whether discarding this record leaves its pull request public and tracked, because only an update
// is dropped, instead of abandoning the record. A card words its confirmation by it.
export function discardKeepsPull(record, now = nowSeconds()) {
  const next = discardRecord(record, now)
  return Boolean(next) && next.status !== 'abandoned'
}

// The owner's ways out of a finished PR that waits on them (lifecycle-record.js `ownerHeld`): the tables' own events. A successor is the record the
// work went on in, so the exit that hands it over names it (`successor`); an exit that only ends the wait carries a note or nothing.
// Where each is stored: an update's exit is `update_outcome` ({ exit, at, note?, successor? }) and the status stays the PR's own; a merge that never
// landed, re-landed as new work, is `superseded` with `superseded_by`, which every card already follows.
export const EXITS = {
  COVERED_BY_MERGE: { region: 'update', note: 'The merged pull request already contained these changes.' },
  PRESERVE_AS_NEW: { region: 'update', successor: true },
  DISCARD_UPDATE: { region: 'update' },
  OWNER_RELANDS: { region: 'publication', successor: true },
}

// The exits the record's state accepts now, in the order a card offers them ([] for a record that is not held).
export function settleExits(record, now = nowSeconds()) {
  const found = regionsOf(record, now)
  return found ? Object.keys(EXITS).filter(type => allowed(TABLES, found.vector, type)) : []
}

// The record after the owner settles it by `exit`, or null when its state does not accept that exit (or a successor is missing or is the record
// itself). The exit, its outcome and the status word it derives are stored in one write; the job's request about it goes in the same write, and
// the reminder clock of a stranded update stops (the job clears both when it next reads a record, but it never reads a finished PR again).
export function settleRecord(record, exit, { successor = '', iso = new Date().toISOString(), now = nowSeconds() } = {}) {
  const rule = EXITS[exit]
  const found = rule && regionsOf(record, now)
  if (!found || (rule.successor && (!validRecordId(successor) || successor === record.id))) return null
  const step = apply(TABLES, found.vector, { type: exit, source: 'owner' }, now)
  if (step.refusal) return null
  const outcome = exit === 'OWNER_RELANDS' ? { superseded_by: successor }
    : { update_outcome: { exit, at: iso, ...(rule.note ? { note: rule.note } : {}), ...(rule.successor ? { successor } : {}) } }
  const next = { ...record, ...outcome, lifecycle: step.vector, status: statusOf(TABLES, step.vector, record.status), updated_at: iso }
  if (record.stranded_reminded_at) next.stranded_reminded_at = null
  return withoutSettledRequest(next, step.vector)
}
