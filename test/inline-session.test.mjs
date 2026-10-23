import test from 'node:test'
import assert from 'node:assert/strict'
import { batchHandle, cardRecordIds, sendTarget } from '../chat-blocks.js'
import { reviewAddressFor } from '../send-readiness.js'
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

// The review status the real server returns: rows only for the records the app
// addressed (#1911), which is what the app asks for via reviewAddressFor.
function serverReviewStatus(addressed, store) {
  const ids = addressed.filter(id => store.get(id)?.status === 'prepared')
  return { state: 'ready', addressed, byId: Object.fromEntries(ids.map(id => [id, { state: 'ready' }])) }
}
function harness({ actions, records, checkpoint = null, retain = false, send, sendStack, address = null, runtime: extra = {} }) {
  const store = new Map(records.map(record => [record.id, record]))
  const states = [], sends = [], needs = []
  const session = createInlineSession({ sessionId: 'session-1', actions, checkpoint, retain, publish: state => states.push(structuredClone(state)),
    loadExact: async id => store.has(id) ? structuredClone(store.get(id)) : null, onNeedRuntime: () => needs.push(true) })
  const runtime = () => ({ records: [...store.values()], ledgerReady: true, connection: 'connected', frozenBinding: true,
    reviewStatus: serverReviewStatus(address || reviewAddressFor(cardRecordIds(actions.map(item => item.key)), [...store.values()]), store),
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
  const sized = confirmationItem(prepared('sized', { plan: { diff_stat: ' 3 files changed, 40 insertions(+), 2 deletions(-)' } }))
  assert.deepEqual(sized.facts.find(fact => fact.label === 'Change'), { label: 'Change', value: '3 files · +40 −2' }, 'Confirm shows how big the change is')
  const stacked = confirmationItem({ ...layer('base', 1, ''), plan: { ...layer('base', 1, '').plan, diff_stat: '1 file changed, 1 insertion(+)' } })
  assert.equal(stacked.facts.length, 8, 'a stack layer with its size stays within the eight-fact limit')
  assert.equal(stacked.facts.find(fact => fact.label === 'Change').value, '1 file · +1 −0')
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

test('a card naming one layer of a new stack reaches Confirm once every prepared layer is addressed', async () => {
  const records = [layer('base', 1, ''), layer('top', 2, 'base')]
  records[1].plan.base_sha = records[0].plan.head_sha
  const actions = [{ key: 'chat-send:base', label: 'Contribute' }]
  assert.deepEqual(reviewAddressFor(['base'], records), ['base', 'top'], 'the status request covers the whole stack phase')
  // As the server answers a request addressed only to the card's own id: the other layer has no check.
  const narrow = harness({ actions, records, address: ['base'] })
  await openConfirm(narrow, 'chat-send:base')
  assert.equal(narrow.action('chat-send:base').confirming, false)
  assert.match(narrow.action('chat-send:base').note, /current source check/)
  // The app's request covers every prepared layer, so the stack's phase can be confirmed and sent as one.
  const h = harness({ actions, records })
  await openConfirm(h, 'chat-send:base')
  const state = h.action('chat-send:base')
  assert.equal(state.confirming, true)
  assert.deepEqual(state.confirmation.map(item => item.title), ['Change base', 'Change top'])
  h.fire('chat-send:base', 'confirm'); await tick()
  assert.deepEqual(h.sends.map(call => [call.kind, call.ids.join(',')]), [['stack', 'base,top']])
})

test('the review-status address is bounded and adds only prepared layers of named stacks', () => {
  const records = [layer('base', 1, '', 'open'), layer('top', 2, 'base'), prepared('alone')]
  assert.deepEqual(reviewAddressFor(['top', 'alone', 'top'], records), ['top', 'alone'], 'a published layer needs no check')
  assert.deepEqual(reviewAddressFor(['missing'], records), ['missing'])
  assert.equal(reviewAddressFor(Array.from({ length: 60 }, (_, n) => `id${n}`), []).length, 50)
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

// One card with a Contribute all action, opened to Confirm on that action.
async function confirmingCard() {
  const ids = ['one', 'two']
  const actions = [...ids.map(id => ({ key: `chat-send:${id}`, label: 'Contribute' })), { key: `chat-send-batch:${batchHandle(ids)}`, label: 'Contribute all' }]
  const h = harness({ actions, records: ids.map(id => prepared(id)) })
  const batch = actions.at(-1).key
  const confirmingKeys = () => h.last().actions.filter(action => action.confirming).map(action => action.key)
  await openConfirm(h, batch)
  assert.deepEqual(confirmingKeys(), [batch])
  // Another action's tap while one is confirming never adds a second Confirm.
  h.fire('chat-send:one', 'activate'); await tick()
  assert.deepEqual(confirmingKeys(), [batch])
  h.fire(batch, 'cancel'); await tick()
  h.fire('chat-send:one', 'activate'); await tick()
  assert.deepEqual(confirmingKeys(), ['chat-send:one'])
  for (const state of h.states) assert.ok(state.actions.filter(action => action.confirming).length <= 1, 'never two confirming actions')
  return { h, actions }
}

test('a card never reports more than one confirming action', async () => {
  await confirmingCard()
})

// The real B2 host parser, only when MOBIUS_BLOCKS_FRONTEND names a Möbius
// frontend checkout that has it; the test above covers the rule everywhere.
test('the B2 host keeps Confirm available for that one confirming action', async t => {
  const BLOCKS = process.env.MOBIUS_BLOCKS_FRONTEND || ''
  if (!BLOCKS) return t.skip('set MOBIUS_BLOCKS_FRONTEND to a Möbius frontend with the passive block host to run this check')
  const b2 = await import(`${BLOCKS}/src/components/ChatView/markdown/appBlockSession.js`)
  const { h, actions } = await confirmingCard()
  const parsed = b2.sessionState({ type: 'moebius:app-block-state', ...h.last() }, 'session-1', new Set(actions.map(action => action.key)))
  const confirming = parsed.actions.filter(action => action.confirming)
  assert.equal(confirming.length, 1)
  assert.ok(confirming[0].confirmation?.length === 1 && !confirming[0].disabled, 'the host shows the app-sourced list and an enabled Confirm')
  assert.notEqual(confirming[0].note, b2.AMBIGUOUS_CONFIRMATION)
})

test('a relay (mobius-bot) contribution is never confirmable from chat and is never sent', async () => {
  const relay = prepared('one', { record: { submission_mode: 'mobius-bot' } })
  const h = harness({ actions: [{ key: 'chat-send:one' }], records: [relay] })
  await openConfirm(h, 'chat-send:one')
  const state = h.action('chat-send:one')
  assert.equal(state.confirming, false)
  assert.equal(state.disabled, true)
  assert.match(state.note, /Möbius relay.*Open Contribute to send it/)
  h.fire('chat-send:one', 'confirm'); await tick()
  assert.equal(h.sends.length, 0)
})

test('an uncertified approval_changed refusal stays unknown and locked end to end; only not_attempted releases Confirm', async () => {
  const { submitContribution } = await import('../api.js')
  const previousFetch = globalThis.fetch
  const refused = notAttempted => {
    globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'approval_changed', changed_record_ids: ['one'], not_attempted: notAttempted } }) })
    return submitContribution({ appId: 80, token: 't', rec: { id: 'one' }, expectedRecord: {} })
  }
  try {
    for (const notAttempted of [false, undefined]) {
      const outcome = await refused(notAttempted)
      assert.equal(outcome.failure.owner, 'automatic', 'a maybe-attempted refusal is owned by reconciliation')
      const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => outcome })
      await openConfirm(h, 'chat-send:one')
      h.fire('chat-send:one', 'confirm'); await tick()
      const state = h.action('chat-send:one')
      assert.ok(h.last().checkpoint, 'the unresolved attempt stays in the checkpoint')
      assert.equal(h.last().retain, true)
      assert.match(state.note, /not confirmed yet/)
      h.fire('chat-send:one', 'activate'); await tick()
      assert.equal(h.action('chat-send:one').confirming, false, 'Confirm is not offered again')
      h.fire('chat-send:one', 'confirm'); await tick()
      assert.equal(h.sends.length, 1, 'no second send while the outcome is unknown')
    }
    const certified = await refused(true)
    const h = harness({ actions: [{ key: 'chat-send:one' }], records: [prepared('one')], send: () => certified })
    await openConfirm(h, 'chat-send:one')
    h.fire('chat-send:one', 'confirm'); await tick()
    assert.equal(h.last().checkpoint, null, 'a certified non-attempt releases the checkpoint')
    h.fire('chat-send:one', 'activate'); await tick()
    assert.equal(h.action('chat-send:one').confirming, true, 'only not_attempted re-enables Confirm')
  } finally { globalThis.fetch = previousFetch }
  // The rule also holds for a host that forwards the code without the owner fix.
  assert.equal(attemptOutcome({ error: 'changed', failure: { owner: 'agent', code: 'approval_changed' } }).state, 'unknown')
  assert.equal(attemptOutcome({ notAttempted: true, failure: { owner: 'agent', code: 'approval_changed' } }).state, 'not_attempted')
})
