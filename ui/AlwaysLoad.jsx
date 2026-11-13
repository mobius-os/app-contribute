import { useState } from 'react'
import { NAMES } from '../names.js'

// The owner's switch for one repository: its pull requests are read in the background and kept up to date, so they are
// there when it is opened. A preference of this workspace; it changes nothing the repository allows (repositories.js).
export function AlwaysLoad({ repo, pinned, onChange }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  async function change(on) {
    setBusy(true); setFailed(false)
    try { await onChange(repo, on) } catch { setFailed(true) } finally { setBusy(false) }
  }
  return <div className="co-pin">
    <label className="co-pin-switch">
      <span>{NAMES.alwaysLoad}</span>
      <input type="checkbox" role="switch" className="co-switch" checked={pinned} disabled={busy} aria-checked={pinned} aria-describedby="co-pin-hint" onChange={event => change(event.target.checked)} />
    </label>
    <small id="co-pin-hint" role={failed ? 'alert' : undefined}>{failed ? 'Could not save this. Try again.' : 'Keeps this repository’s pull requests up to date in the background.'}</small>
  </div>
}
