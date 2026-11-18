// The owner's own Merge, Close, Open for review or Back to draft, written to the contribution record of that PR in the step that
// confirms it. Without this the ledger says "open" until the scheduled job's next pass, up to fifteen minutes. Who computes the
// stored word follows `lifecycle_writer`: shadow stores only what the job itself would store for that fact
// (job.sh `_decide`: the status word, and the finished PR's emptied attention), engine stores the engine's result.
// Pure up to `writePullReceipt`, which hands the change to storage.js's checked write.
import { apply, statusOf } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { tracked, vectorOf } from './lifecycle-record.js'
import { casWriteRecord, lifecycleWriterOf, loadAppSettings } from './storage.js'

const nowSeconds = () => Math.floor(Date.now() / 1000)

// What each confirmed receipt (collaboration.js STATUS_WRITE and mergePull: the state it names) means: the engine event it raises and the
// word the job writes for the same fact (domain.js liveStatusFor). A merge queue entry is a state of its own for the engine and nothing
// for the job: the PR is still "open" there.
export const RECEIPTS = {
  merged: { event: 'MERGED', word: 'merged' },
  closed: { event: 'CLOSED', word: 'closed' },
  ready: { event: 'MARKED_READY', word: 'open' },
  draft: { event: 'MARKED_DRAFT', word: 'draft' },
  queued: { event: 'QUEUE_ENTERED', word: null },
}
const FINISHED_WORDS = ['merged', 'closed']
// The records the job polls in shadow mode (job.sh `_is_target`): a live PR on GitHub. A `landing` one is only ever settled by a finished PR.
const POLLED_WORDS = ['draft', 'open', 'landing']
const OWNER_REQUEST = 'owner_request'

const onGithub = record => tracked(record) && /^https:\/\/github\.com\//.test(String(record.url || ''))

// What empties the attention a finished PR still carries (lifecycle_job.py `emptied_attention`, which the job applies in both modes).
// Only the slots that hold something are named, so a quiet record stays quiet; an owner request stands in engine mode.
export function emptiedAttention(record, { keepOwnerRequest = false } = {}) {
  const attention = record.attention && typeof record.attention === 'object' && !Array.isArray(record.attention) ? record.attention : null
  const out = {}
  if (attention && !(keepOwnerRequest && attention.type === OWNER_REQUEST)) Object.assign(out, { needs_attention: false, attention: null })
  else if (!attention && record.needs_attention) out.needs_attention = false
  if (Array.isArray(record.waiting_attention) ? record.waiting_attention.length : record.waiting_attention) out.waiting_attention = []
  if (record.outside_activity) out.outside_activity = null
  return out
}

// Shadow: the patch the job writes when it sees this fact first, plus the marker that tells the job the notice is still owed (not for a merge
// into another branch: "ships to everyone" would be untrue of it, and the job's own read has no other word for it). Null when the job would not
// write (a record it does not poll, a word already stored, a queue entry).
function shadowRecord(record, receipt, iso, baseDefault) {
  const word = RECEIPTS[receipt?.state]?.word
  if (!word || !onGithub(record) || !POLLED_WORDS.includes(record.status) || record.status === word) return null
  if (record.status === 'landing' && !FINISHED_WORDS.includes(word)) return null
  const next = { ...record, status: word, updated_at: iso }
  if (!FINISHED_WORDS.includes(word)) return next
  const owed = word === 'merged' && baseDefault === false ? {} : owedNotice(word)
  return { ...next, ...owed, needs_attention: false, attention: null, ...emptiedAttention({ ...record, needs_attention: false, attention: null }) }
}

// "Finished here, not told yet": the job's next pass sends the one merged or closed notice and closes out the follow-up
// grant for a record that carries this marker as `false`, then sets it. A record the job itself finished never has the key.
const owedNotice = word => (word === 'merged' ? { merged_announced: false } : word === 'closed' ? { closed_announced: false } : {})
const OWED_BY_STATE = { MERGED: 'merged', CLOSED: 'closed' }

