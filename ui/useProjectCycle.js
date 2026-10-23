// Project-local progress over the platform's durable conversation owner.
import { useCallback, useEffect, useRef, useState } from 'react'
import { claimProjectCycle, freezeStartAction, loadCycleState, settleProjectCycleClaim } from '../storage.js'
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
// conversation deleted) can never start: that cycle number is spent.
export const TERMINAL_SCOPE_CODES = ['scope_cancelled', 'scope_deleted']

// A reserved cycle has one identity, its scope, and the platform's scoped start
// is idempotent for it. So there is nothing to infer from a failure: any error,
// local refusal or lost response leaves the reservation in place with Finish
// starting as the way forward. Only a confirmed conversation settles it, or the
// platform's own verdict that this exact scope can never start.
export function startOutcome(outcome) {
  if (outcome?.ok && outcome.chatId) return { state: 'admitted', chatId: String(outcome.chatId) }
  if (TERMINAL_SCOPE_CODES.includes(outcome?.code)) return { state: 'spent', error: 'Möbius cancelled this start, so nothing was started. Start again.' }
  return { state: 'unknown', ...(outcome?.error ? { error: outcome.error } : {}) }
}
// A scoped conversation is started only once its first turn exists. A
// created-but-empty row is the platform's intermediate state, not an owner.
export const scopedChatStarted = row => row?.has_messages === true

// An older reservation without its saved work cannot be replayed; Check again
// still finds its conversation if that start was admitted.
export const LEGACY_START = 'This older start did not save its exact work, so it cannot be finished here. Check again finds its conversation if it started.'
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
      const scope = saved.pending.scope || `contribute-cycle:${saved.pending.id}`
      const unresolved = { ...base, pending: true, pendingId: saved.pending.id, pendingScope: scope, pendingTitle: saved.pending.title, pendingEvent: saved.pending.event, pendingAction: saved.pending.action || null, phase: 'unknown', error: UNRESOLVED_START }
      setCycle(unresolved)
      try {
        const matches = await window.mobius.chat.list({ scope })
        if (!current()) return
        // Only one unambiguous, *started* conversation settles the scope. An
        // empty lookup, an empty (not yet admitted) row or several rows leave
        // the reservation as it is.
        const found = Array.isArray(matches) && matches.length === 1 && scopedChatStarted(matches[0]) ? matches[0] : null
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
  async function settleStart(requestedProject, claim, action, previous, outcome) {
    const current = () => alive.current && identity.current === requestedProject
    if (outcome.state === 'spent') {
      const released = await settleProjectCycleClaim(requestedProject, claim.id, null)
      if (current()) setCycle(released ? { ...previous, pending: false, phase: previous.chatId ? previous.phase : 'idle', error: outcome.error }
        : { ...previous, pending: true, pendingId: claim.id, pendingScope: claim.scope, phase: 'unknown', error: 'This start was cancelled, but the reservation could not be updated. Check again.' })
      return { ok: false, error: outcome.error }
    }
    if (outcome.state === 'unknown') {
      const error = outcome.error ? `${outcome.error} ${UNRESOLVED_START}` : UNRESOLVED_START
      if (current()) setCycle({ ...previous, pending: true, pendingId: claim.id, pendingScope: claim.scope, pendingTitle: action.title, pendingEvent: action.event, pendingAction: freezeStartAction(action) || previous.pendingAction || null, phase: 'unknown', error })
      return { ok: false, reserved: true, error }
    }
    const saved = { chat_id: outcome.chatId, title: action.title, event: action.event, started_at: new Date().toISOString(), scope: claim.scope }
    const recorded = await settleProjectCycleClaim(requestedProject, claim.id, saved)
    const shortcutError = recorded ? '' : 'Work started, but its project shortcut could not be saved. Open this conversation and refresh before another cycle.'
    const history = previous.chatId && previous.chatId !== saved.chat_id ? [{ chat_id: previous.chatId, title: previous.title, event: previous.event, started_at: previous.startedAt }, ...(previous.history || [])] : previous.history || []
    if (current()) setCycle({ shortcutError, phase: recorded ? 'running' : 'unknown', chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, history, error: shortcutError })
    return { ok: true, chatId: outcome.chatId }
  }
  async function admit(action, scope) {
    try { return startOutcome(await startAgentTask({ ...action, scope })) }
    catch { return { state: 'unknown' } }
  }
  async function start(action) {
    if (!action || starting.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', 'checking', 'starting', 'running', 'waiting', 'stopping', 'unknown'].includes(cycle.phase)) return { ok: false, error: 'Check or stop the current work before starting another cycle.' }
    // The exact, platform-bounded start is fixed before anything is reserved;
    // the reservation and every replay carry this same payload.
    const frozen = freezeStartAction(action)
    if (!frozen) return { ok: false, error: 'This agent handoff is incomplete.' }
    starting.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try {
      let claim
      try { claim = await claimProjectCycle(requestedProject, previous.chatId, frozen) }
      catch { claim = { ok: false, error: 'Could not reserve this project cycle. Refresh and try again.' } }
      if (!claim.ok) {
        if (alive.current && identity.current === requestedProject) setCycle({ ...previous, error: claim.error })
        return claim
      }
      const reserved = { id: claim.id, scope: claim.scope || `contribute-cycle:${claim.id}` }
      return await settleStart(requestedProject, reserved, frozen, previous, await admit(frozen, reserved.scope))
    } finally { starting.current = false }
  }
  // Finish starting asks the platform's scoped start again for the same scope
  // with the saved work and model. That call is idempotent: it returns the
  // started conversation, admits the first turn of an empty one, or creates
  // the only one. It is always safe to repeat.
  async function finishStart() {
    const claim = { id: cycle.pendingId, scope: cycle.pendingScope || `contribute-cycle:${cycle.pendingId}` }
    const action = cycle.pendingAction
    if (!claim.id || starting.current) return { ok: false, error: 'There is no reserved start to finish.' }
    if (!action) return { ok: false, error: LEGACY_START }
    starting.current = true
    observation.current++
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try { return await settleStart(projectKey, claim, action, { ...previous, pending: false }, await admit(action, claim.scope)) }
    finally { starting.current = false }
  }
  // Where the platform can fence a scope, the owner may abandon a reserved
  // start instead: a cancelled or deleted scope is certified never admitted.
  const canDiscardStart = typeof globalThis.window?.mobius?.chat?.cancelStart === 'function'
  async function discardStart() {
    const claim = { id: cycle.pendingId, scope: cycle.pendingScope || `contribute-cycle:${cycle.pendingId}` }
    if (!claim.id || !canDiscardStart || starting.current) return
    starting.current = true
    const previous = { ...cycle, pending: false }
    try {
      let fenced
      try { fenced = await window.mobius.chat.cancelStart({ scope: claim.scope }) } catch { fenced = null }
      const outcome = fenced?.outcome === 'started' && fenced.chatId ? { state: 'admitted', chatId: fenced.chatId }
        : ['cancelled', 'deleted'].includes(fenced?.outcome) ? { state: 'spent', error: 'The reserved start was cancelled; nothing was started.' }
        : { state: 'unknown' }
      // The saved replay payload survives an unknown fence outcome.
      await settleStart(projectKey, claim, cycle.pendingAction || { title: cycle.pendingTitle, event: cycle.pendingEvent }, previous, outcome)
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
