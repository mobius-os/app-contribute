// Pure logic for the autopilot mirror: reading the ledger's display-only
// `autopilot` block, classifying which attention events autopilot handles, and
// narrating round state for the card. No React, no I/O.
//
// The `autopilot` block on a record is a ONE-WAY MIRROR the platform writes
// after every lifecycle transition (the source of truth is a platform DB row
// the app can't see or write). The app reads it only to render state; every
// action (Send grant, Pause/Resume, Retry) goes through a platform endpoint.
// Shape:
//   { enabled, granted_at, state: 'idle'|'responding'|'blocked', rounds_used,
//     push_mode?: 'auto'|'ask', last_round?: { finished_at, outcome, summary }, rounds: [ ... ] }
// `push_mode` says who publishes a fix: 'auto' (the agent pushes it; also every grant from before the
// mode existed) or 'ask' (the agent prepares it and the owner's Update PR press publishes it).
import { NAMES } from './names.js'

// Attention types the background loop can handle on its own. Anything else
// (or a paused/ungranted record) falls back to the classic notify path.
// `outside_activity` (a comment or review from someone who is not a repository
// owner, member or collaborator) is deliberately absent: strangers cannot start
// a round. job.sh classifies authors through github_events.py.
export const ACTIONABLE_ATTENTION = new Set([
  'changes_requested',
  'checks_failed',
  'github_activity',
])

// The escalation flag the platform sets when the agent must hand back to a
// human. This is the ONLY attention type that still notifies for an autopilot
// record (alongside merged/closed).
export const HUMAN_REQUIRED = 'human_required'

export function autopilotState(rec) {
  if (!rec || typeof rec !== 'object') return null
  const block = rec.autopilot
  return block && typeof block === 'object' ? block : null
}

export function isAutopilotEnabled(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled)
}

// True while a background round is actively working this record.
export function isAutopilotResponding(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled && block.state === 'responding')
}

// True when the platform stopped following this record (state 'blocked': the
// agent handed it back) and keeps the grant until the owner resumes it. Nothing
// works the record meanwhile, so it is never "being handled".
export function isAutopilotBlocked(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled && block.state === 'blocked')
}

// What a blocked record says when the agent left no note of its own.
export const BLOCKED_REASON = 'The follow-up agent stopped and is waiting for you.'

// Whether this kind of attention is work an agent can handle. This capability
// is deliberately independent from the current autopilot grant: an ungranted
// record still belongs to Contribute's one private run rather than becoming a
// misleading human decision.
export function canAgentHandleAttention(rec) {
  const attention = rec && rec.attention
  const type = attention && attention.type
  if (type === HUMAN_REQUIRED) return false
  return typeof type === 'string' && ACTIONABLE_ATTENTION.has(type)
}

// Whether autopilot owns this record's current attention right now. Used by
// the UI to decide whether to show "autopilot will handle this" vs private-run
// work; job.sh makes the same decision server-side to route to /respond.
export function isActionableAttention(rec) {
  const block = autopilotState(rec)
  return !!(block && block.enabled && !isAutopilotBlocked(rec) && canAgentHandleAttention(rec))
}

// True when the record is waiting on the human (escalated). Leads the card with
// the human_required callout even for a granted record.
export function needsHuman(rec) {
  const attention = rec && rec.attention
  return !!(rec && rec.needs_attention && attention &&
    attention.type === HUMAN_REQUIRED)
}

// How a followed record stands: null without a grant, otherwise whether it is paused and who publishes a fix.
export function followState(rec) {
  const block = autopilotState(rec)
  return block ? { paused: !block.enabled, mode: block.push_mode === 'ask' ? 'ask' : 'auto' } : null
}

// A PR that was sent without following can still be followed while it is open, unless it is part of a stack
// (the platform refuses both; the menu does not offer what it would refuse).
const FOLLOWABLE_STATUS = new Set(['open', 'draft'])
export const canStartFollowing = rec => !!rec && rec.type === 'pr' && FOLLOWABLE_STATUS.has(rec.status)
  && !(rec.plan?.stack && typeof rec.plan.stack === 'object')

