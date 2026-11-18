// The chat card tells one story from the lifecycle regions. "Merged" is the PR merging into the
// default branch and nothing else; an update whose PR merged or closed first is a stranded update and
// says so; a record replaced by other work follows `superseded_by`. A record written by an older app
// (the status word alone) reads as it always did.
import test from 'node:test'
import assert from 'node:assert/strict'
import { batchHandle, CHAT_INTENT } from '../chat-blocks.js'
import { readBlockSession } from '../block-protocol.js'
import { apply, newVector } from '../lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'
import { isDroppedUpdate, isPublished, isStranded, isSuperseded, pullKey, sendBlocker } from '../send-readiness.js'
import { discardRecord } from '../lifecycle-write.js'
import { createInlineSession, observeAttempt, STRANDED_NOTE } from '../inline-session.js'
import { createInlineSession as createInlineSessionV1, DROPPED_PILL as DROPPED_PILL_V1, observeAttempt as observeAttemptV1, STRANDED_NOTE as STRANDED_NOTE_V1 } from '../inline-session-v1.js'

const HEAD = 'a'.repeat(40)
const CHAT = '00000000-0000-4000-8000-00000000c4a7'
const KEY = 'chat-send:one'
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)) }
const pull = number => ({ number, url: `https://github.com/owner/repo/pull/${number}` })

// A record as it stands in the ledger. `states` is what the engine stored beside the status word (engine
// mode); without it the record is the status word alone, as an older app or today's job writes it.
function record(id, status, { states = null, action = 'pr', number = 7, more = {} } = {}) {
  const lifecycle = states && newVector(TABLES, { followup: 'OFF', update: 'NONE', ...states }, Math.floor(Date.now() / 1000))
  return { id, type: 'pr', status, repo: 'owner/repo', updated_at: '2026-11-18T10:00:00Z', chat_id: CHAT, chat_ids: [CHAT],
    ...(status === 'prepared' && !states?.update ? {} : pull(number)),
    plan: { action, repo: 'owner/repo', title: `Change ${id}`, branch: `fix/${id}`, head_sha: HEAD, diff_sha256: 'd'.repeat(64), diff_stat: ' 1 file changed, 2 insertions(+)' },
    quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, ...(lifecycle ? { lifecycle } : {}), ...more }
}

function card(ids, records) {
  const actions = [{ key: ids.length === 1 ? `chat-send:${ids[0]}` : 'chat-send-batch:0000000000000000', label: 'Send' }]
  const items = ids.map(id => ({ intent: `review:${id}` }))
  const store = new Map(records.map(item => [item.id, item]))
  const states = []
  const parse = envelope => readBlockSession({ sessionId: 'session-1', generation: 1, actions, ...envelope })
  const context = { chatId: CHAT, latest: true, intent: CHAT_INTENT }
  const session = createInlineSession({ ...parse({ items, features: ['row-state', 'rows-v2'], context }), publish: state => states.push(structuredClone(state)),
    loadExact: async id => (store.has(id) ? structuredClone(store.get(id)) : null), onNeedRuntime: () => {} })
  return { session, last: () => states.at(-1), row: id => states.at(-1).rows.find(item => item.intent === `review:${id}`), action: () => states.at(-1).actions[0] }
}
const open = async (ids, records) => { const h = card(ids, records); h.session.start(); await tick(); return h }

test('"merged" is a merge into the default branch: another branch, an orphaned merge and a stranded update are not it', async () => {
  const merged = record('one', 'merged', { states: { publication: 'MERGED' } })
  const elsewhere = record('two', 'merged', { states: { publication: 'MERGED_ELSEWHERE' } })
  const orphaned = record('three', 'merged', { states: { publication: 'ORPHANED' } })
  assert.deepEqual([merged, elsewhere, orphaned].map(pullKey), ['merged', 'merged_elsewhere', 'orphaned'])
  const h = await open(['one', 'two', 'three'], [merged, elsewhere, orphaned])
  assert.deepEqual(['one', 'two', 'three'].map(id => h.row(id).pill), ['Merged', 'Merged to a branch', 'Not shipped'])
  assert.deepEqual(['one', 'two', 'three'].map(id => h.row(id).tone), ['success', 'neutral', 'attention'])
})

