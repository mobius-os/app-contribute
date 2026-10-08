import test from 'node:test'
import assert from 'node:assert/strict'
import { targetDrifts, targetCaseRecords } from './inline-target-cases.mjs'
import { createInlineSession } from '../inline-session.js'

const record = (id, extra = {}) => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo',
  plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) },
  updated_at: '2026-10-08T22:00:00Z', ...extra })
const failed = rec => ({ ...rec, updated_at: '2026-10-08T22:02:00Z', last_submit_error: 'Branch protection rejected this exact attempt' })
const opened = (rec, number = 1) => ({ ...rec, status: 'open', number, url: `https://github.com/team/repo/pull/${number}`, updated_at: '2026-10-08T22:03:00Z' })
const reviews = records => ({ state: 'ready', byId: Object.fromEntries(records.map(rec => [rec.id, { state: 'ready' }])) })
function fixture(initial, options = {}) {
  let records = initial, exact = initial, state, calls = 0
  const key = options.key || `chat-send:${initial[0].id}`
  const session = createInlineSession({ sessionId: 'failure', actions: [{ key }, ...initial.map(rec => ({ key: `chat-send:${rec.id}` }))],
    loadExact: options.loadExact || (async id => { if (exact instanceof Error) throw exact; return exact.find(rec => rec.id === id) }),
    send: async rec => { calls++; return options.send ? options.send(rec) : { pending: true } },
    sendStack: async recs => { calls++; return options.sendStack ? options.sendStack(recs) : { pending: true } },
    checkpoint: options.checkpoint, retain: options.retain,
    publish: next => { state = next }, refresh: async () => {} })
  const ledger = next => { records = next; session.updateLedger(next, true, reviews(next)) }
  ledger(initial)
  return { session, key, get calls() { return calls }, get state() { return state },
    get action() { return state.actions.find(action => action.key === key) }, ledger,
    async read(next) { exact = next; await session.hydrate(initial.map(rec => rec.id)) },
    async start() { await session.hydrate(); session.activate(key); await session.confirm(key) } }
}
const attention = f => {
  assert.equal(f.action.status, 'Needs attention')
  assert.match(f.action.note, /Branch protection rejected/)
  assert.match(f.action.note, /Contribute/)
  assert.equal(f.action.disabled, true)
  assert.equal(f.state.retain, true)
  assert.ok(f.state.checkpoint)
}

test('new exact post-attempt failure replaces pending diagnosis without releasing ownership', async () => {
  const a = record('phase.1'), f = fixture([a]); await f.start()
  const submitting = { ...a, status: 'submitting', updated_at: '2026-10-08T22:01:00Z' }; f.ledger([submitting]); await f.read([submitting])
  const bad = failed(a); f.ledger([bad]); await f.read([bad]); attention(f)
  f.session.activate(f.key); await f.session.confirm(f.key); assert.equal(f.calls, 1)
  const reload = fixture([bad], { checkpoint: f.state.checkpoint, retain: true }); await reload.session.hydrate(); attention(reload)
  reload.session.handleEvent({ key: f.key, event: 'confirm', nonce: 'old-confirm' })
  reload.session.activate(f.key); await reload.session.confirm(f.key); assert.equal(reload.calls, 0)
  reload.ledger([opened(a)]); assert.equal(reload.state.retain, false)
  assert.equal(reload.state.checkpoint, null)
})

test('exact failure during held response wins over stale pending handler and read', async () => {
  const a = record('phase.1'); let release
  const f = fixture([a], { send: () => new Promise(resolve => { release = resolve }) })
  await f.session.hydrate(); f.session.activate(f.key)
  const sending = f.session.confirm(f.key)
  await new Promise(resolve => setImmediate(resolve))
  const bad = failed(a); f.ledger([bad]); await f.read([bad]); attention(f)
  await f.session.confirm(f.key); f.session.activate(f.key); assert.equal(f.calls, 1)
  await f.read([a]); release({ pending: true, record: a }); await sending; attention(f)
})

for (const mode of ['batch', 'stack']) test(`mixed ${mode} presents failed remainder and keeps every attempted identity locked`, async () => {
  let a = record('a.1'), b = record('b.2')
  if (mode === 'stack') {
    const layer = (rec, position, parent = '') => ({ ...rec, plan: { ...rec.plan, base_sha: 'a'.repeat(40), branch: `stack/s/${rec.id}`,
      stack: { id: 's', position, total: 2, base_branch: parent ? `stack/s/${parent}` : 'main', parent_record_id: parent } } })
    a = layer(a, 1); b = layer(b, 2, a.id)
  }
  const key = mode === 'batch' ? 'chat-send-batch:a.1,b.2' : 'chat-send:a.1'
  const f = fixture([a,b], { key }); await f.start()
  const next = [opened(a), failed(b)]; f.ledger(next); await f.read(next); attention(f)
  const reload = fixture(next, { key, checkpoint: f.state.checkpoint, retain: true }); await reload.session.hydrate(); attention(reload)
  for (const item of reload.state.actions) { reload.session.activate(item.key); await reload.session.confirm(item.key) }
  assert.equal(reload.calls, 0)
  assert.ok(reload.action.links.some(link => link.url === opened(a).url))
  reload.ledger([opened(a), opened(b, 2)]); assert.equal(reload.state.retain, false)
})

