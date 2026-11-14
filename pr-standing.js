// How a PR's machine decision (pr-machine.js) shows on a row: the comet frame
// and the chip. Pure, so rows, the desk and the PR page cannot disagree.
import { prFacts } from './pr-facts.js'
import { decide } from './pr-machine.js'
import { responseView } from './respond-result.js'
import { NAMES } from './names.js'

// A saved answer makes Respond to feedback a second pass: the action says so and what it replaces. The machine's own decision is
// otherwise untouched; this only words the one action, so the menu and the panel stay in agreement.
function secondPass(decision, view) {
  if (!['ready', 'stale'].includes(view?.status)) return decision
  const again = { title: NAMES.respondAgain, detail: 'Replaces the waiting answer. It does not review again.' }
  return { ...decision, actions: decision.actions.map(action => (action.id === 'respond' ? { ...action, ...again } : action)) }
}

export const standingFor = ({ pr, login, runs = [], ignored = null, chats = [], responses = [] }) => secondPass(decide(prFacts({ pr, login, runs, ignored, chats, responses })), responseView(responses, pr))

// States that exist because of a Contribute review: they hold the amber frame.
const REVIEW_MOVES = new Set(['to_confirm', 'unconfirmed', 'needs_answer', 'stalled', 'author.findings', 'reviewer.result_ready', 'reviewer.re_review'])
// A PR's ordinary resting states say nothing a row needs to repeat.
const QUIET = new Set(['reviewer.to_review', 'reviewer.draft', 'author.draft', 'author.waiting_review', 'merged', 'closed', 'working'])
const TONE = { you: 'owner', other: 'waiting', none: 'plain', agent: 'plain' }

export function frameOf(decision) {
  if (decision.turn === 'agent') return 'reviewing'
  return REVIEW_MOVES.has(decision.state) ? 'verdict' : 'idle'
}

// A resting state has no step for anyone here and no agent at work: the PR page says it in the state badge and draws no panel.
export const isResting = decision => QUIET.has(decision.state) && (decision.turn === 'other' || decision.turn === 'none')

// Your own PR that has gone to its reviewers (a first review, a look at fixes, a look at an approval that is old): what the
// Waiting on others block under Needs you lists. A first review nobody was asked for is the owner's own step, not a wait on others.
// Only that state reads "no pending request" as "never asked": after a review has been given, the request is spent by that review, so
// zero pending requests there (fixes pushed, an old approval) still means the PR waits on the reviewer to look again.
const WAITS_ON_REVIEWERS = new Set(['author.waiting_review', 'author.waiting_rereview', 'author.approval_stale'])
export const waitsOnReviewers = decision => WAITS_ON_REVIEWERS.has(decision.state) && !(decision.state === 'author.waiting_review' && decision.nobodyAsked)

export const chipOf = decision => (QUIET.has(decision.state) ? null : { label: decision.label, tone: TONE[decision.turn] })
