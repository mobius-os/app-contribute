// What one agent review of one PR says now, read once for every screen. The result is a state of the
// lifecycle tables' "Agent review" region (lifecycle_tables.py REVIEW) with its label, whose turn it is and
// the next step, so the Review tab, the Desk frame, the Agent runs rows and the findings a Respond window
// carries cannot tell the same review four different ways. Pure: no DOM, no network.
//
// STALE and REPLACED are not read here: they say a later version or a later review exists, which is the PR's (collaboration.js
// reviewOfPull picks the review of the current version; the PR machine's `earlier` carries the older one). This reads one review.
//
// The saved item word (`state`) is what every writer and older readers know and it stays the source of
// truth; the platform's own `lifecycle` vector on the item only adds what the word cannot say (the review
// stalled without a result). An old platform sends no vector and the reading falls back to the word.
import { stateOf } from './lifecycle-record.js'

// States where the owner, not the agent, holds the next step.
export const OWNER_ITEM_STATES = new Set(['needs_you', 'failed', 'merge_unknown', 'ready_unknown', 'ready_unattributable', 'verdict_pending', 'verdict_unknown'])
export const REVIEW_STATE_NAMES = { reviewing: 'Reviewing', repairing: 'Fixing review findings', pushing: 'Sending scoped fix', marking_ready: 'Opening for review', ready_unknown: 'Readiness outcome needs checking', ready_unattributable: 'Readiness outcome needs checking', push_unknown: 'Fix outcome needs checking', pending: 'Waiting to review', all_clear: 'Review clear', needs_you: 'Needs you', merged: 'Merged', queued: 'In merge queue', failed: 'Failed', starting: 'Starting', merging: 'Merging', merge_unknown: 'Outcome needs checking', verdict_pending: 'Verdict waiting for you', verdict_posting: 'Submitting verdict', verdict_unknown: 'Verdict outcome needs checking', complete: 'Complete', stopped: 'Stopped', interrupted: 'Interrupted', paused: 'Paused', awaiting_owner: 'Waiting for your answer' }

// Execution belongs to the conversation; saved verdicts and public receipts survive it.
const SETTLED_ITEMS = new Set(['all_clear', 'merged', 'queued', 'complete'])
export const HALTED_RUNS = new Set(['stopped', 'failed', 'interrupted'])
export const reviewRunStateLabel = run => REVIEW_STATE_NAMES[run.execution_state] || REVIEW_STATE_NAMES[run.state] || run.state
export const reviewRunHalted = run => run.state !== 'complete' && HALTED_RUNS.has(run.execution_state)

// The reviewer named an obstacle that ended the review early (the platform's `blocked`: its words in the run itself, only `true`
// in a list). Such a review found nothing and decided nothing: it is not a result, and the PR is still to review.
export const reviewBlocked = item => !!item?.blocked

// ---- The owner's note that set a review's findings aside. It belongs to the review it was made on, not to the PR version: a
// later review of the same version is judged afresh. Notes written before runs were part of the key are filed by version only; they
// still count for the review they were made on, and are ignored by any review that began after them.
const versionKey = item => `${String(item.repo).toLowerCase()}#${item.number}@${item.head_sha}`
export const ignoreKey = (item, run = null) => (run?.id ? `${versionKey(item)}#${run.id}` : versionKey(item))
// The notes are kept by exact version, so they stay few: only the newest few hundred are remembered.
const MAX_IGNORE_NOTES = 200
export function withIgnoreNote(notes, item, reason, now = new Date().toISOString(), run = null) {
  const next = { ...notes, [ignoreKey(item, run)]: { reason, at: now } }
  return Object.fromEntries(Object.entries(next).sort(([, a], [, b]) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_IGNORE_NOTES))
}
// Undo takes back every note of this exact version: the review on screen is the one being undone.
export function withoutIgnoreNote(notes, item) {
  const version = versionKey(item)
  return Object.fromEntries(Object.entries(notes || {}).filter(([key]) => key !== version && !key.startsWith(`${version}#`)))
}

// When the review now on screen began: a run that pushed a fix reviews the new version
// from the moment you pressed Push, not from when the run itself started.
export function reviewStartedAt(run, item) {
  const pushes = (item?.repair_attempts || []).filter(entry => entry.state === 'pushed').map(entry => entry.decided_at)
  return [run?.created_at, ...pushes].filter(Boolean).sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] || null
}

// A note with no time, or a review with none, cannot be compared, so the note stands.
function madeBefore(note, run, item) {
  const at = Date.parse(note?.at || '')
  const began = Date.parse(reviewStartedAt(run, item) || '')
  return Number.isFinite(at) && Number.isFinite(began) && at < began
}

