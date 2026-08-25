import React, { useEffect, useId, useRef, useState } from 'react'
import {
  ATTENTION_DETAIL,
  ATTENTION_HEADLINE,
  STATUS_LABELS,
  TYPE_LABELS,
  problemHeadline,
  statusNarration,
  timeAgo,
} from '../domain.js'
import { parseDiffStat } from '../diff.js'
import { contributionLabelOutcome } from '../labels.js'
import {
  canRunPrePrChecks,
  prePrCheckPhase,
  qualityReviewFor,
} from '../review.js'
import {
  autopilotState,
  autopilotNarration,
  autopilotRounds,
  isAutopilotResponding,
  needsHuman,
} from '../autopilot.js'
import { FileDiffList } from './FileDiffList.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { Icon } from './Icons.jsx'

// One ledger row. Cards deliberately expose explicit targets only — the title
// is the link on a linked PR/issue card, and prepared cards use their
// Send/Drop/Details controls; there is no whole-card click (removed for
// stability, so narration copy must not promise a tap). The status chip
// carries the group's identity in color, and the meta line reads
// type · repo#number · updated-time.
// Every field is optional-tolerant — the ledger is written by the agent and
// cron, so a missing summary or repo just drops that piece rather than breaking
// layout.
//
// Prepared records grow a review flow when the feed passes the handlers:
//   - with a `plan`, the collapsed card shows only high-level context; Review
//     expands the exact markdown body and an on-demand structured diff.
//   - without one (a record staged by a v1-skill agent), the card keeps the
//     plain fallback and Send returns a re-stage error from the platform.
// Send calls the platform submit endpoint directly for PR plans; Feedback
// returns to the source chat; Move to History CAS-flips to abandoned via storage.js.

const ACTION_LABELS = {
  pr: 'Pull request',
  pr_update: 'Pull request update',
  issue: 'Issue',
  issue_comment: 'Issue comment',
  discussion_comment: 'Discussion reply',
}

const PREPARED_ACTION_LABELS = {
  pr: 'New PR',
  pr_update: 'Update PR',
  issue: 'New issue',
  issue_comment: 'New issue comment',
  discussion_comment: 'New discussion reply',
}