test('a record written as the status word alone still reads Merged, Closed, Draft and Open as it did', async () => {
  const records = [record('one', 'merged'), record('two', 'closed'), record('three', 'draft'), record('four', 'open'), record('five', 'open', { states: { publication: 'QUEUED' } })]
  const h = await open(['one', 'two', 'three', 'four', 'five'], records)
  assert.deepEqual(['one', 'two', 'three', 'four', 'five'].map(id => h.row(id).pill), ['Merged', 'Closed', 'Draft', '', ''])
})

test('an update whose PR merged first says so: it is not "Merged", not "Contribution sent", and offers nothing to send', async () => {
  const stranded = record('one', 'merged', { action: 'pr_update', states: { publication: 'MERGED', update: 'STRANDED_UPDATE' } })
  assert.deepEqual([isStranded(stranded), isPublished(stranded)], [true, false])
  const h = await open(['one'], [stranded])
  assert.equal(h.row('one').pill, 'PR merged first')
  assert.equal(h.row('one').tone, 'attention')
  assert.deepEqual(h.row('one').links, [{ label: '#7', url: 'https://github.com/owner/repo/pull/7' }])
  assert.equal(h.last().title, '1 update not sent')
  assert.equal(h.last().titleTone, 'attention')
  assert.equal(h.action().hidden, true, 'a stranded update can no longer be sent from the card')
  // The update that really went out and whose PR then merged is the story it always was.
  const sent = await open(['one'], [record('one', 'merged', { action: 'pr_update', states: { publication: 'MERGED', update: 'NONE' } })])
  assert.deepEqual([sent.row('one').pill, sent.last().title], ['Merged', 'Contribution sent'])
})

test('an update waiting on its public PR is waiting, not sent, even though it carries the PR\'s own url and number', async () => {
  // The platform keeps a public PR's url and number on the record while a new update is prepared.
  const waiting = record('one', 'prepared', { action: 'pr_update', more: pull(7) })
  const sending = record('two', 'submitting', { action: 'pr_update', more: pull(8) })
  assert.deepEqual([waiting, sending].map(isPublished), [false, false])
  assert.deepEqual([waiting, sending].map(isStranded), [false, false])
  const h = await open(['one'], [waiting])
  assert.notEqual(h.last().title, 'Contribution sent')
  assert.equal(h.action().hidden === true, false, 'the card still offers its Send')
  assert.equal(h.row('one').links, undefined, 'a PR link is shown only once the update went out')
  const sent = record('one', 'open', { action: 'pr_update' })
  assert.equal(isPublished(sent), true, 'after the update went out it is the open PR again')
})

test('an update whose PR closed first says so, and the card counts it beside what was sent', async () => {
  const closed = record('one', 'closed', { action: 'pr_update', states: { publication: 'CLOSED', update: 'STRANDED_UPDATE' } })
  const h = await open(['one', 'two'], [closed, record('two', 'open')])
  assert.deepEqual([h.row('one').pill, h.row('two').pill], ['PR closed first', ''])
  assert.equal(h.last().title, '1 of 2 sent · 1 update not sent')
  assert.equal(h.last().titleTone, 'attention')
})

test('a record replaced by other work follows superseded_by to its successor', async () => {
  const old = record('one', 'superseded', { states: { publication: 'SUPERSEDED' }, more: { superseded_by: 'two' } })
  const successor = record('two', 'prepared')
  assert.equal(isSuperseded(old), true)
  const h = await open(['one'], [old, successor])
  assert.deepEqual(h.last().rows.map(item => item.intent), ['review:two'], 'the card follows to the current version')
  const lone = await open(['one'], [{ ...old, superseded_by: undefined }])
  assert.equal(lone.row('one').pill, 'Replaced', 'with no successor it is a replaced record, never "Merged"')
})