// What one choice on the Follow window asks the platform for: 'paused', or a push mode. `pushMode` is named only
// when it is new authority (a first grant, or another mode), which is what Möbius's own sheet confirms; a resume
// in the grant's own mode names none, so it stays the plain Pause/Resume call.
export function followChange(rec, choice) {
  if (choice === 'paused') return { enabled: false }
  const state = followState(rec)
  const mode = choice === 'ask' ? 'ask' : 'auto'
  return state?.mode === mode ? { enabled: true } : { enabled: true, pushMode: mode }
}

// Where a followed record stands, as one word the two wordings below share. A `prepared` round counts only
// while its update still waits for the owner: once Update PR is pressed the record is open again.
function followPhase(rec, block) {
  if (needsHuman(rec)) return 'needs_you'
  if (isAutopilotBlocked(rec)) return 'stopped'
  if (block.state === 'responding') return 'working'
  const outcome = block.last_round?.outcome
  if (outcome === 'prepared') return rec.status === 'prepared' ? 'prepared' : 'on'
  if (outcome === 'stale' || outcome === 'failed') return 'retry'
  return ['pushed', 'replied', 'escalated'].includes(outcome) ? outcome : 'on'
}

const NARRATION = {
  stopped: BLOCKED_REASON,
  working: 'Autopilot is responding to a review — no action needed.',
  prepared: 'Autopilot prepared a fix. Press Update PR to publish it.',
  pushed: 'Autopilot pushed a fix for the last review.',
  replied: 'Autopilot replied to the last review.',
  retry: 'Autopilot will retry the last review shortly.',
  escalated: 'Autopilot handed this back to you.',
  on: 'Autopilot is on — it will handle new reviews for you.',
}

// One plain-language line describing what autopilot is doing / last did. Returns
// '' when there is nothing autopilot-specific to say (caller omits the line).
export function autopilotNarration(rec) {
  const block = autopilotState(rec)
  if (!block || !block.enabled) return ''
  const phase = followPhase(rec, block)
  if (phase !== 'needs_you') return NARRATION[phase]
  const msg = rec.attention && rec.attention.message
  return msg ? String(msg) : 'Autopilot needs your input to continue.'
}

// What following does with a fix, by push mode: the detail under the menu row and the resting Following line.
export const FOLLOW_MODE_WORDS = { ask: 'Asks before each push', auto: 'Pushes on its own' }

const FOLLOWING = {
  needs_you: 'stopped and waits for your decision',
  stopped: 'stopped and waits for you to resume',
  working: 'an agent is answering the review now',
  prepared: 'a fix is ready for you: press Update PR',
  pushed: 'pushed a fix for the last review',
  replied: 'replied to the last review',
  retry: 'will try the last review again shortly',
  escalated: 'handed the last review back to you',
}

// The quiet Following line of the PR page: { label, text } for a followed record, or null. The label says what is
// true (Following, or Paused) and the text is what it last did, or how it publishes a fix while nothing happened yet.
export function followingLine(rec) {
  const state = followState(rec)
  if (!state) return null
  if (state.paused) return { label: NAMES.followPaused, text: 'nothing is answered until you resume' }
  const phase = followPhase(rec, autopilotState(rec))
  return { label: NAMES.following, text: FOLLOWING[phase] || FOLLOW_MODE_WORDS[state.mode].toLowerCase() }
}

// The rounds timeline for the card detail view. Newest first, each entry a
// plain-text {when, label, summary} — summaries are rendered WITHOUT markdown
// (they may quote untrusted reviewer text).
export function autopilotRounds(rec) {
  const block = autopilotState(rec)
  const rounds = block && Array.isArray(block.rounds) ? block.rounds : []
  const labelFor = (outcome) => {
    switch (outcome) {
      case 'pushed': return 'Pushed a fix'
      case 'replied': return 'Replied to review'
      case 'prepared': return 'Prepared a fix'
      case 'stale': return 'Round timed out'
      case 'failed': return 'Round failed'
      case 'escalated': return 'Handed to you'
      default: return 'Round'
    }
  }
  return rounds
    .slice()
    .reverse()
    .map((round) => ({
      when: String(round.finished_at || round.started_at || ''),
      label: labelFor(round.outcome),
      summary: typeof round.summary === 'string' ? round.summary : '',
    }))
}
