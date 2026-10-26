import { contributionScopeHash } from './review.js'

// Chat blocks are destinations, never approval. Opening one navigates to an
// exact identity in the project workspace; nothing starts or is sent. A send
// key only names records; the owner's Confirm on the card is the approval.
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
export const MAX_BATCH = 12
export const validRecordId = id => typeof id === 'string' && RECORD_ID.test(id)

export function chatBlockTarget(intent) {
  // A review run opens in the full project workspace; opening never starts one.
  const run = /^review-run:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  if (run) return { kind: 'run', id: run[1] }
  const pull = /^pull-request:([^/#\s]+)\/([^/#\s]+)#([1-9][0-9]{0,9})$/.exec(String(intent || ''))
  if (!pull) return null
  const [, owner, name, number] = pull
  if (![owner, name].every(part => REPOSITORY_PART.test(part) && !/^\.+$/.test(part))) return null
  const value = Number(number)
  return Number.isSafeInteger(value) ? { kind: 'pull', repo: `${owner}/${name}`, number: value } : null
}

const SEND = /^chat-send:(.+)$/
const BATCH = /^chat-send-batch:([0-9a-f]{16})$/

// A short, content-addressed handle for the records a batch card lists. It
// binds the exact set (prepared_block.py computes the same value) and keeps
// the intent bounded however long the record ids are. It is a reference, not
// an approval token.
export const batchHandle = ids => contributionScopeHash(['contribute-batch-v1', ...[...new Set(ids)].sort()].join('\n'))

// Resolve one card action. A batch resolves only against the per-record send
// actions listed on the same card; a handle naming any other set is refused.
export function sendTarget(key, cardKeys = []) {
  const single = SEND.exec(String(key || ''))
  if (single) return validRecordId(single[1]) ? { kind: 'record', ids: [single[1]] } : null
  const batch = BATCH.exec(String(key || ''))
  if (!batch) return null
  const ids = [...new Set(cardKeys.map(other => SEND.exec(String(other || ''))?.[1]).filter(validRecordId))]
  return ids.length >= 2 && ids.length <= MAX_BATCH && batchHandle(ids) === batch[1]
    ? { kind: 'batch', ids } : { kind: 'batch', ids: [], invalid: true }
}

// Every record a card's send actions name, for read-only status requests.
export const cardRecordIds = keys => [...new Set(keys.flatMap(key => sendTarget(key, keys)?.ids || []))]
