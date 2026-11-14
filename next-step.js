// The PR page's next-step panel and the word beside its state badge (findings 1, 10 and 13), and the same step for a desk row. They only read
// the PR machine's decision (pr-machine.js): the pill says what is true, the hint is
// the machine's own sentence, and the one filled button is the next step it names.
// Pure, so every state's panel is tested without a browser.
import { NAMES } from './names.js'
import { mayRunYourAction, requestReviewButton, AGENT_INTENTS } from './actions-menu.js'
import { frameOf, isResting } from './pr-standing.js'

// How each next step runs. 'menu' goes through the same handler as the Actions menu
// (its confirm sheet or review window); 'review' opens the Review tab, where the
// verdict card, the draft and the stopped run live; 'sync' reads GitHub again.
const ROUTES = {
  check_my_pr: 'menu', respond: 'menu', review: 'menu', open_for_review: 'menu', merge: 'menu', ask_approval: 'menu',
  rerun_job: 'menu',
  draft_verdict: 'review', send_draft: 'review', check_github: 'review',
  retry: 'sync',
}
// Where the machine's own action title would be a sentence, the button says the job.
const TITLES = { draft_verdict: 'See the review', send_draft: 'Read the draft', retry: NAMES.sync }

// A next step answered on another tab, with no button here. An agent's question is answered in the Review tab,
// the one place its conversation is offered, so the panel only says where. The pointer is its own line: the
// hint stays the machine's sentence, which its twin in the platform must read the same.
const POINTERS = { open_job: 'Answer it in the Review tab.' }

// A stopped job starts over as the same job through the Actions menu's own window: the machine lets
// a stalled job be run again, and nothing else is working on the PR. Which menu action that is depends
// on the job's kind and whose PR it is (review_fix_merge is Finish it for me on yours, Take over on theirs).
const RERUN_ACTION = {
  review: { author: 'check_my_pr', reviewer: 'review' }, review_merge: { author: 'check_my_pr', reviewer: 'review' },
  respond: { author: 'respond', reviewer: 'respond' }, fix: { author: 'respond', reviewer: 'respond' },
  review_fix_merge: { author: 'finish_it', reviewer: 'take_over' },
}
const actionToRun = decision => (decision.next === 'rerun_job' ? RERUN_ACTION[decision.jobKind]?.[decision.role] || 'review' : decision.next)

const GOOD_STATES = new Set(['author.draft_ready', 'author.approved', 'reviewer.mergeable'])
const BAD_STATES = new Set(['author.blocked', 'unconfirmed', 'unknown'])

// The pill's colour: one meaning each. Amber = an agent job stopped or waits on a decision of
// yours, purple = your move, red = blocked, green = ready, grey = nothing for you to do.
export function pillTone(decision) {
  if (BAD_STATES.has(decision.state)) return 'blocker'
  if (GOOD_STATES.has(decision.state)) return 'ready'
  if (frameOf(decision) === 'verdict') return 'waiting'
  return decision.turn === 'you' ? 'you' : 'quiet'
}

// { pill, hint, pointer, primary } for the panel under the facts line, or null for a resting state, which the
// state badge already says. `primary` is null when the
// next step is not yours to take, cannot run yet (the menu says why), or this Möbius
// cannot run it for you.
export function nextStepModel(decision, { record = null, capabilities = null } = {}) {
  if (!decision || isResting(decision)) return null
  const action = decision.actions.find(item => item.id === actionToRun(decision))
  const route = ROUTES[decision.next]
  const allowed = action?.enabled && route && (route !== 'menu' || AGENT_INTENTS.has(action.id) || mayRunYourAction(action.id, { record, capabilities }))
  // The button keeps the words of the machine's own next step (Review again, Run it again), whichever action runs.
  const title = TITLES[decision.next] || decision.actions.find(item => item.id === decision.next)?.title || action?.title
  return {
    pill: { label: decision.label, tone: pillTone(decision) },
    hint: decision.headline,
    pointer: POINTERS[decision.next] || '',
    primary: allowed ? { intent: action.id, route, title } : null,
  }
}

// What the state badge adds to "Open": Approved is an approval of this exact version by someone other than
// the author (the machine's own count), a resting state is the machine's own label ("Waiting on reviewers"),
// and anything else is In review. A draft, merged or closed PR already says so in the badge.
export function stageWord(pr, decision) {
  if (!decision || pr?.isDraft || pr?.mergedAt || (pr?.state && pr.state !== 'OPEN')) return ''
  if (decision.approvedBy?.length) return 'Approved'
  return isResting(decision) ? decision.label : 'In review'
}

// What a desk row can be swiped to: the PR page's own next-step button (its intent and route), where it opens a window,
// a sheet or a tab. A step that only reads GitHub again (Sync) is not worth a swipe.
export function rowStep(decision, { record = null, capabilities = null } = {}) {
  const primary = nextStepModel(decision, { record, capabilities })?.primary
  return primary && primary.route !== 'sync' ? primary : null
}

// The ask a PR that waits on its reviewers can be given again: the first of these the PR machine offers and this Möbius can run,
// as the intent of the sheet it opens (Ask for re-review, Ask for approval, Request review); null when none, so no button shows.
const ASK_AGAIN = ['ask_rereview', 'ask_approval', 'request_review']
const canAsk = (decision, id, capabilities) => (id === 'request_review'
  ? requestReviewButton(decision, { capabilities })?.off === false
  : !!decision.actions.find(action => action.id === id)?.enabled && mayRunYourAction(id, { capabilities }))
export const askAgainIntent = (decision, { capabilities = null } = {}) => ASK_AGAIN.find(id => canAsk(decision, id, capabilities)) || null
