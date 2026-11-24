// What the screens do beyond their first version: settings saved as checked writes, a discarded
// update that stays an open PR, Take back Post, set-aside notes tied to their run, no Merge options in a merge queue, answered findings not listed,
// and a cut list of review runs that says so and reads more when asked.
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { actionsMenuModel, MERGE_OPTIONS } from '../actions-menu.js'
import { standingFor } from '../pr-standing.js'
import { savedFindings } from '../address-feedback.js'
import { postRefusal } from '../review-actions.js'
import { runsCutWords } from '../desk.js'
import { buildContributionRun } from '../run.js'
import { discardRecord } from '../lifecycle-write.js'
import { isCurrentRecord } from '../storage.js'
import { SYNC_POLICY, createSyncHub } from '../refresh.js'
import { changedReviewRuns } from '../review-list.js'

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const app = read('index.jsx')

test('the four settings saves of the app are checked writes made as a change to the file as it is now', () => {
  assert.doesNotMatch(app, /saveAppSettings/, 'no save of a whole object built from an earlier read')
  assert.match(app, /void updateAppSettings\(settings => \(\{ \.\.\.settings, \[DESK_LAST_LOOKED_KEY\]: new Date\(\)\.toISOString\(\) \}\)\)/)
  assert.match(app, /await updateAppSettings\(settings => \(\{ \.\.\.settings, new_pr_stage: stage \}\)\)/)
  assert.match(app, /await updateAppSettings\(\(\{ review_agent: _replaced, \.\.\.settings \}\) => \(agent \? \{ \.\.\.settings, review_agent: agent \} : settings\)\)/)
  assert.match(app, /await updateAppSettings\(settings => \(\{ \.\.\.settings, autopilot_default: next \}\)\)/)
})

