// Project-local progress over the platform's durable conversation owner.
import { useCallback, useEffect, useRef, useState } from 'react'
import { contributionActionScope, contributionCyclePhase } from '../review.js'
import { loadCycleState, saveCycleState } from '../storage.js'
import { openAgentConversation } from './BatchAction.jsx'

export function useProjectCycle(projectKey, startAgentTask) {
  const [cycle, setCycle] = useState({ phase: 'restoring', chatId: '', error: '' })
  const alive = useRef(true)
  const starting = useRef(false)
  const refresh = useCallback(async (saved) => {
    try {
      const runtime = await window.mobius.chat.status(saved.chat_id)
      if (alive.current) setCycle(current => current.chatId !== saved.chat_id ? current : ({ ...current, phase: contributionCyclePhase(runtime), runtime, error: current.shortcutError || '' }))
    } catch {
      if (alive.current) setCycle(current => current.chatId !== saved.chat_id ? current : ({ ...current, phase: 'paused', error: 'Progress is unavailable. Open the conversation or try again.' }))
    }
  }, [])
  useEffect(() => {
    alive.current = true
    let cancelled = false
    async function restore() {
      const saved = await loadCycleState(projectKey)
      if (cancelled) return
      if (!saved) { setCycle({ phase: 'idle', chatId: '', error: '' }); return }
      setCycle({ phase: 'checking', chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, error: '' })
      await refresh(saved)
    }
    void restore()
    return () => { cancelled = true; alive.current = false }
  }, [projectKey, refresh])
  useEffect(() => {
    if (!cycle.chatId) return
    const check = () => { if (!document.hidden) void refresh({ chat_id: cycle.chatId }) }
    // The conversation is durable; this mounted view only observes it.
    const timer = cycle.phase === 'complete' ? null : setInterval(check, 5000)
    window.addEventListener('focus', check)
    return () => { clearInterval(timer); window.removeEventListener('focus', check) }
  }, [cycle.chatId, cycle.phase, refresh])
  async function start(action) {
    if (!action || starting.current) return { ok: false, error: 'Work is already starting.' }
    starting.current = true
    setCycle({ phase: 'starting', chatId: '', title: action.title, event: action.event, error: '' })
    try {
      const outcome = await startAgentTask(action)
      if (!outcome?.ok) {
        if (alive.current) setCycle({ phase: 'failed', chatId: '', error: outcome?.error || 'Could not start.' })
        return outcome
      }
      const saved = { chat_id: outcome.chatId, title: action.title, event: action.event, started_at: new Date().toISOString(), scope: contributionActionScope(action) }
      const recorded = await saveCycleState(saved, projectKey)
      const shortcutError = recorded ? '' : 'Work started, but its shortcut could not be saved. Keep this conversation link.'
      if (alive.current) setCycle({ shortcutError, phase: 'running', chatId: saved.chat_id, title: saved.title, event: saved.event, startedAt: saved.started_at, error: shortcutError })
      return { ok: true, chatId: outcome.chatId }
    } catch {
      const error = 'Could not start the agent. Try again.'
      if (alive.current) setCycle({ phase: 'failed', chatId: '', error })
      return { ok: false, error }
    } finally { starting.current = false }
  }
  async function stop() {
    setCycle(current => ({ ...current, phase: 'stopping' }))
    try {
      await window.mobius.chat.stop(cycle.chatId)
      await refresh({ chat_id: cycle.chatId })
    } catch {
      setCycle(current => ({ ...current, phase: 'paused', error: 'Could not confirm the stop. Open the conversation to check.' }))
    }
  }
  return { cycle, start, stop, open: () => openAgentConversation(cycle.chatId) }
}
