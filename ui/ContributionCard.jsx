import React, { useEffect, useState } from 'react'
import { STATUS_LABELS, TYPE_LABELS, timeAgo } from '../domain.js'
import { parseDiffStat } from '../diff.js'
import { FileDiffList } from './FileDiffList.jsx'
import { MarkdownView } from './MarkdownView.jsx'

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
    <div className="co-plan-summary">
      <PlanMeta rec={rec} />
      <DiffLine stat={rec.plan?.diff_stat} />
    </div>
  )
}

// A persisted submit failure, shown as a real alert strip (not stray red text)
// on the prepared card in both the collapsed and expanded states, so the reason
// a Send bounced stays visible while the partner fixes it.
function SubmitErrorAlert({ rec }) {
  if (!rec.last_submit_error) return null
  return (
    <div className="co-alert" role="status">
      <p className="co-alert-text">{rec.last_submit_error}</p>
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

function isInteractiveTarget(target) {
  return !!target?.closest?.('button, a, input, textarea, select, [role="button"]')
}

function attentionTitle(attention) {
  return attention?.title || 'Needs attention'
}

function attentionMessage(attention) {
  return attention?.message || 'There is new activity on GitHub.'
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
      {plan.title && plan.title !== rec.title ? (
        <div className="co-review-title">{plan.title}</div>
      ) : null}
      {isPr ? (
        <div className="co-review-coauthor" title="The contribution workflow adds this commit trailer before publishing.">
          <span>Co-authored with</span>
          <strong>Möbius Agent</strong>
        </div>
      ) : null}
      {plan.body_draft ? (
        <section className="co-review-section">
          <div className="co-review-section-title">Description</div>
          <MarkdownView markdown={plan.body_draft} />
        </section>
      ) : null}
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
function ReviewActions({ rec, onSend, onFeedback, onDismiss }) {
  const [sendNote, setSendNote] = useState(null)
  const [sending, setSending] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  // Dismiss abandons the prepared record (a CAS flip the skill treats as
  // terminal), so it must never fire on a single stray tap. The first tap arms
  // this in-card confirm; only the explicit Discard inside it runs dismiss().
  const [confirmingDismiss, setConfirmingDismiss] = useState(false)
  const [note, setNote] = useState(null)
  const isPr = rec.plan?.action === 'pr' || rec.type === 'pr'

  async function send() {
    if (!isPr) return
    setSending(true)
    setSendNote(null)
    setNote(null)
    try {
      const outcome = (await onSend(rec)) || {}
      if (outcome.ok) {
        setSendNote('Pull request opened on GitHub for review.')
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
    const outcome = (typeof onFeedback === 'function' && onFeedback(rec)) || {}
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
    <>
      {confirmingDismiss ? (
        <div className="co-confirm" role="alertdialog" aria-label="Confirm drop">
          <p className="co-confirm-text">
            Drop this prepared contribution? It moves to History — you can undrop
            it there anytime.
          </p>
          <div className="co-confirm-actions">
            <button
              type="button"
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
        <div className={`co-review-actions${isPr ? '' : ' is-secondary-only'}`}>
          {isPr ? (
            <button
              type="button"
              className="co-btn co-btn-primary"
              disabled={sending}
              onClick={send}
            >
              {sending ? 'Sending…' : 'Send PR'}
            </button>
          ) : null}
          <button type="button" className="co-btn" onClick={feedback}>
            Feedback
          </button>
          <button
            type="button"
            className="co-btn co-btn-sm co-btn-danger"
            onClick={() => setConfirmingDismiss(true)}
          >
            Drop
          </button>
        </div>
      )}
      {!isPr ? (
        <p className="co-review-note">
          Only prepared PRs can be sent to GitHub from here right now.
        </p>
      ) : (
        <p className="co-review-note">
          Send may bring your GitHub fork up to date before opening the PR.
        </p>
      )}
      {sendNote && <p className="co-review-note">{sendNote}</p>}
      {note && <p className="co-review-error">{note}</p>}
    </>
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
      {note && <p className="co-review-error">{note}</p>}
    </div>
  )
}

export function ContributionCard({
  rec,
  onSend,
  onFeedback,
  onDismiss,
  onRestore,
  loadDiff,
  reviewOnly = false,
}) {
  const status = rec.status || 'prepared'
  const statusLabel = STATUS_LABELS[status] || status
  const typeLabel = TYPE_LABELS[rec.type] || rec.type || 'Contribution'
  const when = timeAgo(rec.updated_at || rec.created_at)
  const [expanded, setExpanded] = useState(false)

  // Reflection engagement signal: fire once each time the review opens, never
  // on collapse. `expanded` only ever goes true for a plan card (both the
  // Review toggle and the whole-card tap gate on hasPlan), so this is
  // inherently scoped to real reviews and captures either open route.
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
  const reviewable =
    status === 'prepared' && (
      reviewOnly || (
        typeof onSend === 'function' && typeof onDismiss === 'function'
      )
    )
  const hasPlan = reviewable && rec.plan && typeof rec.plan === 'object'
  const wholeCardTarget = hasLink || hasPlan
  const reviewLabel =
    rec.plan?.action === 'pr' || rec.type === 'pr' ? 'Review PR' : 'Review'

  function openCardTarget() {
    if (hasPlan) {
      setExpanded(true)
      return
    }
    if (hasLink) {
      window.open(rec.url, '_blank', 'noopener,noreferrer')
    }
  }

  function handleCardClick(event) {
    if (!wholeCardTarget || isInteractiveTarget(event.target)) return
    openCardTarget()
  }

  return (
    <div
      className={`co-card${wholeCardTarget ? ' is-clickable' : ''}${reviewOnly ? ' is-stack-layer' : ''}`}
      onClick={handleCardClick}
    >
      <div className="co-card-top">
        {hasLink ? (
          <a
            className="co-card-title"
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {title}
          </a>
        ) : (
          <span className="co-card-title">{title}</span>
        )}
        <span className={`co-chip is-${status}`}>{statusLabel}</span>
      </div>
      {rec.summary ? <p className="co-card-summary">{rec.summary}</p> : null}
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
      {hasPlan && !expanded ? <PlanSummary rec={rec} /> : null}
      <SubmitErrorAlert rec={rec} />
      {hasPlan && (
        <button
          type="button"
          className="co-btn co-btn-sm co-review-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide review' : reviewLabel}
        </button>
      )}
      {reviewable && (!hasPlan || expanded) && (
        <div className="co-review">
          {hasPlan && <ReviewPlan rec={rec} loadDiff={loadDiff} />}
          {!reviewOnly && (
            <ReviewActions
              rec={rec}
              onSend={onSend}
              onFeedback={onFeedback}
              onDismiss={onDismiss}
            />
          )}
        </div>
      )}
      {status === 'abandoned' && typeof onRestore === 'function' && (
        <UndropAction rec={rec} onRestore={onRestore} />
      )}
    </div>
  )
}
