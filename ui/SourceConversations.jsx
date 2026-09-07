// Discover source metadata only when choosing a scope; chat owns preparation.
import { useEffect, useState } from 'react'
import { collaborationRequest } from '../collaboration.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'

export function SourceConversations({ project, token, appId }) {
  const task = useProjectTask()
  const [state, setState] = useState({ phase: 'idle', chats: [], error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (task?.activeId !== 'task:scope') return
    let current = true
    setState(old => ({ ...old, phase: 'loading', error: '' }))
    collaborationRequest(token, appId, `source-chats?project_key=${encodeURIComponent(project.key)}`)
      .then(result => { if (current) setState({ phase: 'ready', chats: result.chats || [], error: '' }) })
      .catch(error => { if (current) setState({ phase: 'error', chats: [], error: error.message }) })
    return () => { current = false }
  }, [task?.activeId, project.key, appId, token, attempt])
  return <TaskPane id="task:scope">
    <h3>Choose what to prepare</h3>
    <button className="co-scope-row" onClick={() => task.open('task:prepare')}><strong>All local work in {project.name}</strong><span>Group related work across conversations.</span><Icon name="right" size={16} /></button>
    <h4>One conversation</h4>
    <p>Continue in its Changes view. Preparation stays with the conversation that owns the work.</p>
    {state.phase === 'loading' ? <p role="status">Finding source conversations…</p> : null}
    {state.phase === 'error' ? <div role="alert"><p>Source conversations couldn’t load. {state.error}</p><button className="co-btn" onClick={() => setAttempt(old => old + 1)}>Try again</button><p>You can still open a conversation directly and choose Changes.</p></div> : null}
    {state.phase === 'ready' && !state.chats.length ? <p>No source conversations were found for this project. Its current code can still be prepared as a whole.</p> : null}
    {state.chats.map(chat => <button className="co-scope-row" key={chat.chat_id} onClick={() => window.parent.postMessage({ type: 'moebius:open-chat', chatId: chat.chat_id, view: 'changes' }, '*')}>
      <strong>{chat.title || 'Source conversation'}</strong><span>Open Changes</span><Icon name="right" size={16} />
    </button>)}
  </TaskPane>
}
