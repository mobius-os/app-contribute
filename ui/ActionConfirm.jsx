import { useEffect, useId, useRef, useState } from 'react'
import { focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { CloseWindowButton, WindowHead } from './WindowHead.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { NAMES } from '../names.js'
import { TickList } from './TickList.jsx'

const FACT_ICON = { ok: 'check', warn: 'info', bad: 'close' }

// The confirm sheet for one of the owner's own actions on a PR (Open for review,
// Merge; Request review may name several PRs in `pulls`): what it does, what GitHub shows right now, and one button. The X is
// the only way out, so there is no Cancel; a finished action swaps it for Done.
// `copy` is the words and the icon (see action-copy.js; `says` shows text the action will post, `disabled` keeps the button off while it is not ready); `onConfirm` runs the action and
// returns the outcome the app's handlers already use ({ ok } | { alreadyHandled }
// | { pending, error } | { error }). A { pending } outcome may have happened on GitHub: the sheet
// first has the owner's view read GitHub again (`onUnconfirmed`, read-only), and its button stays
// off for good, so another attempt can only start from that fresh read. Opened inside a ReviewDialog.
// `viaShell`: Möbius confirms this action on its own sheet (owner-grant.js) before `onConfirm` sends anything. From the press until that
// sheet is answered this one is in the empty phase 'asking' (a waiting line only); `onConfirm` is given `onConfirmed` to call when
// the owner has confirmed, and only then does the sheet say it is at work. `onConfirm` may answer { cancelled } (the owner closed Möbius's
// sheet): nothing was sent, so the choices come back. `autoConfirm` (with `viaShell`): the one tap on the action already was the owner's
// press, so this sheet opens asking and runs `onConfirm` itself, and a cancel closes it. `onConfirm` also gets the ticked `people`
// and the text the sheet showed for them (`note`): what is sent is what was read, not a rebuild of it.
export function ActionConfirm({ pr, pulls = null, copy, onConfirm, onClose, onDone, onUnconfirmed, viaShell = false, autoConfirm = false }) {
  const region = useRef(null)
  const titleId = useId()
  const [phase, setPhase] = useState(autoConfirm ? 'asking' : 'confirm')
  const [error, setError] = useState('')
  // An action with ways to do it (Merge: squash, merge commit, rebase) asks once, in the sheet.
  const [picked, setPicked] = useState(copy.choices?.value || '')
  // An action that names people (Ask for approval, Ask for re-review) lists them with a tick each, and the sheet's words
  // follow the ticks: `copy.forPicked` words it for whoever is ticked, in the list's order.
  const [ticked, setTicked] = useState(() => (copy.people?.options || []).filter(option => option.ticked).map(option => option.key))
  const pickedPeople = (copy.people?.options || []).map(option => option.key).filter(key => ticked.includes(key))
  const live = copy.forPicked ? copy.forPicked(pickedPeople) : copy
  const [result, setResult] = useState(null)
  useEffect(() => { focusActionRegion(region.current); if (autoConfirm) void confirm() }, [])
  // Waiting for Möbius's sheet, writing, or reading GitHub back after a write that could not be confirmed.
  const working = phase === 'asking' || phase === 'working' || phase === 'checking'
  async function confirm() {
    setPhase(viaShell ? 'asking' : 'working'); setError('')
    let outcome
    // A handler that throws never said whether the write reached GitHub.
    try { outcome = await onConfirm({ choice: picked, people: pickedPeople, note: live.says?.markdown, onConfirmed: () => setPhase('working') }) } catch { outcome = { pending: true, error: 'Lost contact with GitHub. Check the PR before trying again.' } }
    if (outcome?.cancelled) { setPhase('confirm'); if (autoConfirm) onClose(); return }
    if (outcome?.ok || outcome?.alreadyHandled) { setResult(outcome); setPhase('done'); onDone?.(outcome); return }
    setError(outcome?.error || 'Could not complete this. Nothing changed.')
    if (!outcome?.pending) { setPhase('confirm'); return }
    // An unconfirmed result is read back, never repeated from here.
    setPhase('checking')
    try { await onUnconfirmed?.() } catch { /* the view shows its own read error */ }
    setPhase('unconfirmed')
  }
  const done = phase === 'done'
  // Möbius's sheet is the owner's view of what happens; until this action has an outcome this one shows only a line.
  const lineOnly = viaShell && (phase === 'asking' || phase === 'working')
  const finished = typeof live.done === 'function' ? live.done(result) : live.done
  const selected = copy.choices?.options.find(option => option.key === picked)
  return <section ref={region} tabIndex={-1} className="co-review-window" aria-labelledby={titleId}>
    <WindowHead icon={done ? 'check' : live.icon} title={done ? finished.title : live.title} titleId={titleId} pulls={pulls || [pr]} done={done}
      tools={done ? null : <CloseWindowButton disabled={working} onClick={onClose} />} />
    {done ? <div className="co-rw-body"><p className="co-rw-result" role="status">{finished.text}</p>{/^https:\/\//.test(finished.link?.href || '') ? <a className="co-btn co-btn-quiet" href={finished.link.href} target="_blank" rel="noopener noreferrer">{finished.link.label}</a> : null}</div> : lineOnly ? <div className="co-rw-body"><p role="status">{phase === 'asking' ? NAMES.waitingForMobius : live.working}</p></div> : <div className="co-rw-body">
      <ul className="co-rw-facts">{live.facts.map(fact => <li key={fact.text} className={'is-' + fact.tone}><Icon name={FACT_ICON[fact.tone]} size={18} /><span>{fact.text}</span></li>)}</ul>
      {copy.people ? <>
        <h4 className="co-rw-label">{copy.people.label}</h4>
        <TickList label={copy.people.label} disabled={working} items={copy.people.options.map(option => ({ key: option.key, label: option.label, detail: option.detail, checked: ticked.includes(option.key) }))}
          onToggle={(key, checked) => setTicked(old => (checked ? [...old, key] : old.filter(item => item !== key)))} />
      </> : null}
      {live.says ? <details className="co-task-details" open><summary>{live.says.label}</summary><MarkdownView markdown={live.says.markdown} /></details> : null}
      {copy.choices ? <>
        <h4 className="co-rw-label">{copy.choices.label}</h4>
        <div className="co-rw-rungs" role="radiogroup" aria-label={copy.choices.label}>
          {copy.choices.options.map(option => <button key={option.key} type="button" role="radio" aria-checked={picked === option.key} disabled={working}
            className={'co-rw-rung' + (picked === option.key ? ' is-on' : '')} onClick={() => setPicked(option.key)}>
            <i aria-hidden="true" /><span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </button>)}
        </div>
      </> : null}
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </div>}
    {lineOnly ? null : <footer className="co-rw-foot">
      {done ? null : <p>{live.footnote}</p>}
      <div className="co-rw-actions">
        {done
          ? <button type="button" className="co-btn co-btn-primary" onClick={onClose}>Done</button>
          : <button type="button" className="co-btn co-btn-primary" disabled={working || phase === 'unconfirmed' || live.disabled === true} aria-busy={working} onClick={confirm}>{phase === 'checking' ? 'Checking GitHub…' : working ? live.working : selected?.action || live.confirm}</button>}
      </div>
    </footer>}
  </section>
}
