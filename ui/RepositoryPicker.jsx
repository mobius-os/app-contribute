import { useState } from 'react'
import { discoverRepository } from '../collaboration.js'
import { followRepository } from '../repositories.js'

export function RepositoryPicker({ token, connected, onAdded }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  async function add(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const repo = await discoverRepository(token, value)
      const followed = await followRepository(repo.nameWithOwner)
      onAdded?.(repo, followed)
      setValue(''); setOpen(false)
    } catch (error) { setError(error.message || 'Could not add this repository. Try again.') }
    finally { setBusy(false) }
  }
  return <details className="co-repository-picker" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Add repository</summary>
    {connected ? <form onSubmit={add}>
      <label htmlFor="co-repository-name">GitHub repository</label>
      <div><input id="co-repository-name" value={value} onChange={event => setValue(event.target.value)} placeholder="owner/project or GitHub URL" disabled={busy} autoComplete="off" required />
      <button className="co-btn" disabled={busy || !value.trim()}>{busy ? 'Adding…' : 'Add'}</button></div>
      <p>Follow contributions here without installing the project.</p>
      {error ? <p className="co-run-error" role="alert">{error}</p> : null}
    </form> : <p>Connect GitHub in the top right to add a repository.</p>}
  </details>
}
