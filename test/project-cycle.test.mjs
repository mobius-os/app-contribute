import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { freezeStartAction } from '../storage.js'

// The hook's effects observe only a fixture runtime/storage. No DOM, real
// conversation, saved partner record, or application transport is involved.
const source = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
function fixture({ saved = null, runtime = {}, statusError = false, stopResult = { stopped: true }, claim = async () => ({ ok: false, error: 'Fixture claim refused' }), list = async () => [], settle, start = () => assert.fail('Observation must not start an agent'), readClaim, abandon } = {}) {
  const slots = [], effects = [], calls = []
  let cursor = 0
  const context = vm.createContext({
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update }]
    },
    useRef(initial) {
      const index = cursor++
      return slots[index] ||= { current: initial }
    },
    useCallback: callback => callback,
    useEffect: effect => { effects.push(effect) },
    loadCycleState: async key => { calls.push(['load', key]); return typeof saved === 'function' ? saved() : saved },
    claimProjectCycle: (...args) => { calls.push(['claim', args[0]]); return claim(...args) },
    freezeStartAction,
    // By default the online claim is the fixture's saved reservation.
    readProjectCycleClaim: async key => { calls.push(['readClaim', key]); if (readClaim) return readClaim(key); const value = typeof saved === 'function' ? await saved() : saved; return value?.pending || null },
    abandonProjectCycleClaim: async (...args) => { calls.push(['abandon', ...args]); if (!abandon) assert.fail('Fixture must not abandon a claim'); return abandon(...args) },
    settleProjectCycleClaim: async (...args) => { calls.push(['settle', ...args]); if (!settle) assert.fail('Fixture must not settle a claim'); return settle(...args) },
    openAgentConversation: id => { calls.push(['open', id]); return { ok: true } },
    document: { hidden: false },
    window: { mobius: { chat: { status: async id => {
      calls.push(['status', id])
      if (typeof statusError === 'function' ? statusError() : statusError) throw Error('Fixture unavailable')
      return typeof runtime === 'function' ? runtime(id) : runtime
    }, list: async options => { calls.push(['list', options.scope]); return list(options) }, stop: async id => { calls.push(['stop', id]); return stopResult } } }, addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (function|const) /g, '$1 '), context)
  return {
    calls,
    phase: context.projectCyclePhase,
    outcome: context.startOutcome,
    failureStatus: context.startFailureStatus,
    render(projectKey = 'fixture-project') { cursor = 0; return context.useProjectCycle(projectKey, start) },
    setCycle(next) { slots[0] = next },
    get starting() { return slots[3]?.current },
    async restore() { effects.splice(0).forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('project runtime does not conflate unknown, non-running, paused, stopped, failed, and completed', () => {
  const { phase } = fixture()
  for (const runtime of [null, {}, { error: 'unavailable' }, { goal: { status: 'active' } }]) assert.equal(phase(runtime), 'unknown')
  assert.equal(phase({ running: false }), 'inactive')
  assert.equal(phase({ running: true, goal: { status: 'paused' } }), 'running')
  assert.equal(phase({ running: false, pending_question_id: 'fixture-question' }), 'waiting')
  for (const [status, expected] of [['paused', 'paused'], ['failed', 'failed'], ['stopped', 'stopped'], ['cancelled', 'stopped'], ['completed', 'complete']]) {
    assert.equal(phase({ running: false, goal: { status } }), expected)
  }
})

test('restoring a named paused cycle observes status without resuming, stopping, saving, or starting', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Prepare the selected work', event: 'private', started_at: '2026-09-10T12:00:00Z' },
    runtime: { running: false, goal: { status: 'paused' }, title: 'Fixture preparation conversation' } })
  f.render()
  await f.restore()
  const observed = f.render()
  assert.equal(observed.cycle.phase, 'paused')
  assert.equal(observed.cycle.title, 'Prepare the selected work')
  assert.equal(observed.cycle.chatTitle, 'Fixture preparation conversation')
  assert.equal(observed.cycle.startedAt, '2026-09-10T12:00:00Z')
  assert.equal(typeof observed.stop, 'function')
  assert.deepEqual(f.calls, [['load', 'fixture-project'], ['status', 'fixture-chat']])
  observed.open()
  assert.deepEqual(f.calls.at(-1), ['open', 'fixture-chat'])
})

test('status failure retains named saved work as unknown, never paused or successful', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Pull accepted work', event: 'update_source_projects', started_at: '2026-09-10T12:00:00Z' }, statusError: true, list: async () => [{ id: 'fixture-chat' }] })
  f.render()
  await f.restore()
  const { cycle } = f.render()
  assert.equal(cycle.phase, 'unknown')
  assert.equal(cycle.title, 'Pull accepted work')
  assert.equal(cycle.chatId, 'fixture-chat')
  assert.equal(cycle.startedAt, '2026-09-10T12:00:00Z')
  assert.match(cycle.error, /Progress is unavailable/)
  assert.equal(cycle.runtime, null)
  assert.deepEqual(f.calls, [['load', 'fixture-project'], ['status', 'fixture-chat'], ['list', undefined]])
})

