// Transcript blocks are read-only destinations. No run or public action starts.
export function contributeBlockTarget(intent) {
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