for (const kind of ['unchanged', 'stale', 'missing', 'wrong-id', 'wrong-repo', 'wrong-head', 'wrong-action', 'error', 'ledger-only', 'older-than-current']) test(`${kind} observation is not authority that an unknown attempt failed`, async () => {
  const a = record('phase.1'), f = fixture([a]); await f.start()
  let bad = failed(a)
  if (kind === 'unchanged') bad = a
  if (kind === 'stale') bad = { ...bad, updated_at: a.updated_at }
  if (kind === 'wrong-id') bad = { ...bad, id: 'other' }
  if (kind === 'wrong-repo') bad = { ...bad, plan: { ...bad.plan, repo: 'other/repo' } }
  if (kind === 'wrong-action') bad = { ...bad, plan: { ...bad.plan, action: 'pr_update' } }
  if (kind === 'wrong-head') bad = { ...bad, plan: { ...bad.plan, head_sha: 'f'.repeat(40) } }
  f.ledger(kind === 'older-than-current' ? [{ ...a, updated_at: '2026-10-08T22:03:00Z' }] : [bad])
  await f.read(kind === 'missing' ? [] : kind === 'error' ? new Error('unavailable') : kind === 'ledger-only' ? [a] : [bad])
  assert.equal(f.action.status, 'Checking result'); assert.equal(f.state.retain, true)
  assert.equal(f.action.disabled, true); assert.equal(f.calls, 1)
})

test('unchanged pre-existing error in a recovered observation cannot prove this attempt failed', async () => {
  const a = record('phase.1'), first = fixture([a]); await first.start()
  const value = JSON.parse(first.state.checkpoint.data)
  // The initial failure was already observed before this unknown attempt.
  for (const phase of value.phases) for (const observation of phase.observations || []) observation.error = failed(a).last_submit_error
  const checkpoint = { id: 'preexisting', data: JSON.stringify(value) }
  const next = fixture([failed(a)], { checkpoint, retain: true }); await next.session.hydrate()
  assert.equal(next.action.status, 'Checking result'); assert.equal(next.calls, 0)
})

for (const outcome of [{ uncertain: true }, { failure: { owner: 'automatic' } }, { ok: true }]) test(`new canonical failure diagnoses unknown ${JSON.stringify(outcome)} without retry`, async () => {
  const a = record('phase.1'), f = fixture([a], { send: () => outcome }); await f.start()
  const bad = failed(a); f.ledger([bad]); await f.read([bad]); attention(f)
  assert.equal(f.calls, 1)
})

test('pending checkpoint reload can discover a new exact failure without regaining approval', async () => {
  const a = record('phase.1'), first = fixture([a]); await first.start()
  const next = fixture([failed(a)], { checkpoint: first.state.checkpoint, retain: true }); await next.session.hydrate(); attention(next)
  next.session.activate(next.key); await next.session.confirm(next.key); assert.equal(next.calls, 0)
  assert.equal(next.state.ackNonce, null)
})

test('legacy checkpoint without baseline stays unknown and locked despite current errors', async () => {
  const checkpoint = { id: 'legacy', data: JSON.stringify({ version: 1, phases: [{ unitKey: 'record:phase.1', phaseIds: ['phase.1'], state: 'pending', note: 'Checking the contribution result. Do not retry yet.' }] }) }
  const next = fixture([failed(record('phase.1'))], { checkpoint, retain: true }); await next.session.hydrate()
  assert.equal(next.action.status, 'Checking result'); assert.equal(next.action.disabled, true); assert.equal(next.calls, 0)
})


test('checkpoint observation decoding strips foreign approval fields and invalid observations fail closed', async () => {
  const a = record('phase.1'), first = fixture([a]); await first.start()
  const value = JSON.parse(first.state.checkpoint.data)
  const observation = value.phases[0].observations[0]
  observation.nonce = 'old-confirm'; observation.plan = a.plan
  const next = fixture([a], { checkpoint: { id: 'extra-fields', data: JSON.stringify(value) }, retain: true }); await next.session.hydrate()
  assert.equal(next.state.checkpoint.data.includes('nonce'), false)
  assert.equal(next.state.checkpoint.data.includes('head_sha'), false)
  assert.equal(next.action.disabled, true); assert.equal(next.calls, 0)
  for (const mutation of [{ id: 'other' }, { target: 'bad' }, { at: -1 }, { at: 1e100 }, { error: 'x'.repeat(501) }]) {
    const invalid = structuredClone(value); Object.assign(invalid.phases[0].observations[0], mutation)
    const locked = fixture([a], { checkpoint: { id: 'invalid-observation', data: JSON.stringify(invalid) }, retain: true }); await locked.session.hydrate()
    assert.equal(locked.state.recoveryError, true); assert.equal(locked.action.disabled, true); assert.equal(locked.calls, 0)
  }
})


