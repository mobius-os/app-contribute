// What the Actions menu offers for the PR(s) in front of it. It only lays out
// the PR machine's decision (pr-machine.js): the header says where the PR
// stands, then what you can do yourself ("You") and what an agent can do
// ("Agent"). The highlighted choice comes first; a choice that cannot run stays
// in place, dimmed, with the machine's reason.
import { checkSummary, conversationCount } from './collaboration.js'
import { isPersonalDraft } from './domain.js'
import { allowedMergeMethods } from './action-copy.js'
import { ownerConfirmOffered } from './owner-grant.js'
import { FOLLOW_MODE_WORDS, canStartFollowing, followState } from './autopilot.js'
import { NAMES } from './names.js'

// The agent jobs and your own actions the menu shows, by machine action id, in
// their fixed order. Take over sits apart at the bottom: it is rare and deliberate.
export const AGENT_MENU = { check_my_pr: 'review', respond: 'reply', finish_it: 'fix', review: 'review', take_over: 'takeover' }
const YOUR_MENU = { open_for_review: 'send', back_to_draft: 'draft', ask_rereview: 'person', ask_approval: 'person', merge: 'merge', close: 'close' }
// Each of your actions exists only where this Möbius can do it for you.
const CAPABILITY = { open_for_review: 'mark_ready_now', back_to_draft: 'back_to_draft_now', ask_rereview: 'request_rereview_now', ask_approval: 'ask_approval_now', merge: 'merge_now', close: 'close_now' }
// Request review asks anyone, not just people who reviewed, and has a button of its own beside Actions: it is a menu row
// only once someone was asked (anotherReview).
const OWN_BUTTON = { request_review: 'request_review_now' }
export const YOUR_INTENTS = new Set([...Object.keys(YOUR_MENU), ...Object.keys(OWN_BUTTON)])
// Not a machine action: Merge's way to choose how it lands first, on the Merge row itself. It exists only where Möbius confirms Merge on its own sheet, which
// has no such choice, so Merge itself lands the way the repository prefers; see withMergeOptions.
export const MERGE_OPTIONS = 'merge_options'
export const AGENT_INTENTS = new Set(Object.keys(AGENT_MENU))
// Not a machine action either: following is a standing permission, not a job on this version, so the machine (and its twin in
// the platform) knows nothing of it. The row exists only where this Möbius can switch following on after a PR was sent.
export const FOLLOW = 'follow'
const FOLLOW_CAPABILITY = 'follow_after_send'

// One line of facts about a PR: checks and conflicts. Where it stands (a draft, who reviewed) is the machine's label or
// sentence beside it; only a PR with no decision yet falls back to GitHub's own draft flag and review count.
export function pullHeader(pr, decision = null) {
  const checks = checkSummary(pr)
  const parts = [
    !decision && pr?.isDraft ? 'draft' : '',
    decision || conversationCount(pr) ? '' : 'no reviews',
    checks?.failed > 0 ? `${checks.failed} failing ${checks.failed === 1 ? 'check' : 'checks'}`
      : checks?.state === 'success' ? 'checks passing' : checks?.state === 'pending' ? 'checks running' : '',
    pr?.mergeable === 'CONFLICTING' ? `conflicts with ${pr.baseRefName || 'the target branch'}` : '',
  ]
  return { label: `#${pr.number}`, text: parts.filter(Boolean).join(' · ') }
}

// Closing is the one destructive row: it is set apart, last, and never takes the first focus.
const DESTRUCTIVE = new Set(['close'])
const asItem = (action, icon) => ({ intent: action.id, icon, title: action.title, detail: action.detail, rec: action.highlighted, off: !action.enabled, reason: action.reason, danger: DESTRUCTIVE.has(action.id) })

// Whether this Möbius can run one of your own actions for you (the menu lists it, the next-step button offers it).
export const mayRunYourAction = (id, { record, capabilities }) => !!YOUR_MENU[id]
  && (capabilities?.[CAPABILITY[id]] === true || (id === 'open_for_review' && isPersonalDraft(record)))

// The Request review button of the PR page: absent where this Möbius cannot do it or the PR is not your own,
// dimmed with the machine's reason where it cannot run now.
export function requestReviewButton(decision, { capabilities } = {}) {
  const action = decision?.actions?.find(item => item.id === 'request_review')
  return action && capabilities?.[OWN_BUTTON.request_review] === true ? { off: !action.enabled, reason: action.reason } : null
}

// Someone was already asked: the page's own button steps aside, and the menu offers asking one more.
export const reviewRequested = pr => pr?.reviewRequests?.totalCount > 0
function anotherReview(decision, pr, capabilities) {
  const offer = reviewRequested(pr) ? requestReviewButton(decision, { capabilities }) : null
  return offer ? [{ intent: 'request_review', icon: 'plus', title: NAMES.requestAnotherReview, detail: 'Asks more people to review it on GitHub.', rec: false, off: offer.off, reason: offer.reason, danger: false }] : []
}

