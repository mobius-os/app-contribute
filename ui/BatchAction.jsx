import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'

// Mini-app frames have an opaque origin, so a frame-origin target silently
// drops this shell command. postMessage still goes only to the direct parent;
// `*` is required for the shell to receive it across the opaque boundary.
export function openAgentConversation(chatId) {
  if (!chatId || window.parent === window) return false
  window.parent.postMessage({
    type: 'moebius:open-chat',
    chatId,
  }, '*')
  return true
}

export function AgentHandoffButton({
  action,
  onStart,
  className = 'co-btn co-btn-sm',
  icon = '',
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState(null)
  const actionKey = `${action?.event || ''}:${action?.title || ''}`
  useEffect(() => {
    setStarted(null)
    setError('')
  }, [actionKey])
  if (!action) return null

  async function run() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const outcome = await onStart?.(action)
      if (!outcome?.ok) {
        setError(outcome?.error || 'Could not start the agent. Try again.')
      } else {
        setStarted(outcome)
      }
    } catch {
      setError('Could not start the agent. Try again.')
    } finally {
      setBusy(false)
    }
  }

  function viewConversation() {
    if (!openAgentConversation(started?.chatId)) return
    window.mobius?.signal?.('contribute_agent_conversation_opened', {
      event: action.event || 'contribute_agent_handoff',
    })
  }

  if (started) {
    return (
      <div className="co-agent-started" role="status" aria-live="polite">
        <span>
          <strong>{action.startedLabel || 'Agent started'}</strong>
          <small>{action.startedMessage || 'Keep working here. New decisions and ready changes will appear in Contribute.'}</small>
        </span>
        {window.parent !== window ? (
          <button type="button" className="co-agent-chat-link" onClick={viewConversation}>
            View conversation
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="co-agent-handoff">
      <button
        type="button"
        className={className}
        disabled={busy}
        aria-busy={busy}
        onClick={run}
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {busy ? (action.busyLabel || 'Starting…') : action.label}
      </button>
      {error ? <p className="co-agent-handoff-error" role="status">{error}</p> : null}
    </div>
  )
}