// The same marker for an update that was waiting when the PR finished: it is stranded now, and the owner is not told and not asked until
// the job's next pass raises the request and sends the one "update could not be sent" notice. A record the job strands itself never has the key.
const owedStranded = step => (step.effects.some(effect => effect.region === 'update' && effect.effect === 'REQUEST_OWNER') ? { stranded_announced: false } : {})

// Whether the PR's base is the repository's default branch, as the PR read the screen holds says (`defaultBranchRef` is in api.js PR_FIELDS);
// null when it did not say, which the tables read as the default branch, exactly as before the field was read.
export function baseIsDefaultOf(pr) {
  const defaultBranch = pr?.repository?.defaultBranchRef?.name
  return typeof defaultBranch === 'string' && defaultBranch && typeof pr.baseRefName === 'string' && pr.baseRefName ? pr.baseRefName === defaultBranch : null
}

// A merged stack member lands in its parent's branch, not in the default one, whatever the read says; any other PR is as the read says (`known`).
const baseDefaultOf = (record, known) => (record.plan?.stack && typeof record.plan.stack === 'object' ? false : typeof known === 'boolean' ? known : null)

// Engine: the event the receipt confirms, offered to the record's lifecycle as the owner's. A state that does not accept it (a PR
// already merged, a record not yet sent) changes nothing. The effects it raises (the follow-up grant closed out, one notification)
// belong to whoever performs them: the job sees a finished PR and raises nothing again.
function engineRecord(record, receipt, now, iso, baseRef, baseDefault) {
  const entry = RECEIPTS[receipt?.state]
  const vector = entry && onGithub(record) ? vectorOf(record, now) : null
  if (!vector) return null
  const data = entry.event === 'MERGED' ? { base_is_default: baseDefault } : undefined
  const step = apply(TABLES, vector, { type: entry.event, source: 'owner', ...(data ? { data } : {}) }, now)
  if (step.refusal) return null
  const publication = step.vector.regions.publication.state
  const next = { ...record, lifecycle: step.vector, status: statusOf(TABLES, step.vector, record.status), updated_at: iso }
  if (publication === 'MERGED_ELSEWHERE' && baseRef) next.github_base_ref = baseRef
  const finished = ['MERGED', 'MERGED_ELSEWHERE', 'CLOSED'].includes(publication)
  return finished ? { ...next, ...owedNotice(OWED_BY_STATE[publication]), ...owedStranded(step), ...emptiedAttention(next, { keepOwnerRequest: true }) } : next
}

// The record as it should be stored after the receipt, or null when there is nothing to store.
export function recordAfterReceipt(record, receipt, { engine = false, now = nowSeconds(), iso = new Date(now * 1000).toISOString(), baseRef = '', baseIsDefault = null } = {}) {
  const baseDefault = baseDefaultOf(record, baseIsDefault)
  return engine ? engineRecord(record, receipt, now, iso, baseRef, baseDefault) : shadowRecord(record, receipt, iso, baseDefault)
}

// Store what a confirmed receipt did to the PR's contribution record. `rec` is the record the screen holds; the change is made to the
// record as the file holds it now. Never throws: the PR page has its own answer on screen, and the job's next pass settles whatever
// this could not write.
export async function writePullReceipt({ rec, receipt, baseRef = '', baseIsDefault = null }) {
  if (!rec?.id || !RECEIPTS[receipt?.state]) return { unchanged: true }
  try {
    const engine = lifecycleWriterOf(await loadAppSettings()) === 'engine'
    // The one checked write every record change goes through (storage.js). A record that no longer allows the change comes back as a
    // conflict that carries it; for a receipt that is "nothing to store", and only two lost races in a row stay a conflict.
    const outcome = await casWriteRecord({ rec, change: current => recordAfterReceipt(current, receipt, { engine, baseRef, baseIsDefault }) })
    return outcome.conflict ? { unchanged: true } : outcome
  } catch (error) {
    return { error: String(error?.message || error) }
  }
}
