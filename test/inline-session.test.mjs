import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession, pendingPhaseBlocks, publicationPhaseKey, publicationPhaseResult, settled } from '../inline-session.js'

const readyReview = records => ({ state: 'ready', byId: Object.fromEntries(records.map(rec => [rec.id, { state: 'ready' }])) })

const record = (id, extra = {}) => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo', revision: 1,
  plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) }, ...extra })

test('legacy batch marks only canonically linked current phase sent', () => {
  const a = record('a')
  const b = record('b')
  const linked = { ...a, status: 'open', number: 12, url: 'https://github.com/team/repo/pull/12' }
  assert.deepEqual(publicationPhaseResult([a], [], { ok: true }), { state: 'checking' })
  assert.deepEqual(publicationPhaseResult([a], [{ ...linked, url: '' }], { ok: true }), { state: 'checking' })
  assert.deepEqual(publicationPhaseResult([a], [linked], { ok: true }), { state: 'sent' })
  assert.deepEqual(settled(linked), { label: 'View PR #12', url: 'https://github.com/team/repo/pull/12' })
  assert.deepEqual(publicationPhaseResult([a, b], [linked], { ok: true }), { state: 'checking' })
  assert.deepEqual(publicationPhaseResult([a], [], { pending: true }), { state: 'checking' })
  assert.deepEqual(publicationPhaseResult([a], [], { failure: { owner: 'automatic' } }), { state: 'checking' })
})

test('legacy batch pending suffix cannot borrow approval; settled phase gets a new key', () => {
  const a = record('a'), b = record('b')
  const prefix = { key: 'stack:s', ready: [a, b] }
  const suffix = { key: 'stack:s', ready: [b] }
  assert.notEqual(publicationPhaseKey(prefix), publicationPhaseKey(suffix))
  const progress = { [publicationPhaseKey(prefix)]: { state: 'checking', unitKey: 'stack:s', phaseIds: ['a', 'b'] } }
  const item = { unitKey: 'stack:s', phase: [b] }
  assert.equal(pendingPhaseBlocks(progress, item, [a, b]), true)
  assert.equal(pendingPhaseBlocks(progress, item, [{ ...a, status: 'open', number: 1, url: 'https://github.com/team/repo/pull/1' }, b]), true)
  assert.equal(pendingPhaseBlocks(progress, item, [
    { ...a, status: 'open', number: 1, url: 'https://github.com/team/repo/pull/1' },
    { ...b, status: 'open', number: 2, url: 'https://github.com/team/repo/pull/2' },
  ]), false)
})

