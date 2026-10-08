import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createInlineSession } from '../inline-session.js'

const record = id => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo', plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40) }, quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) } })
const opened = (rec, number = 1) => ({ ...rec, status: 'open', number, url: `https://github.com/team/repo/pull/${number}`, updated_at: '2026-10-08T12:00:00Z' })
const reviews = recs => ({ state: 'ready', byId: Object.fromEntries(recs.map(rec => [rec.id, { state: 'ready' }])) })
const actions = [{ key: 'chat-send:a', label: 'Contribute' }]
function fixture(recs = [record('a')], options = {}) {
  let current = recs
  let state, calls = 0
  const session = createInlineSession({ sessionId: 's', actions, loadExact: async id => current.find(rec => rec.id === id),
    send: async () => { calls++; return { uncertain: true } }, sendStack: async () => { calls++; return { uncertain: true } },
    ...options, publish: next => { state = next; options.publish?.(next) } })
  return { session, get state() { return state }, get calls() { return calls },
    ledger(next = current, ready = true) { current = next; session.updateLedger(next, ready, reviews(next)) } }
}

for (const phase of ['busy', 'uncertain']) test(`${phase} ownership survives cold reload, prepared reread, and explicit activate/confirm without another handler`, async () => {
  let release
  const first = fixture(undefined, phase === 'busy' ? { send: () => new Promise(resolve => { release = resolve }) } : {})
  first.ledger(); await first.session.hydrate(); first.session.activate(actions[0].key)
  const sending = first.session.confirm(actions[0].key)
  if (phase === 'uncertain') await sending
  const checkpoint = first.state.checkpoint
  assert.ok(checkpoint, 'ownership is emitted before an unresolved handler can complete')
  assert.equal(checkpoint.data.includes('head_sha'), false)
  const next = fixture(undefined, { checkpoint, retain: true })
  next.ledger([], false)
  assert.equal(next.state.retain, true)
  assert.equal(next.state.checkpointAck, checkpoint.id)
  assert.equal(next.state.ackNonce, null)
  assert.equal(next.state.actions[0].disabled, true)
  next.ledger(); await next.session.hydrate()
  assert.equal(next.state.actions[0].disabled, true)
  assert.equal(next.state.actions[0].hidden, false)
  next.session.activate(actions[0].key); await next.session.confirm(actions[0].key)
  assert.equal(next.calls, 0)
  next.ledger([opened(record('a'))])
  assert.equal(next.state.retain, false)
  assert.equal(next.state.checkpoint, null)
  assert.equal(next.state.actions[0].links[0].url, 'https://github.com/team/repo/pull/1')
  if (release) { release({ uncertain: true }); await sending }
})

test('confirmation is not a checkpoint and a reloaded confirmation cannot replay Confirm', async () => {
  const first = fixture(); first.ledger(); await first.session.hydrate(); first.session.activate(actions[0].key)
  assert.equal(first.state.checkpoint, null)
  const next = fixture(); next.ledger(); await next.session.hydrate()
  next.session.handleEvent({ key: actions[0].key, event: 'confirm', nonce: 'old-confirm' })
  assert.equal(next.calls, 0)
  assert.equal(next.state.retain, false)
  first.session.cancel(actions[0].key); assert.equal(first.state.retain, false)
})

for (const checkpoint of [{ id: 'bad', data: 'not-json' }, { id: 'large', data: '💫'.repeat(9000) }, { id: '', data: '{}' },
  { id: 'wrong', data: JSON.stringify({ version: 1, phases: [{ unitKey: 'record:a', phaseIds: ['a'], state: 'ready', note: '' }] }) }]) {
  test(`invalid checkpoint ${checkpoint.id || 'empty'} fails closed and remains visible`, async () => {
    const next = fixture(undefined, { checkpoint, retain: true }); next.ledger(); await next.session.hydrate()
    assert.equal(next.state.retain, true); assert.equal(next.state.recoveryError, true)
    assert.equal(next.state.actions[0].hidden, false); assert.equal(next.state.actions[0].disabled, true)
    assert.match(next.state.actions[0].note, /Open Contribute/)
    next.session.activate(actions[0].key); await next.session.confirm(actions[0].key); assert.equal(next.calls, 0)
  })
}