// The same for a selection of PRs (the tray beside Assign): every PR must be your own and able to ask, and in one repository,
// because one list of people is offered for all of them.
export function requestReviewForMany(decisions, pulls, { capabilities } = {}) {
  const offers = decisions.map(decision => requestReviewButton(decision, { capabilities }))
  if (capabilities?.[OWN_BUTTON.request_review] !== true) return null
  if (offers.some(offer => !offer)) return { off: true, reason: 'Only your own PRs can ask for a review.' }
  const stopped = offers.find(offer => offer.off)
  if (stopped) return stopped
  const repos = new Set(pulls.map(pr => pr.repository?.nameWithOwner?.toLowerCase()))
  return repos.size > 1 ? { off: true, reason: 'Choose PRs of one repository.' } : { off: false, reason: '' }
}

// A row that would change nothing is left out: Open for review on an open PR, Back to draft on a draft, and an Ask with nobody to
// ask. The machine keeps all of them (its twin in the platform refuses nothing here); only the menu drops the row.
const ASKS = new Set(['ask_rereview', 'ask_approval'])
const changesNothing = (action, pr) => (action.id === 'open_for_review' && !pr.isDraft)
  || (action.id === 'back_to_draft' && !!pr.isDraft)
  || (ASKS.has(action.id) && !action.enabled)

function yourItems(decision, pr, { record, capabilities }) {
  const rows = decision.actions.filter(action => mayRunYourAction(action.id, { record, capabilities }) && !changesNothing(action, pr))
    .map(action => asItem(action, YOUR_MENU[action.id]))
  return [...rows, ...anotherReview(decision, pr, capabilities)]
    .sort((a, b) => Number(a.danger) - Number(b.danger) || Number(b.rec) - Number(a.rec))
}

// The second, smaller choice on the Merge row, and off for the same reason when Merge is off.
function withMergeOptions(items, pr, capabilities) {
  if (!ownerConfirmOffered(capabilities) || allowedMergeMethods(pr.repository).length < 2) return items
  const side = { intent: MERGE_OPTIONS, title: NAMES.mergeOptions, detail: 'Choose how it lands.' }
  return items.map(item => (item.intent === 'merge' ? { ...item, side } : item))
}

// Follow this PR, on your own PR that Contribute sent: the row starts it, or says how it is followed now. A PR with no
// record of ours, or one the platform would refuse (closed, part of a stack), has no row.
function followItems(decision, record) {
  const state = followState(record)
  if (decision.role !== 'author' || !(state || canStartFollowing(record))) return []
  const detail = !state ? 'An agent answers reviews and failing checks for you.' : state.paused ? 'Paused' : FOLLOW_MODE_WORDS[state.mode]
  return [{ intent: FOLLOW, icon: 'cycle', title: state ? NAMES.following : NAMES.followPr, detail, rec: false, off: false, reason: '', danger: false }]
}

// Where following can start after Send it replaces Finish it for me in the menu: both leave an agent on the PR until it is
// done, and following is the one the owner can pause and steer. The machine keeps finish_it, so a stopped job of that kind
// still starts again from the next-step button.
function agentItems(decision, { record, capabilities }) {
  const follows = capabilities?.[FOLLOW_CAPABILITY] === true
  const items = decision.actions.filter(action => AGENT_MENU[action.id] && !(follows && action.id === 'finish_it')).map(action => asItem(action, AGENT_MENU[action.id]))
  const rare = items.filter(item => item.intent === 'take_over')
  const usual = items.filter(item => item.intent !== 'take_over').sort((a, b) => Number(b.rec) - Number(a.rec))
  return [...usual, ...(follows ? followItems(decision, record) : []), ...rare]
}

// Several PRs at once: only a review (a private check on your own PRs) can run
// as a batch, and only when every selected PR allows it. The dimmed reason names the PR that blocks it.
function batchItems(list, decisions) {
  const reasons = decisions.map(decision => decision.actions.find(action => ['review', 'check_my_pr'].includes(action.id))?.reason || '')
  const blocked = reasons.findIndex(Boolean)
  const reason = blocked < 0 ? '' : `#${list[blocked].number}: ${reasons[blocked]}`
  return [{ intent: 'review', icon: 'review', title: 'Review each', detail: 'Your own PRs are only checked privately.', rec: false, off: !!reason, reason }]
}

// `decisions` line up with `pulls` (one machine decision each). Returns { header, standing, headline, you, agent }: `standing` is the
// machine's short label and `headline` its sentence (a menu shows one of the two), and a row's `side` is a second choice on that row.
export function actionsMenuModel(pulls, decisions, { record = null, capabilities = null } = {}) {
  const list = (Array.isArray(pulls) ? pulls : []).filter(Boolean)
  if (list.length !== 1) return { header: list.length ? { label: `${list.length} PRs`, text: 'selected' } : null, headline: '', you: [], agent: list.length ? batchItems(list, decisions) : [] }
  const decision = decisions?.[0]
  if (!decision) return { header: pullHeader(list[0]), headline: '', you: [], agent: [] }
  return { header: pullHeader(list[0], decision), standing: decision.label, headline: decision.headline, you: withMergeOptions(yourItems(decision, list[0], { record, capabilities }), list[0], capabilities), agent: agentItems(decision, { record, capabilities }) }
}
