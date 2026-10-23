// Project-local progress over the platform's durable conversation owner.
import { useCallback, useEffect, useRef, useState } from 'react'
import { abandonProjectCycleClaim, claimProjectCycle, freezeStartAction, loadCycleState, readProjectCycleClaim, settleProjectCycleClaim } from '../storage.js'
import { openAgentConversation } from './BatchAction.jsx'

// A conversation that is not running a turn still owns its project while the
// platform reports work it will resume on its own: an outstanding durable
// Wait (armed, or fired but not yet delivered), queued messages, a
// continuation or recovery run, compaction, or live background helpers.
export function pendingContinuation(runtime) {
  const count = value => Array.isArray(value) ? value.length : 0
  return count(runtime.waits) > 0 || count(runtime.pending_messages) > 0 || Boolean(runtime.continuation_wait)
    || Boolean(runtime.recovery_run_id) || Boolean(runtime.compacting) || ['queued', 'pending'].includes(runtime.run_status)
    || Number(runtime.background_helpers?.count) > 0
}

// Observe explicit runtime facts; an unavailable or incomplete status is not
// evidence that the owner paused, stopped, or completed the work.
export function projectCyclePhase(runtime) {
  if (!runtime || typeof runtime !== 'object' || runtime.error) return 'unknown'
  if (runtime.running === true) return 'running'
  if (runtime.pending_question_id) return 'waiting'
  // Checked before any goal status: work that will resume is not finished.
  if (pendingContinuation(runtime)) return 'scheduled'
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
export const LEGACY_START = 'This older start did not save its exact work, so it cannot be finished here. Check again finds its conversation if it started; if it never started, abandon it.'
const SUPERSEDED_START = 'This start was already settled in another view, so nothing was started here.'
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
      const applies = () => alive.current && identity.current === requestedProject && (generation === undefined || generation === observation.current)
      if (applies()) setCycle(current => current.chatId !== saved.chat_id || (current.pending && !reconcile) || (current.phase === 'stopping' && !afterStop) ? current : ({ ...current, phase: 'unknown', runtime: null, error: 'Progress is unavailable. Open the conversation to check.' }))
      // A failed read is not evidence of deletion. The app's complete list of
      // its active conversations is: a successful list without this saved
      // conversation means the owner deleted it, which finishes its cycle.
      let deleted = false
      try { const rows = await window.mobius.chat.list({}); deleted = Array.isArray(rows) && !rows.some(row => String(row?.id) === String(saved.chat_id)) }
      catch { /* Unknown stays unknown. */ }
      if (deleted && applies()) setCycle(current => current.chatId !== saved.chat_id || (current.pending && !reconcile) || (current.phase === 'stopping' && !afterStop) ? current : ({ ...current, phase: 'deleted', runtime: null, pending: reconcile ? false : current.pending, error: '' }))
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
    const timer = ['complete', 'deleted'].includes(cycle.phase) ? null : setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [cycle.chatId, cycle.pending, cycle.phase, refresh])
  // Settle the outcome of one reserved scoped start, whichever path observed it.
  async function settleStart(requestedProject, claim, action, previous, outcome) {
    const current = () => alive.current && identity.current === requestedProject
    if (outcome.state === 'superseded') return { ok: false, superseded: true, error: SUPERSEDED_START }
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
  // Every Start and Finish re-reads the online claim immediately before the
  // scoped start and proceeds only while it is still pending at exactly this
  // scope. The platform's scoped start ignores deleted conversations, so a
  // stale pane replaying a cycle another view already settled (and the owner
  // then deleted) would otherwise recreate it beside its successor.
  async function admit(requestedProject, claim, action) {
    let fresh
    try { fresh = await readProjectCycleClaim(requestedProject) }
    catch { return { state: 'unknown', error: 'The reservation could not be re-checked, so nothing was started.' } }
    if (!fresh || fresh.id !== claim.id || (fresh.scope || `contribute-cycle:${fresh.id}`) !== claim.scope) return { state: 'superseded' }
    try { return startOutcome(await startAgentTask({ ...action, scope: claim.scope })) }
    catch { return { state: 'unknown' } }
  }
  // A start another view settled is shown as that view left it.
  function afterAdmission(result) {
    if (result?.superseded || result?.abandoned) void recheck().then(() => { if (result.superseded && alive.current) setCycle(current => ({ ...current, error: current.error || SUPERSEDED_START })) })
    return result
  }
  async function start(action) {
    if (!action || starting.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', 'checking', 'starting', 'running', 'waiting', 'scheduled', 'stopping', 'unknown'].includes(cycle.phase)) return { ok: false, error: 'Check or stop the current work before starting another cycle.' }
    // The exact, platform-bounded start is fixed before anything is reserved;
    // the reservation and every replay carry this same payload.
    const frozen = freezeStartAction(action)
    if (!frozen) return { ok: false, error: 'This agent handoff is incomplete.' }
    starting.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    let result
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
      result = await settleStart(requestedProject, reserved, frozen, previous, await admit(requestedProject, reserved, frozen))
      return result
    } finally { starting.current = false; afterAdmission(result) }
  }
  // Finish starting asks the platform's scoped start again for the same scope
  // with the saved work and model, after confirming the claim is still pending
  // at that scope. While the scope's conversation exists, that call returns
  // it, admits the first turn of an empty one, or creates the only one.
  async function finishStart() {
    const claim = { id: cycle.pendingId, scope: cycle.pendingScope || `contribute-cycle:${cycle.pendingId}` }
    const action = cycle.pendingAction
    if (!claim.id || starting.current) return { ok: false, error: 'There is no reserved start to finish.' }
    if (!action) return { ok: false, error: LEGACY_START }
    starting.current = true
    observation.current++
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    let result
    try { result = await settleStart(projectKey, claim, action, { ...previous, pending: false }, await admit(projectKey, claim, action)); return result }
    finally { starting.current = false; afterAdmission(result) }
  }
  // The owner's explicit way out of a reserved start the platform will not
  // admit (for example, its provider was removed). Allowed only when a fresh
  // lookup of this exact scope finds no started conversation; one started
  // conversation settles the cycle instead. Never automatic.
  async function abandonStart() {
    const claim = { id: cycle.pendingId, scope: cycle.pendingScope || `contribute-cycle:${cycle.pendingId}` }
    if (!claim.id || starting.current) return { ok: false, error: 'There is no reserved start to abandon.' }
    const requestedProject = projectKey
    const previous = { ...cycle, pending: false }
    const keep = error => { if (alive.current && identity.current === requestedProject) setCycle(current => ({ ...current, ...cycle, phase: 'unknown', error })); return { ok: false, error } }
    starting.current = true
    observation.current++
    setCycle(current => ({ ...current, phase: 'checking', error: '' }))
    let result
    try {
      let fresh, rows
      try { fresh = await readProjectCycleClaim(requestedProject) } catch { return result = keep('The reservation could not be re-checked. Nothing was abandoned.') }
      if (!fresh || fresh.id !== claim.id) return result = { ok: false, superseded: true, error: SUPERSEDED_START }
      try { rows = await window.mobius.chat.list({ scope: claim.scope }) } catch { rows = null }
      if (!Array.isArray(rows)) return result = keep('Möbius could not check this start, so it stays reserved. Try again.')
      const started = rows.filter(scopedChatStarted)
      if (started.length > 1) return result = keep('More than one conversation answers this start. Open them before continuing.')
      if (started.length === 1) {
        result = await settleStart(requestedProject, claim, cycle.pendingAction || { title: cycle.pendingTitle, event: cycle.pendingEvent }, previous, { state: 'admitted', chatId: String(started[0].id) })
        return result
      }
      if (!await abandonProjectCycleClaim(requestedProject, claim.id)) return result = keep('The start could not be abandoned. Check again.')
      if (alive.current && identity.current === requestedProject) setCycle({ ...previous, pendingId: '', pendingScope: '', pendingAction: null, phase: previous.chatId ? 'checking' : 'idle', error: '' })
      return result = { ok: true, abandoned: true }
    } finally { starting.current = false; afterAdmission(result) }
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
  return { cycle, start, stop, recheck, finishStart, abandonStart, open: (chatId = cycle.chatId) => openAgentConversation(chatId) }
}
