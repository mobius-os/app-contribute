import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession } from '../inline-session.js'

const record = (id, extra = {}) => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo', revision: 1,
  plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) }, ...extra })
function fixture(actions, initial, options = {}) {
  let current = initial
  const states = []
  const sends = []
  const session = createInlineSession({ sessionId: 's', actions: actions.map(key => ({ key, label: 'Contribute' })),
    publish: state => states.push(state), loadExact: async id => current.find(rec => rec.id === id),
    send: options.send || (async rec => { sends.push(rec.id); return { ok: true, record: { ...rec, status: 'open', number: 7, url: 'https://github.com/team/repo/pull/7' } } }),
    sendStack: options.sendStack || (async recs => { sends.push(recs.map(rec => rec.id).join(',')); return { ok: true } }),
    refresh: async () => {}, })
  session.updateLedger(current, true, {})
  return { session, states, sends, setRecords(next) { current = next; session.updateLedger(next, true, {}) },
    action(key) { return states.at(-1).actions.find(item => item.key === key) } }
}

test('init and canonical hydration are read-only; activate and cancel are read-only', async () => {
  const f = fixture(['chat-send:a'], [record('a')])
  await f.session.hydrate()
  f.session.activate('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, true)
  f.session.cancel('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, false)
  assert.deepEqual(f.sends, [])
})

test('batch confirmations start independent ready entries concurrently and freeze approved copies', async () => {
  const pending = []
  const f = fixture(['chat-send-batch:a,b'], [record('a'), record('b')], { send: rec => new Promise(resolve => pending.push({ rec, resolve })) })
  await f.session.hydrate()
  f.session.activate('chat-send-batch:a,b')
  f.setRecords([record('a', { revision: 2 }), record('b')])
  assert.equal(f.action('chat-send-batch:a,b').disabled, false) // frozen approval stays confirmable; onSend rejects drift
  const sending = f.session.confirm('chat-send-batch:a,b')
  assert.deepEqual(pending.map(item => item.rec.id), ['a', 'b'])
  assert.equal(pending[0].rec.revision, 1)
  pending.forEach(({ rec, resolve }, i) => resolve({ ok: true, record: { ...rec, status: 'open', number: i + 1, url: `https://github.com/team/repo/pull/${i + 1}` } }))
  await sending
  assert.equal(f.action('chat-send-batch:a,b').links.length, 2)
})

test('duplicate confirm and overlapping row/batch cannot publish twice', async () => {
  let resolve
  let calls = 0
  const f = fixture(['chat-send:a', 'chat-send-batch:a,b'], [record('a'), record('b')], { send: () => { calls++; return new Promise(r => { resolve = r }) } })
  await f.session.hydrate()
  f.session.activate('chat-send:a')
  const first = f.session.confirm('chat-send:a')
  await f.session.confirm('chat-send:a')
  f.session.activate('chat-send-batch:a,b')
  await f.session.confirm('chat-send-batch:a,b')
  assert.equal(calls, 1)
  resolve({ pending: true })
  await first
  assert.notEqual(f.action('chat-send:a').status, 'Sent')
  assert.match(f.action('chat-send:a').note, /Checking/)
})

test('rejected, stale and uncertain outcomes never read as Sent', async () => {
  for (const outcome of [{ error: 'Rejected' }, { error: 'Stale approval' }, { uncertain: true }]) {
    const f = fixture(['chat-send:a'], [record('a')], { send: async () => outcome })
    await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
    assert.notEqual(f.action('chat-send:a').status, 'Sent')
    assert.equal(f.action('chat-send:a').links.length, 0)
    assert.match(f.action('chat-send:a').note, /Rejected|Stale|confirm/)
  }
})

test('stack keeps parent-first send and links settled layers after partial outcome', async () => {
  const stack = (id, position, parent = '') => record(id, { branch: `stack/s/${id}`, plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const a = stack('a', 1), b = stack('b', 2, 'a')
  let passed
  const f = fixture(['chat-send:a'], [a,b], { sendStack: async recs => { passed = recs.map(rec => rec.id); return { error: 'Second layer failed', records: [{ ...a, status: 'open', number: 3, url: 'https://github.com/team/repo/pull/3' }] } } })
  await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
  assert.deepEqual(passed, ['a', 'b'])
  assert.equal(f.action('chat-send:a').links[0].url, 'https://github.com/team/repo/pull/3')
  assert.match(f.action('chat-send:a').note, /Second layer failed/)
})

test('empty ready batch has no Contribute 0 action and exposes canonical settled link', async () => {
  const f = fixture(['chat-send-batch:a,b'], [record('a', { status: 'open', number: 2, url: 'https://github.com/team/repo/pull/2' }), record('b', { status: 'abandoned' })])
  await f.session.hydrate()
  assert.equal(f.action('chat-send-batch:a,b').hidden, true)
  assert.equal(f.action('chat-send-batch:a,b').links.length, 1)
  assert.notEqual(f.action('chat-send-batch:a,b').status, 'Sent')
  assert.deepEqual(f.sends, [])
})

test('batch reports each row as it settles while sibling remains busy', async () => {
  const pending = new Map()
  const f = fixture(['chat-send:a', 'chat-send:b', 'chat-send-batch:a,b'], [record('a'), record('b')], {
    send: rec => new Promise(resolve => pending.set(rec.id, resolve)),
  })
  await f.session.hydrate(); f.session.activate('chat-send-batch:a,b')
  const work = f.session.confirm('chat-send-batch:a,b')
  assert.equal(f.action('chat-send:a').status, 'Contributing')
  assert.equal(f.action('chat-send:b').status, 'Contributing')
  pending.get('a')({ ok: true, record: { ...record('a'), status: 'open', number: 1, url: 'https://github.com/team/repo/pull/1' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.action('chat-send:a').status, 'Sent')
  assert.equal(f.action('chat-send:a').links.length, 1)
  assert.equal(f.action('chat-send:b').status, 'Contributing')
  assert.equal(f.action('chat-send-batch:a,b').status, 'Contributing')
  pending.get('b')({ error: 'Rejected by server' })
  await work
  assert.equal(f.action('chat-send:b').status, 'Needs attention')
  assert.match(f.action('chat-send:b').note, /Rejected/)
  assert.equal(f.action('chat-send:a').links.length, 1)
})

test('duplicate batch ids from one stack publish that stack once', async () => {
  const stack = (id, position, parent = '') => record(id, { branch: `stack/s/${id}`, plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  let calls = 0
  const f = fixture(['chat-send-batch:a,b'], [stack('a', 1), stack('b', 2, 'a')], { sendStack: async () => { calls++; return { pending: true } } })
  await f.session.hydrate(); f.session.activate('chat-send-batch:a,b'); await f.session.confirm('chat-send-batch:a,b')
  assert.equal(calls, 1)
  assert.equal(f.action('chat-send-batch:a,b').status, 'Checking result')
})

test('pending reconciles on a later canonical ledger update, but not without a verified link', async () => {
  const f = fixture(['chat-send:a'], [record('a')], { send: async () => ({ pending: true }) })
  await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
  assert.equal(f.action('chat-send:a').status, 'Checking result')
  f.setRecords([record('a', { status: 'open', number: 4 })])
  assert.equal(f.action('chat-send:a').status, 'Checking result')
  f.setRecords([record('a', { status: 'open', number: 4, url: 'https://github.com/team/repo/pull/4' })])
  assert.equal(f.action('chat-send:a').status, 'Sent')
})

test('successful response without a verified link remains Checking result', async () => {
  const f = fixture(['chat-send:a'], [record('a')], { send: async () => ({ ok: true }) })
  await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
  assert.equal(f.action('chat-send:a').status, 'Checking result')
  assert.equal(f.action('chat-send:a').links.length, 0)
})

test('initial hydration says Loading, and empty footer keeps its original label', async () => {
  const states = []
  const f = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send-batch:a,b', label: 'Contribute all' }], publish: state => states.push(state), loadExact: async () => null, send: async () => { throw Error('must not send') } })
  f.updateLedger([], false, {})
  assert.equal(states.at(-1).actions[0].status, 'Loading')
  assert.equal(states.at(-1).actions[0].label, 'Contribute all')
  await f.hydrate()
  f.updateLedger([], true, {})
  assert.equal(states.at(-1).actions[0].status, 'Needs attention')
  assert.equal(states.at(-1).actions[0].hidden, true)
})

test('mixed stack update prefix settles, then new-PR suffix needs a new explicit confirmation', async () => {
  const stack = (id, position, action, parent = '') => record(id, { branch: `stack/s/${id}`, plan: { action, repo: 'team/repo', head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const a = stack('a', 1, 'pr_update'), b = stack('b', 2, 'pr', 'a')
  const phases = []
  const f = fixture(['chat-send:a'], [a, b], { sendStack: async recs => {
    const prepared = recs.filter(rec => rec.status === 'prepared')
    phases.push(prepared.filter(rec => rec.plan.action === prepared[0]?.plan.action).map(rec => rec.id))
    return phases.length === 1
      ? { ok: true, records: [{ ...a, status: 'open', number: 8, url: 'https://github.com/team/repo/pull/8' }] }
      : { pending: true }
  } })
  await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
  assert.deepEqual(phases, [['a']])
  assert.equal(f.action('chat-send:a').links.length, 1)
  assert.equal(f.action('chat-send:a').status, 'Ready')
  assert.equal(f.action('chat-send:a').confirming, false)
  f.session.activate('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, true)
  await f.session.confirm('chat-send:a')
  assert.deepEqual(phases, [['a'], ['b']])
  assert.equal(f.action('chat-send:a').status, 'Checking result')
  assert.equal(f.action('chat-send:a').links.length, 1)
  f.setRecords([{ ...a, status: 'open', number: 8, url: 'https://github.com/team/repo/pull/8' }, { ...b, status: 'open', number: 9, url: 'https://github.com/team/repo/pull/9' }])
  assert.equal(f.action('chat-send:a').status, 'Sent')
  assert.equal(f.action('chat-send:a').links.length, 2)
})

test('activation before authoritative hydration opens confirmation later without sending', async () => {
  let resolveExact
  let sends = 0
  const states = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a', label: 'Contribute' }], publish: state => states.push(state),
    loadExact: () => new Promise(resolve => { resolveExact = resolve }), send: async () => { sends++; return { ok: true } } })
  session.updateLedger([], false, {})
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].confirming, false)
  const hydration = session.hydrate()
  session.updateLedger([record('a')], true, {})
  assert.equal(states.at(-1).actions[0].confirming, false)
  resolveExact(record('a'))
  await hydration
  assert.equal(states.at(-1).actions[0].confirming, true)
  assert.equal(sends, 0)
})

test('cancel clears an activation requested before hydration', async () => {
  let resolveExact
  const states = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a', label: 'Contribute' }], publish: state => states.push(state),
    loadExact: () => new Promise(resolve => { resolveExact = resolve }), send: async () => { throw Error('must not send') } })
  session.updateLedger([], false, {})
  session.activate('chat-send:a')
  session.cancel('chat-send:a')
  const hydration = session.hydrate()
  session.updateLedger([record('a')], true, {})
  resolveExact(record('a'))
  await hydration
  assert.equal(states.at(-1).actions[0].confirming, false)
})

test('partial stack failure note clears only after explicit recovery settles remaining layer', async () => {
  const stack = (id, position, parent = '') => record(id, { branch: `stack/s/${id}`, plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), branch: `stack/s/${id}`, stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const a = stack('a', 1), b = stack('b', 2, 'a')
  let calls = 0
  const f = fixture(['chat-send:a'], [a, b], { sendStack: async () => {
    calls++
    return calls === 1
      ? { error: 'Second layer failed', records: [{ ...a, status: 'open', number: 5, url: 'https://github.com/team/repo/pull/5' }] }
      : { ok: true, records: [{ ...b, status: 'open', number: 6, url: 'https://github.com/team/repo/pull/6' }] }
  } })
  await f.session.hydrate(); f.session.activate('chat-send:a'); await f.session.confirm('chat-send:a')
  assert.equal(f.action('chat-send:a').status, 'Needs attention')
  assert.match(f.action('chat-send:a').note, /Second layer failed/)
  assert.equal(f.action('chat-send:a').links.length, 1)
  f.session.activate('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, true)
  assert.equal(calls, 1) // no retry before a second explicit confirm
  await f.session.confirm('chat-send:a')
  assert.equal(calls, 2)
  assert.equal(f.action('chat-send:a').status, 'Sent')
  assert.equal(f.action('chat-send:a').links.length, 2)
  assert.doesNotMatch(f.action('chat-send:a').note, /failed/)
})
