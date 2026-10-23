import test from 'node:test'
import assert from 'node:assert/strict'
import { batchHandle, cardRecordIds, sendTarget } from '../chat-blocks.js'
import { attemptOutcome, confirmationItem, createInlineSession, decodeCheckpoint, encodeCheckpoint, observeAttempt, RECOVERY_NOTE } from '../inline-session.js'

const HEAD = 'a'.repeat(40), NEXT = 'c'.repeat(40)
function prepared(id, extra = {}) {
  const head = extra.head || HEAD
  return { id, type: 'pr', status: 'prepared', repo: 'owner/repo', updated_at: '2026-10-20T10:00:00Z',
    plan: { action: 'pr', repo: 'owner/repo', title: `Change ${id}`, branch: `fix/${id}`, head_sha: head, diff_sha256: 'd'.repeat(64), ...extra.plan },
    quality_review: { state: 'all_clear', reviewed_head_sha: head }, ...extra.record }
}
function layer(id, position, parent, status = 'prepared') {
  return prepared(id, { record: { status, ...(status === 'open' ? { number: 40 + position, url: `https://github.com/owner/repo/pull/${40 + position}` } : {}) },
    plan: { branch: `stack/s1/0${position}`, base_sha: parent ? HEAD : undefined,
      stack: { id: 's1', name: 'Stack', position, total: 2, base_branch: parent ? 'stack/s1/01' : 'main', ...(parent ? { parent_record_id: parent } : {}) } } })
}
const published = (record, number = 7) => ({ ...record, status: 'open', number, url: `https://github.com/owner/repo/pull/${number}`, updated_at: '2026-10-20T11:00:00Z' })
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function harness({ actions, records, checkpoint = null, retain = false, send, sendStack, runtime: extra = {} }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = []
  const session = createInlineSession({ sessionId: 'session-1', actions, checkpoint, retain, publish: state => states.push(structuredClone(state)),
    loadExact: async id => store.has(id) ? structuredClone(store.get(id)) : null, onNeedRuntime: () => needs.push(true) })
  const runtime = () => ({ records: [...store.values()], ledgerReady: true, connection: 'connected', frozenBinding: true,
    reviewStatus: { state: 'ready', addressed: [...store.keys()], byId: Object.fromEntries([...store.keys()].map(id => [id, { state: 'ready' }])) },
    send: async rec => { sends.push({ kind: 'single', ids: [rec.id], records: [structuredClone(rec)] }); return send ? send(rec) : { ok: true } },
    sendStack: async recs => { sends.push({ kind: 'stack', ids: recs.map(rec => rec.id), records: structuredClone(recs) }); return sendStack ? sendStack(recs) : { ok: true } },
    refresh() {}, ...extra })
  let nonce = 0
  const fire = (key, event) => session.handleEvent({ sessionId: 'session-1', key, event, nonce: `n${++nonce}` })
  const last = () => states.at(-1)
  const action = key => last().actions.find(item => item.key === key)
  const provide = () => session.updateRuntime(runtime())
  return { session, store, states, sends, needs, fire, last, action, provide, runtime }
}
async function openConfirm(h, key) {
  h.session.start(); await tick()
  h.fire(key, 'activate'); await tick()
  assert.equal(h.needs.length > 0, true, 'activation asked for the publication runtime')
  h.provide(); await tick()
}

test('Contribute becomes Confirm with the complete app-sourced identity of each frozen change', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one', label: 'Contribute' }], records: [prepared('one')] })
  h.session.start(); await tick()
  assert.equal(h.action('chat-send:one').disabled, false)
  assert.equal(h.sends.length, 0, 'reading the card never sends')
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, true)
  assert.equal(state.confirmation.length, 1)
  const [item] = state.confirmation
  assert.equal(item.title, 'Change one')
  assert.ok(item.facts.length <= 8)
  for (const fact of item.facts) assert.ok(fact.label && fact.value && fact.value.length <= 512, JSON.stringify(fact))
  assert.deepEqual(item.facts.map(fact => fact.label), ['Repository', 'Action', 'Branch', 'Version', 'Reviewed diff', 'Review'])
  assert.equal(h.sends.length, 0, 'activation is not approval')
})

test('Confirm sends the frozen snapshot once and publishes the unresolved checkpoint first', async () => {
  const gate = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => gate.promise })
  await openConfirm(h, 'chat-send:one')
  const frozenTitle = h.action('chat-send:one').confirmation[0].title
  h.store.set('one', prepared('one', { plan: { title: 'Edited after Confirm appeared' } }))
  h.fire('chat-send:one', 'confirm'); h.fire('chat-send:one', 'confirm')
  await tick()
  assert.equal(h.sends.length, 1, 'double Confirm sends once')
  assert.equal(h.sends[0].records[0].plan.title, frozenTitle, 'the frozen snapshot, not a refreshed substitute, is sent')
  const pending = h.last()
  assert.ok(pending.checkpoint, 'checkpoint exists while the request is outstanding')
  assert.equal(pending.retain, true)
  assert.equal(h.action('chat-send:one').busy, true)
  h.store.set('one', published(prepared('one')))
  gate.resolve({ ok: true }); await tick()
  const done = h.action('chat-send:one')
  assert.equal(done.hidden, true)
  assert.deepEqual(done.links, [{ label: 'View PR #7', url: 'https://github.com/owner/repo/pull/7' }])
  assert.equal(h.last().checkpoint, null, 'a proven result releases the checkpoint')
})

