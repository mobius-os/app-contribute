import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Runs the real hook with minimal hook stand-ins: refs persist, and each
// effect runs when its dependencies change (cleanups on unmount).
const source = readFileSync(new URL('../ui/useFocusLease.js', import.meta.url), 'utf8')
function harness() {
  const slots = [], deps = [], cleanups = []
  let cursor = 0, effect = 0
  const context = vm.createContext({
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial } },
    useEffect(run, list) {
      const index = effect++
      const before = deps[index]
      if (!before || list.some((value, n) => !Object.is(value, before[n]))) {
        deps[index] = list
        const cleanup = run()
        if (typeof cleanup === 'function') cleanups[index] = cleanup
      }
    },
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export function /g, 'function '), context)
  const released = []
  return {
    released,
    render(props) { cursor = 0; effect = 0; context.useFocusLease({ release: nonce => released.push(nonce), ...props }) },
    unmount() { cleanups.forEach(cleanup => cleanup?.()) },
  }
}

test('the lease is held while its PR is worked on and released once when that stops', () => {
  const h = harness()
  h.render({ nonce: 'n1', held: false, connected: true })
  h.render({ nonce: 'n1', held: true, connected: true })
  h.render({ nonce: 'n1', held: true, connected: true })
  assert.deepEqual(h.released, [])
  h.render({ nonce: 'n1', held: false, connected: true })
  assert.deepEqual(h.released, ['n1'])
  h.render({ nonce: 'n1', held: false, connected: true })
  assert.deepEqual(h.released, ['n1'], 'released once')
})

test('a disconnect releases a pending lease; an initial unknown connection does not', () => {
  const h = harness()
  h.render({ nonce: 'n2', held: false, connected: false })
  assert.deepEqual(h.released, [], 'still checking the connection is not a disconnect')
  h.render({ nonce: 'n2', held: false, connected: true })
  h.render({ nonce: 'n2', held: false, connected: false })
  assert.deepEqual(h.released, ['n2'])
})

test('unmounting releases the current lease', () => {
  const h = harness()
  h.render({ nonce: 'n3', held: true, connected: true })
  h.unmount()
  assert.ok(h.released.includes('n3'))
})
