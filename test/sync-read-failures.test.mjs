// A failed read of the reviewed PRs is read again, and Sync says what really happened. The hook is run for real with
// minimal hook stand-ins (as use-review-list.test.mjs does), on the real sync hub with no cooldown so the automatic retry is seen.
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { classifyReview, mergeReviewPulls, respondEntries, reviewCounts, reviewEntries, reviewKey } from '../review-list.js'
import { SYNC_POLICY, createSyncHub } from '../refresh.js'

const source = readFileSync(new URL('../ui/useReviewList.js', import.meta.url), 'utf8')
const unmounts = []
after(() => unmounts.forEach(unmount => unmount()))

function harness({ loadReviewRuns, use = 'useReviewList' } = {}) {
  const slots = [], effects = [], reads = []
  let cursor = 0, props = {}, rendering = false, queued = [], view = null
  const hub = createSyncHub({ policy: { ...SYNC_POLICY, githubCooldownMs: 0 }, host: { mobius: { onVisibilityChange: listener => { listener(true); return () => {} } } } })
  const stopHub = hub.start()
  const memo = (compute, deps) => {
    const slot = slots[cursor] ||= { deps: null, value: undefined }
    cursor += 1
    if (!slot.deps || deps.some((value, n) => !Object.is(value, slot.deps[n]))) { slot.deps = deps; slot.value = compute() }
    return slot.value
  }
  const context = vm.createContext({
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useRef(initial) { const slot = slots[cursor] ||= { value: { current: initial } }; cursor += 1; return slot.value },
    useState(initial) {
      const slot = slots[cursor] ||= { value: initial }
      cursor += 1
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; if (!rendering) render() }]
    },
    useEffect(run, deps) { queued.push({ index: cursor++, run, deps }) },
    createContext: () => ({}), useContext: () => null,
    classifyReview, mergeReviewPulls, respondEntries, reviewCounts, reviewEntries, reviewKey,
    fetchChangeProbe: async () => null,
    loadReviewRuns: loadReviewRuns || (async () => ({ runs: [] })),
    changedReviewRuns: () => [], pendingRespondStarts: () => [], respondStartsExpireIn: () => null, withRespondStart: list => list, withReviewRun: list => list,
    hasActiveReview: () => false, SYNC_POLICY,
    readReviewPulls(token, refs, keys) {
      const asked = (keys ? refs.filter(ref => keys.has(reviewKey(ref.repo, ref.number))) : refs).map(ref => reviewKey(ref.repo, ref.number))
      return new Promise((resolve, reject) => reads.push({ keys, asked, resolve: pulls => resolve({ everything: !keys, asked, pulls }), reject }))
    },
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (const|function) /g, '$1 '), context)
  function render(next) {
    if (next) props = { ...props, hub, enabled: true, ...next }
    rendering = true; cursor = 0; queued = []
    view = context[use](props)
    rendering = false
    for (const effect of queued) {
      const before = effects[effect.index]
      if (before && !effect.deps.some((value, n) => !Object.is(value, before.deps[n]))) continue
      before?.cleanup?.()
      effects[effect.index] = { deps: effect.deps, cleanup: effect.run() }
    }
    return view
  }
  unmounts.push(() => { effects.forEach(effect => effect?.cleanup?.()); stopHub() })
  const flush = () => new Promise(resolve => setTimeout(resolve, 5))
  return { render, reads, flush, hub, last: () => view, sync: options => view.syncPulls(options), failed: () => view.failed }
}

const head = letter => letter.repeat(40)
const runs = [{ id: 'r1', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', items: [{ repo: 'o/r', number: 7, head_sha: head('a'), title: 'A PR', state: 'needs_you', verdict_proposal: { state: 'posted', event: 'REQUEST_CHANGES' } }] }]
const pull = () => ({ number: 7, state: 'OPEN', headRefOid: head('a'), baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'someone-else' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null,
  reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })
const base = { token: 't', ignored: null, login: 'owner', runs }

test('a read of the reviewed PRs that failed is read again by the hub, with the PRs it was asked for', async () => {
  const h = harness()
  h.render(base)
  assert.equal(h.reads.length, 1)
  h.reads[0].reject(new Error('offline')); await h.flush()
  assert.equal(h.reads.length, 2, 'the work list was put back, so the hub\'s own retry has something to read (it was empty before)')
  assert.deepEqual(h.reads[1].asked, h.reads[0].asked)
  assert.equal(h.failed(), true, 'the page says it could not read, until the retry answers')
  h.reads[1].resolve(new Map([['o/r#7', pull()]])); await h.flush()
  assert.equal(h.failed(), false, 'the retry\'s answer clears the failure')
})

test('a Sync whose read failed is retried as a Sync: it reads every PR again', async () => {
  const h = harness()
  h.render(base)
  h.reads[0].resolve(new Map([['o/r#7', pull()]])); await h.flush()
  const done = h.sync()
  h.reads[1].reject(new Error('offline'))
  assert.equal(await done, false, 'Sync hears that the read failed')
  await h.flush()
  assert.equal(h.reads[2].keys, null, 'the retry reads every PR, as the Sync that failed asked')
})

test('the Sync of the reviewed PRs answers whether its read went through', async () => {
  const h = harness()
  h.render(base)
  h.reads[0].resolve(new Map([['o/r#7', pull()]])); await h.flush()
  const good = h.sync()
  h.reads[1].resolve(new Map([['o/r#7', pull()]]))
  assert.equal(await good, true)
  const bad = h.sync()
  h.reads[2].reject(new Error('offline'))
  assert.equal(await bad, false)
})

test('the runs read answers whether it went through, so a Sync that could not read them is not "Synced"', async () => {
  let fail = false
  const h = harness({ use: 'useDeskReviewRuns', loadReviewRuns: async () => { if (fail) throw new Error('offline'); return { runs: [] } } })
  const view = h.render({ token: 't', appId: 1, connState: 'connected', sendOnly: false, pullPageOpen: false })
  await h.flush()
  assert.equal(await view.refresh(), true, 'a read that answered')
  fail = true
  assert.equal(await h.last().refresh(), false, 'a read that failed')
  fail = false
  assert.equal(await h.last().refresh(), true, 'and the next one that answers')
})

const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')

test('the Sync\'s result carries the failures of the runs and of the reviewed PRs', () => {
  const refresh = app.match(/async function refreshEverything\(\{ quiet = false \} = \{\}\) \{[\s\S]*?\n  \}/)[0]
  assert.match(refresh, /const \[, , checked, runsOk, pullsOk\] = await Promise\.all\(\[[^\]]*refreshReviewRuns\(\), reviewList\.syncPulls\(\{ quiet \}\)\]\)/)
  assert.match(refresh, /upstream = \{ \.\.\.checked, ok: checked\.ok && runsOk !== false && pullsOk !== false \}/)
  assert.match(app, /const synced = conn\.state === 'connected' && !sourceError && syncReadsCurrent\(\) && reviewList\.settled && !reviewList\.failed && !runsError/, 'the open\'s own sync hears a failed read of the runs too')
})