test('an unconfirmed Stop leaves the saved cycle blocked and does not restart it', async () => {
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Old work' }, runtime: { running: true }, stopResult: { stopped: false } })
  f.render(); await f.restore()
  await f.render().stop()
  const observed = f.render()
  assert.equal(observed.cycle.phase, 'unknown')
  assert.equal(observed.cycle.chatId, 'fixture-chat')
  assert.match(observed.cycle.error, /Could not confirm Stop/)
  assert.deepEqual(f.calls.at(-1), ['stop', 'fixture-chat'])
})

test('a thrown project-cycle claim restores the prior phase and releases the local start latch', async () => {
  const f = fixture({ claim: async () => { throw Error('Storage unavailable') } })
  f.render()
  f.setCycle({ phase: 'idle', chatId: '', history: [], error: '' })
  const first = await f.render().start({ title: 'Fresh work', draft: 'Fresh draft' })
  assert.equal(first.ok, false)
  assert.equal(f.render().cycle.phase, 'idle')
  assert.equal(f.starting, false)
  await f.render().start({ title: 'Fresh work', draft: 'Fresh draft' })
  assert.equal(f.calls.filter(([kind]) => kind === 'claim').length, 2)
})

test('late Stop response cannot replace a different project or chat state', async () => {
  let resolveStop
  const stopResult = new Promise(resolve => { resolveStop = resolve })
  const f = fixture({ saved: { chat_id: 'old-chat', title: 'Old project' }, runtime: { running: true }, stopResult })
  f.render('old-project'); await f.restore()
  const pending = f.render('old-project').stop()
  f.setCycle({ phase: 'running', chatId: 'new-chat', title: 'New project', error: '' })
  f.render('new-project')
  resolveStop({ stopped: false })
  await pending
  assert.equal(f.render('new-project').cycle.chatId, 'new-chat')
  assert.equal(f.render('new-project').cycle.phase, 'running')
  assert.equal(f.calls.filter(([kind, id]) => kind === 'status' && id === 'new-chat').length, 0)
})

test('late post-Stop status cannot overwrite a newer chat in the same project', async () => {
  let resolveStatus
  const f = fixture({ saved: { chat_id: 'old-chat' }, runtime: id => id === 'old-chat' ? new Promise(resolve => { resolveStatus = resolve }) : { running: true } })
  f.render(); f.setCycle({ phase: 'running', chatId: 'old-chat', error: '' })
  const pending = f.render().stop()
  await new Promise(resolve => setImmediate(resolve))
  f.setCycle({ phase: 'running', chatId: 'new-chat', error: '' })
  resolveStatus({ running: false, goal: { status: 'stopped' } })
  await pending
  assert.equal(f.render().cycle.chatId, 'new-chat')
  assert.equal(f.render().cycle.phase, 'running')
})

