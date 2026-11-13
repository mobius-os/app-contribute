import { useState } from 'react'
import { followingLine, isAutopilotEnabled } from '../autopilot.js'
import { NAMES } from '../names.js'
import { Icon } from './Icons.jsx'

// Pause or Resume following for one record: the one control both the saved card's panel and the PR page's Following line
// use. It calls the platform through `onSetAutopilot(rec, enabled)` (never a ledger write) and hands a refusal to `onNote`.
export function PauseResume({ rec, onSetAutopilot, onNote, className = '' }) {
  const [busy, setBusy] = useState(false)
  const enabled = isAutopilotEnabled(rec)
  async function toggle() {
    setBusy(true)
    onNote(null)
    const outcome = (await onSetAutopilot(rec, !enabled)) || {}
    if (outcome.error) onNote(outcome.error)
    setBusy(false)
  }
  return <button type="button" className={`co-btn ${className}`} onClick={toggle} disabled={busy}>{busy ? '…' : enabled ? NAMES.pause : NAMES.resume}</button>
}

// The quiet Following line under a PR page's facts: whether an agent follows this PR, what it last did, and Pause or
// Resume. Absent for a PR that is not followed. The words are fixed sentences, never the agent's or a reviewer's text.
export function FollowLine({ record, onSetAutopilot, readOnly = false }) {
  const [note, setNote] = useState(null)
  const line = followingLine(record)
  if (!line) return null
  return <div className="co-follow-line">
    <p role="status"><Icon name="cycle" size={15} /><span><b>{line.label}</b> · {line.text}</span></p>
    {!readOnly && typeof onSetAutopilot === 'function' ? <PauseResume rec={record} onSetAutopilot={onSetAutopilot} onNote={setNote} className="co-btn-quiet co-follow-toggle" /> : null}
    {note ? <p className="co-follow-error" role="alert">{note}</p> : null}
  </div>
}
