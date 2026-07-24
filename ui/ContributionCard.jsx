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
  autopilotState,
  autopilotNarration,
  autopilotRounds,
  isAutopilotResponding,
  needsHuman,
} from '../autopilot.js'
import { FileDiffList } from './FileDiffList.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { Icon } from './Icons.jsx'

// One ledger row. Pointer clicks on a linked PR/issue card open the target, and
// pointer clicks on a prepared card open its review detail; keyboard users keep
// the familiar visible link/button targets. The status chip carries the group's
// identity in color, and the meta line reads type · repo#number · updated-time.
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
// returns to the source chat; Dismiss CAS-flips to abandoned via storage.js.

const ACTION_LABELS = {
  pr: 'New PR to',
  issue: 'New issue in',
  issue_comment: 'Comment on',
  discussion_comment: 'Comment on',
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
    <div className="co-plan-meta">
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
  return (
    <div className="co-technical-summary">
      <PlanMeta rec={rec} />
      <DiffLine stat={rec.plan?.diff_stat} />
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
function SubmitErrorAlert({ rec, reviewState }) {
  const blocked = reviewState?.state === 'needs_refresh'
  if (!blocked && (reviewState?.state === 'ready' || !rec.last_submit_error)) return null
  const message = blocked
    ? (reviewState.message || 'The staged source no longer matches this review.')
    : rec.last_submit_error
  // The backend tags each blocking problem with a stable `code`; lead with its
  // human headline and tuck the raw Git message behind Details. A persisted
  // last_submit_error carries no fresh code, so name it as one. An unmapped code
  // returns '' and the raw message becomes the headline (lenient fallback).
  const code = reviewState?.code || (rec.last_submit_error ? 'previous_submit_failure' : '')
  const headline = problemHeadline(code)

  return (
    <div className="co-alert" role="status">
      <strong>{headline || (blocked ? 'Fresh review needed' : 'Could not send')}</strong>
      <p className="co-alert-reassurance">Nothing was pushed. Your agent can update it safely.</p>
      {headline ? (
        <details className="co-alert-details">
          <summary>Technical details</summary>
          <p className="co-alert-text">{message}</p>
        </details>
      ) : (
        <p className="co-alert-text">{message}</p>
      )}
      {typeof rec.last_pushed_branch_url === 'string' &&
        rec.last_pushed_branch_url.startsWith('https://github.com/') ? (
        <a
          className="co-review-link"
          href={rec.last_pushed_branch_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View pushed branch
        </a>
      ) : null}
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
        <button type="button" className="co-btn co-btn-sm" onClick={handleAskAgent}>
          Draft follow-up
        </button>
      ) : null}
    </div>
  )
}

// The staged plan, rendered for review. Shown only when rec.plan exists. The
// diff now reads as a changed-file list (FileDiffList) that fetches and parses
// the full diff on expand — no raw diff_stat block, no excerpt step.
function ReviewPlan({ rec, loadDiff }) {
  const plan = rec.plan
  const where = plan.repo || rec.repo || ''
  const badge = (ACTION_LABELS[plan.action] || 'Contribution to') +
    (where ? ' ' + where : '')
  const isPr = plan.action === 'pr' || rec.type === 'pr'

  return (
    <>
      <span className="co-review-badge">{badge}</span>
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
      <PriorWorkEvidence priorWork={plan.prior_work} />
      <PlanLabels rec={rec} />
      {plan.body_draft ? (
        <section className="co-review-section">
          <div className="co-review-section-title">Description</div>
          <MarkdownView markdown={plan.body_draft} />
        </section>
      ) : null}
      {/* What the source-only allowlist already guarantees, said plainly right
          above the diff. Do not widen this claim beyond that allowlist. */}
      <p className="co-review-assurance">
        Contains only code and docs your agent changed — no personal data,
        chats, or memory.
      </p>
      <FileDiffList rec={rec} loadDiff={loadDiff} />
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
function ReviewActions({ rec, reviewState, onSend, onFeedback, onDismiss }) {
  const [sendNote, setSendNote] = useState(null)
  const [sending, setSending] = useState(false)
  const [sendElapsed, setSendElapsed] = useState(0)
  const [dismissing, setDismissing] = useState(false)
  // Dismiss abandons the prepared record (a CAS flip the skill treats as
  // terminal), so it must never fire on a single stray tap. The first tap arms
  // this in-card confirm; only the explicit Discard inside it runs dismiss().
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)
  const [note, setNote] = useState(null)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'
  const blocked = reviewState?.state === 'needs_refresh'
  const keepButtonRef = useRef(null)
  const confirmDescriptionId = useId()

  // The confirm replaces the action row. Move focus to the safe choice so
  // keyboard and switch users never land on the destructive action by default.
  useEffect(() => {
    if (confirmingDismiss) keepButtonRef.current?.focus()
  }, [confirmingDismiss])

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
    if (!isPr || blocked) return
    setSending(true)
    setSendNote(null)
    setNote(null)
    try {
      const outcome = (await onSend(rec)) || {}
      if (outcome.ok) {
        setSendNote('Pull request opened on GitHub for review.')
      } else if (outcome.pending) {
        setSendNote('Publishing is still in progress. Contribute will update this card when GitHub finishes.')
      } else {
        setNote(outcome.error || 'Could not submit this contribution.')
      }
    } finally {
      setSending(false)
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
      {confirmingDismiss ? (
        <div
          className="co-confirm"
          role="alertdialog"
          aria-label="Confirm drop"
          aria-describedby={confirmDescriptionId}
        >
          <p id={confirmDescriptionId} className="co-confirm-text">
            Drop this prepared contribution? It moves to History — you can undrop
            it there anytime.
          </p>
          <div className="co-confirm-actions">
            <button
              type="button"
              ref={keepButtonRef}
              className="co-btn co-btn-sm"
              disabled={dismissing}
              onClick={() => setConfirmingDismiss(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              className="co-btn co-btn-sm co-btn-danger"
              disabled={dismissing}
              onClick={dismiss}
            >
              {dismissing ? 'Dropping…' : 'Drop'}
            </button>
          </div>
        </div>
      ) : (
        <div className="co-review-actions" aria-label="Contribution actions">
          {blocked ? (
            <button
              type="button"
              className="co-icon-btn co-refresh-btn is-primary"
              onClick={feedback}
            >
              <Icon name="feedback" />
              <span>Refresh in chat</span>
            </button>
          ) : isPr ? (
            <button
              type="button"
              className={'co-icon-btn co-send-btn is-primary' + (sending ? ' is-sending' : '')}
              disabled={sending}
              onClick={send}
              aria-busy={sending}
              aria-label={sending ? 'Sending pull request' : 'Send pull request for review'}
              title="Send for review"
            >
              <Icon name="send" />
              <span className="co-action-label">
                <span>Send</span>
                {sending ? (
                  <span className="co-action-label-sweep" aria-hidden="true">Send</span>
                ) : null}
              </span>
            </button>
          ) : null}
          {!blocked ? (
            <button
              type="button"
              className="co-icon-btn"
              onClick={feedback}
              aria-label="Give feedback"
              title="Give feedback"
            >
              <Icon name="feedback" />
            </button>
          ) : null}
          <button
            type="button"
            className="co-icon-btn is-danger"
            onClick={() => setConfirmingDismiss(true)}
            aria-label="Drop contribution"
            title="Drop"
          >
            <Icon name="trash" />
          </button>
        </div>
      )}
      {!isPr ? (
        <p className="co-review-note">
          Only prepared PRs can be sent to GitHub from here right now.
        </p>
      ) : null}
      {sending && (
        <p className="co-review-note" role="status" aria-live="polite">
          Checking the reviewed source and publishing it to GitHub
          {sendElapsed >= 5 ? ` · ${sendElapsed}s elapsed` : '…'}
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

// Undrop: bring a dropped (abandoned) record back to Ready for review. No
// confirm — restoring is non-destructive (the opposite of Drop), one tap. Its
// outcome messaging mirrors ReviewActions' dismiss so a conflict/offline reads
// the same everywhere.
function UndropAction({ rec, onRestore }) {
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
          ? 'You are offline — undropping needs a connection; try again once you are back online.'
          : 'Could not undrop: ' + outcome.error)
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
        {restoring ? 'Undropping…' : 'Undrop'}
      </button>
      {note && (
        <p className="co-review-error" role="status" aria-live="polite">{note}</p>
      )}
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

export function ContributionCard({
  rec,
  reviewState,
  onSend,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  loadDiff,
  reviewOnly = false,
}) {
  const status = rec.status || 'prepared'
  const blocked = status === 'prepared' && reviewState?.state === 'needs_refresh'
  const statusLabel = blocked ? 'Needs update' : (STATUS_LABELS[status] || status)
  // The one plain-language line under the chip. A blocked card leads with its
  // SubmitErrorAlert instead, and an attention record with its callout, so both
  // suppress the calm lifecycle narration here.
  const narration = blocked ? '' : statusNarration(rec)
  const typeLabel = TYPE_LABELS[rec.type] || rec.type || 'Contribution'
  const when = timeAgo(rec.updated_at || rec.created_at)
  const [expanded, setExpanded] = useState(false)

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
  const hasPlan = reviewable && rec.plan && typeof rec.plan === 'object'
  const displayTitle = hasPlan ? (rec.plan.title || title) : title
  const planSummary = hasPlan && rec.summary && rec.summary !== displayTitle
    ? rec.summary
    : ''

  return (
    <div className={`co-card${blocked ? ' is-blocked' : ''}${reviewOnly ? ' is-stack-layer' : ''}`}>
      <div className="co-card-top">
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
        <span className={`co-chip is-${blocked ? 'needs-refresh' : status}`}>{statusLabel}</span>
      </div>
      {narration ? <p className="co-card-status">{narration}</p> : null}
      {planSummary ? <p className="co-card-summary is-clamped">{planSummary}</p> : null}
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
      <SubmitErrorAlert rec={rec} reviewState={reviewState} />
      {showPublishedLabelOutcome ? (
        <PlanLabels rec={rec} outcome={labelOutcome} />
      ) : null}
      {hasPlan && (
        <div className="co-card-footer">
          <button
            type="button"
            className="co-details-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>{expanded ? 'Hide details' : 'Details'}</span>
            <span className={expanded ? 'is-open' : ''}><Icon name="chevron" size={16} /></span>
          </button>
          {!reviewOnly && (
            <ReviewActions
              rec={rec}
              reviewState={reviewState}
              onSend={onSend}
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
        <UndropAction rec={rec} onRestore={onRestore} />
      )}
    </div>
  )
}
