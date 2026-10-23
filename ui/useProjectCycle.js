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

// A scope the platform finalised before its first turn (cancelled, or its
// conversation deleted) is never admitted again under that scope.
export const TERMINAL_SCOPE_CODES = ['scope_cancelled', 'scope_deleted']

// Every scoped start has exactly one of three outcomes. Only a certified
// non-admission may release its reservation; anything else stays owned.
export function startOutcome(outcome) {
  if (outcome?.ok && outcome.chatId) return { state: 'admitted', chatId: String(outcome.chatId) }
  if (outcome?.notStarted || TERMINAL_SCOPE_CODES.includes(outcome?.code)) {
    return { state: 'not_admitted', error: outcome.error || 'Nothing was started.' }
  }
  return { state: 'unknown' }
}

const UNRESOLVED_START = 'This start is not confirmed. It stays reserved, so no second agent starts. Finish starting it, or check again.'

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
      const unresolved = { ...base, pending: true, pendingId: saved.pending.id, pendingTitle: saved.pending.title, pendingEvent: saved.pending.event, phase: 'unknown', error: UNRESOLVED_START }
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
  // Settle the outcome of one reserved scoped start, whichever path observed it.
  async function settleStart(requestedProject, claimId, action, previous, outcome) {
    const current = () => alive.current && identity.current === requestedProject
    if (outcome.state === 'not_admitted') {
      const released = await settleProjectCycleClaim(requestedProject, claimId, null)
      if (current()) setCycle(released ? { ...previous, pending: false, phase: previous.chatId ? previous.phase : 'idle', error: outcome.error }
        : { ...previous, pending: true, pendingId: claimId, phase: 'unknown', error: 'Nothing was started, but the reservation could not be released. Check again.' })
      return { ok: false, error: outcome.error }
    }
    if (outcome.state === 'unknown') {
      if (current()) setCycle({ ...previous, pending: true, pendingId: claimId, pendingTitle: action.title, pendingEvent: action.event, phase: 'unknown', error: UNRESOLVED_START })
      return { ok: false, reserved: true, error: UNRESOLVED_START }
    }
    const saved = { chat_id: outcome.chatId, title: action.title, event: action.event, started_at: new Date().toISOString(), scope: `contribute-cycle:${claimId}` }
    const recorded = await settleProjectCycleClaim(requestedProject, claimId, saved)
    const shortcutError = recorded ? '' : 'Work started, but its project shortcut could not be saved. Open this conversation and refresh before another cycle.'
    const history = previous.chatId && previous.chatId !== saved.chat_id ? [{ chat_id: previous.chatId, title: previous.title, event: previous.event, started_at: previous.startedAt }, ...(previous.history || [])] : previous.history || []
    if (current()) setCycle({ shortcutError, phase: recorded ? 'running' : 'unknown', chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, history, error: shortcutError })
    return { ok: true, chatId: outcome.chatId }
  }
  async function admit(action, claimId) {
    try { return startOutcome(await startAgentTask({ ...action, scope: `contribute-cycle:${claimId}` })) }
    catch { return { state: 'unknown' } }
  }
  async function start(action) {
    if (!action || starting.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', 'checking', 'starting', 'running', 'waiting', 'stopping', 'unknown'].includes(cycle.phase)) return { ok: false, error: 'Check or stop the current work before starting another cycle.' }
    starting.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try {
      let claim
      try { claim = await claimProjectCycle(requestedProject, previous.chatId, action) }
      catch { claim = { ok: false, error: 'Could not reserve this project cycle. Refresh and try again.' } }
      if (!claim.ok) {
        if (alive.current && identity.current === requestedProject) setCycle({ ...previous, error: claim.error })
        return claim
      }
      return await settleStart(requestedProject, claim.id, action, previous, await admit(action, claim.id))
    } finally { starting.current = false }
  }
  // Explicit recovery of a reserved start whose outcome is unknown. Replaying
  // the same scope is idempotent on the platform: it returns the admitted
  // conversation or admits its first turn once; it never starts a second agent.
  async function finishStart(action) {
    const claimId = cycle.pendingId
    if (!claimId || !action || starting.current) return { ok: false, error: 'There is no reserved start to finish.' }
    starting.current = true
    observation.current++
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try { return await settleStart(projectKey, claimId, action, { ...previous, pending: false }, await admit(action, claimId)) }
    finally { starting.current = false }
  }
  // Where the platform can fence a scope, the owner may abandon a reserved
  // start instead: a cancelled or deleted scope is certified never admitted.
  const canDiscardStart = typeof globalThis.window?.mobius?.chat?.cancelStart === 'function'
  async function discardStart() {
    const claimId = cycle.pendingId
    if (!claimId || !canDiscardStart || starting.current) return
    starting.current = true
    const previous = { ...cycle, pending: false }
    try {
      let fenced
      try { fenced = await window.mobius.chat.cancelStart({ scope: `contribute-cycle:${claimId}` }) } catch { fenced = null }
      const outcome = fenced?.outcome === 'started' && fenced.chatId ? { state: 'admitted', chatId: fenced.chatId }
        : ['cancelled', 'deleted'].includes(fenced?.outcome) ? { state: 'not_admitted', error: 'The reserved start was cancelled; nothing was started.' }
        : { state: 'unknown' }
      await settleStart(projectKey, claimId, { title: cycle.pendingTitle, event: cycle.pendingEvent }, previous, outcome)
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
  return { cycle, start, stop, recheck, finishStart, discardStart, canDiscardStart, open: (chatId = cycle.chatId) => openAgentConversation(chatId) }
}
