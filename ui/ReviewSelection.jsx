import { useEffect, useRef, useState } from 'react'
import { collaborationRequest } from '../collaboration.js'
import { inspectReviewSelection, loadReviewSelection } from '../review-selection.js'
import { ReviewConfirmation } from './PullRequests.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'

export function ReviewSelection({ selectionId, appId, token, onClose }) {
  const [state, setState] = useState({ loading: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState(null)
  const attempt = useRef(0)
  const inFlight = useRef(false)
  async function load() {
    const current = ++attempt.current
    setState({ loading: true }); setError(''); setMode(null)
    try {
      const request = await loadReviewSelection(selectionId)
      const { runs } = await collaborationRequest(token, appId, 'review-runs')
      const existing = runs.find(run => run.request_id === selectionId)
      const choice = existing ? null : await inspectReviewSelection(token, request)
      if (current === attempt.current) setState({ request, choice, run: existing })
    } catch (error) { if (current === attempt.current) setState({ error: error.message }) }
  }
  useEffect(() => { void load(); return () => { attempt.current += 1 } }, [selectionId, appId, token])
  const choice = state.choice ? { ...state.choice, mode: mode || state.choice.mode } : null
  const blockedMerge = choice?.mode === 'review_merge' && !choice.canMerge
  async function approve() {
    if (inFlight.current || !choice || blockedMerge) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const current = await loadReviewSelection(selectionId)
      if (JSON.stringify(current) !== JSON.stringify(state.request)) throw new Error('This proposal changed while you were reading it. Reopen the link before approving.')
      await inspectReviewSelection(token, current)
      const { run } = await collaborationRequest(token, appId, 'review-runs', { ...current, mode: choice.mode })
      setState(old => ({ ...old, choice: null, run }))
    } catch (error) { setError(error.message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section className="co-selection-page" aria-label="Contribution approval">
    <button className="co-quiet-action" onClick={onClose}><Icon name="left" size={16} /> Back to projects</button>
    {state.loading ? <p role="status">Checking the selected contributions…</p> : null}
    {state.error ? <div role="alert"><h2>Could not open this review</h2><p>{state.error}</p><button className="co-btn" onClick={load}>Retry</button></div> : null}
    {state.run ? <><h2>Review {state.run.state === 'complete' ? 'complete' : 'already started'}</h2><p>This selection has one owning conversation. No additional approval is needed.</p><button className="co-btn co-btn-primary" onClick={() => openAgentConversation(state.run.chat_id)}>Open review conversation</button></> : null}
    {choice ? <>
      <ReviewConfirmation choice={choice} busy={busy} disabled={blockedMerge} error={error} onConfirm={approve} onCancel={onClose} onModeChange={setMode} />
      {blockedMerge ? <p role="status">Merging is not available for this selection. <button className="co-quiet-action" onClick={() => setMode('review')}>Review privately instead</button></p> : null}
    </> : null}
  </section>
}