test('a settled stack card links only its own PR and clears old snapshot badges', async () => {
  const stack = (id, position, parent = '') => record(id, { status: 'open', number: position,
    url: `https://github.com/team/repo/pull/${position}`, branch: `stack/s/${id}`,
    plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40),
      branch: `stack/s/${id}`, stack: { id: 's', position, total: 2,
        base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
  const f = fixture(['chat-send:b'], [stack('a', 1), stack('b', 2, 'a')])
  await f.session.hydrate()
  assert.deepEqual(f.action('chat-send:b').links, [{ label: 'View PR #2', url: 'https://github.com/team/repo/pull/2' }])
  assert.equal(f.action('chat-send:b').status, 'Open')
  assert.deepEqual(f.action('chat-send:b').badges, [])
  assert.deepEqual(f.sends, [])
})
function fixture(actions, initial, options = {}) {
  let current = initial
  const states = []
  const sends = []
  const session = createInlineSession({ sessionId: 's', actions: actions.map(key => ({ key, label: 'Contribute' })),
    publish: state => states.push(state), loadExact: async id => current.find(rec => rec.id === id),
    send: options.send || (async rec => { sends.push(rec.id); return { ok: true, record: { ...rec, status: 'open', number: 7, url: 'https://github.com/team/repo/pull/7' } } }),
    sendStack: options.sendStack || (async recs => { sends.push(recs.map(rec => rec.id).join(',')); return { ok: true } }),
    refresh: async () => {}, })
  session.updateLedger(current, true, readyReview(current))
  return { session, states, sends, setRecords(next) { current = next; session.updateLedger(next, true, readyReview(next)) },
    action(key) { return states.at(-1).actions.find(item => item.key === key) } }
}

test('init and canonical hydration are read-only; activate and cancel are read-only', async () => {
  const f = fixture(['chat-send:a'], [record('a')])
  await f.session.hydrate()
  f.session.activate('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, true)
  assert.equal(f.states.at(-1).notice, '', 'confirmation stays in the two buttons without extra prose')
  f.session.cancel('chat-send:a')
  assert.equal(f.action('chat-send:a').confirming, false)
  assert.deepEqual(f.sends, [])
})

test('malformed stack intent cannot activate single or batch publication handlers', async () => {
  const malformed = record('broken', { plan: { ...record('broken').plan, stack: { id: 'chain', total: 2 } } })
  const good = record('good')
  const f = fixture(['chat-send:broken', 'chat-send-batch:broken,good'], [malformed, good])
  await f.session.hydrate()
  assert.equal(f.action('chat-send:broken').status, 'Needs attention')
  assert.match(f.action('chat-send:broken').note, /invalid layer metadata/i)
  f.session.activate('chat-send:broken')
  await f.session.confirm('chat-send:broken')
  assert.equal(f.action('chat-send:broken').confirming, false)
  f.session.activate('chat-send-batch:broken,good')
  await f.session.confirm('chat-send-batch:broken,good')
  assert.deepEqual(f.sends, ['good'])
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
  assert.equal(f.action('chat-send:a').note, '')
  assert.equal(f.action('chat-send-batch:a,b').note, '')
  pending.get('a')({ ok: true, record: { ...record('a'), status: 'open', number: 1, url: 'https://github.com/team/repo/pull/1' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.action('chat-send:a').status, 'Open')
  assert.equal(f.action('chat-send:a').links.length, 1)
  assert.equal(f.action('chat-send:b').status, 'Contributing')
  assert.equal(f.action('chat-send-batch:a,b').status, 'Contributing')
  assert.equal(f.action('chat-send:a').note, '')
  assert.equal(f.action('chat-send-batch:a,b').note, '')
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
  assert.equal(f.action('chat-send:a').status, 'Open')
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

test('focused hydration resolves a public PR before the ledger and queues activation until authority arrives', async () => {
  const linked = { ...record('a'), status: 'open', number: 9, url: 'https://github.com/team/repo/pull/9' }
  const states = [], sends = []
  const session = createInlineSession({ sessionId: 'focused', actions: [{ key: 'chat-send:a', label: 'Contribute' }],
    publish: state => states.push(state), loadExact: async () => linked,
    send: async rec => { sends.push(rec); return { ok: true } }, sendStack: async () => { throw Error('unexpected stack') } })
  session.updateLedger([], false, null)
  await session.hydrate()
  assert.equal(states.at(-1).actions[0].status, 'Open')
  assert.equal(states.at(-1).actions[0].note, '')
  assert.deepEqual(states.at(-1).actions[0].links, [{ label: 'View PR #9', url: linked.url }])
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].confirming, false)
  session.updateLedger([linked], true, { state: 'ready', byId: {} })
  assert.equal(states.at(-1).actions[0].confirming, false)
  assert.deepEqual(sends, [])
})

test('prepared focused activation waits for authoritative ledger and review, then still requires confirm', async () => {
  const current = record('a')
  const states = [], sends = []
  const session = createInlineSession({ sessionId: 'focused', actions: [{ key: 'chat-send:a' }],
    publish: state => states.push(state), loadExact: async () => current,
    send: async rec => { sends.push(rec.id); return { pending: true } }, sendStack: async () => { throw Error('unexpected stack') } })
  session.updateLedger([], false, null)
  await session.hydrate()
  assert.equal(states.at(-1).actions[0].status, 'Prepared')
  assert.equal(states.at(-1).actions[0].hidden, false)
  assert.equal(states.at(-1).actions[0].disabled, false)
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].confirming, false)
  session.updateLedger([current], false, { state: 'loading', byId: {} })
  assert.equal(states.at(-1).actions[0].confirming, false)
  session.updateLedger([current], true, readyReview([current]))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states.at(-1).actions[0].confirming, true)
  assert.deepEqual(sends, [])
  session.cancel('chat-send:a')
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
})

test('exact prepared record missing from the complete ledger cannot activate or send', async () => {
  const current = record('a'), states = [], sends = []
  const session = createInlineSession({ sessionId: 'removed', actions: [{ key: 'chat-send:a' }],
    publish: state => states.push(state), loadExact: async () => current,
    send: async rec => { sends.push(rec.id); return { ok: true } } })
  session.updateLedger([], true, { state: 'ready', byId: {} })
  await session.hydrate()
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].confirming, false)
  assert.match(states.at(-1).actions[0].note, /no longer in Contribute/)
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
})

