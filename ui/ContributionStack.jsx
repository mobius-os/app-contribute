import React, { useEffect, useId, useRef, useState } from 'react'
import {
  sortStackRecords,
  stackLandingReadiness,
  stackMeta,
  stackProgress,
  stackReadiness,
} from '../stack.js'
import {
  blockedReviewCount,
  fixAndReviewAction,
  progressReviewAction,
  reviewStateFor,
} from '../review.js'
import { ContributionCard } from './ContributionCard.jsx'
import { AgentHandoffButton } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'

function branchOf(rec) {
  return rec?.plan?.branch || rec?.branch || 'branch unavailable'
}

// Copy for the "lands through GitHub" panel, keyed by the stack's check state.
const MERGE_COPY = {
  ready: {
    title: 'All checks passed',
    body: 'This repository merges on GitHub — open each pull request to merge it or add it to the queue.',
  },
  failed: {
    title: 'A check needs attention on GitHub',
    body: 'Open the pull request on GitHub to see the failing check, then merge there once it passes.',
  },
  running: {
    title: 'Checks are running on GitHub',
    body: 'They can be merged on GitHub once every check has passed.',
  },
}

// One status-banner tone rule: red only for a genuine failure or broken chain;
// a calm accent while a landing is in progress; neutral otherwise.
function warnTone(code, isLanding) {
  if (code === 'failed' || code === 'invalid') return ' is-error'
  return isLanding ? ' is-progress' : ''
}

