// The Desk keeps merged PRs open. Only open PRs of the owner's are counted, the owner's own PRs are watched by the one probe a minute the
// hub already makes (never a second timer), and a merge or close made on GitHub reads the list at once; Open for review refreshes it.
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { authoredPulls, deskCounts, ownPullRefs, requestsWaiting, waitingOnOthers, withReadPulls } from '../desk.js'
import { syncFacts } from '../sync-summary.js'
import { classifyReview, mergeReviewPulls, respondEntries, reviewCounts, reviewEntries, reviewKey } from '../review-list.js'
import { SYNC_POLICY, createSyncHub } from '../refresh.js'

const HEAD = 'a'.repeat(40)
const pull = (number, extra = {}) => ({ number, title: `Mine ${number}`, author: { login: 'owner' }, repository: { nameWithOwner: 'acme/widgets', viewerPermission: 'WRITE' }, labels: { nodes: [] }, comments: { totalCount: 0 }, headRefName: `h${number}`, baseRefName: 'main', updatedAt: '2026-11-02T08:00:00Z', isDraft: false,
  headRefOid: HEAD, state: 'OPEN', mergeable: 'MERGEABLE', latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra })

test('a merged or closed PR of yours that a lagging search still lists is no open PR, row or count', () => {
  const incoming = [pull(1), pull(2, { state: 'MERGED' }), pull(3, { state: 'CLOSED' }), pull(4, { state: undefined })]
  assert.deepEqual(authoredPulls(incoming, 'owner').map(pr => pr.number), [1, 4], 'a PR with no state read is as it was: open')
  assert.equal(deskCounts({ incoming, login: 'owner' }).mine, 2, 'it was 4')
  assert.deepEqual(ownPullRefs(incoming, 'owner'), [{ repo: 'acme/widgets', number: 1 }, { repo: 'acme/widgets', number: 4 }])
  assert.deepEqual(waitingOnOthers({ incomingReviews: [pull(2, { state: 'MERGED', updatedAt: '2026-10-01T08:00:00Z' })], canonical_repo: 'acme/widgets' }, [], 'owner'), [], 'a merged PR is not waiting on reviewers')
})

// ---- The probe, with the real hook and the real hub.
const source = readFileSync(new URL('../ui/useReviewList.js', import.meta.url), 'utf8')
const unmounts = []
after(() => unmounts.forEach(unmount => unmount()))

function harness({ probe }) {
  const slots = [], effects = [], watched = []
  let cursor = 0, props = {}, rendering = false, queued = []
  const reads = []
  const hub = createSyncHub({ policy: { ...SYNC_POLICY, probeMs: 1 }, host: { mobius: { onVisibilityChange: listener => { listener(true); return () => {} } } } })
  const stopHub = hub.start()
  hub.fact('incoming', { github: true, read: async () => { reads.push('incoming'); return [] }, apply: () => {} })
  const memo = (compute, deps) => {
    const slot = slots[cursor] ||= { deps: null, value: undefined }
    cursor += 1
    if (!slot.deps || deps.some((value, n) => !Object.is(value, slot.deps[n]))) { slot.deps = deps; slot.value = compute() }
    return slot.value
  }
  const context = vm.createContext({
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useRef(initial) { const slot = slots[cursor] ||= { value: { current: initial } }; cursor += 1; return slot.value },
    useState(initial) { const slot = slots[cursor] ||= { value: initial }; cursor += 1; return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; if (!rendering) render() }] },
    useEffect(run, deps) { queued.push({ index: cursor++, run, deps }) },
    createContext: () => ({}), useContext: () => null,
    classifyReview, mergeReviewPulls, respondEntries, reviewCounts, reviewEntries, reviewKey,
    fetchChangeProbe: async (token, pulls) => { watched.push(pulls.map(item => item.key)); return probe(pulls) },
    readReviewPulls: () => new Promise(() => {}),
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (const|function) /g, '$1 '), context)
  function render(next) {
    if (next) props = { ...props, hub, enabled: true, ...next }
    rendering = true; cursor = 0; queued = []
    context.useReviewList(props)
    rendering = false
    for (const effect of queued) {
      const before = effects[effect.index]
      if (before && !effect.deps.some((value, n) => !Object.is(value, before.deps[n]))) continue
      before?.cleanup?.()
      effects[effect.index] = { deps: effect.deps, cleanup: effect.run() }
    }
  }
  unmounts.push(() => { effects.forEach(effect => effect?.cleanup?.()); stopHub() })
  return { render, hub, watched, reads, flush: () => new Promise(resolve => setTimeout(resolve, 5)) }
}

const base = { token: 't', runs: [], ignored: null, login: 'owner', ownPulls: [{ repo: 'acme/widgets', number: 1 }] }

// The probe is answered by the test, one answer at a time, so each is seen before the next is given.
const controlled = () => {
  const waiting = []
  return { probe: () => new Promise(resolve => waiting.push(resolve)), waiting, answer: async map => { while (!waiting.length) await new Promise(resolve => setTimeout(resolve, 2)); waiting.shift()(map); await new Promise(resolve => setTimeout(resolve, 8)) } }
}
const signatures = (stamp, state = 'OPEN') => new Map([['requests', ''], ['own:acme/widgets#1', `${stamp}|${state}`]])

test('the one probe a minute also asks about the owner\'s own open PRs, under keys of their own', async () => {
  const control = controlled()
  const h = harness({ probe: control.probe })
  h.render(base)
  await control.answer(signatures('t1'))
  assert.deepEqual([...h.watched[0]], ['own:acme/widgets#1'], 'the probe asks about the PR once, in the same question as the reviewed PRs')
})

