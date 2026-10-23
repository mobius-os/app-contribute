// Project-local progress over the project's one durable agent conversation.
import { useCallback, useEffect, useRef, useState } from 'react'
import { beginProjectCycle, freezeStartAction, loadCycleState, recordCycleDelivery } from '../storage.js'
import { openAgentConversation } from './BatchAction.jsx'

// Run statuses the platform still owns (models.NONTERMINAL_RUN_STATUSES).
const NONTERMINAL_RUN_STATUSES = ['running', 'parked', 'resume_pending']

// A conversation that is not running a turn still has work it will resume on
// its own while the platform reports any of these. `recovery_run_id` is not
// among them: it names the latest attempt of every idle conversation so a
// manual Resume can target it. Only a non-terminal run status counts.
export function pendingContinuation(runtime) {
  const count = value => Array.isArray(value) ? value.length : 0
  return count(runtime.waits) > 0 || count(runtime.pending_messages) > 0 || Boolean(runtime.continuation_wait)
    || Boolean(runtime.compacting) || NONTERMINAL_RUN_STATUSES.includes(runtime.run_status)
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

// The platform positively reports work in progress. Only these block a new
// cycle, and only as guidance: the project has one conversation, so a new
// cycle's message can at worst queue behind the current one.
export const BUSY_PHASES = ['starting', 'running', 'waiting', 'scheduled', 'stopping']

export function useProjectCycle(projectKey, deliver) {
  const [cycle, setCycle] = useState({ phase: 'restoring', chatId: '', history: [], error: '' })
  const alive = useRef(true)
  const identity = useRef(projectKey)
  identity.current = projectKey
  const sending = useRef(false)
  const observation = useRef(0)
  const isCurrent = (requestedProject, generation) => alive.current && identity.current === requestedProject
    && (generation === undefined || generation === observation.current)
  const refresh = useCallback(async (chatId, { afterStop = false, generation } = {}) => {
    const requestedProject = projectKey
    let runtime = null
    try { runtime = await window.mobius.chat.status(chatId) } catch { runtime = null }
    if (!isCurrent(requestedProject, generation)) return
    const phase = projectCyclePhase(runtime)
    setCycle(current => current.chatId !== chatId || (current.phase === 'stopping' && !afterStop) ? current : ({
      ...current, phase, runtime,
      chatTitle: runtime?.title || runtime?.chat_title || runtime?.chat?.title || current.chatTitle,
      error: phase === 'unknown' ? 'Progress is unavailable. Open the conversation to check.' : current.unsent ? current.error : '',
    }))
  }, [projectKey])
  const recheck = useCallback(async () => {
    const requestedProject = projectKey
    const generation = ++observation.current
    let saved = null, unavailable = false
    try { saved = await loadCycleState(requestedProject) } catch { unavailable = true }
    if (!isCurrent(requestedProject, generation)) return
    if (!saved) {
      setCycle(unavailable ? current => ({ ...current, phase: 'unknown', error: 'Saved work could not be checked. Refresh to try again.' })
        : { phase: 'idle', chatId: '', history: [], error: '' })
      return
    }
    const current = saved.cycle && !saved.cycle.delivered ? { ...saved.cycle, scope: saved.scope || saved.cycle.cid.replace(/:\d+$/, '') } : null
    setCycle({
      chatId: saved.chat_id || '', k: saved.k || 0, title: saved.title, event: saved.event, startedAt: saved.started_at, history: saved.history || [],
      unsent: current, phase: saved.chat_id ? 'checking' : 'idle', error: current ? 'This start was not confirmed. Send it again; a message that already arrived is not sent twice.' : '',
    })
    if (saved.chat_id) await refresh(saved.chat_id, { afterStop: true, generation })
  }, [projectKey, refresh])
  useEffect(() => {
    alive.current = true
    void recheck()
    return () => { alive.current = false; observation.current++ }
  }, [projectKey, recheck])
  useEffect(() => {
    if (!cycle.chatId) return
    const check = () => { if (!document.hidden) void refresh(cycle.chatId) }
    // The conversation is durable; this mounted view only observes it.
    const timer = cycle.phase === 'complete' ? null : setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [cycle.chatId, cycle.phase, refresh])
  // Deliver cycle k. Safe to repeat from any pane: the message id is fixed.
  async function send(requestedProject, planned) {
    let outcome
    try { outcome = await deliver({ ...planned.action, scope: planned.scope, cid: planned.cid }) }
    catch { outcome = { ok: false, error: 'Could not reach Möbius. Send again.' } }
    if (!isCurrent(requestedProject)) return outcome
    if (!outcome?.ok || !outcome.chatId) {
      const error = outcome?.error || 'This start was not confirmed. Send it again.'
      const chatId = outcome?.chatId ? String(outcome.chatId) : ''
      setCycle(current => ({ ...current, unsent: planned, chatId: chatId || current.chatId, phase: chatId || current.chatId ? 'checking' : 'idle', error }))
      if (chatId || cycle.chatId) void refresh(chatId || cycle.chatId)
      return { ok: false, unsent: true, error }
    }
    await recordCycleDelivery(requestedProject, planned.k, outcome.chatId)
    if (isCurrent(requestedProject)) setCycle(current => ({ ...current, unsent: null, chatId: outcome.chatId, title: planned.action.title, event: planned.action.event, phase: 'running', error: '' }))
    return { ok: true, chatId: outcome.chatId }
  }
  async function start(action) {
    if (!action || sending.current) return { ok: false, error: 'Work is already starting.' }
    if (['restoring', ...BUSY_PHASES].includes(cycle.phase)) return { ok: false, error: 'The current work must finish or be cancelled before another cycle starts.' }
    const frozen = freezeStartAction(action)
    if (!frozen) return { ok: false, error: 'This agent handoff is incomplete.' }
    sending.current = true
    observation.current++
    const requestedProject = projectKey
    const previous = cycle
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try {
      let planned
      try { planned = await beginProjectCycle(requestedProject, frozen, previous.k || 0) }
      catch { planned = { ok: false, error: 'Could not save this start. Refresh and try again.' } }
      if (!planned.ok) {
        if (isCurrent(requestedProject)) setCycle({ ...previous, error: planned.error })
        if (planned.changed) void recheck().then(() => { if (isCurrent(requestedProject)) setCycle(current => ({ ...current, error: current.error || planned.error })) })
        return planned
      }
      if (isCurrent(requestedProject)) setCycle(current => ({ ...current, k: planned.k }))
      if (isCurrent(requestedProject)) setCycle(current => ({ ...current, history: previous.chatId && previous.title ? [{ chat_id: previous.chatId, title: previous.title, event: previous.event, started_at: previous.startedAt }, ...(previous.history || [])] : previous.history || [], startedAt: new Date().toISOString() }))
      return await send(requestedProject, planned)
    } finally { sending.current = false }
  }
  // Send the unconfirmed cycle again: the same id, work and model.
  async function sendAgain() {
    const planned = cycle.unsent
    if (!planned || sending.current) return { ok: false, error: 'There is nothing to send again.' }
    sending.current = true
    observation.current++
    setCycle(current => ({ ...current, phase: 'starting', error: '' }))
    try { return await send(projectKey, planned) }
    finally { sending.current = false }
  }
  async function stop() {
    const chatId = cycle.chatId
    const requestedProject = projectKey
    if (!chatId) return
    observation.current++
    setCycle(current => current.chatId === chatId ? ({ ...current, phase: 'stopping' }) : current)
    let stopped = null
    try { stopped = await window.mobius.chat.stop(chatId) } catch { stopped = null }
    if (identity.current !== requestedProject) return
    if (stopped?.stopped === true) await refresh(chatId, { afterStop: true })
    else setCycle(current => current.chatId === chatId ? ({ ...current, phase: 'unknown', error: 'Could not confirm Stop. Open the conversation to check; nothing was restarted.' }) : current)
  }
  return { cycle, start, stop, recheck, sendAgain, open: (chatId = cycle.chatId) => openAgentConversation(chatId) }
}
