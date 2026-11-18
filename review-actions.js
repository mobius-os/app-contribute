import { NAMES } from './names.js'
// What the Review tab offers once a review exists, chosen by what actually
// happened (not by the saved word alone): the next step comes first, a finished
// review never offers "Stop review", and the conversation is a plain button for
// the day the owner wants to ask something specific. Pure, so the choice is
// tested without a browser. The tab wires each `key` to its handler.

// Why a finding is set aside. The note is for the owner's own memory: nothing
// is posted, and it applies to this exact version of the PR only.
export const IGNORE_REASONS = ['Not a problem', 'I’ll do it later', 'Already fixed', 'Out of scope']

// Why the platform refuses to post a saved review's findings, in its own words, by the code it answers with
// (contribution_review_post_findings.py REFUSALS). The sentences are the platform's: a refusal the app did not foresee
// reads the same here as in the 409.
export const POST_REFUSALS = {
  blocked: 'This review did not finish, so there is nothing to post. Review again first.',
  no_result: 'This review has no finished result to post.',
  has_verdict: 'This review already has a verdict. Submit or discard that one.',
  already_sent: 'This review was already sent to GitHub. Check the pull request.',
}
// A receipt that means the review is on GitHub or may be (an attempt that certainly did not go out, `not_dispatched`, can be made again).
const HELD_RECEIPTS = new Set(['posting', 'posted', 'unknown'])

// The first reason, in the order the owner would fix them, that this saved item cannot be posted; null when it can. The platform
// says so itself on every item (`post_findings`); an older platform does not, and its rule is read from the same fields. Only the
// saved item decides this: posting also needs someone else's PR that is still open and the exact words previewed, which GitHub and
// the preview answer at the moment of posting.
export function postRefusalCode(item) {
  const said = item?.post_findings
  if (typeof said?.allowed === 'boolean') return said.allowed ? null : (POST_REFUSALS[said.code] ? said.code : 'no_result')
  if (item?.blocked) return 'blocked'
  if (!['all_clear', 'needs_you'].includes(item?.state) || !String(item?.summary || '').trim()) return 'no_result'
  if (item.verdict_proposal) return 'has_verdict'
  return HELD_RECEIPTS.has(item.public_review?.state) ? 'already_sent' : null
}
export const postableFindings = item => postRefusalCode(item) === null
// The reason Post to GitHub is not offered for this item, or '' when it is.
export const postRefusal = item => POST_REFUSALS[postRefusalCode(item)] || ''

// Stop is for a review that is still going or waiting on an answer. A running
// review keeps its Stop after its own turn has ended: it hands the work to a
// helper and sleeps until the helper reports, so a helper that hangs leaves it
// running with no open turn to read. `progress` is reviewItemProgress's answer.
export const reviewStoppable = ({ run, tone, progress }) =>
  !!run.can_stop && run.state !== 'complete' && !progress.halted && !progress.settled &&
  (tone === 'running' || run.execution_state !== 'completed')

const primary = action => ({ ...action, primary: true })
const quiet = action => ({ ...action, quiet: true })

// `tone` is reviewContent's key (ui/ReviewTab.jsx). `can` says which actions this surface can
// take (a closed PR cannot start a review, an older run has no retry, ...). `batch` is how many
// PRs the run covers: Stop ends the whole run, so a batch's button says how many it stops.
export function reviewActionPlan({ tone, own = false, chat = false, asked = false, stoppable = false, batch = 1, can = {} }) {
  const ask = label => (chat ? [{ key: 'ask', label }] : [])
  const stop = stoppable ? [quiet({ key: 'stop', label: batch > 1 ? `Stop review of ${batch} PRs` : 'Stop review' })] : []
  switch (tone) {
    case 'running':
      return [...ask(NAMES.openChat).map(primary), ...stop]
    case 'halted':
      return [...(can.retry ? [{ key: 'retry', label: NAMES.reviewAgain }] : []), ...ask(NAMES.openChat)]
    case 'blocked': // nothing was found or decided, so the one step is another review; the conversation says what stopped it
      return [...(can.again ? [primary({ key: 'again', label: NAMES.reviewAgain })] : []), ...ask(NAMES.openChat)]
    case 'needs':
      return [...ask(asked ? NAMES.answerInChat : NAMES.openChat).map(primary), ...stop]
    case 'findings':
    case 'changes':
    case 'fix_ready':
      return [
        ...(own && can.fix ? [primary({ key: 'fix', label: NAMES.fixFindings })] : []),
        // On someone else's PR the next step is saying what you found. On your own PR nothing is ever
        // posted as a review of yourself (pr-machine.js): you fix it or set it aside.
        ...(can.post && !own ? [primary({ key: 'post', label: NAMES.postToGitHub })] : []),
        ...(can.ignore ? [{ key: 'ignore', label: NAMES.ignore }] : []),
        ...(can.again ? [{ key: 'again', label: NAMES.reviewAgain }] : []),
        ...ask('Ask the reviewer something'),
      ]
    case 'ignored':
      return [...(can.undo ? [{ key: 'undo', label: 'Undo set aside' }] : []), ...ask('Ask the reviewer something')]
    default: // a verdict card carries its own buttons; clear, waiting and settled reviews only offer the question
      return ask('Ask the reviewer something')
  }
}