for (const item of targetDrifts) test(`another publication target cannot diagnose the attempted phase: ${item.name}`, async () => {
  const original = targetCaseRecords(item), f = fixture(original); await f.start()
  const changed = structuredClone(original); item.mutate(changed)
  const attemptedId = original.at(-1).id
  const next = changed.map(rec => rec.id === attemptedId ? { ...failed(rec), last_submit_error: 'Failure from different target' } : rec)
  f.ledger(next); await f.read(next)
  assert.equal(f.action.status, 'Checking result', item.name)
  assert.doesNotMatch(f.action.note, /Failure from different target/)
  assert.equal(f.state.retain, true); assert.equal(f.action.disabled, true); assert.equal(f.calls, 1)
})

test('pre-hash baseline cannot rebind frozen intent to a changed current target', async () => {
  const original = targetCaseRecords({}), f = fixture(original)
  await f.session.hydrate(); f.session.activate(f.key)
  const changed = structuredClone(original); changed[0].plan.branch = 'fix/different'; changed[0].plan.base_branch = 'release'
  f.ledger(changed); await f.session.confirm(f.key)
  const next = changed.map(failed); f.ledger(next); await f.read(next)
  assert.equal(f.action.status, 'Checking result'); assert.equal(f.calls, 1); assert.equal(f.state.retain, true)
})

test('hash await snapshots the baseline metadata and cannot adopt a mutated error or target', async () => {
  const original = targetCaseRecords({}), f = fixture(original)
  await f.session.hydrate(); f.session.activate(f.key)
  const digest = crypto.subtle.digest.bind(crypto.subtle); let release
  crypto.subtle.digest = (algorithm, bytes) => new Promise(resolve => { release = () => digest(algorithm, bytes).then(resolve) })
  let sending
  try {
    sending = f.session.confirm(f.key)
    original[0].plan.branch = 'fix/different'; original[0].last_submit_error = 'Injected during hash'; original[0].updated_at = '2026-10-08T22:01:00Z'
    release()
  } finally { crypto.subtle.digest = digest }
  await sending
  const baseline = JSON.parse(f.state.checkpoint.data).phases[0].observations[0]
  assert.equal(baseline.error, ''); assert.equal(baseline.at, Date.parse('2026-10-08T22:00:00Z'))
  const changed = original.map(failed); f.ledger(changed); await f.read(changed)
  assert.equal(f.action.status, 'Checking result'); assert.equal(f.calls, 1)
})

test('held old exact target read loses to a newer exact generation without misdiagnosis', async () => {
  const original = targetCaseRecords({}); let next = original, release, hold = false
  const f = fixture(original,{loadExact:id=>hold?new Promise(resolve=>{release=resolve}):Promise.resolve(next.find(rec=>rec.id===id))})
  await f.start(); hold = true; const older = f.session.hydrate(); hold = false
  const changed = structuredClone(original); changed[0].plan.base_branch = 'release'; next = changed.map(failed); f.ledger(next)
  await f.session.hydrate(); release(failed(original[0])); await older
  assert.equal(f.action.status, 'Checking result'); assert.equal(f.calls,1); assert.equal(f.state.retain,true)
  next = original.map(rec=>({...failed(rec),updated_at:'2026-10-08T22:03:00Z'})); f.ledger(next); await f.session.hydrate(); attention(f)
})


for (const kind of ['missing', 'missing-timestamp', 'failed']) test(`latest ${kind} linked-parent exact read cannot lend a stale identity to child failure`, async () => {
  const original = targetCaseRecords({stack:true}); let next = original
  const f = fixture(original,{loadExact:async id=>{
    if(id===original[0].id && next!==original) {
      if(kind==='failed') throw Error('parent unavailable')
      if(kind==='missing') return null
      const parent={...next[0]}; delete parent.updated_at; return parent
    }
    return next.find(rec=>rec.id===id)
  }})
  await f.start(); next=original.map((rec,index)=>index?failed(rec):rec); f.ledger(next); await f.session.hydrate()
  assert.equal(f.action.status,'Checking result'); assert.equal(f.calls,1); assert.equal(f.state.retain,true)
})