test('the newest attempt owns the checkpoint after fail, restage and retry (reload before response)', async () => {
  let call = 0
  const second = deferred()
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
    send: () => ++call === 1 ? { error: 'Push rejected', failure: { owner: 'agent' } } : second.promise })
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.action('chat-send:one').status, 'Needs attention')
  assert.equal(h.last().checkpoint, null, 'a known failure is not a lock')
  // The agent restages a new reviewed head; the owner confirms again.
  h.store.set('one', prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T12:00:00Z' } }))
  h.provide()
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirmation[0].facts.find(fact => fact.label === 'Version').value, NEXT.slice(0, 12))
  h.fire('chat-send:one', 'confirm'); await tick()
  const saved = decodeCheckpoint(h.last().checkpoint)
  assert.equal(saved.length, 1, 'only the unresolved retry crosses reload')
  assert.deepEqual(saved[0].ids, ['one'])
  // Reload: a new document restores from that checkpoint and stays locked.
  const reloaded = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { head: NEXT })], checkpoint: h.last().checkpoint, retain: true })
  reloaded.session.start(); await tick()
  assert.equal(reloaded.last().checkpointAck, h.last().checkpoint.id)
  assert.equal(reloaded.action('chat-send:one').label, 'Check again')
  reloaded.provide(); reloaded.fire('chat-send:one', 'activate'); await tick()
  assert.equal(reloaded.action('chat-send:one').confirming, false, 'an unknown result never becomes a fresh Confirm')
  assert.equal(reloaded.sends.length, 0)
  reloaded.store.set('one', published(prepared('one', { head: NEXT }), 9))
  reloaded.fire('chat-send:one', 'activate'); await tick()
  assert.equal(reloaded.action('chat-send:one').hidden, true)
  assert.equal(reloaded.last().checkpoint, null)
})

test('only uncertain sends lock after reload; a known failure allows a new explicit Confirm', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ notAttempted: true, error: 'The saved proposal changed.' }) })
  await openConfirm(h, 'chat-send:one')
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.last().checkpoint, null)
  assert.match(h.action('chat-send:one').note, /saved proposal changed/)
  assert.equal(h.action('chat-send:one').disabled, false)
  h.fire('chat-send:one', 'activate'); await tick()
  assert.equal(h.action('chat-send:one').confirming, true, 'not attempted can be confirmed again')

  const lost = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => ({ uncertain: true }) })
  await openConfirm(lost, 'chat-send:one')
  lost.fire('chat-send:one', 'confirm'); await tick()
  assert.ok(lost.last().checkpoint, 'a lost response stays owned')
  assert.equal(lost.action('chat-send:one').status, 'Checking result')
})

test('a recorded server failure after the attempt releases a recovered lock', () => {
  const attempt = { id: 'a1', unitKey: 'record:one', ids: ['one'], at: Date.parse('2026-10-20T10:30:00Z'), state: 'unknown' }
  const older = prepared('one', { record: { last_submit_error: 'old', updated_at: '2026-10-20T10:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', older]])).state, 'unknown')
  const newer = prepared('one', { record: { last_submit_error: 'Push rejected', updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', newer]])).state, 'failed')
  assert.equal(observeAttempt(attempt, new Map([['one', published(prepared('one'))]])).state, 'sent')
  const changed = prepared('one', { head: NEXT, record: { updated_at: '2026-10-20T11:00:00Z' } })
  assert.equal(observeAttempt(attempt, new Map([['one', changed]])).state, 'unknown', 'a changed record is not proof nothing was sent')
})

test('Contribute all sends independent units in parallel and a stack as one ordered request', async () => {
  const gates = { one: deferred(), two: deferred() }
  const records = [prepared('one'), prepared('two'), layer('base', 1, ''), layer('top', 2, 'base')]
  records[3].plan.base_sha = records[2].plan.head_sha
  const ids = ['one', 'two', 'base', 'top']
  const actions = [...ids.map(id => ({ key: `chat-send:${id}`, label: 'Contribute' })), { key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, records, send: rec => gates[rec.id].promise })
  const batch = actions.at(-1).key
  await openConfirm(h, batch)
  const confirming = h.action(batch)
  assert.equal(confirming.confirming, true)
  assert.deepEqual(confirming.confirmation.map(item => item.title), ['Change one', 'Change two', 'Change base', 'Change top'])
  assert.equal(confirming.confirmation[2].facts[1].value, 'Layer 1 of 2 · Stack')
  h.fire(batch, 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => call.ids.join('+')).sort(), ['base+top', 'one', 'two'], 'both singles are in flight together')
  assert.equal(h.sends.find(call => call.kind === 'stack').ids.join(','), 'base,top')
  h.store.set('two', published(prepared('two'), 8))
  gates.two.resolve({ ok: true }); await tick()
  assert.equal(h.action('chat-send:two').hidden, true, 'a finished unit settles before slower siblings')
  assert.equal(h.action('chat-send:one').busy, true)
  gates.one.resolve({ error: 'Push rejected', failure: { owner: 'agent' } }); await tick()
  assert.equal(h.action('chat-send:one').status, 'Needs attention')
  assert.equal(h.action('chat-send:two').hidden, true, 'a sibling failure never makes a sent unit pending')
})