test('an update an older app abandoned while its PR is live reads as that live PR, not as Dismissed', async () => {
  // The engine's `corrects` rule: the stored lifecycle says an update waits on an open PR, the status word says abandoned.
  const abandoned = record('one', 'abandoned', { action: 'pr_update', states: { publication: 'OPEN', update: 'PREPARED_UPDATE' } })
  assert.equal(isPublished(abandoned), true)
  const h = await open(['one'], [abandoned])
  // Its history (the engine infers the discard from the word) says the update was dropped, so the row says that.
  assert.deepEqual([h.row('one').pill, h.row('one').links[0].label], ['Update dropped', '#7'])
  // The shadow-mode discard stores no lifecycle: the tables seed an abandoned update with its PR as that live PR too.
  const unstored = record('one', 'abandoned', { action: 'pr_update' })
  assert.equal('lifecycle' in unstored, false)
  assert.equal(isPublished(unstored), true)
  const seen = await open(['one'], [unstored])
  assert.deepEqual([seen.row('one').pill, seen.row('one').links[0].label], ['', '#7'], 'with no history entry it reads as today')
  // Work that was never sent, with or without a lifecycle stored, is still Dismissed.
  const never = record('one', 'abandoned', { states: { publication: 'ABANDONED' } })
  assert.equal((await open(['one'], [never])).row('one').pill, 'Dismissed')
  assert.equal((await open(['one'], [record('one', 'abandoned')])).row('one').pill, 'Dismissed')
})

// The engine-mode discard of a waiting update: the PR returns to open with the discard in its history.
const dropped = (id = 'one') => ({ ...discardRecord(record(id, 'prepared', { action: 'pr_update', more: pull(7) })), updated_at: '2026-11-18T10:00:00Z' })

test('a discarded update reads as dropped, not as a send, and is not counted as sent in the header', async () => {
  const discarded = dropped()
  assert.deepEqual([discarded.status, isPublished(discarded), isDroppedUpdate(discarded)], ['open', true, true])
  const alone = await open(['one'], [discarded])
  assert.deepEqual([alone.row('one').pill, alone.row('one').tone, alone.row('one').links], ['Update dropped', 'neutral', [{ label: '#7', url: pull(7).url }]])
  assert.equal(alone.last().title, 'Nothing left to send')
  assert.notEqual(alone.last().titleTone, 'success')
  const beside = await open(['one', 'two'], [discarded, record('two', 'open', { number: 8 })])
  assert.equal(beside.last().title, '1 pull request', 'only the update that went out is counted')
  assert.deepEqual([beside.row('one').pill, beside.row('two').pill], ['Update dropped', ''])
})

test('an update prepared or sent after a discard is no longer dropped', () => {
  const discarded = dropped()
  const again = { ...discarded, status: 'prepared' }
  assert.deepEqual([isDroppedUpdate(again), isPublished(again)], [false, false], 'a new update waits to be sent')
  const now = Math.floor(Date.now() / 1000)
  const step = (vector, event) => apply(TABLES, vector, { source: 'platform', ...event }, now).vector
  const staged = step(discarded.lifecycle, { type: 'STAGE_UPDATE' })
  const sent = step(step(staged, { type: 'SEND_UPDATE_CONFIRMED', region: 'update' }), { type: 'UPDATE_OK', region: 'update' })
  const after = { ...discarded, lifecycle: sent, status: 'open' }
  assert.deepEqual([isDroppedUpdate(after), isPublished(after)], [false, true], 'the update that went out is a send')
  // No history entry at all (shadow mode, an open PR) reads as today.
  assert.equal(isDroppedUpdate(record('one', 'open', { action: 'pr_update' })), false)
  assert.equal(isDroppedUpdate(record('one', 'merged')), false)
})

