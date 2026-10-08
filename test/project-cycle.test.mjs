import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// The hook's effects observe only a fixture runtime/storage. No DOM, real
// conversation, saved partner record, or application transport is involved.
const source = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
function fixture({ saved = null, runtime = {}, statusError = false, stopResult = { stopped: true }, claim = async () => ({ ok: false, error: 'Fixture claim refused' }), list = async () => [], settle, start = () => assert.fail('Observation must not start an agent') } = {}) {
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
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export function /g, 'function '), context)
  return {
    calls,
    phase: context.projectCyclePhase,
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
  const f = fixture({ saved: { chat_id: 'fixture-chat', title: 'Pull accepted work', event: 'update_source_projects', started_at: '2026-09-10T12:00:00Z' }, statusError: true })
  f.render()
  await f.restore()
  const { cycle } = f.render()
  assert.equal(cycle.phase, 'unknown')
  assert.equal(cycle.title, 'Pull accepted work')
  assert.equal(cycle.chatId, 'fixture-chat')
  assert.equal(cycle.startedAt, '2026-09-10T12:00:00Z')
  assert.match(cycle.error, /Progress is unavailable/)
  assert.equal(cycle.runtime, null)
  assert.deepEqual(f.calls, [['load', 'fixture-project'], ['status', 'fixture-chat']])
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
  const first = await f.render().start({ title: 'Fresh work' })
  assert.equal(first.ok, false)
  assert.equal(f.render().cycle.phase, 'idle')
  assert.equal(f.starting, false)
  await f.render().start({ title: 'Fresh work' })
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
  assert.match(controls, /workflow\.stop/); assert.match(controls, /Cancel active work/); assert.match(controls, /'paused' \? 'Cancel paused work'/); assert.doesNotMatch(controls, /Follow through to merge/)
  assert.match(controls, /DateLabel value=\{cycle.startedAt\} prefix="Started "/)
  assert.match(controls, /disabled=\{!canStart/)
  assert.match(controls, /Full merge cycles/)
  assert.match(controls, /Start fresh full merge cycle/)
  assert.match(controls, /TaskPane id="task:cycle"/)
  assert.match(controls, /start\(fullCycleAction, cycleAgent\)/)
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
    list:async({scope})=>{assert.equal(scope,'contribute-cycle:reservation-one');return visible?[{id:'same-chat',title:'Recovered',created_at:'2026-09-10T12:00:00Z'}]:[]},
    settle:async(key,id,next)=>{assert.equal(key,'fixture-project');assert.equal(id,saved.pending.id);saved=next;return true},
  })
  f.render();await f.restore()
  await f.render().start({title:'Prepare',event:'private'})
  assert.equal(f.render().cycle.pending,true)
  assert.equal(typeof f.render().recheck,'function')
  await f.render().recheck()
  assert.equal(f.render().cycle.pending,true)
  assert.equal((await f.render().start({title:'Duplicate'})).ok,false)
  visible=true
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
  const f=fixture({saved:{chat_id:'same-chat',title:'Reserved'},runtime:()=>runtime,statusError:()=>offline,stopResult:{stopped:false}})
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