// Open stacks whose target lands through GitHub's own merge/queue (protected or
// ruled default branch) show this calm path instead of a Land button that would
// only fail. Reuses the shared .co-stack-warning banner: accent when ready to
// merge, caution amber when a check failed, neutral while checks run.
function StackMergeNotice({ unit, readiness, readinessId }) {
  const key = readiness.code === 'ready' ? 'ready'
    : readiness.code === 'failed' ? 'failed'
    : 'running'
  const copy = MERGE_COPY[key]
  const links = sortStackRecords(unit.records).filter((rec) =>
    typeof rec.url === 'string' && rec.url.startsWith('https://github.com/'))
  return (
    <div
      id={readinessId}
      className={'co-stack-warning' + (key === 'ready' ? ' is-progress' : key === 'failed' ? ' is-attention' : '')}
      role="status"
    >
      <strong>{copy.title}</strong>
      <span>{copy.body}</span>
      {links.length > 0 ? (
        <div className="co-stack-merge-links">
          {links.map((rec) => (
            <a
              key={rec.id}
              className="co-review-link"
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {rec.number ? `Merge #${rec.number} ↗` : 'Open on GitHub ↗'}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function StackRail({ records }) {
  return (
    <div className="co-stack-rail" aria-label="Pull request chain">
      {records.map((rec) => {
        const meta = stackMeta(rec)
        return (
          <div className="co-stack-node" key={rec.id}>
            <span className="co-stack-node-dot" aria-hidden="true" />
            <span className="co-stack-node-layer">PR {meta?.position || '?'}</span>
            <code title={meta?.baseBranch || ''}>{meta?.baseBranch || 'unknown base'}</code>
            <span aria-hidden="true">→</span>
            <code title={branchOf(rec)}>{branchOf(rec)}</code>
          </div>
        )
      })}
    </div>
  )
}

export function ContributionStack({
  unit,
  action = 'send',
  landable = false,
  reviewStatus,
  onSendStack,
  onLandStack,
  onFeedback,
  onStartAgent,
  onSetAutopilot,
  loadDiff,
}) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [accepted, setAccepted] = useState(false)
  const isLandingAction = action === 'land'
  const progress = stackProgress(unit)
  const ready = unit.records.filter((rec) => rec.status === 'prepared')
  const readiness = isLandingAction
    ? stackLandingReadiness(unit)
    : stackReadiness(unit)
  // An open stack whose target can't be atomically landed here (protected or
  // ruled default branch, or no push) never gets a Land button that would only
  // fail — it lands through GitHub's own merge/queue, so we show that path.
  const mergeOnGitHub = isLandingAction && !landable
  const blocked = isLandingAction ? 0 : blockedReviewCount(unit.records, reviewStatus)
  const canAct = readiness.ok && blocked === 0
  const canRecoverLanding = isLandingAction && readiness.code === 'landing'
  const canRun = canAct || canRecoverLanding
  const repairAction = !isLandingAction && blocked > 0
    ? (progressReviewAction(unit.records, reviewStatus) || fixAndReviewAction(unit.records))
    : null
  const sendLabel = ready.length === 1 ? 'Send PR' : 'Send PRs'
  const keepPrivateRef = useRef(null)
  const readinessId = useId()
  const confirmDescriptionId = useId()

  useEffect(() => {
    if (confirming) keepPrivateRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!canAct && confirming) setConfirming(false)
  }, [canAct, confirming])

  async function runAction() {
    if (!canRun) return
    setSending(true)
    setAccepted(true)
    setNote('')
    try {
      const handler = isLandingAction ? onLandStack : onSendStack
      const outcome = (await handler?.(unit.records)) || {}
      if (outcome.ok) {
        setNote(isLandingAction
          ? `${outcome.landed || unit.records.length} verified changes landed together.`
          : `${outcome.submitted || ready.length} linked pull requests opened on GitHub.`)
        setConfirming(false)
      } else if (outcome.pending) {
        setNote(isLandingAction
          ? 'Landing is still being reconciled from its saved journal. Check again shortly.'
          : 'Publishing is still in progress for this chain. Contribute will update each change as it finishes.')
        setConfirming(false)
      } else {
        const recovery = !isLandingAction
          ? await onStartAgent?.(fixAndReviewAction(unit.records))
          : null
        if (!recovery?.ok) {
          setAccepted(false)
          setNote(outcome.error || recovery?.error || (isLandingAction
            ? 'Could not land this PR stack.'
            : 'Could not submit this PR stack.'))
        }
      }
    } catch {
      const recovery = !isLandingAction
        ? await onStartAgent?.(fixAndReviewAction(unit.records))
        : null
      if (!recovery?.ok) {
        setAccepted(false)
        setNote(recovery?.error || 'Could not continue this contribution stack.')
      }
    } finally {
      setSending(false)
    }
  }

  function feedback() {
    const rec = ready.find((item) => item.chat_id) || unit.records.find((item) => item.chat_id)
    if (!rec || typeof onFeedback !== 'function') {
      setNote('This stack does not know which source chat created it.')
      return
    }
    const outcome = onFeedback(rec, {
      draft: blocked > 0
        ? `Please refresh the reviewed source for PR stack ${unit.name} (${unit.id}). Contribute found ${blocked} stale ${blocked === 1 ? 'layer' : 'layers'}: `
        : `Feedback on PR stack ${unit.name} (${unit.id}): `,
    }) || {}
    if (!outcome.ok) setNote('Open Contribute inside Möbius to return to the source chat.')
  }

  if (accepted) return null

  return (
    <article className="co-stack-card">
      <header className="co-stack-head">
        <div>
          <span className="co-stack-kicker">{progress.total} related changes</span>
          <h3>{unit.name}</h3>
          <p>
            {progress.landing > 0
              ? 'Landing the verified stack…'
              : progress.ready > 0
                ? `${progress.ready} ready to send`
                : isLandingAction && landable && readiness.ok
                  ? 'Every check passed · ready to land'
                  : 'Everything has been sent'}
            {progress.open > 0 && !isLandingAction ? ` · ${progress.open} being reviewed` : ''}
            {progress.merged > 0 ? ` · ${progress.merged} complete` : ''}
          </p>
        </div>
      </header>

      <details className="co-stack-details">
        <summary>
          <span>Details</span>
          <Icon name="chevron" size={16} />
        </summary>
        <div className="co-stack-details-body">
          <StackRail records={unit.records} />
          <div className="co-stack-layers">
            {unit.records.map((rec) => (
              <ContributionCard
                key={rec.id}
                rec={rec}
                reviewOnly={rec.status === 'prepared'}
                reviewState={reviewStateFor(rec, reviewStatus)}
                onFeedback={onFeedback}
                onSetAutopilot={onSetAutopilot}
                loadDiff={loadDiff}
              />
            ))}
          </div>
        </div>
      </details>

      {mergeOnGitHub
        ? <StackMergeNotice unit={unit} readiness={readiness} readinessId={readinessId} />
        : null}

      {!mergeOnGitHub && (blocked > 0 ? (
        <div
          id={readinessId}
          className={'co-stack-warning' + (isLandingAction && readiness.code !== 'failed' ? ' is-progress' : '')}
          role="status"
        >
          <strong>{blocked} {blocked === 1 ? 'change needs' : 'changes need'} another look</strong>
          <span>Sending is paused until the agent updates the review.</span>
        </div>
      ) : !readiness.ok && !['settled', 'landing'].includes(readiness.code) ? (
        <div
          id={readinessId}
          className={'co-stack-warning' + warnTone(readiness.code, isLandingAction)}
          role="status"
        >
          <strong>{isLandingAction
            ? readiness.code === 'failed' ? 'Automated checks failed' : 'Waiting to land'
            : 'Not ready to send'}</strong>
          <span>{readiness.message}</span>
        </div>
      ) : readiness.code === 'landing' ? (
        <div id={readinessId} className="co-stack-warning is-progress" role="status">
          <strong>Landing in progress</strong>
          <span>The verified changes are being applied together.</span>
        </div>
      ) : null)}

      {!mergeOnGitHub && (confirming ? (
        <div
          className="co-stack-confirm"
          role="alertdialog"
          aria-label={isLandingAction ? 'Confirm PR stack landing' : 'Confirm PR stack publish'}
          aria-describedby={confirmDescriptionId}
        >
          <strong>{isLandingAction
            ? `Land ${unit.records.length} green changes together?`
            : `Send ${ready.length} related ${ready.length === 1 ? 'change' : 'changes'} for review?`}</strong>
          <p id={confirmDescriptionId}>
            {isLandingAction
              ? 'This advances the unchanged upstream branch to the top reviewed commit in one step. It stops safely if upstream moved.'
              : <>This will open the linked pull {ready.length === 1 ? 'request' : 'requests'} on GitHub. Nothing is merged automatically.</>}
          </p>
          <details className="co-stack-confirm-details">
            <summary>Technical order</summary>
            <ol>
              {(isLandingAction ? unit.records : ready).map((rec) => {
                const meta = stackMeta(rec)
                return (
                  <li key={rec.id}>
                    <span>{rec.title || branchOf(rec)}</span>
                    <code>{meta?.baseBranch} → {branchOf(rec)}</code>
                  </li>
                )
              })}
            </ol>
          </details>
          <div className="co-confirm-actions">
            <button ref={keepPrivateRef} type="button" className="co-btn co-btn-sm" disabled={sending} onClick={() => setConfirming(false)}>
              {isLandingAction ? 'Keep open' : 'Keep private'}
            </button>
            <button
              type="button"
              className={'co-btn co-btn-primary' + (sending ? ' is-sending' : '')}
              disabled={sending}
              onClick={runAction}
              aria-busy={sending}
            >
              <span className="co-action-label">
                <span>{isLandingAction ? 'Land stack' : 'Send for review'}</span>
                {sending ? (
                  <span className="co-action-label-sweep" aria-hidden="true">
                    {isLandingAction ? 'Land stack' : 'Send for review'}
                  </span>
                ) : null}
              </span>
            </button>
          </div>
        </div>
      ) : (
        <div className="co-stack-actions">
          {repairAction ? (
            <AgentHandoffButton
              action={repairAction}
              onStart={onStartAgent}
              className="co-icon-btn co-review-btn is-primary"
              icon="review"
            />
          ) : <button
            type="button"
            className="co-icon-btn co-send-btn is-primary"
            disabled={!canRun}
            aria-label={isLandingAction
              ? (canRecoverLanding ? 'Check landing status' : canAct ? 'Land green stack' : readiness.message)
              : (blocked > 0 ? 'Fresh review required before sending' : 'Send related changes for review')}
            title={isLandingAction ? (canRecoverLanding ? 'Check landing status' : canAct ? 'Land stack' : 'Not ready to land') : (blocked > 0 ? 'Fresh review required' : 'Send for review')}
            aria-describedby={
              !canAct && (blocked > 0 || readiness.code !== 'settled')
                ? readinessId
                : undefined
            }
            onClick={() => canRecoverLanding ? runAction() : setConfirming(true)}
          >
            <Icon name={isLandingAction ? 'merge' : 'send'} />
            <span>{canRecoverLanding ? 'Check' : isLandingAction ? 'Land' : sendLabel}</span>
          </button>}
          {!isLandingAction && <button
            type="button"
            className="co-icon-btn"
            onClick={feedback}
            aria-label={blocked > 0 ? 'Ask agent to update this review' : 'Give feedback'}
            title={blocked > 0 ? 'Ask agent to update' : 'Give feedback'}
          >
            <Icon name="feedback" />
          </button>}
        </div>
      ))}
      {!mergeOnGitHub && note && (
        <p
          className={note.includes('opened') || note.includes('landed') || note.startsWith('Publishing') || note.startsWith('Landing')
            ? 'co-review-note'
            : 'co-review-error'}
          role="status"
          aria-live="polite"
        >
          {note}
        </p>
      )}
    </article>
  )
}