test('the earlier card (no rows-v2) says Update dropped too and does not count it as sent', async () => {
  const discarded = dropped()
  const store = new Map([['one', discarded], ['two', record('two', 'open', { number: 8 })]])
  const states = []
  const session = createInlineSessionV1({ sessionId: 'session-1', actions: [{ key: `chat-send-batch:${batchHandle(['one', 'two'])}`, label: 'Contribute' }], items: [{ intent: 'review:one' }, { intent: 'review:two' }], features: ['row-state'],
    publish: state => states.push(structuredClone(state)), loadExact: async id => structuredClone(store.get(id)), onNeedRuntime: () => {} })
  session.start(); await tick()
  const rows = states.at(-1).items
  assert.deepEqual(rows.map(item => [item.status, item.statusTone]), [[DROPPED_PILL_V1, 'neutral'], ['Open', 'success']])
  assert.equal(states.at(-1).title, '1 of 2 sent')
})

test('an unknown attempt on an update that was stranded is answered: it never went out', () => {
  const stranded = record('one', 'merged', { action: 'pr_update', states: { publication: 'MERGED', update: 'STRANDED_UPDATE' } })
  const attempt = { id: 'a1', unitKey: 'record:one', ids: ['one'], at: 1, state: 'unknown', note: '' }
  for (const [observe, note] of [[observeAttempt, STRANDED_NOTE], [observeAttemptV1, STRANDED_NOTE_V1]]) {
    assert.deepEqual(observe(attempt, new Map([['one', stranded]])), { ...attempt, state: 'failed', note })
    const open = record('one', 'open', { action: 'pr_update' })
    assert.equal(observe(attempt, new Map([['one', open]])).state, 'sent', 'an update that did go out is still a send')
  }
})

test('a stranded update is told as such where a send is asked about it', () => {
  const stranded = record('one', 'merged', { action: 'pr_update', states: { publication: 'MERGED', update: 'STRANDED_UPDATE' } })
  assert.match(sendBlocker(stranded), /ended before this update went out/)
  assert.equal(sendBlocker(record('one', 'merged')), 'This contribution is not waiting to be sent.')
  // Dismissed means discarded before sending; an abandoned update whose PR is public is the live PR, not dismissed.
  assert.equal(sendBlocker(record('one', 'abandoned')), 'This contribution was dismissed.')
  assert.equal(sendBlocker({ status: 'abandoned' }), 'This contribution was dismissed.')
  assert.equal(sendBlocker(record('one', 'abandoned', { action: 'pr_update' })), 'This contribution is not waiting to be sent.')
})

test('the earlier card (no rows-v2) tells the same story', async () => {
  const stranded = record('one', 'merged', { action: 'pr_update', states: { publication: 'MERGED', update: 'STRANDED_UPDATE' } })
  const store = new Map([['one', stranded]])
  const states = []
  const session = createInlineSessionV1({ sessionId: 'session-1', actions: [{ key: KEY, label: 'Contribute' }], items: [{ intent: 'review:one' }], features: ['row-state'],
    publish: state => states.push(structuredClone(state)), loadExact: async id => structuredClone(store.get(id)), onNeedRuntime: () => {} })
  session.start(); await tick()
  const row = states.at(-1).items.find(item => item.intent === 'review:one')
  assert.deepEqual([row.status, row.statusTone], ['PR merged first', 'danger'])
  assert.equal(states.at(-1).title, '1 update not sent')
  const merged = new Map([['one', record('one', 'merged', { states: { publication: 'MERGED_ELSEWHERE' } })]])
  const there = []
  const other = createInlineSessionV1({ sessionId: 'session-1', actions: [{ key: KEY, label: 'Contribute' }], items: [{ intent: 'review:one' }], features: ['row-state'],
    publish: state => there.push(structuredClone(state)), loadExact: async id => structuredClone(merged.get(id)), onNeedRuntime: () => {} })
  other.start(); await tick()
  assert.equal(there.at(-1).items.find(item => item.intent === 'review:one').status, 'Merged to a branch')
})
