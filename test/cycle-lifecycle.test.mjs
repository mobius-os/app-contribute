// A project's run as the lifecycle's `run` region (lifecycle_tables.py RUN): what the platform's run statuses make of a conversation
// (a stopped run used to read "Not running" and lived nowhere else), the 2-minute deadline of a start that was never confirmed, and the
// ONE selector other screens call for what the run waits on.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { RUN_PHASES, RUN_WORDS, runStateOf, runVectorOf, runWaitingOn, unsentCycle } from '../cycle-lifecycle.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'

// The hook's own source, as test/project-cycle.test.mjs reads it: its pure phase function is what the screens call.
const source = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
const context = vm.createContext({})
vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (function|const) /g, '$1 '), context)
const phaseOf = context.projectCyclePhase

const STARTED = '2026-11-18T09:00:00Z'
const STARTED_S = Date.parse(STARTED) / 1000
const record = (patch = {}) => ({ chat_id: 'project-chat', started_at: STARTED, k: 3, cycle: { k: 3, cid: 'scope:3', delivered: true, started_at: STARTED }, ...patch })
const idle = { running: false, waits: [], pending_messages: [], background_helpers: { count: 0, items: [] }, continuation_wait: null, recovery_run_id: 'run-latest' }

test('a run the platform says stopped, interrupted or failed is not "Not running": it is the owner’s move', () => {
  for (const [run_status, phase] of [['stopped', 'stopped'], ['interrupted', 'stopped'], ['failed', 'failed']]) {
    assert.equal(phaseOf({ ...idle, run_status }), phase, run_status)
    assert.equal(phaseOf({ ...idle, run_status, goal: { status: 'open' } }), phase, `${run_status}, the goal not decided`)
  }
  // What was already decided stays decided.
  assert.equal(phaseOf({ ...idle, run_status: 'completed' }), 'inactive')
  assert.equal(phaseOf({ ...idle, run_status: 'completed', goal: { status: 'completed' } }), 'complete')
  assert.equal(phaseOf({ ...idle, run_status: 'failed', goal: { status: 'paused' } }), 'paused', 'a goal the owner paused')
  assert.equal(phaseOf({ ...idle, run_status: 'interrupted', pending_question_id: 'q' }), 'waiting')
  assert.equal(phaseOf({ ...idle, run_status: 'parked' }), 'scheduled', 'the platform resumes a parked run by itself')
  assert.equal(phaseOf({ ...idle, run_status: 'resume_pending' }), 'scheduled')
  assert.equal(phaseOf({ running: true, run_status: 'running' }), 'running')
  assert.equal(phaseOf({ running: false }), 'inactive', 'no run status, no goal: nothing to say it ended badly')
})

test('the run table is one table in both directions, and every phase the screens show reads as a state and back', () => {
  const phases = ['running', 'scheduled', 'paused', 'waiting', 'stopped', 'failed', 'complete', 'inactive', 'unknown']
  for (const phase of phases) {
    const state = runStateOf({ unsent: false, chat: true, phase })
    assert.ok(TABLES.regions.run.states[state], `${phase} reads as ${state}`)
    assert.ok(RUN_PHASES[state], `${state} shows as a phase word`)
  }
  assert.deepEqual(phases.map(phase => RUN_PHASES[runStateOf({ unsent: false, chat: true, phase })]),
    ['running', 'running', 'running', 'waiting', 'stopped', 'failed', 'complete', 'complete', 'running'])
  assert.equal(runStateOf({ unsent: true, chat: true, phase: 'running' }), 'SENDING', 'a start nobody confirmed comes before what the old conversation is doing')
  assert.equal(runStateOf({ unsent: false, chat: false, phase: null }), 'NONE')
  assert.deepEqual(Object.keys(RUN_PHASES).sort(), Object.keys(TABLES.regions.run.states).sort(), 'every state has its phase word')
  assert.ok(RUN_WORDS.at(-1).region === 'RUNNING' && Object.keys(RUN_WORDS.at(-1).words).length === 0, 'the last row catches what nothing says ended')
})