test('focused public stack receipt does not wait for linked members that were not requested', async () => {
  const linked = record('b', { status: 'open', number: 9, url: 'https://github.com/team/repo/pull/9',
    plan: { repo: 'team/repo', stack: { id: 's', position: 2, total: 2, parent_record_id: 'a', base_branch: 'stack/s/a' } } })
  const states = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:b' }], publish: s => states.push(s), loadExact: async () => linked })
  await session.hydrate()
  assert.equal(states.at(-1).actions[0].status, 'Open')
  assert.equal(states.at(-1).actions[0].note, '')
  assert.equal(states.at(-1).actions[0].hidden, true)
})

test('a partially resolved batch cannot claim the missing contribution was sent', async () => {
  const linked = record('a', { status: 'open', number: 9, url: 'https://github.com/team/repo/pull/9' })
  const states = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send-batch:a,b' }], publish: s => states.push(s), loadExact: async id => id === 'a' ? linked : null })
  await session.hydrate()
  assert.notEqual(states.at(-1).actions[0].status, 'Sent')
})

test('unavailable review offers an explicit retry without sending', async () => {
  const current = record('a'), states = [], sends = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a' }], publish: s => states.push(s),
    loadExact: async () => current, send: async rec => { sends.push(rec.id) } })
  await session.hydrate()
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].status, 'Checking')
  session.updateLedger([current], true, { state: 'unavailable', byId: {} })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states.at(-1).actions[0].status, 'Check unavailable')
  assert.equal(states.at(-1).actions[0].label, 'Retry check')
  assert.match(states.at(-1).actions[0].note, /Could not verify/)
  assert.equal(states.at(-1).actions[0].confirming, false)
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
})

test('batch keeps one unavailable explanation and truthful prepared rows through retry', async () => {
  const current = [record('a'), record('b')]
  const states = [], sends = []
  const session = createInlineSession({ sessionId: 's', actions: [
    { key: 'chat-send:a', label: 'Contribute' }, { key: 'chat-send:b', label: 'Contribute' },
    { key: 'chat-send-batch:a,b', label: 'Contribute all' },
  ], publish: state => states.push(state), loadExact: async id => current.find(rec => rec.id === id),
  send: async rec => { sends.push(rec.id) } })
  await session.hydrate()
  session.updateLedger(current, true, { state: 'unavailable', byId: {} })
  assert.equal(states.at(-1).summary, '2 prepared · Current review unavailable')
  assert.equal(states.at(-1).actions.find(action => action.key === 'chat-send:a').status, 'Check unavailable')
  assert.equal(states.at(-1).actions.find(action => action.key === 'chat-send:a').note, '')
  assert.match(states.at(-1).actions.find(action => action.key === 'chat-send-batch:a,b').note, /Could not verify/)
  session.activate('chat-send-batch:a,b')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(states.at(-1).actions.find(action => action.key === 'chat-send-batch:a,b').confirming, false)
  session.updateLedger(current, true, readyReview(current))
  assert.equal(states.at(-1).actions.find(action => action.key === 'chat-send-batch:a,b').confirming, true)
  assert.deepEqual(sends, [])
})

