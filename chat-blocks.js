// Transcript blocks name an identity, never an action. Opening one starts no
// run; a prepared contribution's view offers the same guarded Send as the queue.
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const validContributeRecordId = id => typeof id === 'string' && RECORD_ID.test(id)
export function contributeBlockTarget(intent) {
  // A batch names up to 12 prepared records to confirm and send together.
  const batch = /^chat-send-batch:(.+)$/.exec(String(intent || ''))
  if (batch) {
    const ids = batch[1].split(',')
    if (ids.length <= 12 && ids.every(validContributeRecordId)) return { kind: 'batch', ids: [...new Set(ids)], embedded: true }
  }
  // chat-send opens the same view with the send confirmation already shown.
  // Legacy chat-prepared titles enter the project workspace through review.js.
  // Only chat-send is the deliberately headerless in-transcript confirmation.
  const prepared = /^chat-send:(.+)$/.exec(String(intent || ''))
  if (prepared && validContributeRecordId(prepared[1])) return { kind: 'prepared', id: prepared[1], embedded: true, confirm: true }
  const pull = /^(chat-pull|pull-request):([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)$/.exec(String(intent || ''))
  if (pull && !pull[2].split('/').some(part => ['.', '..'].includes(part))) return { kind: 'pull', repo: pull[2], number: Number(pull[3]), embedded:pull[1] === 'chat-pull' }
  const run = /^chat-review-run:([A-Za-z0-9_-]{1,64})$/.exec(String(intent || ''))
  return run ? { kind: 'run', id: run[1], embedded:true } : null
}

export function recordsForPull(records, pr) {
  const repo = pr.repository.nameWithOwner.toLowerCase()
  return records.filter(record => (record.repo || record.plan?.repo || '').toLowerCase() === repo && record.number === pr.number)
}

export function pullConversations(records, runs, pr) {
  const result = new Map()
  function add(chat_id, role, title) {
    if (typeof chat_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(chat_id)) return
    const key = `${chat_id}:${role}`
    result.set(key, { chat_id, role, title: title || (role === 'source' ? 'Source conversation' : role === 'fix' ? 'Fix conversation' : 'Review conversation') })
  }
  for (const record of recordsForPull(records, pr)) {
    add(record.chat_id, 'source', record.chat_title)
    for (const id of record.chat_ids || []) add(id, 'source')
    add(record.quality_review?.chat_id, 'review')
    add(record.autopilot?.followup_chat_id || record.autopilot?.chat_id, 'fix')
    for (const round of record.autopilot?.rounds || []) add(round.chat_id, 'fix')
  }
  for (const run of runs || []) if (run.items?.some(item => item.repo.toLowerCase() === pr.repository.nameWithOwner.toLowerCase() && item.number === pr.number)) add(run.chat_id, 'review')
  return [...result.values()]
}
