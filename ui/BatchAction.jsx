import { useEffect, useId, useRef, useState } from 'react'

export function BatchAction({
  count,
  eyebrow,
  title,
  description,
  actionLabel,
  confirmTitle,
  confirmBody,
  items = [],
  onAction,
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [note, setNote] = useState('')
  const [noteTone, setNoteTone] = useState('quiet')
  const cancelRef = useRef(null)
  const descriptionId = useId()
  const needsConfirmation = !!confirmTitle

  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
  }, [confirming])

  if (!count) return null

  async function run() {
    setBusy(true)
    setNote('')
    setNoteTone('quiet')
    setProgress(null)
    try {
      const outcome = (await onAction?.((next) => setProgress(next))) || {}
      if (outcome.ok) {
        setNote(outcome.message || 'Done.')
        setNoteTone('quiet')
        setConfirming(false)
      } else if (outcome.pending) {
        setNote(outcome.message || 'Publishing is still in progress. The feed will update as it settles.')
        setNoteTone('quiet')
        setConfirming(false)
      } else {
        setNote(outcome.error || 'Could not complete this batch.')
        setNoteTone('error')
      }
    } finally {
      setBusy(false)
    }
  }

  function start() {
    if (needsConfirmation) {
      setNote('')
      setConfirming(true)
      return
    }
    run()
  }

  return (
    <section className="co-batch-action" aria-label={title}>
      <div className="co-batch-copy">
        <span>{eyebrow}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className="co-btn co-btn-primary co-batch-button"
        disabled={busy}
        onClick={start}
      >
        {busy && !confirming ? 'Opening…' : actionLabel}
      </button>

      {confirming ? (
        <div
          className="co-batch-confirm"
          role="alertdialog"
          aria-label={confirmTitle}
          aria-describedby={descriptionId}
        >
          <strong>{confirmTitle}</strong>
          <p id={descriptionId}>{confirmBody}</p>
          {items.length > 0 ? (
            <ol className="co-batch-list">
              {items.map((item) => <li key={item.id}>{item.label}</li>)}
            </ol>
          ) : null}
          <div className="co-confirm-actions">
            <button
              ref={cancelRef}
              type="button"
              className="co-btn co-btn-sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Keep private
            </button>
            <button
              type="button"
              className={'co-btn co-btn-primary' + (busy ? ' is-sending' : '')}
              disabled={busy}
              aria-busy={busy}
              onClick={run}
            >
              {busy ? 'Sending…' : actionLabel}
            </button>
          </div>
          {busy && progress ? (
            <p className="co-review-note" role="status" aria-live="polite">
              Sending {progress.done + 1} of {progress.total}: {progress.label}
            </p>
          ) : null}
        </div>
      ) : null}

      {note ? (
        <p
          className={noteTone === 'error' ? 'co-review-error' : 'co-review-note'}
          role="status"
          aria-live="polite"
        >
          {note}
        </p>
      ) : null}
    </section>
  )
}
