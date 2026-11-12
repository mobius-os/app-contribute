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
export const YOUR_INTENTS = new Set(Object.keys(YOUR_MENU))
// Not a machine action: Merge's way to choose how it lands first. It exists only where Möbius confirms Merge on its own sheet, which
// has no such choice, so Merge itself lands the way the repository prefers; see withMergeOptions.
export const MERGE_OPTIONS = 'merge_options'
export const AGENT_INTENTS = new Set(Object.keys(AGENT_MENU))
// Not a machine action either: following is a standing permission, not a job on this version, so the machine (and its twin in
// the platform) knows nothing of it. The row exists only where this Möbius can switch following on after a PR was sent.
export const FOLLOW = 'follow'
const FOLLOW_CAPABILITY = 'follow_after_send'

// One line of facts about a PR: draft, checks and conflicts. Who approved what is the
// machine's headline below it, so GitHub's own review summary is not repeated here.
export function pullHeader(pr) {
  const checks = checkSummary(pr)
  const parts = [
    pr?.isDraft ? 'draft' : '',
    conversationCount(pr) ? '' : 'no reviews',
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

function yourItems(decision, { record, capabilities }) {
  return decision.actions.filter(action => mayRunYourAction(action.id, { record, capabilities }))
    .map(action => asItem(action, YOUR_MENU[action.id]))
    .sort((a, b) => Number(a.danger) - Number(b.danger) || Number(b.rec) - Number(a.rec))
}

// Right after Merge, and off for the same reason when Merge is off.
function withMergeOptions(items, pr, capabilities) {
  const at = items.findIndex(item => item.intent === 'merge')
  if (at < 0 || !ownerConfirmOffered(capabilities) || allowedMergeMethods(pr.repository).length < 2) return items
  const options = { ...items[at], intent: MERGE_OPTIONS, title: NAMES.mergeOptions, detail: 'Choose how it lands.', rec: false }
  return items.toSpliced(at + 1, 0, options)
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

// `decisions` line up with `pulls` (one machine decision each). Returns { header, headline, you, agent }.
export function actionsMenuModel(pulls, decisions, { record = null, capabilities = null } = {}) {
  const list = (Array.isArray(pulls) ? pulls : []).filter(Boolean)
  if (list.length !== 1) return { header: list.length ? { label: `${list.length} PRs`, text: 'selected' } : null, headline: '', you: [], agent: list.length ? batchItems(list, decisions) : [] }
  const decision = decisions?.[0]
  if (!decision) return { header: pullHeader(list[0]), headline: '', you: [], agent: [] }
  return { header: pullHeader(list[0]), headline: decision.headline, you: withMergeOptions(yourItems(decision, { record, capabilities }), list[0], capabilities), agent: agentItems(decision, { record, capabilities }) }
}
