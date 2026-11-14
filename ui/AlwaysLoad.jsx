import { useId, useState } from 'react'
import { NAMES } from '../names.js'
import { Icon } from './Icons.jsx'

// The owner's button for one repository: its pull requests are read in the background and kept up to date, so they are
// there when it is opened. A preference of this workspace; it changes nothing the repository allows (repositories.js).
// A toggle button, so the name stays "Auto-sync" and aria-pressed carries the state. The eye gets it from more than colour:
// green, a solid edge and the turning arrows while on; grey, a dashed edge and the arrows struck through while off.
export function AlwaysLoad({ repo, pinned, onChange }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const hint = useId()
  async function change() {
    setBusy(true); setFailed(false)
    try { await onChange(repo, !pinned) } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <div className="co-pin">
    <button type="button" className="co-btn co-btn-chip co-pin-btn" aria-pressed={pinned} aria-describedby={hint} title={NAMES.autoSyncHint} disabled={busy} onClick={change}>
      <Icon name={pinned ? 'sync' : 'syncOff'} size={14} /><span>{NAMES.autoSync}</span>
    </button>
    <small id={hint} className={failed ? 'co-pin-failed' : 'co-visually-hidden'} role={failed ? 'alert' : undefined}>{failed ? 'Could not save this. Try again.' : NAMES.autoSyncHint}</small>
  </div>
}