// The owner's note setting aside this review's findings, if there is one for them. With the run, only a note made on this very
// review (or a version-only note made after it began) counts. Without the run it cannot tell reviews of one version apart, so any
// note of the version counts: a screen that knows the run must pass it.
export function ignoredNote(item, ignored, run = null) {
  if (item.state !== 'needs_you' || !ignored) return null
  if (!run) return ignored[versionKey(item)] || Object.entries(ignored).find(([key]) => key.startsWith(`${versionKey(item)}#`))?.[1] || null
  const made = ignored[ignoreKey(item, run)]
  if (made) return made
  const older = ignored[versionKey(item)]
  return older && !madeBefore(older, run, item) ? older : null
}

// ---- The reading.
const WORKING = new Set(['reviewing', 'pending', 'starting'])
// What the platform's own table makes of a saved word (contribution_review_lifecycle.py RESULT_EVENTS): the review has reported.
const CLEAR_WORDS = new Set(['all_clear', 'merging', 'merge_unknown', 'queued', 'merged', 'complete'])
const PROBLEM_WORDS = new Set(['repairing', 'pushing', 'push_unknown'])
// The step each owner-held state leaves the owner.
const NEXT = { STALLED: 'review_again', NOT_FINISHED: 'review_again', ASKS: 'answer' }

// The platform's vector says the review stalled while its word still says it works (the review timed out, or its chat ended).
const stalledByPlatform = item => WORKING.has(item.state) && stateOf(item.lifecycle, 'review') === 'STALLED'

function regionOf(run, item, { waived, closed, halted, waiting }) {
  if (waived) return 'SET_ASIDE'
  if (closed) return 'ANSWERED'
  if (halted) return run.execution_state === 'stopped' && !stalledByPlatform(item) ? 'STOPPED' : 'STALLED'
  if (waiting) return 'ASKS'
  if (item.state === 'needs_you') return reviewBlocked(item) ? 'NOT_FINISHED' : 'PROBLEMS'
  if (CLEAR_WORDS.has(item.state)) return 'CLEAR'
  if (PROBLEM_WORDS.has(item.state)) return 'PROBLEMS'
  return WORKING.has(item.state) ? 'REVIEWING' : null
}

// `turn` says whose move the review leaves on its PR: 'agent' while it works, 'owner' while a decision, an answer or a fix waits
// on you, 'author' once your review is out and the PR's author is next, 'none' once it is settled. The saved word needs_you is what
// the review FOUND; the verdict receipts say what you already did about it, and only they can hand the move to the author.
// GitHub refuses a verdict on your own PR, so a posted verdict is always on someone else's. A posted plain review hands a PR over
// only when `own` is known to be false; null (unknown) never does.
// `ignored` is the owner's notes of findings set aside: a finding set aside on this review no longer waits on them.
// `answered` is whether a reply posted at this version covers the findings (pr-facts.js findingsAnswered).
export function reviewReading(run, item, { own = null, ignored = null, answered = false } = {}) {
  const found = item.state === 'needs_you'
  const verdict = item.verdict_proposal
  const requested = found && verdict?.state === 'posted' && verdict.event === 'REQUEST_CHANGES'
  // Any verdict that reached GitHub settles the findings: the owner said what they wanted to say, whichever it was.
  const handedOver = found && (verdict?.state === 'posted' || (own === false && !verdict && item.public_review?.state === 'posted'))
  const dropped = found && verdict?.state === 'discarded'
  const waived = !handedOver && !!ignoredNote(item, ignored, run)
  const closed = !handedOver && !waived && found && answered
  const settled = SETTLED_ITEMS.has(item.state) || handedOver || dropped || waived || closed
  const halted = !settled && (HALTED_RUNS.has(run.execution_state) || stalledByPlatform(item))
  const waiting = !settled && run.execution_state === 'awaiting_owner'
  const state = regionOf(run, item, { waived, closed, halted, waiting })
  const label = requested ? 'Changes requested' : handedOver ? 'Review posted' : dropped ? 'Verdict discarded' : waived ? 'Set aside' : closed ? 'Answered'
    : halted || reviewBlocked(item) ? 'Not finished' : REVIEW_STATE_NAMES[item.state] || item.state
  // A review you stopped asks nothing of you (the table's STOPPED); one that stalled is the owner's move.
  const turn = handedOver ? 'author' : settled || state === 'STOPPED' ? 'none' : halted || waiting || OWNER_ITEM_STATES.has(item.state) ? 'owner' : 'agent'
  return { state, label, turn, next: NEXT[state] || '', halted, waiting, settled }
}

// The fields the screens that predate the reading ask for; the reading itself is `reviewReading`.
export function reviewItemProgress(run, item, context) {
  const { label, halted, waiting, settled, turn } = reviewReading(run, item, context)
  return { label, halted, waiting, settled, turn }
}