test('working motion is opt-in and reduced-motion collapses it', () => {
  const theme = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const controls = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  assert.match(theme, /@media\(prefers-reduced-motion:reduce\) \{ \.co-working-icon \{ animation:none; \}/)
  assert.match(controls, /className=\{moving \? 'co-working-icon' : ''\}/)
  assert.match(controls, /workflow\.stop/); assert.match(controls, /Cancel active work/); assert.match(controls, /'paused' \? 'Cancel paused work'/); assert.match(controls, /Follow through to merge/)
  assert.match(controls, /DateLabel value=\{cycle.startedAt\} prefix="Started "/)
  assert.match(controls, /disabled=\{!canStart/)
  assert.match(controls, /Start fresh full merge cycle/)
  assert.match(controls, /TaskPane id="task:cycle"/)
  assert.match(controls, /start\(fullCycleAction, cycleAgent\)/)
  assert.match(controls, /mayMerge\(project\.viewerPermission\) && cycleAction \? \{ \.\.\.cycleAction, merge: true \}/)
  assert.match(controls, /workflow\.finishStart\(\)/)
  assert.match(controls, /start\(run\.privateAction, prepareAgent\)/)
  assert.match(controls, /start\(projectUpdateAction\(\[project\], Date\.now\(\)\), pullAgent\)/)
  assert.match(controls, /Local work/)
  assert.match(controls, /GitHub proposal/)
  assert.doesNotMatch(controls, /disabled=\{!canStart\} onClick=\{\(\) => task\?\.open\('task:update'\)/)
})

test('mounted lost-start recheck recovers the exact saved reservation without duplicate admission', async () => {
  let saved=null, visible=false, starts=0
  const f=fixture({
    saved:()=>saved, runtime:{running:true},
    claim:async()=>{saved={pending:{id:'reservation-one',title:'Prepare',event:'private'}};return {ok:true,id:'reservation-one'}},
    start:async action=>{starts++;assert.equal(action.scope,'contribute-cycle:reservation-one');return {ok:false,error:'Lost response'}},
    list:async({scope})=>{assert.equal(scope,'contribute-cycle:reservation-one');return visible?[{id:'same-chat',title:'Recovered',created_at:'2026-09-10T12:00:00Z',has_messages:visible==='started'}]:[]},
    settle:async(key,id,next)=>{assert.equal(key,'fixture-project');assert.equal(id,saved.pending.id);saved=next;return true},
  })
  f.render();await f.restore()
  await f.render().start({title:'Prepare',event:'private',draft:'Prepare draft'})
  assert.equal(f.render().cycle.pending,true)
  assert.equal(typeof f.render().recheck,'function')
  await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  assert.equal((await f.render().start({title:'Duplicate'})).ok,false)
  // A created-but-empty row is not yet an owner; the reservation stays.
  visible='empty'
  await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  visible='started'
  await f.render().recheck()
  assert.equal(f.render().cycle.chatId,'same-chat')
  assert.equal(f.render().cycle.phase,'running')
  assert.equal(Boolean(f.render().cycle.pending),false)
  assert.equal(starts,1)
  assert.equal(f.calls.filter(([kind])=>kind==='claim').length,1)
})

test('empty, offline, or unreadable rechecks never release an unresolved reservation', async () => {
  let offline=false, unreadable=false
  const reservation={pending:{id:'reservation-two',title:'Reserved'}}
  const f=fixture({saved:()=>unreadable?null:reservation,list:async()=>{if(offline)throw Error('Offline');return []}})
  f.render();await f.restore()
  assert.equal(f.render().cycle.pending,true)
  await f.render().recheck()
  offline=true;await f.render().recheck()
  unreadable=true;await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  assert.equal(f.render().cycle.phase,'unknown')
  assert.equal((await f.render().start({title:'Duplicate'})).ok,false)
  assert.equal(f.calls.filter(([kind])=>['claim','settle','stop'].includes(kind)).length,0)
})

test('ambiguous Stop can be read-only rechecked on the same mounted conversation', async () => {
  let offline=false, runtime={running:true}
  const f=fixture({saved:{chat_id:'same-chat',title:'Reserved'},runtime:()=>runtime,statusError:()=>offline,stopResult:{stopped:false},list:async()=>{if(offline)throw Error('Offline');return [{id:'same-chat'}]}})
  f.render();await f.restore()
  await f.render().stop()
  assert.equal(f.render().cycle.pending,true)
  offline=true;await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  offline=false;runtime={}
  await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  runtime={running:false,goal:{status:'stopped'}}
  await f.render().recheck()
  assert.equal(f.render().cycle.chatId,'same-chat')
  assert.equal(f.render().cycle.phase,'stopped')
  assert.equal(Boolean(f.render().cycle.pending),false)
  assert.equal(f.calls.filter(([kind])=>kind==='stop').length,1)
  assert.equal(f.calls.filter(([kind])=>['claim','settle'].includes(kind)).length,0)
})

test('a stale explicit recheck cannot overwrite another project after its status read resolves', async () => {
  let resolveStatus
  const f=fixture({saved:{chat_id:'old-chat'},runtime:()=>new Promise(resolve=>{resolveStatus=resolve})})
  f.render('old-project');f.setCycle({phase:'unknown',chatId:'old-chat',pending:true,error:''})
  const pending=f.render('old-project').recheck()
  await new Promise(resolve=>setImmediate(resolve))
  f.setCycle({phase:'running',chatId:'new-chat',error:''});f.render('new-project')
  resolveStatus({running:false,goal:{status:'stopped'}});await pending
  assert.equal(f.render('new-project').cycle.chatId,'new-chat')
  assert.equal(f.render('new-project').cycle.phase,'running')
})

test('a scoped lookup with multiple owners remains reserved rather than choosing one', async () => {
  const f=fixture({saved:{pending:{id:'reservation-ambiguous'}},list:async()=>[{id:'one'},{id:'two'}]})
  f.render();await f.restore();await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  assert.equal(f.calls.filter(([kind])=>['settle','claim','stop'].includes(kind)).length,0)
})

test('a start has one identity: only a confirmed conversation or the platform\'s scope verdict settles it', () => {
  const { outcome } = fixture()
  assert.equal(JSON.stringify(outcome({ ok: true, chatId: 'chat-1' })), JSON.stringify({ state: 'admitted', chatId: 'chat-1' }))
  assert.equal(outcome({ ok: false, code: 'scope_cancelled' }).state, 'spent')
  assert.equal(outcome({ ok: false, code: 'scope_deleted' }).state, 'spent')
  for (const value of [{ ok: false, error: 'Lost response' }, { ok: false, notStarted: true, error: 'Another agent task is already starting.' },
    { ok: false, status: 422 }, { ok: false, status: 413 }, { ok: false, code: 'first_turn_rejected' }, null, { ok: true }]) assert.equal(outcome(value).state, 'unknown')
})

const ACTION = { title: 'Prepare', draft: 'Only record A', event: 'private', agent: { provider: 'codex', model: 'chosen-model', effort: 'high' } }

test('an unknown start is finished by replaying its exact frozen payload under the same scope', async () => {
  let saved = null
  const attempts = []
  const f = fixture({ saved: () => saved, runtime: { running: true },
    claim: async (key, previous, action) => { saved = { pending: { id: 'claim-lost', title: action.title, event: action.event, action: freezeStartAction(action) } }; return { ok: true, id: 'claim-lost' } },
    start: async action => { attempts.push(JSON.parse(JSON.stringify(action))); return attempts.length === 1 ? { ok: false, error: 'Lost response' } : { ok: true, chatId: 'chat-one' } },
    settle: async (key, id, next) => { assert.equal(id, 'claim-lost'); saved = next; return true } })
  f.render(); await f.restore()
  await f.render().start(ACTION)
  assert.equal(f.render().cycle.pending, true)
  // Reload: recovery reads only the saved reservation, never current choices.
  const reloaded = fixture({ saved: () => saved, runtime: { running: true },
    start: async action => { attempts.push(JSON.parse(JSON.stringify(action))); return { ok: true, chatId: 'chat-one' } },
    settle: async (key, id, next) => { saved = next; return true } })
  reloaded.render(); await reloaded.restore()
  await reloaded.render().finishStart()
  assert.deepEqual(attempts.map(action => action.scope), ['contribute-cycle:claim-lost', 'contribute-cycle:claim-lost'])
  assert.equal(attempts[1].draft, 'Only record A', 'the replay carries the original work')
  assert.deepEqual(attempts[1].agent, ACTION.agent, 'the replay keeps the originally chosen model')
  assert.equal(reloaded.render().cycle.chatId, 'chat-one')
  assert.equal(f.calls.filter(([kind]) => kind === 'claim').length, 1)
})

test('a locally refused retry never releases an earlier uncertain start (no second owner)', async () => {
  let saved = null, attempts = 0, claims = 0
  const liveChats = []
  const f = fixture({ saved: () => saved, runtime: { running: true },
    claim: async (key, previous, action) => { saved = { pending: { id: 'claim-' + (++claims), action: freezeStartAction(action) } }; return { ok: true, id: saved.pending.id } },
    start: async () => {
      attempts++
      if (attempts === 1) { liveChats.push('old-admitted'); return { ok: false, error: 'Response lost' } }
      if (attempts === 2) return { ok: false, notStarted: true, error: 'Another agent task is already starting.' }
      liveChats.push('new-admitted'); return { ok: true, chatId: 'new-admitted' }
    },
    settle: async (key, id, next) => { saved = next; return true } })
  f.render(); await f.restore()
  await f.render().start(ACTION)
  await f.render().finishStart()
  assert.equal(saved?.pending?.id, 'claim-1', 'the reservation survives a local refusal of its retry')
  assert.equal(f.render().cycle.pending, true)
  assert.equal(f.render().cycle.phase, 'unknown')
  assert.match(f.render().cycle.error, /already starting/)
  // Reload, then try a fresh start: the reservation still blocks it.
  const reloaded = fixture({ saved: () => saved, runtime: { running: true }, claim: async () => assert.fail('A second scope was reserved') })
  reloaded.render(); await reloaded.restore()
  assert.equal(reloaded.render().cycle.pendingId, 'claim-1')
  assert.equal((await reloaded.render().start(ACTION)).ok, false)
  assert.deepEqual(liveChats, ['old-admitted'])
})

test('a legacy reservation without its frozen work cannot be finished by reconstruction', async () => {
  const f = fixture({ saved: { pending: { id: 'claim-legacy', title: 'Prepare', event: 'private' } } })
  f.render(); await f.restore()
  const result = await f.render().finishStart()
  assert.equal(result.ok, false)
  assert.match(result.error, /did not save its exact work/)
  assert.equal(f.render().cycle.pending, true)
})

test('the frozen start keeps exact work and model fields only', () => {
  assert.equal(freezeStartAction({ title: 'x' }), null)
  assert.deepEqual(freezeStartAction({ ...ACTION, scope: 'ignored', extra: 1, merge: true }),
    { title: 'Prepare', draft: 'Only record A', event: 'private', merge: true, agent: ACTION.agent })
})

test('reserved-start guidance names only controls that exist on this Möbius', async t => {
  const { frontendModules, renderModule } = await import('./render-harness.mjs')
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { reservedStartBlocker } = await renderModule(`export { reservedStartBlocker } from './ui/ProjectControls.jsx'`)
  const legacy = reservedStartBlocker({ action: null, mergeRights: true })
  assert.doesNotMatch(legacy, /Discard/, 'no instruction to use a control this Möbius lacks')
  assert.match(legacy, /Check again finds its conversation if it started; if it never started, abandon it/)
  // A saved start is always finishable, even after merge rights are lost.
  assert.equal(reservedStartBlocker({ action: { ...ACTION, merge: true } }), '')
  assert.equal(reservedStartBlocker({ action: ACTION }), '')
})

test('a new full-cycle reservation that never reached the platform is finished, not stranded, after merge rights are lost', async () => {
  // Real storage helpers over an online CAS fixture; no legacy data.
  const { claimProjectCycle, loadCycleState, settleProjectCycleClaim } = await import('../storage.js')
  const stored = new Map(), versions = new Map()
  const previousWindow = globalThis.window
  globalThis.window = { mobius: { storage: {
    get: async key => structuredClone(stored.get(key) ?? null),
    getWithVersion: async key => ({ value: structuredClone(stored.get(key) ?? null), version: versions.get(key) || null }),
    durableWrite: async (key, value, options = {}) => {
      if ((options.ifNoneMatch && versions.has(key)) || (options.ifMatch && options.ifMatch !== versions.get(key))) throw Object.assign(Error('CAS'), { status: 412 })
      stored.set(key, structuredClone(value)); versions.set(key, String((Number(versions.get(key)) || 0) + 1)); return { durability: 'synced', version: versions.get(key) }
    },
  } } }
  try {
    const cycle = { ...ACTION, event: 'contribution_cycle', merge: true }
    const sent = []
    const f = fixture({ saved: () => loadCycleState('fixture-project'), runtime: { running: true },
      claim: (...args) => claimProjectCycle(...args), settle: (...args) => settleProjectCycleClaim(...args),
      start: async action => { sent.push(JSON.parse(JSON.stringify(action))); return sent.length === 1 ? { ok: false, error: 'Network unreachable' } : { ok: true, chatId: 'cycle-chat' } } })
    // Real storage hashes its key asynchronously; wait for the observed state, bounded.
    const until = async predicate => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)) }
    const settled = h => until(() => !['restoring', 'checking'].includes(h.render().cycle.phase))
    f.render(); await f.restore(); await settled(f)
    await f.render().start(cycle)
    assert.equal(f.render().cycle.pending, true, 'an unknown start stays reserved: ' + JSON.stringify(f.render().cycle))
    // Reload after merge rights are lost (G1: no cancelStart, empty lookup).
    const reloaded = fixture({ saved: () => loadCycleState('fixture-project'), runtime: { running: true },
      settle: (...args) => settleProjectCycleClaim(...args),
      start: async action => { sent.push(JSON.parse(JSON.stringify(action))); return { ok: true, chatId: 'cycle-chat' } } })
    reloaded.render(); await reloaded.restore()
    await until(() => reloaded.render().cycle.pendingId)
    assert.equal(reloaded.render().cycle.pendingAction?.merge, true, JSON.stringify(reloaded.render().cycle))
    const result = await reloaded.render().finishStart()
    assert.equal(result.ok, true)
    assert.equal(sent[1].scope, sent[0].scope, 'the same scope is replayed')
    assert.equal(sent[1].draft, cycle.draft)
    assert.equal(reloaded.render().cycle.chatId, 'cycle-chat')
    assert.equal((await loadCycleState('fixture-project')).pending, undefined, 'the reservation settled to its conversation')
  } finally { globalThis.window = previousWindow }
})