test('retained owner without recovery data cannot silently unlock', async () => {
  const next = fixture(undefined, { retain: true }); next.ledger(); await next.session.hydrate()
  assert.equal(next.state.recoveryError, true); assert.equal(next.state.retain, true)
  next.session.activate(actions[0].key); await next.session.confirm(actions[0].key); assert.equal(next.calls, 0)
})

for (const state of ['pending', 'failed']) test(`reloaded partial stack ${state} blocks a newly prepared suffix until all attempted identities settle`, async () => {
  const stack = (id, position, parent = '') => ({ ...record(id), plan: { ...record(id).plan, base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const a = stack('a', 1), b = stack('b', 2, 'a')
  const checkpoint = { id: 'partial', data: JSON.stringify({ version: 1, phases: [{ unitKey: 'stack:s', phaseIds: ['a', 'b'], state, note: 'Check the remainder' }] }) }
  const next = fixture([opened(a), b], { checkpoint, retain: true })
  next.ledger(); await next.session.hydrate(); next.session.activate(actions[0].key); await next.session.confirm(actions[0].key)
  assert.equal(next.calls, 0); assert.equal(next.state.retain, true); assert.equal(next.state.actions[0].disabled, true)
  next.ledger([opened(a), opened(b, 2)])
  assert.equal(next.state.retain, false); assert.equal(next.state.actions[0].status, 'Open')
})

test('partial batch recovery keeps both exact units without sending a prepared remainder', async () => {
  const batch = [{ key: 'chat-send-batch:a,b', label: 'Contribute all' }]
  const checkpoint = { id: 'batch', data: JSON.stringify({ version: 1, phases: ['a', 'b'].map(id => ({ unitKey: `record:${id}`, phaseIds: [id], state: 'pending', note: '' })) }) }
  const next = fixture([opened(record('a')), record('b')], { actions: batch, checkpoint, retain: true })
  next.ledger(); await next.session.hydrate(); next.session.activate(batch[0].key); await next.session.confirm(batch[0].key)
  assert.equal(next.calls, 0); assert.equal(next.state.retain, true)
  next.ledger([opened(record('a')), opened(record('b'), 2)]); assert.equal(next.state.retain, false)
})

// Execute the actual component initializer, not a separate recovery adapter.
export function mountInitializer(blockSession, props, read, publish) {
  const source = readFileSync(new URL('../ui/InlineBlockSession.jsx', import.meta.url), 'utf8')
  const component = source.slice(source.indexOf('export function InlineBlockSession')).replace('export function', 'function')
  const listeners = new Map(), effects = [], refs = []
  const parent = { postMessage: publish }, window = { parent, location: { origin: 'https://fixture.test' },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  const hooks = { useRef: value => { const ref = { current: value }; refs.push(ref); return ref }, useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn) }
  new Function('window', 'createInlineSession', 'loadFreshContributionRecord', 'hooks', 'props', `const {useRef,useEffect,useLayoutEffect}=hooks; ${component}; InlineBlockSession(props);`)(window, createInlineSession, read, hooks, { blockSession, ...props })
  const cleanup = effects.map(fn => fn()).filter(Boolean)
  return { session: refs[0].current, message: data => listeners.get('message')({ source: parent, origin: window.location.origin, data }), dispose: () => cleanup.forEach(fn => fn()) }
}

test('actual InlineBlockSession cold initializer imports checkpoint before any empty ledger update', async () => {
  const checkpoint = { id: 'attempt', data: JSON.stringify({ version: 1, phases: [{ unitKey: 'record:a', phaseIds: ['a'], state: 'pending', note: 'Check the result' }] }) }
  const states = [], calls = []
  const mounted = mountInitializer({ sessionId: 's', actions, checkpoint, retain: true }, { records: [], ledgerReady: false, reviewStatus: {}, onSend: rec => calls.push(rec) }, async () => record('a'), state => states.push(state))
  assert.equal(states[0].checkpointAck, 'attempt'); assert.equal(states[0].retain, true)
  await mounted.session.hydrate(); mounted.session.updateLedger([record('a')], true, reviews([record('a')]))
  mounted.message({ type: 'moebius:app-block-action', sessionId: 's', key: actions[0].key, event: 'activate', nonce: 'new-activate' })
  mounted.message({ type: 'moebius:app-block-action', sessionId: 's', key: actions[0].key, event: 'confirm', nonce: 'old-confirm' })
  assert.deepEqual(calls, []); assert.equal(states.at(-1).actions[0].disabled, true)
  mounted.dispose()
})

test('an oversized newly frozen ownership checkpoint blocks before any public handler', async () => {
  const members = Array.from({ length: 256 }, (_, index) => {
    const id = String(index).padEnd(128, 'a'), parent = index ? String(index - 1).padEnd(128, 'a') : ''
    return { ...record(id), plan: { ...record(id).plan, base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position: index + 1, total: 256,
      base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } }
  })
  const key = `chat-send:${members[0].id}`
  const f = fixture(members, { actions: [{ key, label: 'Contribute' }] })
  f.ledger(); await f.session.hydrate(); f.session.activate(key); await f.session.confirm(key)
  assert.equal(f.calls, 0); assert.equal(f.state.recoveryError, true); assert.equal(f.state.retain, true)
  assert.match(f.state.actions[0].note, /too large/)
})

// Optional cross-checkout protocol contract. Run with
// MOBIUS_APP_BLOCK_HOST_ROOT=<platform-checkout> against the exact host candidate.
for (const phase of ['busy', 'uncertain', 'partial-stack', 'partial-batch']) test(`composed real app/host reload: ${phase}`, { skip: !process.env.MOBIUS_APP_BLOCK_HOST_ROOT }, async () => {
  const hostRoot = process.env.MOBIUS_APP_BLOCK_HOST_ROOT
  const host = await import(`${hostRoot}/frontend/src/components/ChatView/markdown/appBlock.js`)
  const { attributedFrameVersion } = await import(`${hostRoot}/frontend/src/components/AppCanvas/appFrameProtocol.js`)
  const canvas = readFileSync(`${hostRoot}/frontend/src/components/AppCanvas/AppCanvas.jsx`, 'utf8')
  const stack = (id, position, parent = '') => ({ ...record(id), plan: { ...record(id).plan, base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const recs = phase === 'partial-stack' ? [stack('a', 1), stack('b', 2, 'a')] : phase === 'partial-batch' ? [record('a'), record('b')] : [record('a')]
  const key = phase === 'partial-batch' ? 'chat-send-batch:a,b' : 'chat-send:a'
  const advertised = [{ key, label: 'Contribute' }], keys = new Set([key])
  let state = null, release, firstState, sends = 0
  const oldSource = {}, newSource = {}, frames = new Map([['old', { contentWindow: oldSource }], ['new', { contentWindow: newSource }]])
  const scope = { liveVersionRef: { current: 'old' }, blockSessionRef: { current: { sessionId: 's' } },
    onBlockStateRef: { current: message => { state = host.inlineBlockStateUpdate(state, host.inlineBlockState(message, 's', keys)) } } }
  const begin = canvas.indexOf("if (msg.type === 'moebius:app-block-state'")
  const branch = canvas.slice(begin, canvas.indexOf("      if (msg.type === 'moebius:module-request'", begin))
  const receive = (source, message) => new Function('scope', 'srcVersion', 'msg', `with(scope) { ${branch} }`)(scope, attributedFrameVersion(frames, source), message)
  const send = async rec => {
    sends++; assert.ok(firstState.checkpoint, 'checkpoint must precede the handler boundary')
    if (phase === 'busy') return new Promise(resolve => { release = resolve })
    if (phase === 'partial-batch' && rec.id === 'a') return { ok: true, record: opened(rec) }
    return { uncertain: true }
  }
  const first = createInlineSession({ sessionId: 's', actions: advertised, loadExact: async id => recs.find(rec => rec.id === id), send,
    sendStack: async members => { sends++; return { uncertain: true, records: [opened(members[0])] } },
    publish: message => { firstState = message; receive(oldSource, message) } })
  first.updateLedger(recs, true, reviews(recs)); await first.hydrate(); first.activate(key)
  const sending = first.confirm(key); if (phase !== 'busy') await sending
  assert.ok(state.checkpoint); first.dispose(); state = host.inlineBlockDocumentReset(state); scope.liveVersionRef.current = 'new'
  receive(newSource, { type: 'moebius:app-block-state', sessionId: 's', actions: [{ key, disabled: false }], retain: false })
  assert.equal(host.inlineSessionRetained(state, null), true); assert.equal(state.actions[0].disabled, true)
  const checkpoint = state.checkpoint
  const blockSession = { sessionId: 's', actions: advertised, checkpoint, retain: state.retain, recoveryError: state.recoveryError }
  const messages = []
  const initScope = { loadedDocsRef: { current: new Set(['new']) }, token: 'mock',
    framesRef: { current: new Map([['new', { contentWindow: { postMessage: message => messages.push(message) } }]]) },
    getEffectiveTheme: () => ({ css: '', bg: '#fff' }), theme: null, readAppFrameStorage: () => ({}), appId: 'mock', appSlug: 'mock', capabilityContract: null,
    blockSessionRef: { current: blockSession }, blockSession, swap: { liveVersion: 'new', liveLoaded: true }, postToFrame: (_version, message) => messages.push(message), useEffect: fn => fn() }
  const init = canvas.slice(canvas.indexOf('  function sendInit(v) {'), canvas.indexOf('  // Keep the swap state machine'))
  const delivery = canvas.slice(canvas.indexOf('  // Inline transcript sessions'), canvas.indexOf('  useEffect(() => {\n    if (!blockSession || !blockEvent'))
  new Function('scope', `with(scope) { ${init}; sendInit('new'); ${delivery} }`)(initScope)
  assert.deepEqual(messages[0].blockSession, blockSession); assert.deepEqual(messages[1].checkpoint, checkpoint)
  assert.equal(messages[1].nonce, undefined)
  let nextCalls = 0
  const mounted = mountInitializer(messages[0].blockSession, { records: [], ledgerReady: false, reviewStatus: {}, onSend: () => { nextCalls++ }, onSendStack: () => { nextCalls++ } }, async id => recs.find(rec => rec.id === id), message => receive(newSource, message))
  assert.equal(state.checkpointAck, checkpoint.id); assert.equal(state.ackNonce, null); assert.equal(state.retain, true)
  mounted.message(messages[1]); await mounted.session.hydrate(); mounted.session.updateLedger(recs, true, reviews(recs))
  assert.equal(state.actions[0].disabled, true); assert.equal(state.actions[0].hidden, false)
  for (const event of ['activate', 'confirm']) mounted.message({ type: 'moebius:app-block-action', sessionId: 's', key, event, nonce: event === 'confirm' ? 'old-confirm' : 'new-activate' })
  assert.equal(nextCalls, 0)
  const before = state; receive(oldSource, { type: 'moebius:app-block-state', sessionId: 's', actions: [], retain: false }); assert.equal(state, before)
  const canonical = recs.map((rec, i) => opened(rec, i + 1)); mounted.session.updateLedger(canonical, true, reviews(canonical))
  assert.equal(host.inlineSessionRetained(state, null), false); assert.equal(state.checkpoint, null)
  assert.equal(state.actions[0].links[0].url, 'https://github.com/team/repo/pull/1')
  mounted.dispose(); if (release) { release({ uncertain: true }); await sending }
})
