// The way out of a project run that stopped, failed or never started (the `run` region's DISMISS rows, lifecycle_tables.py): without it
// a run the owner abandoned stayed a Needs you row for ever. Dismissing is one checked write on the project's cycle record; a run the
// platform says the owner stopped is dismissed from the start; a new run is a new row.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runStateOf, runWaitingOn, stoppedByOwner } from '../cycle-lifecycle.js'
import { deskCounts, needsRows } from '../desk.js'
import { readProjectRuns } from '../project-runs.js'
import { RUN_ROW } from '../project-run-copy.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'
import { beginProjectCycle, dismissProjectRun, loadCycleState } from '../storage.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const NOW = 1763460000
const STARTED = new Date((NOW - 3600) * 1000).toISOString()
const record = (patch = {}) => ({ chat_id: 'chat-1', k: 3, started_at: STARTED, cycle: { k: 3, cid: 'scope:3', delivered: true, started_at: STARTED }, ...patch })
const rowsOf = (args) => runWaitingOn({ now: NOW, observedAt: STARTED, ...args }).map(row => `${row.state}:${row.waits}`)

test('the tables have the three exits the owner is given: a stopped or a failed run is dismissed to DONE, a start that never arrived to NONE', () => {
  const exits = TABLES.regions.run.transitions.filter(row => row.event === 'DISMISS').map(row => `${row.from}>${row.to}`).sort()
  assert.deepEqual(exits, ['FAILED>DONE', 'NOT_SENT>NONE', 'STOPPED>DONE'])
})

test('a run that was dismissed no longer waits on the owner, whether it stopped or failed; a run that asks, or runs again, still counts', () => {
  assert.deepEqual(rowsOf({ record: record(), phase: 'stopped' }), ['STOPPED:owner'])
  assert.deepEqual(rowsOf({ record: record({ dismissed: true }), phase: 'stopped' }), [], 'dismissed')
  assert.deepEqual(rowsOf({ record: record(), phase: 'failed' }), ['FAILED:owner'])
  assert.deepEqual(rowsOf({ record: record({ dismissed: true }), phase: 'failed' }), [], 'dismissed')
  assert.deepEqual(rowsOf({ record: record({ dismissed: true }), phase: 'waiting' }), ['QUESTION:owner'], 'a question is answered, never dismissed')
  assert.deepEqual(rowsOf({ record: record({ dismissed: true }), phase: 'running' }), ['RUNNING:agent'], 'a run resumed after it was dismissed is the agent’s again')
  assert.equal(runStateOf({ unsent: false, chat: true, phase: 'stopped', dismissed: true }), 'DONE')
})

test('a start nobody confirmed that the owner gave up (its cycle closed) waits on nobody', () => {
  const unsent = cycle => record({ chat_id: '', cycle: { k: 3, cid: 'scope:3', delivered: false, started_at: STARTED, ...cycle } })
  assert.deepEqual(rowsOf({ record: unsent({}) }), ['NOT_SENT:owner'])
  assert.deepEqual(rowsOf({ record: { ...unsent({ closed: true }), dismissed: true } }), [])
})

test('the platform tells an explicit Stop ("stopped") from a run cut off by a restart or a crash ("interrupted"): only the first is dismissed from the start', () => {
  assert.equal(stoppedByOwner({ run_status: 'stopped' }, 'stopped'), true)
  assert.equal(stoppedByOwner({ run_status: 'interrupted' }, 'stopped'), false)
  assert.equal(stoppedByOwner({ run_status: 'stopped' }, 'running'), false, 'a run that went on after the stop is running')
  assert.equal(stoppedByOwner({ status: 'stopped' }, 'stopped'), false, 'a goal that says stopped is not the run’s own Stop')
  assert.equal(stoppedByOwner(null, 'stopped'), false)
  assert.deepEqual(rowsOf({ record: record(), phase: 'stopped', ownerStopped: true }), [])
  assert.deepEqual(rowsOf({ record: record(), phase: 'stopped', ownerStopped: false }), ['STOPPED:owner'])
})

test('the Desk reads a run the owner stopped as nothing owed, and an interrupted one as the owner’s move', async () => {
  const phaseOf = runtime => (['stopped', 'interrupted'].includes(runtime.run_status) ? 'stopped' : 'running')
  const read = status => readProjectRuns([{ key: 'platform', name: 'Möbius' }], { loadState: async () => record(), chatStatus: async () => ({ running: false, updated_at: STARTED, ...status }), phaseOf, now: NOW })
  assert.deepEqual(await read({ run_status: 'stopped' }), [], 'you pressed Cancel active work')
  assert.deepEqual((await read({ run_status: 'interrupted' })).map(run => run.rows[0].state), ['STOPPED'])
})

// ---- The checked write.
function versionedStore(initial) {
  const files = new Map(Object.entries(initial))
  const versions = new Map([...files.keys()].map(key => [key, 1]))
  const writes = []
  return {
    files, writes, versions,
    storage: {
      get: async key => structuredClone(files.get(key) ?? null),
      getWithVersion: async key => ({ value: structuredClone(files.get(key) ?? null), version: files.has(key) ? String(versions.get(key)) : null }),
      set: async () => { throw new Error('a blind write') },
      durableWrite: async (key, value, options) => {
        if (options?.ifMatch !== String(versions.get(key))) throw Object.assign(new Error('conflict'), { status: 412 })
        files.set(key, structuredClone(value))
        versions.set(key, versions.get(key) + 1)
        writes.push({ key, value: structuredClone(value), options })
        return { durability: 'synced' }
      },
    },
  }
}
const withStore = (t, key, value) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  const store = versionedStore({ [key]: value })
  globalThis.window = { mobius: { storage: store.storage } }
  return store
}
const keyOf = async project => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(project))
  return `project-cycles/${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}.json`
}
const ACTION = { title: 'Fix it', draft: 'Exact work', event: 'contribution_cycle' }
const saved = (patch = {}) => ({ schema: 4, scope: 'scope', chat_id: 'chat-1', title: 'Fix it', started_at: STARTED, k: 3, cycle: { k: 3, cid: 'scope:3', action: ACTION, started_at: STARTED, delivered: true }, history: [], ...patch })

