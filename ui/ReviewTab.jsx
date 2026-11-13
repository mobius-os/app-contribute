import { useEffect, useState } from 'react'
import { OWNER_ITEM_STATES, REVIEW_STATE_NAMES, ignoredNote, reviewItemProgress, reviewRunHalted, reviewRunTitle, reviewStartedAt } from '../collaboration.js'
import { reviewDate } from '../review-copy.js'
import { postableFindings, reviewActionPlan, reviewStoppable } from '../review-actions.js'
import { frameOf } from '../pr-standing.js'
import { openAgentConversation } from './BatchAction.jsx'
import { ClampedMarkdown } from './ClampedMarkdown.jsx'
import { CopyId, commentReference } from './CopyId.jsx'
import { ReviewFrame } from './ReviewFrame.jsx'
import { RespondJobBox } from './RespondJobBox.jsx'
import { ResponseCard } from './ResponseCard.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { RepairProposal, VerdictProposal, savedVersion } from './RunDetail.jsx'
import { RunTag } from './RunTag.jsx'
import { pointsAnswering } from '../respond-result.js'
import { RequestedReviewers } from './RequestedReviewers.jsx'
import { ReviewSteps } from './ReviewSteps.jsx'
import { Shine } from './Shine.jsx'
import { useRunDocuments } from './useRunDocuments.js'
import { NAMES } from '../names.js'

// Seconds since the run started, ticking once a second while `running`.
function useElapsed(startedAt, running) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  const started = Date.parse(startedAt || '')
  return Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null
}

export const formatElapsed = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

// The saved review itself: its title, its box and which buttons fit what it holds.
// Where the PR stands overall, and which actions are allowed, is the PR
// machine's decision (`standing`), never worked out here.
export function reviewContent(status, ctx) {
  if (!status) return { key: 'none', title: 'No review yet' }
  const { run, item } = status
  const progress = reviewItemProgress(run, item, ctx)
  if (progress.halted || item.state === 'failed') return { key: 'halted', title: progress.label, box: 'changes' }
  if (progress.turn === 'agent') return { key: 'running', title: progress.label }
  if (item.state === 'verdict_pending') return { key: 'verdict', title: 'Verdict waiting for you', box: 'verdict' }
  // A prepared fix that owns the findings (the machine's coveredBy) is what this card is about; its buttons are the machine's too.
  if (ctx?.covered === 'repair') return { key: 'fix_ready', title: 'A fix is ready to push', box: 'verdict' }
  if (progress.turn === 'author') return { key: 'waiting', title: progress.label }
  if (ignoredNote(item, ctx?.ignored)) return { key: 'ignored', title: 'Set aside' }
  if (item.state === 'needs_you' && item.verdict_proposal?.event === 'REQUEST_CHANGES') return { key: 'changes', title: 'Changes found', box: 'changes' }
  if (item.state === 'needs_you' && !progress.waiting) return { key: 'findings', title: ctx?.own ? 'Your check found problems' : 'Problems found', box: 'verdict' }
  // A conversation that asked you something is answered first, whatever the review itself is doing. A step whose
  // outcome GitHub has not confirmed keeps its own words: that is the more urgent thing to read.
  const asks = progress.waiting && (item.state === 'needs_you' || !OWNER_ITEM_STATES.has(item.state))
  if (asks || OWNER_ITEM_STATES.has(item.state)) return { key: 'needs', title: asks ? REVIEW_STATE_NAMES.awaiting_owner : progress.label, box: 'verdict' }
  if (item.state === 'all_clear') return { key: 'clear', title: 'Review clear', box: 'clear' }
  return { key: 'settled', title: progress.label }
}

const allowed = (standing, ...ids) => !!standing?.actions?.some(action => ids.includes(action.id) && action.enabled)

// The Review tab of a PR: nothing yet, a running review, or what the last review
// found. It reuses the run's own verdict and conversation actions. Above that come the Respond-to-feedback
// conversation's own box while it holds the PR (`respondChat`, which the machine's `jobKind` confirms) and a saved
// answer from it (`response`, with Post and Discard). An older saved review stays below them, but "No review yet"
// would contradict them.
export function ReviewTab(props) {
  return <>
    <ReviewSteps standing={props.standing} itemState={props.status?.item?.state} />
    <RequestedReviewers entry={props.reviewers} onRetry={props.onRetryReviewers} />
    <ReviewCards {...props} />
  </>
}

