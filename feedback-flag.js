// The flag under a PR's description: what new feedback landed and whether it still waits on you.
// The record's saved attention says what landed (it is server-maintained and only as fresh as the last sync). Who still
// holds a change request is the PR machine's answer (pr-standing.js changeRequestFlagOf), so the two cannot disagree.
// Pure: the page passes in what it has already read.
import { changeRequestFlagOf } from './pr-standing.js'

const CHANGES_REQUESTED = { tone: 'blocker', label: 'Changes requested', note: 'Not addressed yet. Read the review under Comments.' }
const NEW_FEEDBACK = { tone: 'news', label: 'New feedback', note: 'The text is under Comments.' }
const REVIEW_CLEAR = { tone: 'clear', label: 'Review clear', note: 'This review found no blocking problems.' }
const names = who => new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(who)

// `decision`: the machine's decision for this PR. `approvedInFeedback`: the newest feedback is an approving review, or the
// review an agent run posted was an all-clear (a run's all-clear speaks only for the review it posted).
export function feedbackFlagOf({ attention, decision, approvedInFeedback = false }) {
  if (attention?.type === 'github_activity') return approvedInFeedback ? REVIEW_CLEAR : NEW_FEEDBACK
  if (attention?.type !== 'changes_requested') return null
  const live = changeRequestFlagOf(decision)
  if (live === undefined) return CHANGES_REQUESTED
  if (live === null) return null
  if (live.tone === 'clear') return { ...REVIEW_CLEAR, note: `${names(live.who)} approved this version.` }
  return { ...CHANGES_REQUESTED, note: `${names(live.who)} asked for changes. Read the review under Comments.` }
}
