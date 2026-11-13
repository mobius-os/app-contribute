// A screen that shows a review's documents reads the run itself when the list only has its short form.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// The real hook with minimal stand-ins for useState, useRef and useEffect (as use-review-list.test.mjs does);
// `collaborationRequest` is the only fake: every call waits until the test answers it.
const source = readFileSync(new URL('../ui/useRunDocuments.js', import.meta.url), 'utf8')
function harness() {
  const slots = [], effects = [], reads = []
  let cursor = 0, props = {}, view = null, rendering = false, queued = []
  const context = vm.createContext({
    useState(initial) {
      const slot = slots[cursor] ||= { value: initial }
      cursor += 1
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; if (!rendering) render() }]
    },
    useRef(initial) {
      const slot = slots[cursor] ||= { value: { current: initial } }
      cursor += 1
      return slot.value
    },
    useEffect(run, deps) { queued.push({ index: cursor++, run, deps }) },
    collaborationRequest: (token, appId, path) => new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (const|function) /g, '$1 '), context)
  function render(next) {
    if (next) props = { token: 't', appId: 1, ...next }
    rendering = true; cursor = 0; queued = []
    view = context.useRunDocuments(props)
    rendering = false
    for (const effect of queued) {
      const before = effects[effect.index]
      if (before && !effect.deps.some((value, n) => !Object.is(value, before.deps[n]))) continue
      before?.cleanup?.()
      effects[effect.index] = { deps: effect.deps, cleanup: effect.run() }
    }
    return view
  }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  return { render, reads, flush, view: () => view }
}

const item = extra => ({ repo: 'o/r', number: 7, state: 'verdict_pending', ...extra })
const shortRun = (extra = {}) => ({ id: 'run-1', summary_only: true, state: 'needs_you', items: [item({ summary: 'cut… open this run for the full findings', summary_truncated: true })], ...extra })
const wholeRun = (extra = {}) => ({ id: 'run-1', state: 'needs_you', items: [item({ summary: 'the whole findings', verdict_proposal: { body: 'the drafted words' } })], ...extra })
const shown = view => [view.reading, view.failed, view.current, view.run.items?.[0]?.summary]

test('a short run holds until the run itself is read, then shows its documents', async () => {
  const h = harness()
  const first = h.render({ run: shortRun(), item: item() })
  assert.deepEqual([first.reading, first.current], [true, false], 'no cut copy is shown meanwhile')
  assert.equal(h.reads[0].path, 'review-runs/run-1')
  h.reads[0].resolve({ run: wholeRun() }); await h.flush()
  assert.deepEqual(shown(h.view()), [false, false, true, 'the whole findings'])
  assert.equal(h.view().item.verdict_proposal.body, 'the drafted words')
})

test('a full run, from an older Möbius or an action, is shown as it is with nothing read', () => {
  const h = harness()
  const view = h.render({ run: wholeRun(), item: item() })
  assert.deepEqual([view.reading, view.current, h.reads.length], [false, true, 0])
})

test('when the list says the run changed, the last full copy stays but nothing decides on it until it is read again', async () => {
  const h = harness()
  h.render({ run: shortRun(), item: item() })
  h.reads[0].resolve({ run: wholeRun() }); await h.flush()
  h.render({ run: shortRun({ state: 'complete' }), item: item() })
  assert.equal(h.reads.length, 2, 'a changed run is read again')
  assert.deepEqual(shown(h.view()), [false, false, false, 'the whole findings'], 'the old copy stays on screen, not current')
  h.reads[1].resolve({ run: wholeRun({ state: 'complete' }) }); await h.flush()
  assert.deepEqual(shown(h.view()).slice(0, 3), [false, false, true])
  h.render({ run: shortRun({ state: 'complete' }), item: item() })
  assert.equal(h.reads.length, 2, 'the same short list is not read again')
})

test('a read that fails after a good one keeps the good copy; with none it says so', async () => {
  const h = harness()
  h.render({ run: shortRun(), item: item() })
  h.reads[0].resolve({ run: wholeRun() }); await h.flush()
  h.render({ run: shortRun({ state: 'complete' }), item: item() })
  h.reads[1].reject(new Error('offline')); await h.flush()
  assert.deepEqual(shown(h.view()), [false, false, false, 'the whole findings'])
  const fresh = harness()
  fresh.render({ run: shortRun(), item: item() })
  fresh.reads[0].reject(new Error('offline')); await fresh.flush()
  assert.deepEqual([fresh.view().reading, fresh.view().failed], [false, true])
})

test('an action\'s own full answer survives the list going back to the short form until the run is read again', async () => {
  const h = harness()
  h.render({ run: wholeRun({ state: 'complete' }), item: item() })
  const flipped = h.render({ run: shortRun({ state: 'complete' }), item: item() })
  assert.deepEqual([flipped.reading, flipped.current, flipped.run.items[0].summary], [false, false, 'the whole findings'], 'no flash of waiting, no decision on a copy older than the list')
  h.reads[0].resolve({ run: wholeRun({ state: 'complete' }) }); await h.flush()
  assert.equal(h.view().current, true)
})
