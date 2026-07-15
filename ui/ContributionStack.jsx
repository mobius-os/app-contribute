import React, { useState } from 'react'
import { stackMeta, stackProgress } from '../stack.js'
import { ContributionCard } from './ContributionCard.jsx'

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
  onSendStack,
  onFeedback,
  loadDiff,
}) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const progress = stackProgress(unit)
  const ready = unit.records.filter((rec) => rec.status === 'prepared')

  async function send() {
    setSending(true)
    setNote('')
    try {
      const outcome = (await onSendStack(unit.records)) || {}
      if (outcome.ok) {
        setNote(`${outcome.submitted || ready.length} linked pull requests opened on GitHub.`)
        setConfirming(false)
      } else {
        setNote(outcome.error || 'Could not submit this PR stack.')
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
      draft: `Feedback on PR stack ${unit.name} (${unit.id}): `,
    }) || {}
    if (!outcome.ok) setNote('Open Contribute inside Möbius to return to the source chat.')
  }

  return (
    <article className="co-stack-card">
      <header className="co-stack-head">
        <div>
          <span className="co-stack-kicker">PR stack · {progress.total} layers</span>
          <h3>{unit.name}</h3>
          <p>
            {progress.ready > 0 ? `${progress.ready} ready` : 'All layers sent'}
            {progress.open > 0 ? ` · ${progress.open} open` : ''}
            {progress.merged > 0 ? ` · ${progress.merged} merged` : ''}
          </p>
        </div>
        <span className="co-stack-chip">Linked</span>
      </header>

      <StackRail records={unit.records} />

      <div className="co-stack-layers">
        {unit.records.map((rec) => (
          <ContributionCard
            key={rec.id}
            rec={rec}
            reviewOnly={rec.status === 'prepared'}
            onFeedback={onFeedback}
            loadDiff={loadDiff}
          />
        ))}
      </div>

      {confirming ? (
        <div className="co-stack-confirm" role="alertdialog" aria-label="Confirm PR stack publish">
          <strong>Publish {ready.length} linked {ready.length === 1 ? 'PR' : 'PRs'}?</strong>
          <p>
            Contribute will publish these upstream stack branches and open each
            pull request against the layer immediately below it.
          </p>
          <ol>
            {ready.map((rec) => {
              const meta = stackMeta(rec)
              return (
                <li key={rec.id}>
                  <span>{rec.title || branchOf(rec)}</span>
                  <code>{meta?.baseBranch} → {branchOf(rec)}</code>
                </li>
              )
            })}
          </ol>
          <div className="co-confirm-actions">
            <button type="button" className="co-btn co-btn-sm" disabled={sending} onClick={() => setConfirming(false)}>
              Keep private
            </button>
            <button type="button" className="co-btn co-btn-primary" disabled={sending} onClick={send}>
              {sending ? 'Publishing stack…' : `Publish ${ready.length} ${ready.length === 1 ? 'PR' : 'PRs'}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="co-stack-actions">
          <button type="button" className="co-btn co-btn-primary" onClick={() => setConfirming(true)}>
            Send {ready.length}-PR stack
          </button>
          <button type="button" className="co-btn" onClick={feedback}>Feedback</button>
        </div>
      )}
      {note && <p className={note.includes('opened') ? 'co-review-note' : 'co-review-error'}>{note}</p>}
    </article>
  )
}
