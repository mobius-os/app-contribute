// The engine-mode writer for a contribution record the app changes itself (the status word comes from the
// engine only when `lifecycle_writer` is "engine"): one owner action becomes one engine event, and the
// result is the record with its `lifecycle` and the status word that lifecycle derives, to be
// stored in the same compare-and-swap write. Pure: storage.js reads the record and writes it.
import { allowed, apply, statusOf } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { regionsOf } from './lifecycle-record.js'

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
