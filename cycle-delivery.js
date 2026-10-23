// Deliver cycle k of a project's work into the project's one conversation.
//
// Both platform calls are idempotent for the same (scope, cid):
// - POST /api/app-chats/start creates-or-retries the scope's conversation in
//   place under a per-scope lock and sends `cid` as its first turn, or
//   returns the already started conversation without sending (`reused`).
// - POST /api/chats/{id}/messages, which an app token may call for a
//   conversation it created, acknowledges a cid it already holds (queued or
//   in the transcript) as a duplicate instead of sending it again.
// So a retry, a lost response or a stale pane delivers cycle k at most once.
// A deleted conversation is not reused; the next start recreates the scope,
// still with one active conversation.
export async function deliverCycleMessage(token, request, fetcher = globalThis.fetch) {
  const { scope, cid, title, draft, scopeLabel } = request || {}
  if (!scope || !cid || !title || !draft) return { ok: false, error: 'This agent handoff is incomplete.' }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  let timezone = 'UTC'
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { /* UTC */ }
  const agent = request.agent?.model ? { provider: request.agent.provider, model: request.agent.model, ...(request.agent.effort ? { effort: request.agent.effort } : {}) } : null
  const failed = (error, extra = {}) => ({ ok: false, error, ...extra })
  let started
  try {
    started = await fetcher('/api/app-chats/start', { method: 'POST', headers, body: JSON.stringify({
      title, scope, ...(scopeLabel ? { scope_label: scopeLabel } : {}), owner_visible: true, ...(agent || {}), content: draft, cid, timezone,
    }) })
  } catch { return failed('Could not reach Möbius. Send again.') }
  if (!started.ok) return failed('Could not start the agent. Send again.', { status: started.status })
  const data = await started.json().catch(() => null)
  const chatId = data?.chat_id ? String(data.chat_id) : ''
  if (!chatId) return failed('Could not start the agent. Send again.')
  if (data.outcome !== 'reused') return { ok: true, chatId, outcome: 'started' }
  // The conversation already exists: this cycle is one more message in it.
  // Its provider is fixed once it has started; the platform refuses a switch.
  if (agent) {
    let patched
    try { patched = await fetcher(`/api/app-chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', headers, body: JSON.stringify(agent) }) } catch { patched = null }
    if (!patched?.ok) return failed(patched?.status === 409
      ? 'This project’s conversation already uses another provider. Choose one of its models, or delete the conversation to start over.'
      : 'Could not apply the chosen model. Send again.', { chatId, ...(patched ? { status: patched.status } : {}) })
  }
  let sent
  try { sent = await fetcher(`/api/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', headers, body: JSON.stringify({ content: draft, cid, timezone }) }) }
  catch { return failed('Could not reach Möbius. Send again.', { chatId }) }
  if (!sent.ok) return failed('Möbius did not accept this message. Send again.', { chatId, status: sent.status })
  const body = await sent.json().catch(() => null)
  if (body?.status === 'rejected') return failed('Möbius rejected this message.', { chatId })
  return { ok: true, chatId, outcome: body?.status === 'duplicate' ? 'duplicate' : 'sent' }
}