test('a stopped or failed run waits on the owner, dated by the platform’s own stamp, and a run in progress does not', () => {
  const stoppedAt = '2026-11-18T09:40:00Z'
  const now = Date.parse('2026-11-18T12:00:00Z') / 1000
  const [stopped] = runWaitingOn({ record: record(), phase: 'stopped', observedAt: stoppedAt, now })
  assert.deepEqual(stopped, { region: 'run', state: 'STOPPED', waits: 'owner', since: Date.parse(stoppedAt) / 1000, deadline: null })
  const [failed] = runWaitingOn({ record: record(), phase: 'failed', observedAt: stoppedAt, now })
  assert.equal(failed.state, 'FAILED')
  assert.equal(failed.waits, 'owner')
  assert.equal(runWaitingOn({ record: record(), phase: 'waiting', observedAt: stoppedAt, now })[0].state, 'QUESTION')
  assert.equal(runWaitingOn({ record: record(), phase: 'waiting', observedAt: stoppedAt, now })[0].waits, 'owner')
  const [running] = runWaitingOn({ record: record(), phase: 'running', now })
  assert.equal(running.state, 'RUNNING')
  assert.equal(running.waits, 'agent', 'the agent holds it: nothing for the owner')
  for (const phase of ['complete', 'inactive']) assert.deepEqual(runWaitingOn({ record: record(), phase, now }), [], phase)
  assert.deepEqual(runWaitingOn({ record: null, now }), [], 'a project that never ran')
  assert.deepEqual(runWaitingOn({ now }), [])
})

test('a start that was never confirmed is the platform’s to answer for 2 minutes, then the owner’s', () => {
  const unsent = record({ cycle: { k: 3, cid: 'scope:3', delivered: false, started_at: STARTED } })
  assert.equal(unsentCycle(unsent), true)
  assert.equal(unsentCycle(record()), false)
  assert.equal(unsentCycle(record({ cycle: { k: 3, cid: 'x', delivered: false, closed: true } })), false, 'a start the owner closed is over')
  assert.equal(TABLES.regions.run.states.SENDING.deadline.seconds, 120)
  const [young] = runWaitingOn({ record: unsent, now: STARTED_S + 119 })
  assert.deepEqual(young, { region: 'run', state: 'SENDING', waits: 'platform', since: STARTED_S, deadline: STARTED_S + 120 })
  const [late] = runWaitingOn({ record: unsent, now: STARTED_S + 3600 })
  assert.deepEqual(late, { region: 'run', state: 'NOT_SENT', waits: 'owner', since: STARTED_S + 120, deadline: null })
})

test('a run nobody has read for an hour asks the platform again, and a run just read does not', () => {
  const now = STARTED_S + 7200
  const unread = runVectorOf({ record: record(), now })
  assert.equal(unread.vector.regions.run.state, 'RUNNING')
  assert.ok(unread.effects.some(effect => effect.effect === 'ASK_PLATFORM'), 'a record read two hours after it began says: ask the platform')
  const read = runVectorOf({ record: record(), phase: 'running', now })
  assert.deepEqual(read.effects, [], 'the platform just said it is running')
  assert.equal(read.vector.regions.run.deadline, now + 3600)
  const stopped = runVectorOf({ record: record(), phase: 'stopped', observedAt: 'not a time', now })
  assert.equal(stopped.vector.regions.run.since, now, 'a stop with no readable time is dated by the read, never by a guess about the past')
})

test('a stopped run is shown above Start like a failed one, with the same next step, and Cancel is not offered for it', () => {
  const controls = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
  assert.match(controls, /\['paused', 'failed', 'stopped'\]\.includes\(cycle\.phase\)/, 'the notice with Open conversation')
  assert.match(controls, /stopped: 'You can open it, or start new work below\.',/)
  assert.match(controls, /stopped: 'Stopped'/, 'the label the pane already had, no longer reached only by a goal that said so')
  const cancellable = controls.match(/const CANCELLABLE_PHASES = \[([^\]]*)\]/)[1]
  assert.doesNotMatch(cancellable, /stopped|failed/, 'a run that ended is not stopped again')
  const startHeld = controls.match(/const startHeld = (.*)/)[1]
  assert.doesNotMatch(startHeld, /stopped/, 'a stopped run holds nothing back: new work may start')
})

test('the lazy tick dates each deadline at the moment it passed, and a state that renews itself stops after a few rounds', async () => {
  const { catchUp } = await import('../lifecycle-catch-up.js')
  const { newVector } = await import('../lifecycle-engine.js')
  const sending = catchUp(newVector(TABLES, { run: 'SENDING' }, 1000, false), 5000)
  assert.equal(sending.vector.regions.run.state, 'NOT_SENT')
  assert.equal(sending.vector.regions.run.since, 1120, 'since the deadline, not since the look')
  assert.deepEqual(sending.effects.map(effect => effect.effect), ['REQUEST_OWNER'])
  const running = catchUp(newVector(TABLES, { run: 'RUNNING' }, 0, false), 1e9)
  assert.equal(running.vector.regions.run.state, 'RUNNING')
  assert.ok(running.effects.length > 0 && running.effects.length <= 8, 'bounded')
  const unchanged = newVector(TABLES, { run: 'DONE' }, 0, false)
  assert.equal(catchUp(unchanged, 1e9).vector, unchanged, 'nothing due: the same vector comes back')
})
