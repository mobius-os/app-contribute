import { useEffect, useId, useRef } from 'react'
import { ReviewDialog } from './ReviewDialog.jsx'
import { WindowHead } from './WindowHead.jsx'

// A question that must be answered before something that cannot be taken back (Withdraw a PR, Discard a draft): the
// shared window with the purple line, the question, one sentence and two equal buttons. Keep, the safe one, has
// focus when it opens; Escape or a click outside is Keep too. `confirm` is the red one, `busy` its working words.
export function ConfirmWindow({ label, eyebrow, title, text, keep, confirm, busy = false, working, onKeep, onConfirm }) {
  const keepRef = useRef(null)
  const titleId = useId()
  const textId = useId()
  useEffect(() => { keepRef.current?.focus() }, [])
  return <ReviewDialog role="alertdialog" label={label} onClose={onKeep}>
    <section className="co-review-window" aria-labelledby={titleId} aria-describedby={textId}>
      <WindowHead eyebrow={eyebrow} title={title} titleId={titleId} />
      <div className="co-rw-body"><p id={textId} className="co-rw-lede">{text}</p></div>
      <footer className="co-rw-foot"><div className="co-rw-actions">
        <button type="button" ref={keepRef} className="co-btn" disabled={busy} onClick={onKeep}>{keep}</button>
        <button type="button" className="co-btn co-btn-danger" disabled={busy} onClick={onConfirm}>{busy ? working : confirm}</button>
      </div></footer>
    </section>
  </ReviewDialog>
}