test('a discarded update returns as a public PR: it leaves Ready, stays current and is not shown under Dismissed', () => {
  const update = { id: 'upd', type: 'pr', status: 'prepared', number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', title: 'T', plan: { action: 'pr_update', repo: 'o/r', head_sha: 'b'.repeat(40) }, updated_at: '2026-11-17T00:00:00Z', created_at: '2026-11-17T00:00:00Z' }
  const back = discardRecord(update)
  assert.equal(back.status, 'open')
  const before = buildContributionRun({ records: [update] })
  const after = buildContributionRun({ records: [back] })
  assert.deepEqual(before.decisions.map(item => item.kind), ['private_review'], 'waiting to be sent')
  assert.deepEqual(after.decisions.map(item => item.kind), [], 'it left the Ready list')
  assert.equal(after.archive.length, 0, 'and is no Dismissed record')
  assert.equal(isCurrentRecord(back), true, 'it stays in the open list')
  assert.match(app, /A public record handed back by a discard/)
})

test('Take back Post is wired from the PR page to the card, and nothing else posts', () => {
  assert.match(read('ui/PullRequests.jsx'), /onWithdrawResponse: answer && \(\(\) => answerAction\(pr, \(\) => withdrawResponse\(\{ slug: answer\.slug, digest: answer\.result\.digest \}\)\)\),/)
  assert.match(read('ui/PullRequests.jsx'), /import \{ approveResponse, discardResponse, withdrawResponse \} from '\.\.\/respond-flow\.js'/)
  assert.match(read('ui/ReviewTab.jsx'), /onWithdraw=\{props\.onWithdrawResponse\}/)
})

test('the set-aside note is asked of its own run on both sites of the Review tab, and where Post is not offered the card says why', () => {
  const tab = read('ui/ReviewTab.jsx')
  assert.match(tab, /ignoredNote\(item, ctx\?\.ignored, run\)/)
  assert.match(tab, /const note = ignoredNote\(item, ignored, run\)/)
  assert.match(tab, /\? postRefusal\(item\) : ''/)
  assert.match(tab, /\{refusal \? <p className="co-review-note" role="status">\{refusal\}<\/p> : null\}/)
  assert.equal(postRefusal({ state: 'needs_you', summary: 'P1', verdict_proposal: { state: 'proposed', event: 'REQUEST_CHANGES' } }), 'This review already has a verdict. Submit or discard that one.')
  assert.equal(postRefusal({ state: 'needs_you', summary: 'P1' }), '')
})

// ---- Merge options in a merge queue.
const HEAD = 'b'.repeat(40)
const pull = (extra = {}) => ({ number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'alex' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE', squashMergeAllowed: true, rebaseMergeAllowed: true }, latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }], statusContextCountsByState: [] } } } }] }, ...extra })
const ALL = { merge_now: true, owner_confirm: true }
const sideOfMerge = pr => actionsMenuModel([pr], [standingFor({ pr, login: 'alex' })], { capabilities: ALL }).you.find(item => item.intent === 'merge')?.side

test('where the base branch uses a merge queue the Merge row has no "Merge options…"', () => {
  globalThis.window = { mobius: { ownerGrant: { request() {} } } }
  try {
    assert.equal(sideOfMerge(pull())?.intent, MERGE_OPTIONS, 'two ways to land, no queue: the choice is offered')
    assert.equal(sideOfMerge(pull({ isMergeQueueEnabled: true })), undefined, 'a merge queue lands it its own way')
  } finally { delete globalThis.window }
})

// ---- Findings a posted reply answered are not listed.
test('saved findings a posted reply has answered are not listed again; the Desk and the PR page both ask', () => {
  const status = { run: { id: 'r' }, item: { state: 'needs_you', summary: 'P1 problem', head_sha: HEAD, repo: 'o/r', number: 7 } }
  assert.ok(savedFindings(status, null, { answered: false }))
  assert.equal(savedFindings(status, null, { answered: true }), null)
  assert.match(read('ui/DeskViews.jsx'), /savedFindings\(review, ignored, \{ answered: findingsAnswered\(responses, pr, review\) \}\)/)
  assert.match(read('ui/PullRequests.jsx'), /\{ answered: findingsAnswered\(responses, source, status\) \}/)
})

// ---- A cut list of review runs.
test('the Agent runs view says when older finished reviews are cut and offers to read them; an older Möbius says it may miss one', () => {
  const onMore = () => {}
  assert.deepEqual(runsCutWords({ cut: 'finished', onMore }, 'runs'), { text: 'Older finished reviews are not shown here. Everything that is still working or waiting on you is.', action: 'Show older reviews' })
  assert.equal(runsCutWords({ cut: 'finished', onMore }, 'needs'), null, 'nothing that waits on you is cut from a paged list')
  assert.match(runsCutWords({ cut: 'any' }, 'needs').text, /newest 100 review runs, so an older one, even one waiting on you, may be missing/)
  assert.equal(runsCutWords({ cut: 'any' }, 'runs').action, '', 'an older Möbius has no further page')
  assert.equal(runsCutWords({ cut: '' }, 'runs'), null, 'a list with nothing hidden says nothing')
})

const source = read('ui/useReviewList.js')
const unmounts = []
after(() => unmounts.forEach(unmount => unmount()))

function runsHarness({ first, pages }) {
  const slots = [], effects = []
  let cursor = 0, props = {}, rendering = false, queued = [], view = null
  const asked = []
  const hub = createSyncHub({ host: { mobius: { onVisibilityChange: listener => { listener(true); return () => {} } } } })
  const stopHub = hub.start()
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
    loadReviewRuns: async () => structuredClone(first),
    moreReviewRuns: async (token, appId, list) => { asked.push(list.next_cursor); const page = pages.shift(); if (page instanceof Error) throw page; return page },
    changedReviewRuns, pendingRespondStarts: () => [], respondStartsExpireIn: () => null, withRespondStart: list => list, withReviewRun: list => list, hasActiveReview: () => false, SYNC_POLICY,
  })
  vm.runInContext(source.replace(/^import .*\n/gm, '').replace(/export (const|function) /g, '$1 '), context)
  function render(next) {
    if (next) props = { ...props, hub, ...next }
    rendering = true; cursor = 0; queued = []
    view = context.useDeskReviewRuns(props)
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
  return { render, hub, asked, last: () => view, flush: () => new Promise(resolve => setTimeout(resolve, 8)) }
}
const run = (id, state = 'complete') => ({ id, state, execution_state: 'completed', created_at: '2026-11-01T00:00:00Z', items: [] })
const ids = view => [...view.runs].map(item => item.id)

test('older finished runs are read when the owner asks, kept across the reads that follow, and the note goes when none are left', async () => {
  const h = runsHarness({
    first: { runs: [run('new1'), run('new2')], respond_chats: [], has_more: true, next_cursor: 'c1', cut: 'finished' },
    pages: [{ runs: [run('old1'), run('old2')], has_more: true, next_cursor: 'c2' }, { runs: [run('old3')], has_more: false, next_cursor: null }],
  })
  h.render({ token: 't', appId: 1, connState: 'connected', sendOnly: false, pullPageOpen: false })
  await h.flush()
  assert.deepEqual([ids(h.last()), h.last().runsCut.cut], [['new1', 'new2'], 'finished'], 'the first page says it is cut')
  await h.last().runsCut.onMore()
  assert.deepEqual([ids(h.last()), h.last().runsCut.cut, h.asked], [['new1', 'new2', 'old1', 'old2'], 'finished', ['c1']], 'one page more, still more behind it')
  await h.last().refresh()
  assert.deepEqual(ids(h.last()), ['new1', 'new2', 'old1', 'old2'], 'a later read of the first page does not drop what was read')
  assert.equal(h.last().runsCut.cut, 'finished')
  await h.last().runsCut.onMore()
  assert.deepEqual([ids(h.last()).length, h.last().runsCut.cut, h.last().runsCut.onMore, h.asked], [5, '', null, ['c1', 'c2']], 'the cursor moved on; nothing hidden is nothing said')
})

test('a page that cannot be read leaves the list as it was and says so; a full page of an older Möbius has no way to read more', async () => {
  const h = runsHarness({
    first: { runs: [run('new1')], respond_chats: [], has_more: true, next_cursor: 'c1', cut: 'finished' },
    pages: [new Error('offline')],
  })
  h.render({ token: 't', appId: 1, connState: 'connected', sendOnly: false, pullPageOpen: false })
  await h.flush()
  await h.last().runsCut.onMore()
  assert.deepEqual([ids(h.last()), h.last().runsCut.error, h.last().runsCut.cut], [['new1'], 'The older reviews could not be read just now. Try again.', 'finished'])
  const old = runsHarness({ first: { runs: [run('a')], respond_chats: [], cut: 'any' }, pages: [] })
  old.render({ token: 't', appId: 1, connState: 'connected', sendOnly: false, pullPageOpen: false })
  await old.flush()
  assert.deepEqual([old.last().runsCut.cut, old.last().runsCut.onMore], ['any', null])
})

test('the note and the button reach the Desk from the hook through the app', () => {
  assert.match(app, /respondStarted, runsCut \} = useDeskReviewRuns\(/)
  assert.match(app, /projectRuns,\n    runsCut,/)
  assert.match(read('ui/SourceMap.jsx'), /runsCut=\{desk\.runsCut\}/)
  assert.match(read('ui/DeskViews.jsx'), /<RunsCut cut=\{runsCut\} view=\{view\} \/>/)
})

// ---- The search of the owner's PRs stops at one page of 50 and says so.
import { incomingCutOf, incomingCutWords } from '../desk.js'
const rowsOf = (count, extra = {}) => Array.from({ length: count }, (_, index) => ({ number: index + 1, repository: { nameWithOwner: 'o/r' }, ...extra }))

test('a full page of GitHub\'s search is read as "there may be more", and the Desk says so on the views that list them', () => {
  assert.equal(incomingCutOf(rowsOf(49)), '')
  assert.equal(incomingCutOf(rowsOf(50)), 'involved')
  assert.equal(incomingCutOf([...rowsOf(10), ...rowsOf(50, { reviewRequested: true })]), 'requests')
  assert.equal(incomingCutOf([...rowsOf(30), ...rowsOf(30, { reviewRequested: true })]), '', 'the two searches are two pages')
  assert.match(incomingCutWords('involved', 'mine'), /only the first 50 PRs that involve you, so some of yours may be missing/)
  assert.equal(incomingCutWords('involved', 'requests'), '')
  assert.match(incomingCutWords('requests', 'requests'), /only the first 50 PRs that ask for your review/)
  assert.equal(incomingCutWords('', 'mine'), '')
  assert.match(app, /incomingCut: incomingCutOf\(incomingReviews\),/)
  assert.match(read('ui/DeskViews.jsx'), /<IncomingCut cut=\{incomingCut\} view=\{view\} \/>/)
})
