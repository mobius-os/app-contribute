import React, { useEffect, useId, useRef, useState } from 'react'
import {
  stackLandingReadiness,
  stackMeta,
  stackProgress,
  stackReadiness,
} from '../stack.js'
import { blockedReviewCount, reviewStateFor } from '../review.js'
import { ContributionCard } from './ContributionCard.jsx'
import { Icon } from './Icons.jsx'

function branchOf(rec) {
  return rec?.plan?.branch || rec?.branch || 'branch unavailable'
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
  reviewStatus,
  onSendStack,
  onLandStack,
  onFeedback,
  loadDiff,
}) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendElapsed, setSendElapsed] = useState(0)
  const [note, setNote] = useState('')
  const isLandingAction = action === 'land'
  const progress = stackProgress(unit)
  const ready = unit.records.filter((rec) => rec.status === 'prepared')
  const readiness = isLandingAction
    ? stackLandingReadiness(unit)
    : stackReadiness(unit)
  const blocked = isLandingAction ? 0 : blockedReviewCount(unit.records, reviewStatus)
  const canAct = readiness.ok && blocked === 0
  const keepPrivateRef = useRef(null)
  const readinessId = useId()
  const confirmDescriptionId = useId()

  useEffect(() => {
    if (confirming) keepPrivateRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!canAct && confirming) setConfirming(false)
  }, [canAct, confirming])

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

  async function runAction() {
    if (!canAct) return
    setSending(true)
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
        setNote('Publishing is still in progress for this chain. Contribute will update each change as it finishes.')
        setConfirming(false)
      } else {
        setNote(outcome.error || (isLandingAction
          ? 'Could not land this PR stack.'
          : 'Could not submit this PR stack.'))
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
                : isLandingAction && readiness.ok
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
                loadDiff={loadDiff}
              />
            ))}
          </div>
        </div>
      </details>

      {blocked > 0 ? (
        <div
          id={readinessId}
          className={'co-stack-warning' + (isLandingAction && readiness.code !== 'failed' ? ' is-progress' : '')}
          role="status"
        >
          <strong>{blocked} {blocked === 1 ? 'change needs' : 'changes need'} another look</strong>
          <span>Sending is paused until the agent updates the review.</span>
        </div>
      ) : !readiness.ok && !['settled', 'landing'].includes(readiness.code) ? (
        <div id={readinessId} className="co-stack-warning" role="status">
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
      ) : null}

      {confirming ? (
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
            <button type="button" className="co-btn co-btn-primary" disabled={sending} onClick={runAction}>
              {sending ? (isLandingAction ? 'Landing…' : 'Sending…') : (isLandingAction ? 'Land stack' : 'Send for review')}
            </button>
          </div>
          {sending ? (
            <p className="co-review-note" role="status" aria-live="polite">
              {isLandingAction ? 'Landing the verified changes together' : 'Publishing the reviewed pull requests in order'}
              {sendElapsed >= 5 ? ` · ${sendElapsed}s elapsed` : '…'}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="co-stack-actions">
          <button
            type="button"
            className="co-icon-btn co-send-btn is-primary"
            disabled={!canAct}
            aria-label={isLandingAction
              ? (canAct ? 'Land green stack' : readiness.message)
              : (blocked > 0 ? 'Fresh review required before sending' : 'Send related changes for review')}
            title={isLandingAction ? (canAct ? 'Land stack' : 'Not ready to land') : (blocked > 0 ? 'Fresh review required' : 'Send for review')}
            aria-describedby={
              !canAct && (blocked > 0 || readiness.code !== 'settled')
                ? readinessId
                : undefined
            }
            onClick={() => setConfirming(true)}
          >
            <Icon name={isLandingAction ? 'merge' : 'send'} />
            <span>{isLandingAction ? 'Land' : 'Send'}</span>
          </button>
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
      )}
      {note && (
        <p
          className={note.includes('opened') || note.includes('landed') || note.startsWith('Publishing')
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
