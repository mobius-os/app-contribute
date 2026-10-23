import test from 'node:test'
import assert from 'node:assert/strict'
import { listenBlockSession, publishBlockState, readBlockSession } from '../block-protocol.js'

function fakeWindow() {
  const listeners = new Set(), posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const win = { parent, location: { origin: 'https://mobius.example' },
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  return { win, posted, deliver: event => [...listeners].forEach(fn => fn(event)), listeners }
}

test('only the parent shell on this origin can initialise or drive a card session', () => {
  const { win, deliver, listeners } = fakeWindow()
  globalThis.window = win
  const inits = [], actions = []
  const stop = listenBlockSession({ onInit: value => inits.push(value), onAction: value => actions.push(value) })
  const init = { type: 'moebius:app-block-init', sessionId: 's', actions: [{ key: 'chat-send:a', label: 'Contribute', extra: 1 }] }
  deliver({ source: {}, origin: 'https://mobius.example', data: init })
  deliver({ source: win.parent, origin: 'https://evil.example', data: init })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: init })
  deliver({ source: win.parent, origin: 'https://mobius.example', data: { type: 'moebius:app-block-action', sessionId: 's', key: 'chat-send:a', event: 'confirm', nonce: 'n' } })
  assert.equal(inits.length, 1)
  assert.deepEqual(inits[0].actions, [{ key: 'chat-send:a', label: 'Contribute' }])
  assert.deepEqual(actions, [{ sessionId: 's', key: 'chat-send:a', event: 'confirm', nonce: 'n' }])
  stop()
  assert.equal(listeners.size, 0)
  delete globalThis.window
})

test('state goes only to the parent on this origin and session input is normalised', () => {
  const { win, posted } = fakeWindow()
  globalThis.window = win
  publishBlockState({ sessionId: 's', actions: [] })
  assert.deepEqual(posted, [{ message: { type: 'moebius:app-block-state', sessionId: 's', actions: [] }, origin: 'https://mobius.example' }])
  delete globalThis.window
  assert.equal(readBlockSession({ actions: [] }), null)
  assert.deepEqual(readBlockSession({ sessionId: 's', actions: [], retain: 'yes', checkpoint: { id: 'c', data: '{}', other: 1 } }),
    { sessionId: 's', actions: [], checkpoint: { id: 'c', data: '{}' }, retain: false, recoveryError: false })
})