// The collapsed prepared card's one meta line: repo · branch · timeAgo. Kept to
// a single row — the branch (usually the longest, least critical char-by-char)
// is the piece that truncates, so repo and recency always stay legible.
function PlanMeta({ rec }) {
  const plan = rec.plan || {}
  const repo = plan.repo || rec.repo || ''
  const branch = plan.branch || rec.branch || ''
  const when = timeAgo(rec.updated_at || rec.created_at)
  const parts = [
    repo ? { cls: 'co-plan-meta-repo', value: repo } : null,
    branch ? { cls: 'co-plan-meta-branch', value: branch } : null,
    when ? { cls: 'co-plan-meta-time', value: when } : null,
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <div className={'co-plan-meta' + (branch ? ' has-branch' : '')}>
      {parts.map((part, i) => (
        <React.Fragment key={part.cls}>
          {i > 0 ? (
            <span className="co-plan-meta-sep" aria-hidden="true">·</span>
          ) : null}
          <span className={part.cls}>{part.value}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

// The compact mono "N files +A −B" line, parsed from plan.diff_stat's summary
// (diff_stat is always stored). + green, − red; nothing renders if unparseable.
function DiffLine({ stat }) {
  const parsed = parseDiffStat(stat)
  if (!parsed || parsed.totalFiles === 0) return null
  const n = parsed.totalFiles
  return (
    <div className="co-diffline">
      <span className="co-diffline-files">{n} {n === 1 ? 'file' : 'files'}</span>
      <span className="co-diffline-add">+{parsed.additions}</span>
      <span className="co-diffline-del">{'−'}{parsed.deletions}</span>
    </div>
  )
}

function PlanSummary({ rec }) {
  const quality = qualityReviewFor(rec)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const showReadiness = isPr || rec.status === 'prepared'
  return (
    <div className="co-technical-summary">
      <PlanMeta rec={rec} />
      <DiffLine stat={rec.plan?.diff_stat} />
      {showReadiness ? (
        <span className={isPr ? 'co-quality-pill is-' + quality.state : 'co-quality-pill'}>
          <Icon name={isPr ? (quality.state === 'all_clear' ? 'check' : quality.state === 'changes_needed' ? 'fix' : 'review') : 'feedback'} size={13} />
          {isPr ? quality.label : 'Draft ready'}
        </span>
      ) : null}
    </div>
  )
}

const PRIOR_WORK_DECISIONS = {
  none: 'No overlapping work found',
  comment: 'The existing discussion is the right place to contribute',
  collaborate: 'Build on the active pull request',
  distinct_pr: 'A distinct pull request is justified after comparison',
}

function PriorWorkEvidence({ priorWork }) {
  if (!priorWork || typeof priorWork !== 'object') return null
  const query = typeof priorWork.query === 'string' ? priorWork.query.trim() : ''
  const summary = typeof priorWork.summary === 'string' ? priorWork.summary.trim() : ''
  const decision = PRIOR_WORK_DECISIONS[priorWork.decision] || 'Related work was checked'
  const matches = (Array.isArray(priorWork.matches) ? priorWork.matches : [])
    .map((item) => typeof item === 'string' ? { url: item } : item)
    .filter((item) => item && typeof item.url === 'string' &&
      item.url.startsWith('https://github.com/'))
  if (!query && !summary && matches.length === 0 && !priorWork.decision) return null

  return (
    <section className="co-prior-work" aria-label="Existing GitHub work checked">
      <div className="co-prior-work-head">
        <span className="co-prior-work-check" aria-hidden="true">✓</span>
        <div>
          <strong>Existing work checked</strong>
          <span>{decision}</span>
        </div>
      </div>
      {summary ? <p>{summary}</p> : null}
      {query || matches.length > 0 ? (
        <details className="co-prior-work-details">
          <summary>
            Search details
            {matches.length > 0 ? ` · ${matches.length} relevant ${matches.length === 1 ? 'match' : 'matches'}` : ''}
            <Icon name="right" className="co-prior-work-chevron" />
          </summary>
          <div>
            {query ? (
              <div className="co-prior-work-query">
                <span>Search</span>
                <code>{query}</code>
              </div>
            ) : null}
            {matches.length > 0 ? (
              <ul className="co-prior-work-links">
                {matches.slice(0, 5).map((item, index) => (
                  <li key={item.url + index}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {typeof item.title === 'string' && item.title.trim()
                        ? item.title.trim()
                        : `Related GitHub work ${index + 1}`}
                    </a>
                    {typeof item.note === 'string' && item.note.trim()
                      ? <span>{item.note.trim()}</span>
                      : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {matches.length > 5 ? (
              <span className="co-prior-work-more">+{matches.length - 5} more relevant links recorded</span>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  )
}

function PlanLabels({ rec, outcome = contributionLabelOutcome(rec) }) {
  if (outcome.empty) return null
  const githubUrl = typeof rec.url === 'string' && rec.url.startsWith('https://github.com/')
    ? rec.url
    : null

  if (!outcome.published || !outcome.hasOutcome) {
    if (outcome.requested.length === 0) return null
    return (
      <section className="co-plan-labels" aria-label="Reviewed GitHub labels">
        <div className="co-plan-labels-row">
          <span>{outcome.published ? 'Reviewed labels' : 'Labels'}</span>
          <div>
            {outcome.requested.map((label) => (
              <span className="co-plan-label" key={label}>{label}</span>
            ))}
          </div>
        </div>
      </section>
    )
  }

  if (!outcome.needsAttention) {
    return (
      <section className="co-plan-labels" aria-label="Published GitHub labels">
        <div className="co-plan-labels-row">
          <span>Labels applied</span>
          <div>
            {outcome.applied.map((label) => (
              <span className="co-plan-label" key={label}>{label}</span>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className={'co-label-outcome' + (outcome.needsAttention ? ' needs-attention' : '')}
      aria-label="Published GitHub label outcome"
    >
      <strong>{outcome.needsAttention ? 'Labels need attention' : 'Labels applied on GitHub'}</strong>
      {outcome.requested.length > 0 ? (
        <LabelOutcomeRow label="Requested" labels={outcome.requested} tone="muted" />
      ) : null}
      {outcome.applied.length > 0 ? (
        <LabelOutcomeRow label="Applied" labels={outcome.applied} />
      ) : null}
      {outcome.missing.length > 0 ? (
        <LabelOutcomeRow label="Not available" labels={outcome.missing} tone="muted" />
      ) : null}
      {outcome.unconfirmed.length > 0 ? (
        <LabelOutcomeRow label="Not confirmed" labels={outcome.unconfirmed} tone="muted" />
      ) : null}
      {outcome.note ? <p className="co-label-outcome-note">{outcome.note}</p> : null}
      {outcome.needsAttention ? (
        <p className="co-label-outcome-guidance">
          This pull request is already published. Adjust its labels on GitHub if needed;
          do not send it again.
        </p>
      ) : null}
      {outcome.needsAttention && githubUrl ? (
        <a className="co-review-link" href={githubUrl} target="_blank" rel="noopener noreferrer">
          Review labels on GitHub
        </a>
      ) : null}
    </section>
  )
}

function LabelOutcomeRow({ label, labels, tone = '' }) {
  return (
    <div className="co-label-outcome-row">
      <span>{label}</span>
      <div>
        {labels.map((value) => (
          <span className={'co-plan-label' + (tone ? ` is-${tone}` : '')} key={value}>
            {value}
          </span>
        ))}
      </div>
    </div>
  )
}

// A persisted submit failure, shown as a real alert strip (not stray red text)
// on the prepared card in both the collapsed and expanded states, so the reason
// a Send bounced stays visible while the partner fixes it.
function SubmitErrorAlert({ rec, reviewState, onFeedback }) {
  const [note, setNote] = useState('')
  const blocked = reviewState?.state === 'needs_refresh'
  if (!blocked && !rec.last_submit_error) return null
  const message = blocked
    ? (reviewState.message || 'The staged source no longer matches this review.')
    : rec.last_submit_error
  // The backend tags each blocking problem with a stable `code`; lead with its
  // human headline and tuck the raw Git message behind Details. A persisted
  // last_submit_error carries no fresh code, so name it as one. An unmapped code
  // returns '' and the raw message becomes the headline (lenient fallback).
  const code = reviewState?.code || (rec.last_submit_error ? 'previous_submit_failure' : '')
  const headline = problemHeadline(code)
  const displayHeadline = headline || (blocked ? 'Fresh review needed' : 'Review needs refreshing')
  const reviewedHead = String(rec.plan?.head_sha || '')
  const branchWasPushed = (
    rec.last_submit_stage === 'pushed' &&
    reviewedHead &&
    String(rec.last_submit_push_sha || '') === reviewedHead &&
    typeof rec.last_pushed_branch_url === 'string' &&
    rec.last_pushed_branch_url.startsWith('https://github.com/')
  )

  function fixAndReview() {
    const draft = [
      `Fix and review contribution ${rec.id} ("${rec.title || 'untitled'}").`,
      '',
      'Refresh the recorded pull request and branch first. If the exact reviewed head already reached the pull request, reconcile the contribution record and inspect its current checks. If the branch moved, rebuild the private review on its current head and run the relevant checks.',
      '',
      'Keep any further public update behind the existing approval button.',
    ].join('\n')
    const outcome = (typeof onFeedback === 'function' && onFeedback(
      rec, { draft },
    )) || {}
    if (!outcome.ok) {
      setNote(outcome.reason === 'missing-chat'
        ? 'This older record does not know which chat created it.'
        : 'Open Contribute inside Möbius to return to the source chat.')
    }
  }

  return (
    <div className={'co-alert' + (blocked ? ' is-follow-up' : '')} role="status">
      <strong>{displayHeadline}</strong>
      <p className="co-alert-reassurance">
        {branchWasPushed
          ? 'The reviewed branch reached GitHub, but Contribute could not confirm the pull request.'
          : 'This review needs a quick check before it can continue.'}
      </p>
      <details className="co-alert-details">
        <summary>Technical details</summary>
        <p className="co-alert-text">{message}</p>
      </details>
      {branchWasPushed ? (
        <a
          className="co-review-link"
          href={rec.last_pushed_branch_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View pushed branch
        </a>
      ) : null}
      {typeof onFeedback === 'function' ? (
        <button
          type="button"
          className="co-btn co-btn-sm co-btn-primary"
          onClick={fixAndReview}
        >
          Fix and review
        </button>
      ) : null}
      {note ? <p className="co-review-error">{note}</p> : null}
    </div>
  )
}

function PrePrChecksPanel({ rec, onFeedback }) {
  const checks = rec.pre_pr_checks
  const [note, setNote] = useState('')
  if (!checks || typeof checks !== 'object') return null

  const phase = prePrCheckPhase(rec)
  const active = phase === 'running'
  const failed = phase === 'failed'
  const passed = phase === 'passed'
  const url = typeof checks.url === 'string' &&
    checks.url.startsWith('https://github.com/') ? checks.url : ''
  const label = active
    ? 'GitHub checks running'
    : passed
      ? 'GitHub checks passed'
      : failed
        ? 'GitHub checks need a fix'
        : 'GitHub checks'
  const detail = active
    ? 'The reviewed branch is being tested on your personal fork. No pull request is open.'
    : passed
      ? 'The exact reviewed branch passed before a pull request was opened.'
      : checks.message || 'Open the run, fix the failure privately, then prepare a fresh review.'
  const tone = active ? ' is-follow-up' : passed ? ' is-passed' : ''

  function fixInChat() {
    const draft = [
      `Fix prepared contribution ${rec.id} ("${rec.title || 'untitled'}") before it is sent.`,
      `Pre-PR GitHub checks ${failed ? 'need attention' : 'have completed'}.`,
      url ? `Run: ${url}` : null,
      '',
      'Inspect the failing jobs and artifacts, make the smallest durable fix in the live source, run focused local checks, and prepare a fresh reviewed contribution.',
      'Do not push, open a pull request, or otherwise change GitHub without the approval required for that exact public action.',
    ].filter((line) => line !== null).join('\n')
    const outcome = (typeof onFeedback === 'function' && onFeedback(
      rec, { draft },
    )) || {}
    if (!outcome.ok) {
      setNote(outcome.reason === 'missing-chat'
        ? 'This older record does not know which chat created it.'
        : 'Open Contribute inside Möbius to return to the source chat.')
    }
  }

  return (
    <div className={`co-alert${tone}`} role="status">
      <strong>{label}</strong>
      <p className="co-alert-reassurance">{detail}</p>
      {url ? (
        <a className="co-review-link" href={url} target="_blank" rel="noopener noreferrer">
          View run on GitHub
        </a>
      ) : null}
      {failed && typeof onFeedback === 'function' ? (
        <button
          type="button"
          className="co-btn co-btn-sm co-btn-primary"
          onClick={fixInChat}
        >
          Fix in chat
        </button>
      ) : null}
      {note ? <p className="co-review-error">{note}</p> : null}
    </div>
  )
}

function attentionTitle(attention) {
  return attention?.title || ATTENTION_HEADLINE
}

function attentionMessage(attention) {
  return attention?.message || ATTENTION_DETAIL
}

function attentionDraft(rec) {
  const attention = rec.attention || {}
  const bits = [
    'Please sort out this upstream contribution:',
    rec.title ? '"' + rec.title + '"' : '',
    rec.repo ? '(' + rec.repo + ')' : '',
  ].filter(Boolean)
  const details = [
    attention.title || '',
    attention.message || '',
    attention.url || rec.url || '',
  ].filter(Boolean)
  return bits.join(' ') + (details.length ? '\n\nContext:\n' + details.join('\n') : '')
}

function AttentionCallout({ rec, onFeedback }) {
  const attention = rec.attention || {}
  if (!rec.needs_attention && !attention.title && !attention.message) return null

  function handleAskAgent() {
    if (typeof onFeedback !== 'function') return
    onFeedback(rec, { draft: attentionDraft(rec) })
  }

  return (
    <div className="co-attention" role="status">
      <div className="co-attention-copy">
        <div className="co-attention-title">{attentionTitle(attention)}</div>
        <p className="co-attention-text">{attentionMessage(attention)}</p>
        {typeof attention.url === 'string' &&
          attention.url.startsWith('https://github.com/') ? (
          <a
            className="co-review-link"
            href={attention.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View activity on GitHub
          </a>
        ) : null}
      </div>
      {typeof onFeedback === 'function' ? (
        <button
          type="button"
          className="co-icon-btn co-refresh-btn is-primary"
          aria-label="Refresh contribution in chat"
          title="Refresh in chat"
          onClick={handleAskAgent}
        >
          <Icon name="feedback" />
          <span>Refresh</span>
        </button>
      ) : null}
    </div>
  )
}

function ReconciliationHint({ hint, onDismiss }) {
  if (!hint || hint.type !== 'already_landed') return null
  const landingUrl = hint.landing_pr?.url
  return (
    <div className="co-reconciliation-hint" role="status">
      <div>
        <strong>{hint.title || 'Looks already landed'}</strong>
        <p>{hint.message || 'Parts of this change are already on main, but the match is not conclusive.'}</p>
        {typeof landingUrl === 'string' && landingUrl.startsWith('https://github.com/') ? (
          <a href={landingUrl} target="_blank" rel="noopener noreferrer">
            View possible landing PR
          </a>
        ) : null}
      </div>
      <button type="button" className="co-btn co-btn-sm" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  )
}

function publicationHandoff(rec) {
  const handoff = rec?.plan?.after_merge
  if (!handoff || handoff.action !== 'connect_app') return null
  return handoff
}

function PublicationReviewNote({ rec }) {
  if (!publicationHandoff(rec)) return null
  return (
    <section className="co-publication-review" aria-label="Reviewed after-merge action">
      <span>After merge</span>
      <div>
        <strong>Connect this local app in place</strong>
        <p>
          Contribute will offer one verified handoff to the merged App Store
          version. The app stays the same in your workspace, with its saved data.
        </p>
      </div>
    </section>
  )
}

// The staged plan, rendered for review. Shown only when rec.plan exists. The
// diff now reads as a changed-file list (FileDiffList) that fetches and parses
// the full diff on expand — no raw diff_stat block, no excerpt step.
export function ReviewPlan({ rec, loadDiff }) {
  const plan = rec.plan
  const labels = rec.status === 'prepared' ? PREPARED_ACTION_LABELS : ACTION_LABELS
  const badge = labels[plan.action] || 'Contribution'
  const isPr = plan.action === 'pr' || rec.type === 'pr'

  return (
    <>
      {isPr ? (
        <>
          <div className="co-review-changes-head"><strong>Changes</strong><span>{badge}</span></div>
          <FileDiffList rec={rec} loadDiff={loadDiff} />
        </>
      ) : null}
      <details className="co-pr-metadata">
        <summary><span>{isPr ? 'PR details' : 'Request details'}</span><Icon name="chevron" size={15} /></summary>
        <div className="co-pr-metadata-body">
          {plan.title ? (
            <section className="co-review-section">
              <div className="co-review-section-title">GitHub title</div>
              <div className="co-review-title">{plan.title}</div>
            </section>
          ) : null}
          {isPr ? (
            <div className="co-review-coauthor" title="The contribution workflow adds this commit trailer before publishing.">
              <span>Co-authored with</span>
              <strong>Möbius Agent</strong>
            </div>
          ) : null}
          <PublicationReviewNote rec={rec} />
          <PriorWorkEvidence priorWork={plan.prior_work} />
          <PlanLabels rec={rec} />
          {plan.body_draft ? (
            <section className="co-review-section">
              <div className="co-review-section-title">Description</div>
              <MarkdownView markdown={plan.body_draft} />
            </section>
          ) : null}
          <p className="co-review-assurance">
            {isPr
              ? 'Contains only code and docs your agent changed — no personal data, chats, or memory.'
              : 'Prepared from the source conversation. Nothing is published until you continue with that context.'}
          </p>
        </div>
      </details>
      {typeof plan.target_url === 'string' &&
        plan.target_url.startsWith('https://github.com/') && (
        <a
          className="co-review-link"
          href={plan.target_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View the target on GitHub
        </a>
      )}
    </>
  )
}

// The Send/Dismiss row plus its outcome messaging; shared by the plan
// review and the plan-less v1 fallback.
function ReviewActions({
  rec, reviewState, onSend, onRunPrePrChecks, onReview, onFeedback, onDismiss,
}) {
  const [sendNote, setSendNote] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendElapsed, setSendElapsed] = useState(0)
  const [dismissing, setDismissing] = useState(false)
  // Dismiss moves the prepared record to History. It is reversible there, but
  // still must not fire on a stray tap because it leaves the active queue.
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)
  const [confirmingChecks, setConfirmingChecks] = useState(false)
  const [startingChecks, setStartingChecks] = useState(false)
  const [note, setNote] = useState(null)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const isUpdate = rec.plan?.action === 'pr_update'
  const blocked = reviewState?.state === 'needs_refresh'
  const attentionBlocked = rec.needs_attention === true
  // A failed publication needs the source-aware agent recovery above this
  // action row. Do not offer the same blind GitHub mutation again while its
  // cause is unresolved.
  const submitFailed = Boolean(rec.last_submit_error) || attentionBlocked
  const quality = qualityReviewFor(rec)
  const reviewIncomplete = isPr && quality.state !== 'all_clear'
  const checksActive = prePrCheckPhase(rec) === 'running'
  const mayRunChecks = !submitFailed && canRunPrePrChecks(rec) &&
    typeof onRunPrePrChecks === 'function' && !checksActive
  const keepButtonRef = useRef(null)
  const cancelChecksRef = useRef(null)
  const confirmDescriptionId = useId()
  const checkConfirmDescriptionId = useId()

  // The confirm replaces the action row. Move focus to the safe choice so
  // keyboard and switch users never land on the state-changing action by default.
  useEffect(() => {
    if (confirmingDismiss) keepButtonRef.current?.focus()
  }, [confirmingDismiss])

  useEffect(() => {
    if (confirmingChecks) cancelChecksRef.current?.focus()
  }, [confirmingChecks])

  useEffect(() => {
    if (!sending) {
      setSendElapsed(0)
      return undefined
    }
    const startedAt = Date.now()
    const update = () => setSendElapsed(Math.floor((Date.now() - startedAt) / 1000))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [sending])

  async function send() {
    if (!isPr || blocked || submitFailed || reviewIncomplete || checksActive) return
    setSending(true)
    setSendNote(null)
    setNote(null)
    try {
      const outcome = (await onSend(rec)) || {}
      if (outcome.ok) {
        setSendNote(outcome.updated
          ? 'Pull request updated on GitHub.'
          : outcome.viaMobius
            ? 'Draft pull request opened through Möbius.'
            : 'Pull request opened on GitHub for review.')
      } else if (outcome.pending) {
        setSendNote(outcome.viaMobius
          ? 'Möbius accepted the reviewed change and is opening the draft. This card will update automatically.'
          : 'Publishing is still in progress. Contribute will update this card when GitHub finishes.')
      } else {
        setNote(outcome.error || (isUpdate
          ? 'Could not update this pull request.'
          : 'Could not submit this contribution.'))
      }
    } finally {
      setSending(false)
    }
  }

  async function runChecks() {
    if (!mayRunChecks) return
    setStartingChecks(true)
    setSendNote(null)
    setNote(null)
    try {
      const outcome = (await onRunPrePrChecks(rec)) || {}
      if (outcome.ok) {
        setSendNote('The reviewed branch is on your fork and GitHub checks are starting.')
      } else if (outcome.pending) {
        setSendNote('The branch was handled, but the run is still being reconciled. Contribute will update this card before another try.')
      } else {
        setNote(outcome.unsupported
          ? 'Restart Möbius to load the companion GitHub checks service.'
          : outcome.error || 'Could not start GitHub checks.')
      }
    } finally {
      setStartingChecks(false)
      setConfirmingChecks(false)
    }
  }

  function feedback() {
    setSendNote(null)
    setNote(null)
    const outcome = (typeof onFeedback === 'function' && onFeedback(
      rec,
      blocked ? {
        draft: `Please refresh contribution ${rec.id} ("${rec.title || 'untitled'}"). Contribute found: ${reviewState.message || 'the staged source changed after review.'}\n\n`,
      } : {},
    )) || {}
    if (!outcome.ok) {
      setNote(outcome.reason === 'missing-chat'
        ? 'This older record does not know which chat created it.'
        : 'Open Contribute from inside Möbius to jump back to the source chat.')
    }
  }

  async function dismiss() {
    setDismissing(true)
    setNote(null)
    try {
      const outcome = (await onDismiss(rec)) || {}
      if (outcome.conflict !== undefined) {
        setNote('This contribution just changed under you — the feed has been refreshed.')
      } else if (outcome.gone) {
        setNote('This record no longer exists — the feed has been refreshed.')
      } else if (outcome.error) {
        setNote(outcome.error === 'offline'
          ? 'You are offline — dismissing needs a connection; try again once you are back online.'
          : 'Could not dismiss: ' + outcome.error)
      }
    } finally {
      setDismissing(false)
      setConfirmingDismiss(false)
    }
  }

  return (
    <div className="co-action-block">
      {!confirmingDismiss ? (
        <ReconciliationHint
          hint={rec.reconciliation_hint}
          onDismiss={() => setConfirmingDismiss(true)}
        />
      ) : null}
      {confirmingDismiss ? (
        <div
          className="co-confirm"
          role="alertdialog"
          aria-label="Confirm move to History"
          aria-describedby={confirmDescriptionId}
        >
          <p id={confirmDescriptionId} className="co-confirm-text">
            Move this {isPr ? 'prepared contribution' : 'draft'} to History? You
            can restore it there anytime.
          </p>
          <div className="co-confirm-actions">
            <button
              type="button"
              ref={keepButtonRef}
              className="co-btn co-btn-sm"
              disabled={dismissing}
              onClick={() => setConfirmingDismiss(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="co-btn co-btn-sm co-btn-caution"
              disabled={dismissing}
              onClick={dismiss}
            >
              {dismissing ? 'Moving…' : 'Move to History'}
            </button>
          </div>
        </div>
      ) : confirmingChecks ? (
        <div
          className="co-confirm is-safe"
          role="alertdialog"
          aria-label="Confirm GitHub checks"
          aria-describedby={checkConfirmDescriptionId}
        >
          <p id={checkConfirmDescriptionId} className="co-confirm-text">
            This updates your personal fork if needed, pushes only the exact
            reviewed branch, and starts the full GitHub test suite. It does not
            open a pull request or email the organization.
          </p>
          <div className="co-confirm-actions">
            <button
              type="button"
              ref={cancelChecksRef}
              className="co-btn co-btn-sm"
              disabled={startingChecks}
              onClick={() => setConfirmingChecks(false)}
            >
              Not now
            </button>
            <button
              type="button"
              className="co-btn co-btn-sm co-btn-primary"
              disabled={startingChecks}
              onClick={runChecks}
            >
              {startingChecks ? 'Starting…' : 'Run on my fork'}
            </button>
          </div>
        </div>
      ) : (
        <div className="co-review-actions" role="group" aria-label="Contribution actions">
          {blocked ? (
            <button
              type="button"
              className="co-icon-btn co-refresh-btn is-primary"
              aria-label="Refresh contribution in chat"
              title="Refresh in chat"
              onClick={feedback}
            >
              <Icon name="feedback" />
              <span>Refresh</span>
            </button>
          ) : isPr ? (
            <>
              {reviewIncomplete && typeof onReview === 'function' ? (
                <button
                  type="button"
                  className="co-icon-btn co-review-btn is-primary"
                  onClick={() => onReview(rec)}
                  aria-label="Review this contribution"
                  title="Review this contribution"
                >
                  <Icon name="review" />
                  <span>Review</span>
                </button>
              ) : null}
              {mayRunChecks ? (
                <button
                  type="button"
                  className="co-icon-btn co-check-btn"
                  onClick={() => setConfirmingChecks(true)}
                  aria-label={rec.pre_pr_checks ? 'Run GitHub checks again' : 'Run GitHub checks'}
                  title={rec.pre_pr_checks
                    ? 'Run the full GitHub checks again on your fork'
                    : 'Run the full GitHub checks on your fork'}
                >
                  <Icon name={rec.pre_pr_checks ? 'refresh' : 'check'} />
                  <span>{rec.pre_pr_checks ? 'Check again' : 'Run checks'}</span>
                </button>
              ) : null}
              {!reviewIncomplete && !submitFailed ? (
                <button
                  type="button"
                  className={'co-icon-btn co-send-btn is-primary' + (sending ? ' is-sending' : '')}
                  disabled={sending || checksActive}
                  onClick={send}
                  aria-busy={sending}
                  aria-label={checksActive
                    ? 'GitHub checks are still running'
                    : sending
                      ? (isUpdate ? 'Updating pull request' : 'Opening pull request')
                      : (isUpdate ? 'Update pull request' : 'Open pull request for review')}
                  title={checksActive ? 'Wait for checks' : (isUpdate ? 'Update pull request' : 'Open pull request')}
                >
                  <Icon name="send" />
                  <span className="co-action-label">
                    <span>{checksActive ? 'Checking' : (isUpdate ? 'Update PR' : 'Open PR')}</span>
                    {sending ? (
                      <span className="co-action-label-sweep" aria-hidden="true">
                        {isUpdate ? 'Update PR' : 'Open PR'}
                      </span>
                    ) : null}
                  </span>
                </button>
              ) : null}
            </>
          ) : typeof onFeedback === 'function' ? (
            <button
              type="button"
              className="co-icon-btn co-send-btn is-primary"
              onClick={feedback}
              aria-label="Open this request's source conversation"
              title="Open source conversation"
            >
              <Icon name="feedback" />
              <span>Open chat</span>
            </button>
          ) : null}
          {!blocked && !attentionBlocked && isPr ? (
            <button
              type="button"
              className="co-icon-btn co-secondary-action"
              onClick={feedback}
              aria-label="Give feedback"
              title="Give feedback"
            >
              <Icon name="feedback" />
              <span>Feedback</span>
            </button>
          ) : null}
          <button
            type="button"
            className={isPr ? 'co-icon-btn co-secondary-action' : 'co-request-history'}
            onClick={() => setConfirmingDismiss(true)}
            aria-label={isPr ? 'Move contribution to History' : 'Move request draft to History'}
            title="Move to History"
          >
            {isPr ? <><Icon name="cycle" /><span>History</span></> : 'Move to History'}
          </button>
        </div>
      )}
      {!isPr && rec.status === 'prepared' ? (
        <p className="co-review-note">
          Requests stay connected to their source conversation, where you can refine or publish them with the full context intact.
        </p>
      ) : null}
      {sending && (
        <p className="co-review-note" role="status" aria-live="polite">
          {isUpdate
            ? 'Checking the reviewed source and updating the pull request'
            : 'Checking the reviewed source and publishing it to GitHub'}
          {sendElapsed >= 5 ? ` · ${sendElapsed}s elapsed` : '…'}
        </p>
      )}
      {startingChecks && (
        <p className="co-review-note" role="status" aria-live="polite">
          Verifying the reviewed branch, updating your fork, and starting GitHub checks…
        </p>
      )}
      {sendNote && (
        <p className="co-review-note" role="status" aria-live="polite">{sendNote}</p>
      )}
      {note && (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      )}
    </div>
  )
}

// Restore: bring an archived (abandoned) record back to Ready for review. No
// confirm — restoring is non-destructive, one tap. Its
// outcome messaging mirrors ReviewActions' dismiss so a conflict/offline reads
// the same everywhere.
function RestoreAction({ rec, onRestore }) {
  const [restoring, setRestoring] = useState(false)
  const [note, setNote] = useState(null)

  async function restore() {
    setRestoring(true)
    setNote(null)
    try {
      const outcome = (await onRestore(rec)) || {}
      if (outcome.conflict !== undefined) {
        setNote('This contribution just changed under you — the feed has been refreshed.')
      } else if (outcome.gone) {
        setNote('This record no longer exists — the feed has been refreshed.')
      } else if (outcome.error) {
        setNote(outcome.error === 'offline'
          ? 'You are offline — restoring needs a connection; try again once you are back online.'
          : 'Could not restore: ' + outcome.error)
      }
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="co-history-actions">
      <button
        type="button"
        className="co-btn co-btn-sm"
        disabled={restoring}
        onClick={restore}
      >
        {restoring ? 'Restoring…' : 'Restore'}
      </button>
      {note && (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      )}
    </div>
  )
}

function PublicationConnectionAction({ rec, onConnectApp }) {
  const handoff = publicationHandoff(rec)
  const connection = rec.publication_connection
  const [connecting, setConnecting] = useState(false)
  const [note, setNote] = useState('')
  if (!handoff || rec.status !== 'merged') return null

  if (
    connection?.status === 'connected' ||
    connection?.status === 'connected_conflict'
  ) {
    const conflicted = connection.status === 'connected_conflict'
    return (
      <div
        className={`co-publication-action is-connected${conflicted ? ' has-conflicts' : ''}`}
        role="status"
      >
        <span>{conflicted ? 'Connected with follow-up' : 'App connected'}</span>
        <strong>
          {conflicted
            ? 'Your app is linked, but its source changes need review.'
            : 'This installed app now follows its App Store version.'}
        </strong>
        <p>
          {conflicted
            ? 'Your saved app data stayed in place. Open the app’s source chat to resolve the overlapping files.'
            : 'Future App Store updates will update this same app instead of creating a separate copy.'}
        </p>
      </div>
    )
  }

  async function connect() {
    if (typeof onConnectApp !== 'function') return
    setConnecting(true)
    setNote('')
    try {
      const outcome = (await onConnectApp(rec)) || {}
      if (!outcome.ok) {
        setNote(outcome.error || 'Could not connect this published app.')
      }
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="co-publication-action">
      <span>App ready to connect</span>
      <strong>Keep the local app and its published version together</strong>
      <p>
        Contribute will verify the exact merged source and permissions, then
        connect them to this same installed app. Saved app data stays in place.
      </p>
      {typeof onConnectApp === 'function' ? (
        <button
          type="button"
          className="co-btn co-btn-sm co-btn-primary"
          disabled={connecting}
          onClick={connect}
        >
          {connecting ? 'Connecting…' : 'Connect app'}
        </button>
      ) : null}
      {note ? (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      ) : null}
    </div>
  )
}

// Autopilot state for a shipped PR: the plain-language line, a Pause/Resume
// control, and the rounds timeline. The `autopilot` block on the record is a
// display-only mirror of a platform DB row — Pause/Resume calls the platform
// endpoint (onSetAutopilot), never a ledger write. Round summaries are plain
// text rendered without markdown (they may quote untrusted reviewer text).
function AutopilotPanel({ rec, onSetAutopilot }) {
  const block = autopilotState(rec)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  if (!block || typeof onSetAutopilot !== 'function') return null

  const enabled = !!block.enabled
  const line = autopilotNarration(rec)
  const rounds = autopilotRounds(rec)
  const responding = isAutopilotResponding(rec)
  const escalated = needsHuman(rec)

  const toggle = async () => {
    setBusy(true)
    setNote(null)
    const next = !enabled
    const outcome = (await onSetAutopilot(rec, next)) || {}
    if (outcome.error) setNote(outcome.error)
    setBusy(false)
  }

  return (
    <div className={`co-autopilot${escalated ? ' is-escalated' : ''}${responding ? ' is-responding' : ''}`}>
      <div className="co-autopilot-head">
        <span className="co-autopilot-badge">
          {responding ? 'Autopilot working' : enabled ? 'Autopilot on' : 'Autopilot paused'}
        </span>
        <button
          type="button"
          className="co-autopilot-toggle"
          onClick={toggle}
          disabled={busy}
        >
          {busy ? '…' : enabled ? 'Pause' : 'Resume'}
        </button>
      </div>
      {line ? <p className="co-autopilot-line">{line}</p> : null}
      {note ? <p className="co-autopilot-error">{note}</p> : null}
      {rounds.length > 0 && (
        <ul className="co-autopilot-rounds">
          {rounds.slice(0, 6).map((round, i) => (
            <li key={i}>
              <span className="co-autopilot-round-label">{round.label}</span>
              {round.summary ? (
                <span className="co-autopilot-round-summary">{round.summary}</span>
              ) : null}
              {round.when ? (
                <span className="co-autopilot-round-when">{timeAgo(round.when)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function WithdrawAction({ rec, onWithdraw }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const keepRef = useRef(null)
  const descriptionId = useId()
  const eligible = rec.submission_mode === 'mobius-bot' &&
    ['draft', 'open'].includes(rec.status) &&
    typeof rec.relay_contribution_id === 'string' &&
    typeof onWithdraw === 'function'

  useEffect(() => {
    if (confirming) keepRef.current?.focus()
  }, [confirming])

  if (!eligible) return null

  async function withdraw() {
    setBusy(true)
    setNote('')
    try {
      const outcome = (await onWithdraw(rec)) || {}
      if (!outcome.ok) {
        setNote(outcome.error || 'Could not withdraw this contribution.')
      }
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="co-published-action">
        <button
          type="button"
          className="co-btn co-btn-sm"
          onClick={() => { setNote(''); setConfirming(true) }}
        >
          Withdraw PR
        </button>
        {note ? <p className="co-review-error" role="status">{note}</p> : null}
      </div>
    )
  }

  return (
    <div
      className="co-confirm"
      role="alertdialog"
      aria-label="Confirm contribution withdrawal"
      aria-describedby={descriptionId}
    >
      <p id={descriptionId} className="co-confirm-text">
        Withdraw this pull request? Möbius will close it and remove its bot
        branch. The local review stays in History; nothing will be merged.
      </p>
      <div className="co-confirm-actions">
        <button
          type="button"
          ref={keepRef}
          className="co-btn co-btn-sm"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          Keep open
        </button>
        <button
          type="button"
          className="co-btn co-btn-sm co-btn-caution"
          disabled={busy}
          onClick={withdraw}
        >
          {busy ? 'Withdrawing…' : 'Withdraw PR'}
        </button>
      </div>
    </div>
  )
}

export function ContributionCard({
  rec,
  reviewState,
  onSend,
  onRunPrePrChecks,
  onReview,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  loadDiff,
  reviewOnly = false,
  initialExpanded = false,
}) {
  const status = rec.status || 'prepared'
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const blocked = status === 'prepared' && (
    reviewState?.state === 'needs_refresh' || rec.needs_attention === true
  )
  const qualityState = qualityReviewFor(rec)
  const statusLabel = blocked
    ? 'Needs update'
    : status === 'prepared'
      ? (isPr ? qualityState.label : 'Draft')
      : (STATUS_LABELS[status] || status)
  const statusClass = blocked
    ? 'needs-refresh'
    : status === 'prepared' && isPr
      ? qualityState.state
      : status
  // The one plain-language line under the chip. A blocked card leads with its
  // SubmitErrorAlert instead, and an attention record with its callout, so both
  // suppress the calm lifecycle narration here.
  const narration = blocked ? '' : statusNarration(rec)
  const typeLabel = TYPE_LABELS[rec.type] || rec.type || 'Contribution'
  const when = timeAgo(rec.updated_at || rec.created_at)
  const [expanded, setExpanded] = useState(initialExpanded)

  // Reflection engagement signal: fire once each time the review opens, never
  // on collapse. `expanded` only ever goes true for a plan card, so this is
  // inherently scoped to real reviews.
  useEffect(() => {
    if (expanded) window.mobius?.signal?.('contribution_reviewed', { id: rec.id })
  }, [expanded])

  // repo, optionally with a #number; both tolerate absence.
  let where = rec.repo || ''
  if (where && rec.number) where += ' #' + rec.number
  const meta = [typeLabel, where, when].filter(Boolean)

  const title = rec.title || where || 'Untitled contribution'
  const hasLink =
    typeof rec.url === 'string' && rec.url.startsWith('https://github.com/')
  const labelOutcome = contributionLabelOutcome(rec)
  const showPublishedLabelOutcome = labelOutcome.published &&
    labelOutcome.hasOutcome && !labelOutcome.empty
  const reviewable =
    status === 'prepared' && (
      reviewOnly || (
        typeof onSend === 'function' && typeof onDismiss === 'function'
      )
    )
  const hasPlan = !!(rec.plan && typeof rec.plan === 'object' && (reviewable || initialExpanded))
  const displayTitle = hasPlan ? (rec.plan.title || title) : title
  const planSummary = hasPlan && rec.summary && rec.summary !== displayTitle
    ? rec.summary
    : ''

  return (
    <div className={`co-card${blocked ? ' is-blocked' : ''}${reviewOnly ? ' is-stack-layer' : ''}`}>
      <div className="co-card-top">
        <h3 className="co-card-heading">
          {hasLink ? (
            <a
              className="co-card-title"
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {displayTitle}
            </a>
          ) : (
            <span className="co-card-title">{displayTitle}</span>
          )}
        </h3>
        <span className={`co-chip is-${statusClass}`}>{statusLabel}</span>
      </div>
      {narration ? <p className="co-card-status">{narration}</p> : null}
      {planSummary ? (
        <p className={'co-card-summary' + (expanded ? '' : ' is-clamped')}>
          {planSummary}
        </p>
      ) : null}
      {!hasPlan && rec.summary ? <p className="co-card-summary">{rec.summary}</p> : null}
      {/* Non-plan cards keep the generic type · repo#number · time line; a
          prepared plan card carries its own repo · branch · time line inside
          the collapsed summary, so the two never stack. */}
      {!hasPlan && meta.length > 0 && (
        <div className="co-card-meta">
          {meta.map((part, i) => (
            <span key={i}>
              {i > 0 ? '· ' : ''}
              {part}
            </span>
          ))}
        </div>
      )}
      <AttentionCallout rec={rec} onFeedback={onFeedback} />
      {status !== 'prepared' && autopilotState(rec) ? (
        <AutopilotPanel rec={rec} onSetAutopilot={onSetAutopilot} />
      ) : null}
      <WithdrawAction rec={rec} onWithdraw={onWithdraw} />
      <SubmitErrorAlert
        rec={rec}
        reviewState={reviewState}
        onFeedback={onFeedback}
      />
      <PrePrChecksPanel rec={rec} onFeedback={onFeedback} />
      {showPublishedLabelOutcome ? (
        <PlanLabels rec={rec} outcome={labelOutcome} />
      ) : null}
      <PublicationConnectionAction rec={rec} onConnectApp={onConnectApp} />
      {hasPlan && (
        <div className={`co-card-footer${rec.reconciliation_hint ? ' is-reconciliation' : ''}`}>
          <button
            type="button"
            className="co-details-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? 'Hide details' : 'Details'}</span>
            <span className={expanded ? 'is-open' : ''}><Icon name="chevron" size={16} /></span>
          </button>
          {/* Focused History/Open cards keep their reviewed plan readable, but
              active-queue actions belong only to still-prepared work. */}
          {!reviewOnly && reviewable && (
            <ReviewActions
              rec={rec}
              reviewState={reviewState}
              onSend={onSend}
              onRunPrePrChecks={onRunPrePrChecks}
              onReview={onReview}
              onFeedback={onFeedback}
              onDismiss={onDismiss}
            />
          )}
        </div>
      )}
      {reviewable && !hasPlan && !reviewOnly && (
        <div className="co-card-footer is-actions-only">
          <ReviewActions
            rec={rec}
            reviewState={reviewState}
            onSend={onSend}
            onRunPrePrChecks={onRunPrePrChecks}
            onReview={onReview}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
          />
        </div>
      )}
      {hasPlan && expanded && (
        <div className="co-review">
          <PlanSummary rec={rec} />
          <ReviewPlan rec={rec} loadDiff={loadDiff} />
        </div>
      )}
      {status === 'abandoned' && typeof onRestore === 'function' && (
        <RestoreAction rec={rec} onRestore={onRestore} />
      )}
    </div>
  )
}