test('chat never sends without server binding of the confirmed snapshot', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { frozenBinding: false } })
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.disabled, true)
  assert.match(state.note, /newer Möbius/)
})

test('readiness fails closed without a current positive check of the exact record', async () => {
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], runtime: { reviewStatus: { state: 'ready', addressed: ['one'], byId: {} } } })
  await openConfirm(h, 'chat-send:one')
  assert.equal(h.action('chat-send:one').confirming, false)
  assert.match(h.action('chat-send:one').note, /current source check/)
  const stale = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one', { record: { quality_review: { state: 'all_clear', reviewed_head_sha: NEXT } } })] })
  await openConfirm(stale, 'chat-send:one')
  assert.match(stale.action('chat-send:one').note, /needs review first/)
})

test('a review check that was not addressed to the card records never enables Confirm', async () => {
  for (const addressed of [null, []]) {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')],
      runtime: { reviewStatus: { state: 'ready', addressed, byId: { one: { state: 'ready' } } } } })
    await openConfirm(h, 'chat-send:one')
    assert.equal(h.action('chat-send:one').confirming, false)
    assert.match(h.action('chat-send:one').note, /newer Möbius/)
  }
})

test('a batch handle resolves only to the exact records listed on its card', () => {
  const keys = ['chat-send:a', 'chat-send:b']
  const handle = `chat-send-batch:${batchHandle(['b', 'a'])}`
  assert.deepEqual(sendTarget(handle, [...keys, handle]), { kind: 'batch', ids: ['a', 'b'] })
  assert.equal(sendTarget(handle, ['chat-send:a', 'chat-send:c', handle]).invalid, true)
  assert.equal(sendTarget('chat-send-batch:not-a-handle', keys), null)
  assert.equal(sendTarget('chat-send:../x', keys), null)
  const long = Array.from({ length: 12 }, (_, i) => `record-${'x'.repeat(110)}-${i}`)
  assert.ok(`chat-send-batch:${batchHandle(long)}`.length <= 32, 'the batch intent stays short however long the ids are')
  assert.deepEqual(cardRecordIds([...keys, handle]), ['a', 'b'])
})

test('a stale or forged batch card offers nothing to send', async () => {
  const actions = [{ key: 'chat-send:a' }, { key: 'chat-send:b' }, { key: `chat-send-batch:${batchHandle(['a', 'c'])}` }]
  const h = harness({ actions, records: [prepared('a'), prepared('b')] })
  h.session.start(); await tick()
  const batch = h.action(actions[2].key)
  assert.equal(batch.disabled, true)
  assert.match(batch.note, /no longer matches/)
})

test('a broken or missing recovery checkpoint never resurrects Send', async () => {
  for (const options of [{ checkpoint: { id: 'c', data: '{"version":2}' } }, { retain: true }]) {
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], ...options })
    h.session.start(); await tick()
    assert.equal(h.last().recoveryError, true)
    assert.equal(h.action('chat-send:one').note, RECOVERY_NOTE)
    h.fire('chat-send:one', 'activate'); await tick()
    assert.equal(h.action('chat-send:one').confirming, false)
  }
})

test('checkpoint and outcome rules are bounded and conservative', () => {
  assert.equal(encodeCheckpoint([{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1, state: 'failed' }]), null)
  const data = encodeCheckpoint([{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1, state: 'sending', note: 'not persisted' }])
  assert.deepEqual(JSON.parse(data), { version: 1, attempts: [{ id: 'x', unitKey: 'record:a', ids: ['a'], at: 1 }] })
  assert.throws(() => decodeCheckpoint({ id: 'c', data: JSON.stringify({ version: 1, attempts: [{ id: 'x', unitKey: 'record:a', ids: ['../a'], at: 1 }] }) }))
  assert.equal(attemptOutcome({ ok: true }).state, 'unknown')
  assert.equal(attemptOutcome({ error: 'lost', failure: { owner: 'automatic' } }).state, 'unknown')
  assert.equal(attemptOutcome({ notAttempted: true, failure: { owner: 'automatic' } }).state, 'not_attempted')
  assert.equal(attemptOutcome({ error: 'no', failure: { owner: 'agent' } }).state, 'failed')
  const update = confirmationItem({ ...prepared('u'), number: 12, plan: { ...prepared('u').plan, action: 'pr_update' } })
  assert.equal(update.facts.find(fact => fact.label === 'Action').value, 'Update pull request #12')
})