test('new focused read wins over an older delayed hydration after retry', async () => {
  const old = record('a', { revision: 1 })
  const fresh = record('a', { revision: 2, needs_attention: true })
  const reads = []
  const states = [], sends = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a' }],
    publish: state => states.push(state), loadExact: () => new Promise(resolve => reads.push(resolve)),
    send: async rec => { sends.push(rec.id) } })
  session.updateLedger([old], true, readyReview([old]))
  const initial = session.hydrate()
  session.activate('chat-send:a')
  assert.equal(reads.length, 2)
  reads[1](fresh)
  await new Promise(resolve => setImmediate(resolve))
  reads[0](old)
  await initial
  assert.equal(states.at(-1).actions[0].confirming, false)
  assert.match(states.at(-1).actions[0].note, /reviewed source changed/)
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
})

test('a failed focused read is not an indefinite loading placeholder', async () => {
  const states = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a' }], publish: s => states.push(s), loadExact: async () => { throw Error('offline') } })
  await session.hydrate()
  assert.equal(states.at(-1).actions[0].status, 'Needs attention')
  assert.match(states.at(-1).actions[0].note, /Could not read/)
  assert.equal(states.at(-1).actions[0].disabled, true)
})

test('failed exact reread cannot borrow a ready ledger record for confirmation', async () => {
  const current = record('a'), states = [], sends = []
  let fail = false
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a' }],
    publish: state => states.push(state), loadExact: async () => { if (fail) throw Error('offline'); return current },
    send: async rec => { sends.push(rec.id) } })
  session.updateLedger([current], true, readyReview([current]))
  await session.hydrate()
  fail = true
  session.updateLedger([current], false, { state: 'loading', byId: {} })
  session.activate('chat-send:a')
  await new Promise(resolve => setImmediate(resolve))
  session.updateLedger([current], true, readyReview([current]))
  assert.equal(states.at(-1).actions[0].confirming, false)
  assert.match(states.at(-1).actions[0].note, /Could not read/)
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
})

test('an all-clear local review cannot replace a missing current source verdict', async () => {
  const current = record('a'), states = [], sends = []
  const session = createInlineSession({ sessionId: 's', actions: [{ key: 'chat-send:a' }], publish: s => states.push(s), loadExact: async () => current,
    send: async rec => { sends.push(rec.id) } })
  await session.hydrate()
  session.updateLedger([current], true, { state: 'ready', byId: {} })
  session.activate('chat-send:a')
  assert.equal(states.at(-1).actions[0].status, 'Needs attention')
  assert.equal(states.at(-1).actions[0].confirming, false)
  assert.match(states.at(-1).actions[0].note, /current source check/)
  await session.confirm('chat-send:a')
  assert.deepEqual(sends, [])
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
  assert.equal(f.action('chat-send:a').status, 'Open')
  assert.equal(f.action('chat-send:a').links.length, 1)
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
  session.updateLedger([record('a')], true, readyReview([record('a')]))
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
  session.updateLedger([record('a')], true, readyReview([record('a')]))
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
  assert.equal(f.action('chat-send:a').status, 'Open')
  assert.equal(f.action('chat-send:a').links.length, 1)
  assert.equal(f.action('chat-send:a').note, '')
})
test('a cold batch heading never claims its saved contributions are still ready', () => {
  const states = []
  const session = createInlineSession({ sessionId: 'cold', actions: [{ key: 'chat-send-batch:a,b' }],
    publish: state => states.push(state), loadExact: async () => null })
  session.emit()
  assert.equal(states.at(-1).summary, '2 contributions')
  session.dispose()
})