test('a start is bounded to the platform limits before it is reserved', async () => {
  const { projectUpdateAction } = await import('../review.js')
  const project = { key: 'app:long', kind: 'app', name: 'A'.repeat(110) + ' tracker', canonical_repo: 'owner/long', available: true }
  const action = projectUpdateAction([project], 1)
  assert.ok(String(action.scopeLabel).length > 120, 'fixture: a valid long app name exceeds the platform label limit')
  let claimed = null
  const sent = []
  const f = fixture({ claim: async (key, previous, payload) => { claimed = payload; return { ok: true, id: 'claim-long' } }, readClaim: async () => ({ id: 'claim-long' }),
    start: async request => { sent.push(request); return { ok: true, chatId: 'long-chat' } }, settle: async () => true })
  f.render(); await f.restore()
  assert.equal((await f.render().start({ ...action, scopeLabel: action.scopeLabel + '\nwith a newline' })).ok, true)
  for (const payload of [claimed, sent[0]]) {
    assert.ok(payload.scopeLabel.length <= 120 && !/[\u0000-\u001f]/.test(payload.scopeLabel), 'scope label within the platform limit')
    assert.ok(payload.title.length <= 200)
  }
  assert.equal(sent[0].draft, action.draft, 'the work text itself is never shortened')
  // A start the platform cannot accept is never reserved.
  const refused = fixture({ claim: async () => assert.fail('An unacceptable start was reserved') })
  refused.render(); await refused.restore()
  assert.equal((await refused.render().start({ ...ACTION, agent: { provider: 'codex', model: 'm'.repeat(257) } })).ok, false)
})

