// A saved Respond-to-feedback answer as the lifecycle's `respond` region (lifecycle_tables.py RESPOND). Pure: no clock of its own,
// no storage, no React. The result file belongs to the helper and the decision file to the app, so nothing here writes either:
// the region is read from the words they already hold (RESPOND_WORDS) and from the helper's own stamp, the optional
// `lifecycle` key of the result (respond_lifecycle.py), and every deadline that has passed takes effect when an answer is loaded.
// `now` is whole seconds, like the engine's.
import { allowed, newVector, waitingOn } from './lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'
import { catchUp } from './lifecycle-catch-up.js'
import { POSTING_SILENCE_MINUTES, decisionOf } from './respond-result.js'

const REGION = 'respond'

// THE TABLE of this host, both directions. `words` are the stored words an answer has in that state: `state` is the helper's word
// in respond-results/<slug>.json, `decision` is the app's word in respond-decisions/<slug>.json (null: none, or one that names another
// answer), `moved` is whether the PR head left the version the answer was built on. The first row whose words all match is the
// state; the same row, read the other way, says what to store. Existing files stay readable: no word is new, and the state word
// stays what older readers expect (`ready`, `posting`, `failed`, `posted`).
export const RESPOND_WORDS = [
  { region: 'POSTED', words: { state: 'posted' } },
  { region: 'POSTING', words: { state: 'posting' } },
  { region: 'FAILED', words: { state: 'failed' } },
  { region: 'DISCARDED', words: { state: 'ready', decision: 'discarded' } },
  { region: 'OUT_OF_DATE', words: { state: 'ready', moved: true } },
  { region: 'APPROVED', words: { state: 'ready', decision: 'approved' } },
  { region: 'READY', words: { state: 'ready' } },
]
// Waiting out the first 30 seconds or not, an approved answer is stored the same way: only the clock tells them apart.
const SAME_WORDS = { NOT_STARTED: 'APPROVED' }

const matches = (words, found) => Object.entries(words).every(([key, value]) => found[key] === value)

export const respondStateOf = found => RESPOND_WORDS.find(row => matches(row.words, found))?.region ?? null

// The words to store for a state (NONE has no file at all).
export const wordsOfRespond = region => RESPOND_WORDS.find(row => row.region === (SAME_WORDS[region] || region))?.words ?? null

const nowSeconds = () => Math.floor(Date.now() / 1000)
const seconds = text => { const at = Date.parse(text || ''); return Number.isFinite(at) ? Math.floor(at / 1000) : null }

// When the helper last completed a step, as far as the words say: what it receipted, or when the owner pressed Post. Used only for a
// post that no stamp covers (one the helper started before it stamped).
function lastProgress(entry) {
  const { receipts } = entry.result
  const pressed = decisionOf(entry) === 'approved' ? entry.decision : null
  const items = [receipts.push, receipts.screenshots, receipts.description, receipts.rerequest, ...receipts.replies, pressed]
  const known = items.map(item => seconds(item?.at)).filter(at => at !== null)
  return known.length ? Math.max(...known) : null
}

// Where the region's clock starts when nothing stored says. An answer whose age cannot be read starts now: it is never made to
// expire on a guess.
function sinceOf(entry, region, now) {
  if (region === 'APPROVED') return seconds(entry.decision?.at) ?? now
  if (region === 'POSTING') return lastProgress(entry) ?? now
  return seconds(entry.result.created_at) ?? now
}

// The helper's stamp for this very state, or null: another state, another table version or a malformed stamp is ignored.
function stampedSlot(result, region) {
  const stamp = result.lifecycle
  const slot = stamp?.v === TABLES.version ? stamp.regions?.[REGION] : null
  const whole = value => Number.isInteger(value)
  return slot?.state === region && whole(slot.since) && (slot.deadline === null || whole(slot.deadline)) ? slot : null
}

function seeded(entry, region, now) {
  const slot = stampedSlot(entry.result, region)
  if (!slot) return newVector(TABLES, { [REGION]: region }, sinceOf(entry, region, now), false)
  const history = Array.isArray(entry.result.lifecycle.history) ? entry.result.lifecycle.history : []
  return { v: TABLES.version, regions: { [REGION]: { state: region, since: slot.since, deadline: slot.deadline } }, history }
}

const moved = (result, pr) => Boolean(pr?.headRefOid) && pr.headRefOid !== result.pr.head_sha

// -> { vector, effects }. `entry` is { result, decision } as respond-store.js loads it; `pr` (optional) lets an answer the PR moved
// past read OUT_OF_DATE. Nothing is stored. The effects are for the caller: RELEASE_LOCK needs nothing here (the helper's lock
// belongs to its process and goes with it), KEEP_RECEIPTS is true of any answer shown (receipts are never touched), REQUEST_OWNER
// is the "your move" the selectors below report.
export function respondVectorOf(entry, { pr = null, now = nowSeconds() } = {}) {
  const { result } = entry
  const region = respondStateOf({ state: result.state, decision: decisionOf(entry), moved: moved(result, pr) }) || 'READY'
  return catchUp(seeded(entry, region, now), now)
}

export const respondStateAt = (entry, options) => respondVectorOf(entry, options).vector.regions[REGION].state

const stalled = () => ({ step: 'posting', message: `Nothing new went out for ${POSTING_SILENCE_MINUTES} minutes, so the post is taken as stopped.` })

// The answer as a screen should read it after the lazy tick. No PR is given here, so `lifecycle` never says OUT_OF_DATE: a screen that
// has the PR reads that with respondVectorOf(entry, { pr }). A post that made no progress for its whole deadline is FAILED:
// the words say `failed` (with the receipts of what went out, untouched), so every reader that understands the old words understands
// it, and Try again is offered. Everything else is as stored. `lifecycle` carries the region for the readers that want it.
export function settleResponse(entry, options) {
  const { vector } = respondVectorOf(entry, options)
  const timedOut = vector.regions[REGION].state === 'FAILED' && entry.result.state === 'posting'
  const result = timedOut ? { ...entry.result, state: 'failed', error: entry.result.error ?? stalled() } : entry.result
  return { ...entry, result, lifecycle: vector }
}

// What the answer waits on, or []: the rows of engine.waitingOn for this region.
export const respondWaitingOn = (entry, options) => waitingOn(TABLES, respondVectorOf(entry, options).vector)

// Whether the owner may take the approval back now: only from NOT_STARTED, so never while the chat is still expected to start and
// never once the helper has begun.
export const canWithdraw = (entry, options) => allowed(TABLES, respondVectorOf(entry, options).vector, 'WITHDRAW')