test('confirmation identity comes from every frozen current phase member and survives later restaging', async () => {
  const first = record('a', { title: 'Saved title', plan: { action: 'pr', repo: 'actual/repo', title: 'Current title',
    branch: 'fix/current', head_sha: 'a'.repeat(40), base_sha: 'b'.repeat(40), diff_sha256: 'c'.repeat(64) } })
  let approved
  const f = fixture(['chat-send:a'], [first], { send: async rec => { approved = rec; return { pending: true } } })
  await f.session.hydrate(); f.session.activate('chat-send:a')
  const display = structuredClone(f.action('chat-send:a').confirmation)
  assert.equal(display[0].title, 'Current title')
  assert.deepEqual(display[0].facts.find(fact => fact.label === 'Repository'), { label: 'Repository', value: 'actual/repo' })
  assert.deepEqual(display[0].facts.find(fact => fact.label === 'Version'), { label: 'Version', value: first.plan.head_sha })
  assert.deepEqual(display[0].facts.find(fact => fact.label === 'Reviewed diff'), { label: 'Reviewed diff', value: first.plan.diff_sha256 })
  f.setRecords([{ ...first, updated_at: '2099', plan: { ...first.plan, repo: 'other/repo', title: 'Restaged title', head_sha: 'd'.repeat(40) } }])
  assert.deepEqual(f.action('chat-send:a').confirmation, display)
  await f.session.confirm('chat-send:a')
  assert.deepEqual(approved, first)
  const layer = (id, position, parent = '') => record(id, { plan: { action: 'pr', repo: 'team/repo', title: 'Layer '+id,
    head_sha: 'a'.repeat(40), base_sha: 'a'.repeat(40), branch: 'stack/s/'+id,
    stack: { id: 's', position, total: 2, base_branch: parent ? 'stack/s/'+parent : 'main', parent_record_id: parent } } })
  const stack = fixture(['chat-send:b'], [layer('a', 1), layer('b', 2, 'a')])
  await stack.session.hydrate(); stack.session.activate('chat-send:b')
  assert.deepEqual(stack.action('chat-send:b').confirmation.map(item => item.title), ['Layer a', 'Layer b'])
  assert.deepEqual(stack.action('chat-send:b').confirmation.map(item => item.facts.find(fact => fact.label === 'Target').value), ['main', 'stack/s/a'])
})

test('event acknowledgement retains active and uncertain ownership but releases cancellation and canonical settlement', async () => {
  const f = fixture(['chat-send:a'], [record('a')], { send: async () => ({ pending: true }) })
  await f.session.hydrate()
  assert.equal(f.states.at(-1).retain, false)
  f.session.handleEvent({ key: 'chat-send:a', event: 'activate', nonce: 'first' })
  assert.equal(f.states.at(-1).ackNonce, 'first')
  assert.equal(f.states.at(-1).retain, true)
  f.session.handleEvent({ key: 'chat-send:a', event: 'cancel', nonce: 'second' })
  assert.equal(f.states.at(-1).ackNonce, 'second')
  assert.equal(f.states.at(-1).retain, false)
  f.session.handleEvent({ key: 'chat-send:a', event: 'activate', nonce: 'third' })
  f.session.handleEvent({ key: 'chat-send:a', event: 'confirm', nonce: 'fourth' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.states.at(-1).ackNonce, 'fourth')
  assert.equal(f.states.at(-1).retain, true)
  f.setRecords([record('a', { status: 'open', number: 7, url: 'https://github.com/team/repo/pull/7' })])
  assert.equal(f.states.at(-1).retain, false)
  assert.equal(f.session.handleEvent({ key: 'other', event: 'activate', nonce: 'unknown' }), false)
  assert.equal(f.states.at(-1).ackNonce, 'fourth')
})
