import test from 'node:test'
import assert from 'node:assert/strict'
import { frontendModules, renderModule } from './render-harness.mjs'

// useDeskSync's sync order runs without a DOM: React's hooks are replaced by a stub that keeps each state's
// latest value, so the test reads what the header would show (Syncing…, the last-synced note) after each step.
const REACT_STUB = `
  export const calls = { refreshing: [] }
  const states = []
  let slot = 0
  export function reset() { states.length = 0; calls.refreshing.length = 0 }
  export function begin() { slot = 0 }
  export function useState(initial) {
    const index = slot++
    if (!(index in states)) states[index] = initial
    const set = next => {
      states[index] = typeof next === 'function' ? next(states[index]) : next
      if (index === 0) calls.refreshing.push(states[index])
    }
    return [states[index], set]
  }
  export function useRef(initial) { const index = slot++; if (!(index in states)) states[index] = { current: initial }; return states[index] }
  export function useCallback(fn) { const index = slot++; if (!(index in states)) states[index] = fn; return states[index] }
  export function useEffect() { slot++ }
  export function noteOf() { return states[1] }
`
const reactStub = {
  name: 'react-stub',
  resolveId: id => (id === 'react' ? '\0react-stub' : null),
  load: id => (id === '\0react-stub' ? { code: REACT_STUB } : null),
}

async function loadHook() {
  return renderModule(`
    import * as React from 'react'
    import { useDeskSync } from './ui/useDeskSync.js'
    export const react = React
    export function render(props) { React.begin(); return useDeskSync(props) }
  `, [reactStub])
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('a Sync pressed while the quiet catch-up runs shows Syncing… at once and then reads everything itself', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { react, render } = await loadHook()
  react.reset()
  const reads = []
  const quietRead = deferred()
  const refreshEverything = ({ quiet }) => {
    reads.push(quiet ? 'quiet' : 'full')
    return quiet ? quietRead.promise : Promise.resolve({ ok: true, upstream: { ok: true } })
  }
  const props = { refreshEverything, facts: {}, booted: true, connected: true }
  const quietSync = render(props).syncAll({ quiet: true })
  const press = render(props).syncAll()
  assert.deepEqual(react.calls.refreshing, [true], 'the press shows Syncing… while the quiet sync is still running')
  assert.deepEqual(reads, ['quiet'], 'the press waits for the quiet sync instead of reading beside it')
  quietRead.resolve({ ok: true, upstream: { ok: true } })
  await quietSync
  const outcome = await press
  assert.deepEqual(reads, ['quiet', 'full'], 'the press then makes its own full read')
  assert.deepEqual(outcome, { ok: true, upstream: { ok: true } })
  assert.deepEqual(react.calls.refreshing, [true, false])
  assert.equal(react.noteOf().failed, false)
})

test('a quiet catch-up never starts beside a Sync the owner pressed', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { react, render } = await loadHook()
  react.reset()
  const reads = []
  const fullRead = deferred()
  const refreshEverything = ({ quiet }) => { reads.push(quiet ? 'quiet' : 'full'); return fullRead.promise }
  const props = { refreshEverything, facts: {}, booted: true, connected: true }
  const press = render(props).syncAll()
  assert.equal(await render(props).syncAll({ quiet: true }), undefined)
  fullRead.resolve({ ok: true, upstream: { ok: true } })
  await press
  assert.deepEqual(reads, ['full'])
})