function ReviewCards(props) {
  const { pr, status, earlier, standing, respondChat, response } = props
  // While the helper posts, the chat is not "working on feedback": the answer's own card says what it is doing.
  const posting = ['approved', 'posting'].includes(response?.status)
  const job = respondChat && standing?.jobKind === 'respond' && !posting ? <RespondJobBox chat={respondChat} pr={pr} standing={standing} /> : null
  const answer = response ? <ResponseCard pr={pr} response={response} chat={respondChat} busy={props.respondBusy} error={props.respondError} readOnly={props.readOnly} ownerGrant={props.ownerGrant === true}
    onPost={props.onPostResponse} onDiscard={props.onDiscardResponse} onRespondAgain={allowed(standing, 'respond') ? props.onRespondAgain : undefined} /> : null
  if (!job && !answer) return <SavedReview {...props} />
  // A finished answer that is older than the saved review steps below it: the newer review is what needs you now.
  if (!job && reviewIsNewer(status, response)) return <div className="co-review-stack"><SavedReview {...props} />{answer}</div>
  return <div className="co-review-stack">
    {job}
    {answer}
    {status || earlier ? <SavedReview {...props} quiet /> : null}
  </div>
}

const FINISHED_ANSWERS = new Set(['posted', 'stale'])
const reviewIsNewer = (status, response) => !!status && FINISHED_ANSWERS.has(response?.status)
  && (Date.parse(status.run.created_at) || 0) > (Date.parse(response.result.created_at) || 0)

// What the answer that covers these findings is doing decides what the card says: the machine's own state names it.
const COVERED_NOTE = {
  to_confirm: 'Your ready answer above covers these findings. Post or discard it first.',
  sending: 'Your answer above covers these findings and is being posted.',
  unconfirmed: 'Your answer above covers these findings. Check GitHub before anything else.',
}

// The run's kind in the words of the action that started it.
const runKind = (run, own) => (run.mode === 'review_fix_merge' ? (own ? NAMES.finishIt : NAMES.takeOver) : reviewRunTitle(run))