test('no error, refusal or retry outcome releases a reservation; Finish stays available', async () => {
  const failures = [{ ok: false, status: 422 }, { ok: false, status: 413 }, { ok: false, status: 400 }, { ok: false, status: 500 },
    { ok: false, status: 409 }, { ok: false, status: 401 }, { ok: false, error: 'Another agent task is already starting.' }, { ok: false, error: 'network' }]
  for (const response of failures) {
    // First attempt.
    let saved = null
    const settled = []
    const f = fixture({ saved: () => saved, runtime: { running: true },
      claim: async (key, previous, action) => { saved = { pending: { id: 'claim-first', action: freezeStartAction(action) } }; return { ok: true, id: 'claim-first' } },
      start: async () => response, settle: async (key, id, next) => { settled.push(next); saved = next; return true } })
    f.render(); await f.restore()
    await f.render().start(ACTION)
    assert.deepEqual(settled, [], `first attempt ${response.status || response.error} keeps the reservation`)
    assert.equal(f.render().cycle.pending, true)
    assert.equal(f.render().cycle.pendingAction?.draft, ACTION.draft, 'Finish stays available with the saved work')
    // Finish.
    await f.render().finishStart()
    assert.deepEqual(settled, [], `Finish ${response.status || response.error} keeps the reservation`)
    assert.equal(f.render().cycle.pending, true)
  }
})

