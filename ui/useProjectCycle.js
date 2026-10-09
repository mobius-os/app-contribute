// Project-local progress over the platform's durable conversation owner.
import { useCallback, useEffect, useRef, useState } from 'react'
import { claimProjectCycle, loadCycleState, settleProjectCycleClaim } from '../storage.js'
import { openAgentConversation } from './BatchAction.jsx'

// Observe explicit runtime facts; an unavailable or incomplete status is not
// evidence that the owner paused, stopped, or completed the work.
export function projectCyclePhase(runtime) {
  if (!runtime || typeof runtime !== 'object' || runtime.error) return 'unknown'
  if (runtime.running === true) return 'running'
  if (runtime.pending_question_id) return 'waiting'
  const status = runtime.goal?.status || runtime.status
  if (status === 'failed') return 'failed'
  if (status === 'paused') return 'paused'
  if (['stopped', 'cancelled', 'canceled'].includes(status)) return 'stopped'
  if (['completed', 'complete', 'succeeded'].includes(status)) return 'complete'
  return runtime.running === false ? 'inactive' : 'unknown'
}

export function useProjectCycle(projectKey, startAgentTask) {
  const [cycle, setCycle] = useState({ phase: 'restoring', chatId: '', history: [], error: '' })
  const alive = useRef(true)
  const identity = useRef(projectKey)
  identity.current = projectKey
  const starting = useRef(false)
  const observation = useRef(0)
  const refresh = useCallback(async (saved, { afterStop = false, reconcile = false, generation } = {}) => {
    const requestedProject = projectKey
    try {
      const runtime = await window.mobius.chat.status(saved.chat_id)
      const phase = projectCyclePhase(runtime)
      if (alive.current && identity.current === requestedProject && (generation === undefined || generation === observation.current)) setCycle(current => current.chatId !== saved.chat_id || (current.pending && !reconcile) || (current.phase === 'stopping' && !afterStop) ? current : ({
        ...current, phase, runtime, pending: reconcile && phase !== 'unknown' ? false : current.pending,
        chatTitle: runtime?.title || runtime?.chat_title || runtime?.chat?.title || current.chatTitle,
        error: phase === 'unknown' ? 'Progress is unavailable. Open the conversation to check.' : current.shortcutError || '',
      }))
    } catch {
      if (alive.current && identity.current === requestedProject && (generation === undefined || generation === observation.current)) setCycle(current => current.chatId !== saved.chat_id || (current.pending && !reconcile) || (current.phase === 'stopping' && !afterStop) ? current : ({ ...current, phase: 'unknown', runtime: null, error: 'Progress is unavailable. Open the conversation to check.' }))
    }
  }, [projectKey])
  // Both mount and explicit Refresh observe the same saved owner. Empty or
  // unavailable reads never release a reservation or admit another start.
  const recheck = useCallback(async () => {
    if (starting.current) return
    const requestedProject = projectKey
    const generation = ++observation.current
    const current = () => alive.current && identity.current === requestedProject && observation.current === generation
    let saved, unavailable = false
    try { saved = await loadCycleState(requestedProject) }
    catch { unavailable = true; /* Unavailable saved state is not evidence of no work. */ }
    if (!current()) return
    if (!saved) {
      setCycle(previous => unavailable || previous.pending || previous.chatId || previous.phase === 'unknown'
        ? { ...previous, phase: 'unknown', error: 'Saved work could not be checked. Refresh before starting another task.' }
        : { phase: 'idle', chatId: '', history: [], error: '' })
      return
    }
    const base = { chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, history: saved.history || [], error: '' }
    if (saved.pending) {
      const unresolved = { ...base, pending: true, phase: 'unknown', error: 'A cycle start is unresolved. Refresh to check again; no duplicate work was started.' }
      setCycle(unresolved)
      try {
        const scope = `contribute-cycle:${saved.pending.id}`
        const matches = await window.mobius.chat.list({ scope })
        if (!current()) return
        // The exact scope must have one unambiguous owner. Never start,
        // stop, or release a claim in response to an empty lookup.
        const found = Array.isArray(matches) && matches.length === 1 ? matches[0] : null
        if (found?.id) {
          const recorded = await settleProjectCycleClaim(requestedProject, saved.pending.id, {
            chat_id: String(found.id), title: saved.pending.title || found.title,
            event: saved.pending.event, started_at: found.created_at || new Date().toISOString(), scope,
          })
          if (!current() || !recorded) return
          const recovered = await loadCycleState(requestedProject)
          if (!current()) return
          if (recovered?.chat_id === String(found.id) && !recovered.pending && recovered.scope === scope) {
            setCycle({ phase: 'checking', chatId: recovered.chat_id, title: recovered.title, event: recovered.event, startedAt: recovered.started_at, history: recovered.history || [], error: '' })
            await refresh(recovered, { generation })
          }
        }
      } catch { /* Uncertain admission stays reserved. */ }
      return
    }
    // A Stop with a lost response has no new admission claim. Keep its local
    // uncertainty until a read of this same saved conversation proves status.
    setCycle(previous => ({ ...base, pending: previous.chatId === saved.chat_id && previous.pending, phase: 'checking' }))
    await refresh(saved, { afterStop: true, reconcile: true, generation })
  }, [projectKey, refresh])
  useEffect(() => {
    alive.current = true
    void recheck()
    return () => { alive.current = false; observation.current++ }
  }, [projectKey, recheck])
  useEffect(() => {
    if (!cycle.chatId || cycle.pending) return
    const check = () => { if (!document.hidden) void refresh({ chat_id: cycle.chatId }) }
    // The conversation is durable; this mounted view only observes it.
    const timer = cycle.phase === 'complete' ? null : setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [cycle.chatId, cycle.pending, cycle.phase, refresh])
  async function start(action) {
    if (!action || starting.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', 'checking', 'starting', 'running', 'waiting', 'stopping', 'unknown'].includes(cycle.phase)) return { ok: false, error: 'Check or stop the current work before starting another cycle.' }
    starting.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    let claim
    try { claim = await claimProjectCycle(requestedProject, previous.chatId, action) }
    catch { claim = { ok: false, error: 'Could not reserve this project cycle. Refresh and try again.' } }
    if (!claim.ok) {
      if (alive.current && identity.current === requestedProject) setCycle({ ...previous, error: claim.error })
      starting.current = false
      return claim
    }
    try {
      const scopedAction = { ...action, scope: `contribute-cycle:${claim.id}` }
      const outcome = await startAgentTask(scopedAction)
      if (!outcome?.ok) {
        if (alive.current && identity.current === requestedProject) setCycle({ ...previous, pending: true, phase: 'unknown', error: 'Could not confirm whether work started. Refresh to check before trying again.' })
        return outcome
      }
      const saved = { chat_id: outcome.chatId, title: action.title, event: action.event, started_at: new Date().toISOString(), scope: scopedAction.scope }
      const recorded = await settleProjectCycleClaim(requestedProject, claim.id, saved)
      const shortcutError = recorded ? '' : 'Work started, but its project shortcut could not be saved. Open this conversation and refresh before another cycle.'
      const history = previous.chatId ? [{ chat_id: previous.chatId, title: previous.title, event: previous.event, started_at: previous.startedAt }, ...(previous.history || [])] : previous.history || []
      if (alive.current && identity.current === requestedProject) setCycle({ shortcutError, phase: recorded ? 'running' : 'unknown', chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, history, error: shortcutError })
      return { ok: true, chatId: outcome.chatId }
    } catch {
      const error = 'Could not start the agent. Try again.'
      if (alive.current && identity.current === requestedProject) setCycle({ ...previous, pending: true, phase: 'unknown', error: 'Could not confirm whether work started. Refresh to check before trying again.' })
      return { ok: false, error }
    } finally { starting.current = false }
  }
  async function stop() {
    const chatId = cycle.chatId
    const requestedProject = projectKey
    if (!chatId) return
    observation.current++
    setCycle(current => current.chatId === chatId ? ({ ...current, phase:'stopping' }) : current)
    try {
      const stopped = await window.mobius.chat.stop(chatId)
      if (stopped?.stopped !== true) throw new Error('Stop not confirmed')
      if (identity.current === requestedProject) await refresh({ chat_id:chatId }, { afterStop: true })
    } catch {
      if (identity.current === requestedProject) setCycle(current => current.chatId === chatId ? ({ ...current, pending: true, phase:'unknown', error:'Could not confirm Stop. Open the conversation to check; nothing was restarted.' }) : current)
    }
  }
  return { cycle, start, stop, recheck, open: (chatId = cycle.chatId) => openAgentConversation(chatId) }
}