// `quiet`: another box above already holds the amber "needs you" frame, so this saved review stays plain.
function SavedReview({ quiet = false, token, appId, status: listed, response = null, standing = null, earlier: listedEarlier = null, own = null, ignored = null, canPost = false, readOnly = false, busy = false, error = '', onStart, onStop, onRetry, onVerdict, onRepair, onCheck, onFix, onIgnore, onUndoIgnore, onPost, pulls = [], listState = {} }) {
  // The saved review's documents come from the run itself; the list only has its short form.
  const documents = useRunDocuments({ token, appId, run: listed?.run, item: listed?.item })
  const earlierDocuments = useRunDocuments({ token, appId, run: listedEarlier?.run, item: listedEarlier?.item })
  const status = listed ? { ...listed, run: documents.run, item: documents.item } : listed
  const earlier = listedEarlier ? { ...listedEarlier, run: earlierDocuments.run, item: earlierDocuments.item } : listedEarlier
  const tone = reviewContent(status, { own, ignored, covered: standing?.coveredBy })
  const running = tone.key === 'running'
  const elapsed = useElapsed(status ? reviewStartedAt(status.run, status.item) : null, running)
  // Never a cut copy of the findings, or a verdict without its words: the box waits for the run itself.
  if (documents.reading || earlierDocuments.reading) return <div className="co-review-box" aria-label="Review"><p className="co-review-note" role="status"><Shine>Reading the review…</Shine></p></div>
  if (documents.failed || earlierDocuments.failed) return <div className="co-review-box" aria-label="Review"><p className="co-review-note" role="alert">The saved review could not be read just now. Close this page and open it again.</p></div>
  if (!status && earlier) return <EarlierReview earlier={earlier} response={response} own={own === true} />
  if (!status) {
    // The Actions menu above already starts a review, so there is nothing to offer here.
    return <div className="co-review-box" aria-label="Review">
      <h4>No review yet</h4>
      <p className="co-review-note" style={{ color: 'var(--text)', fontSize: 'var(--co-text-body)' }}>You haven’t made a review for this PR.</p>
      {readOnly ? null : <p className="co-review-note">Use Actions above to start one.</p>}
    </div>
  }
  const { run, item } = status
  const halted = reviewRunHalted(run)
  const progress = reviewItemProgress(run, item, { own, ignored })
  const stoppable = reviewStoppable({ run, tone: tone.key, progress })
  const note = ignoredNote(item, ignored)
  const asked = progress.waiting
  const plan = reviewActionPlan({ tone: tone.key, own: own === true, chat: !!run.chat_id, asked, stoppable: stoppable && !!onStop, batch: run.items?.length, can: { retry: halted && !!onRetry, fix: !readOnly && !!onFix && allowed(standing, 'respond'), post: !readOnly && canPost && !!onPost && postableFindings(item) && allowed(standing, 'draft_verdict'), ignore: !readOnly && !!onIgnore && allowed(standing, 'set_aside'), undo: !readOnly && !!onUndoIgnore, again: !readOnly && !!onStart && allowed(standing, 'review', 'check_my_pr') } })
  const handlers = { ask: () => openAgentConversation(run.chat_id), stop: onStop, retry: onRetry, fix: () => onFix(item), post: () => onPost({ run, item }), ignore: () => onIgnore(item), undo: () => onUndoIgnore?.(item), again: () => onStart(standing?.role === 'author' ? 'check_my_pr' : 'review') }
  const version = `${item.head_sha?.slice(0, 7) || '…'} → ${item.base_ref || 'main'}`
  const reviewId = item.verdict_proposal?.review_id || commentReference(item.public_review?.url)
  const posted = item.public_review?.state === 'posted' && item.public_review.url
  const body = <div className={'co-review-box' + (tone.box ? ' is-' + tone.box : '')} aria-label="Review">
    <RunTag kind={runKind(run, own === true)} at={run.created_at} />
    <div className="co-review-head">
      {running ? <span className="co-arc" aria-hidden="true" /> : null}
      <h4>{tone.title}</h4>
      {running && elapsed !== null ? <span className="co-review-elapsed">· {formatElapsed(elapsed)}</span> : null}
      {tone.key === 'clear' ? <CopyId id={String(reviewId || '')} label="review id" /> : null}
      <span className="co-review-version">{version}</span>
    </div>
    {running ? <p className="co-review-note">The agent is reading the PR. Its findings appear here when it finishes. You can leave this page: the frame on the list shows when it is done.</p> : null}
    {tone.key === 'halted' && run.summary ? <p className="co-review-note">{run.summary}</p> : null}
    {item.summary && tone.key !== 'fix_ready' ? <ClampedMarkdown markdown={item.summary} /> : null}
    {item.verdict_proposal ? <VerdictProposal proposal={item.verdict_proposal} mode={run.mode} busy={busy} own={own}
      onDecide={onVerdict ? (proposal, decision, extra) => onVerdict(item, proposal, decision, extra) : null} onCheck={onCheck || null} /> : null}
    <RepairProposal item={item} busy={busy} onDecide={onRepair && !readOnly ? (attempt, decision) => onRepair(item, attempt, decision) : null} />
    {posted ? <a className="co-btn co-btn-quiet" href={item.public_review.url} target="_blank" rel="noopener noreferrer">View the posted review on GitHub</a> : null}
    {standing?.coveredBy === 'answer' && ['findings', 'changes'].includes(tone.key) && COVERED_NOTE[standing.state] ? <p className="co-review-note" role="status">{COVERED_NOTE[standing.state]}</p> : null}
    {item.tests ? <details className="co-task-details"><summary>What it ran</summary><p className="co-review-note">{item.tests}</p></details> : null}
    <p className="co-review-note">{savedVersion(item, pulls, listState)}</p>
    {error ? <p role="alert">{error}</p> : null}
    {tone.key === 'ignored' && note ? <p className="co-review-note">Set aside: {note.reason}. Only for this version; it comes back if the PR changes.</p> : null}
    <div className="co-review-actions">
      {plan.map(action => <button key={action.key} type="button" disabled={busy && action.key !== 'ask'} className={action.primary ? 'co-btn co-btn-primary' : action.quiet ? 'co-btn co-btn-quiet' : 'co-btn'} onClick={handlers[action.key]}>{action.label}</button>)}
    </div>
  </div>
  return <ReviewFrame state={standing && !quiet ? frameOf(standing) : 'idle'} radius={12}>{body}</ReviewFrame>
}

// The PR changed after its last review, so that review is of an earlier version. It looks like
// every other round: its run, what became of it and its findings folded. Starting over is the page's
// one Review again button (the next step, or Actions), not a button of this card. "Answered" only when
// an answer above really took its findings on.
function EarlierReview({ earlier, response, own }) {
  const { run, item } = earlier
  const answered = pointsAnswering(response, run, item)
  const when = reviewDate(run.created_at, true)
  return <div className="co-review-box" aria-label="Review">
    <RunTag kind={runKind(run, own)} at={run.created_at} />
    <div className="co-review-head">
      <h4>{when ? `Checked the version of ${when}` : 'Checked an earlier version'}{answered ? <span className="co-desk-chip is-ready">Answered</span> : null}</h4>
      {item.head_sha ? <span className="co-review-version">{item.head_sha.slice(0, 7)}</span> : null}
    </div>
    <p className="co-review-note" style={{ color: 'var(--text)', fontSize: 'var(--co-text-body)' }}>{answered
      ? `Your answer above dealt with ${answered === 1 ? '1 point' : `${answered} points`} of what it found.`
      : 'This PR has changed since, so its findings may no longer apply. Nobody answered them.'}</p>
    {item.summary ? <details className="co-task-details"><summary>What the check found</summary><ClampedMarkdown markdown={item.summary} /></details> : null}
    {run.chat_id ? <div className="co-review-actions"><button type="button" className="co-btn co-btn-quiet" onClick={() => openAgentConversation(run.chat_id)}>{NAMES.openChat}</button></div> : null}
  </div>
}