test('Dismiss is one checked write on the cycle record, and the record reads back dismissed', async t => {
  const key = await keyOf('platform')
  const store = withStore(t, key, saved())
  assert.equal(await dismissProjectRun('platform', 3), true)
  assert.equal(store.writes.length, 1)
  assert.deepEqual(store.writes[0].options, { ifMatch: '1' }, 'a checked write, never a blind one')
  assert.equal(store.writes[0].value.dismissed, true)
  assert.deepEqual(store.writes[0].value.cycle, saved().cycle, 'a delivered cycle is left as it was')
  assert.equal((await loadCycleState('platform')).dismissed, true)
})

test('Dismiss of a start nobody confirmed also closes that cycle, so the project stops offering to send it again', async t => {
  const key = await keyOf('platform')
  const store = withStore(t, key, saved({ chat_id: '', cycle: { ...saved().cycle, delivered: false } }))
  assert.equal(await dismissProjectRun('platform', 3), true)
  assert.equal(store.writes[0].value.cycle.closed, true)
  const state = await loadCycleState('platform')
  assert.deepEqual(runWaitingOn({ record: state, now: NOW + 7200 }), [])
})

test('a row read from an older run never dismisses a newer one, and an offline or conflicting write dismisses nothing', async t => {
  const key = await keyOf('platform')
  const store = withStore(t, key, saved({ k: 4, cycle: { ...saved().cycle, k: 4, cid: 'scope:4' } }))
  assert.equal(await dismissProjectRun('platform', 3), false, 'the row was read at run 3, the record is at run 4')
  assert.deepEqual(store.writes, [])
  store.storage.getWithVersion = async () => ({ value: saved(), version: '1', offline: true })
  assert.equal(await dismissProjectRun('platform', 3), false, 'offline: not recorded')
  const raced = withStore(t, key, saved())
  raced.versions.set(key, 2)
  const original = raced.storage.getWithVersion
  raced.storage.getWithVersion = async path => ({ ...(await original(path)), version: '1' })
  assert.equal(await dismissProjectRun('platform', 3), false, 'another view wrote first')
})

test('starting the project’s work again writes a new record, so the new run is a new row', async t => {
  const key = await keyOf('platform')
  const store = withStore(t, key, saved({ dismissed: true }))
  const started = await beginProjectCycle('platform', ACTION, 3)
  assert.equal(started.ok, true)
  assert.equal('dismissed' in store.files.get(key), false)
  assert.equal((await loadCycleState('platform')).dismissed, undefined)
})

// ---- The row.
const runs = rows => [{ key: 'repo:acme/widgets', name: 'Widgets', record: { k: 3 }, rows }]
const row = (state, extra = {}) => ({ region: 'run', state, waits: 'owner', since: NOW - 600, deadline: null, ...extra })

test('every row of a stopped, failed or unsent run carries the cycle it was read from, and a run that asks carries no Dismiss', () => {
  for (const state of ['STOPPED', 'FAILED', 'NOT_SENT']) assert.ok(RUN_ROW[state].dismiss.label === 'Dismiss', state)
  assert.equal(RUN_ROW.QUESTION.dismiss, undefined)
  const [needs] = needsRows({ login: 'owner', facts: { projectRuns: runs([row('STOPPED')]) } })
  assert.equal(needs.run.k, 3)
  assert.equal(deskCounts({ login: 'owner', projectRuns: runs([row('STOPPED')]) }).questions, 1)
  assert.equal(deskCounts({ login: 'owner', projectRuns: [] }).questions, 0, 'once dismissed the read lists nothing and the count follows')
})

let renderer
const ui = async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskView } from './ui/DeskViews.jsx'
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
  `)
  return renderer
}
const project = { key: 'widgets', name: 'Widgets', kind: 'app', canonical_repo: 'acme/widgets', available: true, incomingReviews: [], reviewRequests: [] }
const render = (api, states, onDismissRun = () => {}) => api.view({ projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', reviews: { entries: [] }, counts: {}, view: 'needs',
  projectRuns: runs(states.map(state => row(state))), onOpenProject() {}, onOpenPull() {}, onOpenRecord() {}, onDismissRun })

test('a stopped, failed or unsent run’s row has a quiet Dismiss beside it, and a run that asks has none', async t => {
  const api = await ui(t)
  if (!api) return
  for (const state of ['STOPPED', 'FAILED', 'NOT_SENT']) {
    const html = render(api, [state])
    assert.match(html, /<button type="button" class="co-btn co-btn-quiet co-desk-row-action"[^>]*>Dismiss<\/button>/, state)
    assert.match(html, new RegExp(`aria-label="Dismiss: ${RUN_ROW[state].title}, Widgets"`), state)
  }
  assert.doesNotMatch(render(api, ['QUESTION']), />Dismiss</)
  assert.doesNotMatch(render(api, ['STOPPED'], null), />Dismiss</, 'a screen that cannot record it offers nothing')
})

test('the Desk hands Dismiss to the app, which records it and reads the runs again', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /const done = await dismissProjectRun\(key, k\)\s*if \(done\) void hub\?\.refresh\('projectRuns'\)/)
  assert.match(app, /onDismissRun: dismissRun,/)
  assert.match(readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8'), /onDismissRun=\{desk\.onDismissRun\}/)
})