for (const retryStatus of [413, 422]) test(`an admitted start whose response was lost is not released by a ${retryStatus} on Finish (no second owner)`, async () => {
  // Reviewer's round-5 probe: the platform admits the first request but the
  // response is lost; the retry is refused by the body-size limit before any
  // scope lookup. Releasing on that would let a fresh start create a second owner.
  let saved = null, claims = 0
  const liveChats = []
  const f = fixture({ saved: () => saved, runtime: { running: true },
    claim: async (key, previous, action) => { saved = { pending: { id: 'claim-' + (++claims), action: freezeStartAction(action) } }; return { ok: true, id: saved.pending.id } },
    start: async () => {
      if (!liveChats.length) { liveChats.push('old-admitted'); return { ok: false, error: 'Response lost' } }
      return { ok: false, status: retryStatus, error: 'Refused' }
    },
    settle: async (key, id, next) => { saved = next; return true } })
  f.render(); await f.restore()
  await f.render().start(ACTION)
  await f.render().finishStart()
  assert.equal(saved?.pending?.id, 'claim-1', 'the reservation survives the retry refusal')
  const reloaded = fixture({ saved: () => saved, runtime: { running: true }, claim: async () => assert.fail('A second scope was reserved') })
  reloaded.render(); await reloaded.restore()
  assert.equal((await reloaded.render().start(ACTION)).ok, false)
  assert.deepEqual(liveChats, ['old-admitted'])
})

// Real storage helpers over an online CAS fixture, and a platform stand-in with
// the scoped start's G1 contract: one active conversation per scope. Deleting
// a conversation removes it from the map, after which the platform's scoped
// start would create a new one for that scope, as the real route does.
async function realCycles(t) {
  const storage = await import('../storage.js')
  const stored = new Map(), versions = new Map()
  const previousWindow = globalThis.window
  globalThis.window = { mobius: { storage: {
    get: async key => structuredClone(stored.get(key) ?? null),
    getWithVersion: async key => ({ value: structuredClone(stored.get(key) ?? null), version: versions.get(key) || null }),
    durableWrite: async (key, value, options = {}) => {
      if ((options.ifNoneMatch && versions.has(key)) || (options.ifMatch && options.ifMatch !== versions.get(key))) throw Object.assign(Error('CAS'), { status: 412 })
      stored.set(key, structuredClone(value)); versions.set(key, String((Number(versions.get(key)) || 0) + 1)); return { durability: 'synced', version: versions.get(key) }
    },
  } } }
  t.after(() => { globalThis.window = previousWindow })
  const chats = new Map() // scope -> { id, has_messages }
  const until = async predicate => { for (let i = 0; i < 400 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)) }
  const pane = (start, list = async ({ scope }) => chats.has(scope) ? [{ ...chats.get(scope) }] : []) => fixture({
    saved: () => storage.loadCycleState('fixture-project'), runtime: { running: true },
    claim: (...args) => storage.claimProjectCycle(...args), settle: (...args) => storage.settleProjectCycleClaim(...args),
    readClaim: (...args) => storage.readProjectCycleClaim(...args), abandon: (...args) => storage.abandonProjectCycleClaim(...args), start, list })
  return { storage, chats, until, pane }
}

test('an empty scoped chat seen by a second pane is not an owner: no second scope can start', async t => {
  const { chats, until, pane } = await realCycles(t)
  let release
  const held = new Promise(resolve => { release = resolve })
  const admit = async action => {
    // The platform commits the empty chat, then admits its first turn later.
    if (!chats.has(action.scope)) chats.set(action.scope, { id: 'chat-' + chats.size, has_messages: false })
    await held
    chats.get(action.scope).has_messages = true
    return { ok: true, chatId: chats.get(action.scope).id }
  }
  const a = pane(admit), b = pane(admit)
  a.render(); await a.restore(); await until(() => a.render().cycle.phase === 'idle')
  const first = a.render().start(ACTION)
  await until(() => chats.size === 1)
  b.render(); await b.restore(); await until(() => b.render().cycle.pendingId)
  await b.render().recheck()
  assert.equal(b.render().cycle.pending, true, 'the empty row did not settle the reservation')
  assert.equal((await b.render().start(ACTION)).ok, false, 'the second pane cannot start another scope')
  release(); await first
  assert.equal(chats.size, 1, 'one scope, one conversation')
})

