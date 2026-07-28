import { useRef, useState } from 'react'

export function BatchAction({
  count,
  eyebrow,
  title,
  description,
  actionLabel,
  busyLabel = 'Starting…',
  items = [],
  onAction,
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [note, setNote] = useState('')
  const [noteTone, setNoteTone] = useState('quiet')
  const busyRef = useRef(false)

  if (!count) return null

  async function run() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNote('')
    setNoteTone('quiet')
    setProgress(null)
    try {
      const outcome = (await onAction?.((next) => setProgress(next))) || {}
      if (outcome.ok) {
        setNote(outcome.message || 'Done.')
        setNoteTone('quiet')
      } else if (outcome.pending) {
        setNote(outcome.message || 'Publishing is still in progress. The feed will update as it settles.')
        setNoteTone('quiet')
      } else {
        setNote(outcome.error || 'Could not complete this batch.')
        setNoteTone('error')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
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
        aria-busy={busy}
        onClick={run}
      >
        {busy ? busyLabel : actionLabel}
      </button>

      {busy && items.length > 0 ? (
        <div className="co-batch-queue" role="status" aria-live="polite">
          <strong>
            {progress
              ? `Sending ${progress.done + 1} of ${progress.total}: ${progress.label}`
              : 'Preparing send queue…'}
          </strong>
          <ol className="co-batch-list">
            {items.map((item, index) => {
              const state = progress == null || index > progress.done
                ? 'Waiting'
                : (index === progress.done ? 'Sending' : 'Sent')
              return (
                <li key={item.id} data-state={state.toLowerCase()}>
                  <span>{item.label}</span>
                  <small>{state}</small>
                </li>
              )
            })}
          </ol>
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