test('an own PR that moved waits out the cooldown; one that was merged or closed reads the list at once', async () => {
  const control = controlled()
  const h = harness({ probe: control.probe })
  h.render(base)
  await h.hub.refresh('incoming')
  h.reads.length = 0
  await control.answer(signatures('t1'))
  assert.deepEqual(h.reads, [], 'the first answer is only the baseline')
  await control.answer(signatures('t2'))
  assert.deepEqual(h.reads, [], 'a push or a comment: the read waits out its five minutes, as for a moved request')
  await control.answer(signatures('t3', 'MERGED'))
  assert.deepEqual(h.reads, ['incoming'], 'merged on GitHub: the Desk stops counting it within the probe\'s minute')
})

test('Open for review reads the owner\'s PRs at once, and the Desk\'s own-PR list is the probe\'s', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  const markReady = app.match(/const onMarkReady = useCallback\(async \(rec\) => \{[\s\S]*?\n  \}, \[appId, token, applyRecordUpdates, refreshReviewStatus, refreshIncomingReviews\]\)/)[0]
  assert.equal((markReady.match(/void refreshIncomingReviews\(\)/g) || []).length, 3, 'every path that ends with the PR open reads the list again')
  assert.match(app, /const ownPulls = useMemo\(\(\) => ownPullRefs\(incomingReviews, login\), \[incomingReviews, login\]\)/)
  assert.match(app, /pulls: incomingReviews, ownPulls, onOwnMoved, ignored: ignoredReviews, login/)
})

// ---- A PR of the owner's own that GitHub also lists as a review request (a team the owner belongs to was asked): it is still theirs.
test('an own PR that GitHub also lists as a review request stays under My PRs and is no request to the owner', () => {
  const both = pull(1, { reviewRequested: true, updatedAt: '2026-10-01T08:00:00Z' })
  const theirs = pull(2, { reviewRequested: true, author: { login: 'sam' } })
  const incoming = [both, theirs]
  assert.deepEqual(authoredPulls(incoming, 'owner').map(item => item.number), [1], 'it was no row under My PRs')
  assert.deepEqual(ownPullRefs(incoming, 'owner'), [{ repo: 'acme/widgets', number: 1 }], 'the probe watches it like any own PR')
  assert.deepEqual(requestsWaiting(incoming, 'owner').map(item => item.number), [2], 'only someone else\u2019s PR is a request')
  const counts = deskCounts({ incoming, login: 'owner' })
  assert.deepEqual([counts.mine, counts.requests], [1, 1])
  assert.equal(syncFacts({ incoming, login: 'owner' }).requests.size, 1, 'a Sync does not announce it as a new review request')
  const waiting = waitingOnOthers({ incomingReviews: [both], canonical_repo: 'acme/widgets' }, [], 'owner', [], {}, Date.parse('2026-11-18T00:00:00Z'))
  assert.deepEqual(waiting.map(({ pr }) => pr.number), [1], 'waiting on its reviewers, as an own PR does')
})

// ---- A move of an own PR reads that PR, never the lists.
test('an own PR that only moved is read again by itself after the cooldown, and a new request still reads the lists', async () => {
  const control = controlled()
  const h = harness({ probe: control.probe })
  const moved = []
  h.render({ ...base, onOwnMoved: refs => moved.push(refs) })
  await h.hub.refresh('incoming')
  h.reads.length = 0
  await control.answer(signatures('t1'))
  await control.answer(signatures('t2'))
  assert.deepEqual(h.reads, [], 'the lists are not read for a PR of the owner that moved')
  assert.deepEqual(moved, [[{ repo: 'acme/widgets', number: 1 }]], 'that PR is the one read again')
  await control.answer(new Map([['requests', 'new'], ['own:acme/widgets#1', 't2|OPEN']]))
  assert.equal(moved.length, 1, 'a request moved, not the PR')
  await control.answer(signatures('t3', 'MERGED'))
  assert.deepEqual(h.reads, ['incoming'], 'merged on GitHub: the lists, at once')
  assert.equal(moved.length, 1, 'a PR that is over is not read one by one')
})

test('PRs read one by one replace their own rows and keep what the row said about review requests; nothing is added or dropped', () => {
  const list = [pull(1, { reviewRequested: true, title: 'old' }), pull(2), pull(3, { author: { login: 'sam' } })]
  const next = withReadPulls(list, [pull(1, { title: 'new' }), pull(9, { title: 'not listed' })])
  assert.deepEqual(next.map(item => [item.number, item.title]), [[1, 'new'], [2, 'Mine 2'], [3, 'Mine 3']])
  assert.equal(next[0].reviewRequested, true)
  assert.equal(list[0].title, 'old', 'the list it was given is not changed')
  assert.deepEqual(withReadPulls(list, []), list)
})

test('the app reads moved own PRs through the hub as a GitHub fact, with their own points, and puts a failed read back', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /hub\.fact\('ownPulls', \{\s*github: true,/)
  assert.match(app, /readExactPulls\(token, refs, 'ContributeMovedOwnPulls'\)/)
  assert.match(app, /catch \(error\) \{\s*refs\.forEach\(ref => movedOwn\.current\.set\(/)
  assert.match(app, /apply: read => \{ if \(read\.length\) setIncomingReviews\(old => withReadPulls\(old, read\)\) \}/)
})