test('repeating Finish is idempotent and a finished cycle advances to the next scope exactly once', async t => {
  const { storage, chats, until, pane } = await realCycles(t)
  let lose = true
  const platform = async action => {
    if (!chats.has(action.scope)) chats.set(action.scope, { id: 'chat-' + chats.size, has_messages: true })
    if (lose) return { ok: false, error: 'Response lost' }
    return { ok: true, chatId: chats.get(action.scope).id }
  }
  const p = pane(platform)
  p.render(); await p.restore(); await until(() => p.render().cycle.phase === 'idle')
  await p.render().start(ACTION)
  const scope1 = p.render().cycle.pendingScope
  assert.match(scope1, /^contribute-cycle:[0-9a-f]{32}:1$/)
  await p.render().finishStart()
  await p.render().finishStart()
  assert.equal(p.render().cycle.pendingScope, scope1, 'an uncertain Finish keeps the same scope')
  lose = false
  await p.render().finishStart()
  assert.equal(p.render().cycle.chatId, 'chat-0')
  assert.equal((await p.render().finishStart()).ok, false, 'nothing left to finish')
  assert.equal(chats.size, 1, 'repeated Finish created one conversation')
  const afterFirst = await storage.loadCycleState('fixture-project')
  assert.equal(afterFirst.seq, 1)
  // The next cycle starts only after this one finishes, under scope n+1.
  const next = pane(platform, async () => [])
  next.render(); await next.restore(); await until(() => next.render().cycle.chatId)
  next.setCycle({ ...next.render().cycle, phase: 'complete' })
  await next.render().start(ACTION)
  assert.equal(next.render().cycle.chatId, 'chat-1')
  assert.deepEqual([...chats.keys()], [scope1, scope1.replace(/:1$/, ':2')])
  assert.equal((await storage.loadCycleState('fixture-project')).seq, 2)
})

test('a stale Finish cannot recreate a settled cycle the owner deleted while its successor runs', async t => {
  const { storage, chats, until, pane } = await realCycles(t)
  const sent = []
  let lose = true
  // G1's scoped start: reuse an active conversation, else create one.
  const platform = async action => {
    sent.push(action.scope)
    if (!chats.has(action.scope)) chats.set(action.scope, { id: 'chat-' + sent.length, has_messages: true })
    return lose ? { ok: false, error: 'Response lost' } : { ok: true, chatId: chats.get(action.scope).id }
  }
  const a = pane(platform)
  a.render(); await a.restore(); await until(() => a.render().cycle.phase === 'idle')
  await a.render().start(ACTION)
  const scope1 = a.render().cycle.pendingScope
  assert.equal(a.render().cycle.pending, true, 'pane A keeps cycle 1 pending')
  // Pane B settles cycle 1 from its started conversation, then starts cycle 2.
  lose = false
  const b = pane(platform)
  b.render(); await b.restore(); await until(() => b.render().cycle.chatId)
  b.setCycle({ ...b.render().cycle, phase: 'complete' })
  await b.render().start(ACTION)
  const scope2 = scope1.replace(/:1$/, ':2')
  assert.equal((await storage.loadCycleState('fixture-project')).scope, scope2)
  // The owner deletes cycle 1's conversation; the platform no longer sees it.
  chats.delete(scope1)
  const before = sent.length
  const result = await a.render().finishStart()
  assert.equal(result.ok, false)
  assert.equal(sent.length, before, 'the stale pane did not call the scoped start')
  assert.equal(chats.has(scope1), false, 'the deleted cycle was not recreated')
  await until(() => a.render().cycle.chatId === chats.get(scope2).id)
  assert.equal(Boolean(a.render().cycle.pending), false, 'the stale pane now shows the current cycle')
  assert.equal((await storage.loadCycleState('fixture-project')).seq, 2)
})

test('a reservation the platform permanently refuses can be abandoned only after a fresh lookup finds nothing started', async t => {
  const { storage, chats, until, pane } = await realCycles(t)
  let refused = true
  const sent = []
  // A provider removed after the choice: the platform refuses before creating anything.
  const platform = async action => {
    sent.push(action.scope)
    if (refused) return { ok: false, status: 422, error: 'Unknown provider' }
    if (!chats.has(action.scope)) chats.set(action.scope, { id: 'chat-' + sent.length, has_messages: true })
    return { ok: true, chatId: chats.get(action.scope).id }
  }
  const p = pane(platform)
  p.render(); await p.restore(); await until(() => p.render().cycle.phase === 'idle')
  await p.render().start(ACTION)
  const scope1 = p.render().cycle.pendingScope
  // A stale second pane keeps the same reservation in view.
  const stale = pane(platform)
  stale.render(); await stale.restore(); await until(() => stale.render().cycle.pendingId)
  // Reload, Finish is refused again, then the owner abandons it.
  const reloaded = pane(platform)
  reloaded.render(); await reloaded.restore(); await until(() => reloaded.render().cycle.pendingId)
  await reloaded.render().finishStart()
  assert.equal(reloaded.render().cycle.pending, true, 'a refusal never releases on its own')
  const abandoned = await reloaded.render().abandonStart()
  assert.equal(abandoned.ok, true)
  assert.deepEqual(reloaded.calls.filter(([kind]) => kind === 'list').at(-1), ['list', scope1], 'abandon looked up the exact scope')
  const saved = await storage.loadCycleState('fixture-project')
  assert.equal(saved, null, 'no current conversation and no reservation')
  await until(() => reloaded.render().cycle.phase === 'idle')
  // The stale pane's Finish of the abandoned cycle starts nothing.
  const before = sent.length
  assert.equal((await stale.render().finishStart()).ok, false)
  assert.equal(sent.length, before, 'no pane starts an abandoned cycle')
  // A fresh cycle uses n+1.
  refused = false
  await reloaded.render().start(ACTION)
  assert.equal(sent.at(-1), scope1.replace(/:1$/, ':2'))
  assert.equal(reloaded.render().cycle.chatId, chats.get(sent.at(-1)).id)
  assert.equal((await storage.loadCycleState('fixture-project')).seq, 2)
})

test('abandon settles a start that did begin, and keeps the reservation when the lookup fails', async t => {
  const { storage, chats, until, pane } = await realCycles(t)
  const platform = async action => { chats.set(action.scope, { id: 'begun-chat', has_messages: true }); return { ok: false, error: 'Response lost' } }
  const p = pane(platform)
  p.render(); await p.restore(); await until(() => p.render().cycle.phase === 'idle')
  await p.render().start(ACTION)
  const failing = pane(platform, async () => { throw Error('offline') })
  failing.render(); await failing.restore(); await until(() => failing.render().cycle.pendingId)
  assert.equal((await failing.render().abandonStart()).ok, false)
  assert.equal(failing.render().cycle.pending, true, 'an unavailable lookup abandons nothing')
  assert.ok((await storage.loadCycleState('fixture-project')).pending)
  const result = await p.render().abandonStart()
  assert.equal(result.ok, true)
  assert.equal(p.render().cycle.chatId, 'begun-chat', 'the started conversation settles the cycle instead')
  const saved = await storage.loadCycleState('fixture-project')
  assert.equal(saved.chat_id, 'begun-chat')
  assert.equal(saved.pending, undefined)
})

test('a deleted settled conversation finishes its cycle so the next one can start', async () => {
  let rows = [], listFails = false
  const claims = []
  const f = fixture({ saved: { chat_id: 'gone-chat', title: 'Old work', scope: 'contribute-cycle:x:1' }, statusError: true,
    list: async options => { assert.equal(Object.keys(options).length, 0, 'the complete app list, not one scope'); if (listFails) throw Error('offline'); return rows },
    claim: async (...args) => { claims.push(args); return { ok: false, error: 'Fixture claim refused' } } })
  // Still listed: an unreadable status stays unknown and blocks starts.
  rows = [{ id: 'gone-chat' }]
  f.render(); await f.restore()
  assert.equal(f.render().cycle.phase, 'unknown')
  assert.equal((await f.render().start(ACTION)).ok, false)
  listFails = true
  await f.render().recheck()
  assert.equal(f.render().cycle.phase, 'unknown', 'an unavailable list is not evidence of deletion')
  // Absent from a successful list: the owner deleted it.
  listFails = false; rows = [{ id: 'other-chat' }]
  await f.render().recheck()
  assert.equal(f.render().cycle.phase, 'deleted')
  assert.equal(f.render().cycle.chatId, 'gone-chat', 'its history is kept')
  await f.render().start(ACTION)
  assert.equal(claims.length, 1, 'a new cycle may start')
  assert.equal(claims[0][1], 'gone-chat')
  assert.equal(claims.length, 1)
})

test('a durable Wait or other pending continuation keeps the cycle active until it settles', async () => {
  const { phase } = fixture()
  for (const runtime of [
    { running: false, goal: { status: 'open' }, waits: [{ status: 'armed' }] },
    { running: false, goal: { status: 'completed' }, waits: [{ status: 'fired' }] },
    { running: false, pending_messages: [{ content: 'queued' }] },
    { running: false, continuation_wait: { id: 'w' } },
    { running: false, recovery_run_id: 'run-1' },
    { running: false, background_helpers: { count: 1, items: [{}] } },
    { running: false, run_status: 'queued' },
  ]) assert.equal(phase(runtime), 'scheduled', JSON.stringify(runtime))
  assert.equal(phase({ running: false, pending_question_id: 'q', waits: [{}] }), 'waiting', 'an owner question is still a question')
  assert.equal(phase({ running: false, goal: { status: 'completed' }, waits: [], pending_messages: [], background_helpers: { count: 0, items: [] } }), 'complete')
  assert.equal(phase({ running: false, waits: [] }), 'inactive')
  // Armed Wait: the next cycle is refused; once it resumes and completes, it is allowed.
  let runtime = { running: false, goal: { status: 'open' }, waits: [{ status: 'armed' }] }
  const claims = []
  const f = fixture({ saved: { chat_id: 'waiting-chat', title: 'Work' }, runtime: () => runtime,
    claim: async (...args) => { claims.push(args); return { ok: false, error: 'Fixture claim refused' } } })
  f.render(); await f.restore()
  assert.equal(f.render().cycle.phase, 'scheduled')
  assert.equal((await f.render().start(ACTION)).ok, false)
  assert.equal(claims.length, 0, 'no second owner while the Wait is armed')
  runtime = { running: true, goal: { status: 'open' }, waits: [] }
  await f.render().recheck()
  assert.equal(f.render().cycle.phase, 'running')
  runtime = { running: false, goal: { status: 'completed' }, waits: [] }
  await f.render().recheck()
  assert.equal(f.render().cycle.phase, 'complete')
  await f.render().start(ACTION)
  assert.equal(claims.length, 1)
})
