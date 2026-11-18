import assert from 'node:assert/strict'
import test from 'node:test'
import { savedFindings } from '../address-feedback.js'
import { earlierReviewForPull, loadReviewRuns, moreReviewRuns, reviewForPull, reviewItemProgress, reviewOfPull, reviewReading, withIgnoreNote, withoutIgnoreNote, ignoredNote } from '../collaboration.js'
import { prFacts } from '../pr-facts.js'
import { decide } from '../pr-machine.js'
import { classifyReview } from '../review-list.js'
import { frameState, reviewForRecord } from '../review-frame.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const run = (extra = {}) => ({ id: 'r1', state: 'complete', execution_state: 'completed', mode: 'review', created_at: '2026-11-04T10:00:00Z', ...extra })
const item = (extra = {}) => ({ repo: 'o/r', number: 7, head_sha: HEAD, base_ref: 'main', base_sha: 'c'.repeat(40), state: 'needs_you', summary: 'P1 found', ...extra })
const blocked = () => item({ summary: 'Could not read the diff.', blocked: true })
const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', baseRef: { target: { oid: 'c'.repeat(40) } }, mergeable: 'MERGEABLE', author: { login: 'Sam' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra,
})
const mine = extra => pull({ author: { login: 'Alex' }, ...extra })

// ---- A review that stopped is ONE result on every screen.

test('a review that named an obstacle, and one that stalled, are one reading each: label, whose turn, next step', () => {
  const notFinished = reviewReading(run(), blocked())
  assert.deepEqual(notFinished, { state: 'NOT_FINISHED', label: 'Not finished', turn: 'owner', next: 'review_again', halted: false, waiting: false, settled: false })
  const stalled = reviewReading(run({ state: 'needs_you', execution_state: 'interrupted' }), item({ state: 'reviewing', summary: undefined }))
  assert.deepEqual([stalled.state, stalled.label, stalled.turn, stalled.next], ['STALLED', 'Not finished', 'owner', 'review_again'])
  const stopped = reviewReading(run({ state: 'reviewing', execution_state: 'stopped' }), item({ state: 'reviewing' }))
  assert.deepEqual([stopped.state, stopped.next, stopped.turn, stopped.halted], ['STOPPED', '', 'none', true], 'a review you stopped asks nothing')
  assert.equal(reviewReading(run({ execution_state: 'awaiting_owner' }), item()).state, 'ASKS')
  assert.equal(reviewReading(run({ state: 'running', execution_state: 'running' }), item({ state: 'reviewing' })).state, 'REVIEWING')
  assert.equal(reviewReading(run(), item({ state: 'all_clear' })).state, 'CLEAR')
  assert.equal(reviewReading(run(), item()).state, 'PROBLEMS')
})

test('the platform’s own word that the review stalled counts, even while its chat still looks alive', () => {
  const lifecycle = { v: 1, regions: { review: { state: 'STALLED', since: 1763460000, deadline: null } } }
  const reading = reviewReading(run({ state: 'running', execution_state: 'running' }), item({ state: 'reviewing', lifecycle }))
  assert.deepEqual([reading.state, reading.halted, reading.turn], ['STALLED', true, 'owner'])
  // It adds only what the saved word cannot say: a review that has reported is not stalled by a stale vector.
  assert.equal(reviewReading(run(), item({ lifecycle })).state, 'PROBLEMS')
  // An old platform sends no vector and a vector this app cannot read says nothing.
  assert.equal(reviewReading(run({ state: 'running', execution_state: 'running' }), item({ state: 'reviewing', lifecycle: { v: 99 } })).state, 'REVIEWING')
  // The progress fields every older screen asks for are the reading's own.
  assert.deepEqual(reviewItemProgress(run({ state: 'running', execution_state: 'running' }), item({ state: 'reviewing', lifecycle })), { label: 'Not finished', halted: true, waiting: false, settled: false, turn: 'owner' })
})

test('the obstacle text a blocked review saved is never handed to Respond as findings', () => {
  assert.equal(savedFindings({ run: run(), item: blocked() }), null)
  assert.equal(savedFindings({ run: run(), item: item() })?.summary, 'P1 found', 'findings still are')
})

test('the Desk frame: a stalled review is the owner’s move, a review that did not finish or was stopped is none, a comment on its way travels', () => {
  const frame = (reviewItem, runExtra) => frameState({ run: run(runExtra), item: reviewItem }, { own: true })
  assert.equal(frame(blocked()), 'idle')
  assert.equal(frame(item({ state: 'reviewing' }), { state: 'needs_you', execution_state: 'interrupted' }), 'verdict')
  assert.equal(frame(item({ state: 'reviewing' }), { state: 'needs_you', execution_state: 'failed' }), 'verdict')
  assert.equal(frame(item({ state: 'reviewing' }), { state: 'running', execution_state: 'stopped' }), 'idle')
  assert.equal(frameState({ run: run(), item: item({ public_review: { state: 'posting' } }) }), 'reviewing')
  assert.equal(frame(item()), 'verdict', 'findings still wait on the owner')
})

test('the PR row keeps a blocked review plain To review, and the Agent runs list says Not finished and waits on the owner', () => {
  const runs = [run({ items: [blocked()] })]
  const entry = { run: runs[0], item: runs[0].items[0] }
  const theirs = classifyReview(entry, { login: 'alex', live: pull(), runs })
  assert.equal(decide(prFacts({ pr: pull(), login: 'alex', runs })).state, 'reviewer.to_review', 'the machine reads it as it always did (#187)')
  assert.deepEqual([theirs.bucket, theirs.chips], ['stalled', [{ label: 'Not finished', tone: 'owner' }]])
  const own = classifyReview(entry, { login: 'alex', live: mine(), runs })
  assert.deepEqual([own.bucket, own.chips.map(chip => chip.label)], ['stalled', ['Not finished']], 'on your own PR the obstacle was hidden behind Waiting on reviewers')
  // Something more urgent, or a PR that is over, keeps its own words; so does a review of an older version.
  assert.deepEqual(classifyReview(entry, { login: 'alex', live: pull({ state: 'MERGED' }), runs }).chips.map(chip => chip.label), ['Merged'])
  assert.notEqual(classifyReview(entry, { login: 'alex', live: pull({ headRefOid: OLD }), runs }).chips[0].label, 'Not finished')
  // An agent that stopped keeps the words it has: one bucket for both.
  const stalledRuns = [run({ state: 'needs_you', execution_state: 'interrupted', items: [item({ state: 'reviewing' })] })]
  const stalled = classifyReview({ run: stalledRuns[0], item: stalledRuns[0].items[0] }, { login: 'alex', live: pull(), runs: stalledRuns })
  assert.deepEqual([stalled.bucket, stalled.chips[0].label], ['stalled', 'Agent stopped'])
})

// ---- A note belongs to the review it was made on.

test('a note names its review: another review of the same version is judged afresh', () => {
  const first = run({ id: 'first', created_at: '2026-11-04T10:00:00Z' })
  const second = run({ id: 'second', created_at: '2026-11-04T12:00:00Z' })
  const notes = withIgnoreNote({}, item(), 'Out of scope', '2026-11-04T10:30:00Z', first)
  assert.deepEqual(Object.keys(notes), [`o/r#7@${HEAD}#first`])
  assert.equal(reviewItemProgress(first, item(), { ignored: notes }).label, 'Set aside')
  assert.equal(reviewItemProgress(second, item(), { ignored: notes }).label, 'Needs you', 'the later review of the same version is not waived')
  assert.equal(ignoredNote(item(), notes, second), null)
  assert.equal(reviewReading(first, item(), { ignored: notes }).state, 'SET_ASIDE')
  // A screen that does not know the run still sees that the version has a note.
  assert.equal(ignoredNote(item(), notes)?.reason, 'Out of scope')
})

test('a note saved before runs were part of the key counts for the review it was made on, and for no later review', () => {
  const legacy = { [`o/r#7@${HEAD}`]: { reason: 'Not a problem', at: '2026-11-04T10:30:00Z' } }
  const earlier = run({ created_at: '2026-11-04T10:00:00Z' })
  const later = run({ id: 'later', created_at: '2026-11-04T11:00:00Z' })
  assert.equal(reviewItemProgress(earlier, item(), { ignored: legacy }).label, 'Set aside')
  assert.equal(reviewItemProgress(later, item(), { ignored: legacy }).label, 'Needs you')
  // A note made the moment its review began, or with no time, or against a run with no time, stands.
  assert.equal(reviewItemProgress(run({ created_at: '2026-11-04T10:30:00Z' }), item(), { ignored: legacy }).label, 'Set aside')
  assert.equal(reviewItemProgress(later, item(), { ignored: { [`o/r#7@${HEAD}`]: { reason: 'x' } } }).label, 'Set aside')
  assert.equal(reviewItemProgress(run({ created_at: undefined }), item(), { ignored: legacy }).label, 'Set aside')
  // The PR row and the findings a Respond window carries say the same.
  const runs = [{ ...later, items: [item()] }]
  assert.equal(decide(prFacts({ pr: mine(), login: 'alex', runs, ignored: legacy })).state, 'author.findings')
  assert.equal(savedFindings({ run: later, item: item() }, legacy)?.summary, 'P1 found')
  assert.equal(savedFindings({ run: earlier, item: item() }, legacy), null)
})

test('taking a note back removes every note of that exact version, and the notes stay few', () => {
  let notes = withIgnoreNote({}, item(), 'a', '2026-11-04T10:00:00Z', run({ id: 'one' }))
  notes = withIgnoreNote(notes, item(), 'b', '2026-11-04T11:00:00Z')
  notes = withIgnoreNote(notes, item({ head_sha: OLD }), 'c', '2026-11-04T12:00:00Z', run({ id: 'two' }))
  assert.deepEqual(Object.keys(withoutIgnoreNote(notes, item())), [`o/r#7@${OLD}#two`])
  let many = {}
  for (let number = 1; number <= 230; number += 1) many = withIgnoreNote(many, { repo: 'o/r', number, head_sha: HEAD }, 'x', new Date(Date.UTC(2026, 10, 1, 0, 0, number)).toISOString(), run({ id: `r${number}` }))
  assert.equal(Object.keys(many).length, 200)
})

// ---- One selector finds "the review of this PR".

test('after GitHub retargets a PR, the row and the Review tab find the same review', () => {
  const retargeted = run({ items: [item({ base_ref: 'feature-parent', base_sha: 'd'.repeat(40) })] })
  const runs = [retargeted]
  const tab = reviewForPull(runs, pull())
  assert.equal(tab?.run, retargeted)
  assert.equal(tab.exactBase, false, 'it says it did not see this branch')
  assert.equal(reviewOfPull(runs, pull())?.item, tab.item, 'the row reads the very same review')
  assert.equal(decide(prFacts({ pr: mine(), login: 'alex', runs })).state, 'author.findings')
  assert.equal(earlierReviewForPull(runs, pull()), null)
})

test('one lookup: the current version first (the run on the current tip wins), else the newest earlier one', () => {
  const exact = run({ id: 'exact', created_at: '2026-11-04T09:00:00Z', items: [item()] })
  const newer = run({ id: 'newer', created_at: '2026-11-04T11:00:00Z', items: [item({ base_sha: 'e'.repeat(40) })] })
  assert.equal(reviewOfPull([newer, exact], pull()).run.id, 'exact')
  assert.equal(reviewForPull([newer, exact], pull()).run.id, 'exact')
  assert.equal(reviewOfPull([exact, newer], pull({ baseRef: { target: { oid: 'f'.repeat(40) } } })).run.id, 'newer', 'no run saw the tip: the newest at this code')
  const olderVersion = run({ id: 'old', created_at: '2026-11-05T09:00:00Z', items: [item({ head_sha: OLD })] })
  assert.equal(reviewOfPull([olderVersion, exact], pull()).run.id, 'exact', 'a newer review of another version does not hide the one at this code')
  assert.equal(reviewOfPull([olderVersion], pull()).run.id, 'old', 'with none at this code the newest earlier one is read (the machine then calls it earlier)')
  assert.equal(reviewForPull([olderVersion], pull()), null)
  assert.equal(reviewForRecord([olderVersion, exact], { repo: 'O/R', number: 7 }).run.id, 'old', 'a saved record has no version: its newest review')
  assert.equal(reviewOfPull([], pull()), null)
})

// ---- A verdict that reached GitHub settles the findings, whichever it was.

test('a posted verdict of any kind settles findings: changes requested, a comment or an approval', () => {
  const posted = event => item({ verdict_proposal: { state: 'posted', event, head_sha: HEAD } })
  for (const [event, label] of [['REQUEST_CHANGES', 'Changes requested'], ['COMMENT', 'Review posted'], ['APPROVE', 'Review posted']]) {
    const reading = reviewReading(run(), posted(event))
    assert.deepEqual([reading.label, reading.settled, reading.turn], [label, true, 'author'], event)
    assert.equal(frameState({ run: run(), item: posted(event) }), 'idle', event)
  }
  // A verdict that is only proposed, or was refused before GitHub, settles nothing.
  for (const state of ['proposed', 'not_dispatched']) assert.equal(reviewReading(run(), item({ verdict_proposal: { state, event: 'COMMENT' } })).settled, false, state)
})

// ---- A list that is cut says so.

const listOf = (count, extra = {}) => ({ view: 'summary', runs: Array.from({ length: count }, (_, index) => ({ id: `run-${index}`, items: [] })), ...extra })
function serve(t, answers) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url))
    return new Response(JSON.stringify(answers.shift()))
  })
  return calls
}

test('a list the platform pages says what is cut; an older platform’s full page is never taken for the whole', async t => {
  const calls = serve(t, [listOf(100, { has_more: true, next_cursor: 'c1' }), listOf(3, { has_more: false, next_cursor: null }), listOf(100), listOf(40)])
  const first = await loadReviewRuns('t', 80)
  assert.equal(first.cut, 'finished', 'every unfinished run is on the first page; older finished ones are not')
  assert.equal(first.runs.length, 100)
  const all = await loadReviewRuns('t', 80)
  assert.equal(all.cut, undefined, 'a last page cuts nothing')
  const old = await loadReviewRuns('t', 80)
  assert.equal(old.cut, 'any', 'an older platform stops at 100 without saying so: even an unfinished run may be missing')
  assert.equal((await loadReviewRuns('t', 80)).cut, undefined)
  assert.ok(calls.every(call => call.endsWith('review-runs?view=summary')), 'the first read is unchanged')
})

test('the next page is added once, never twice, and a refused cursor leaves the list as it was', async t => {
  const first = { ...listOf(2, { has_more: true, next_cursor: 'a b' }), cut: 'finished' }
  const calls = serve(t, [{ view: 'summary', runs: [{ id: 'run-1', items: [] }, { id: 'run-9', items: [] }], has_more: false, next_cursor: null }])
  const more = await moreReviewRuns('t', 80, first)
  assert.deepEqual(more.runs.map(entry => entry.id), ['run-0', 'run-1', 'run-9'])
  assert.deepEqual([more.has_more, more.cut], [false, undefined])
  assert.equal(more.runs.find(entry => entry.id === 'run-9').summary_only, true, 'a short run is marked so its documents are read first')
  assert.match(calls[0], /review-runs\?view=summary&cursor=a%20b$/)
  assert.equal(await moreReviewRuns('t', 80, more), more, 'nothing further: the same list')
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ detail: 'Invalid cursor' }), { status: 400 }))
  await assert.rejects(moreReviewRuns('t', 80, first), /Invalid cursor/)
})

// ---- The same step wears the same name on the PR page, the Actions menu and the Review tab.

test('after a review that did not finish, the step that starts another is called Review again everywhere the decision shows', async () => {
  const { standingFor } = await import('../pr-standing.js')
  const { mergeCopy } = await import('../action-copy.js')
  const runs = [run({ items: [blocked()] })]
  const title = (pr, id) => standingFor({ pr, login: 'alex', runs }).actions.find(action => action.id === id).title
  assert.equal(title(pull(), 'review'), 'Review again')
  assert.equal(title(mine(), 'check_my_pr'), 'Review again')
  assert.equal(standingFor({ pr: pull(), login: 'alex', runs: [run({ items: [item()] })] }).actions.find(action => action.id === 'review').title, 'Review again', 'findings: as before')
  assert.equal(standingFor({ pr: pull(), login: 'alex' }).actions.find(action => action.id === 'review').title, 'Review', 'never reviewed: as before')
  assert.equal(standingFor({ pr: pull({ headRefOid: OLD }), login: 'alex', runs }).actions.find(action => action.id === 'review').title, 'Review', 'a review of another version is not this version’s')
  // The Merge sheet does not call the obstacle "problems".
  const fact = reviewItem => mergeCopy(pull({ repository: { nameWithOwner: 'o/r' } }), { status: { run: run(), item: reviewItem } }).facts.at(-1)
  assert.deepEqual(fact(blocked()), { tone: 'warn', text: 'Your agent’s review did not finish on this version' })
  assert.deepEqual(fact(item()), { tone: 'warn', text: 'Your agent’s review found problems on this version' })
  assert.equal(mergeCopy(pull(), { status: { run: run({ state: 'needs_you', execution_state: 'interrupted' }), item: item({ state: 'reviewing' }) } }).facts.at(-1).text, 'Your agent’s review did not finish on this version')
  assert.equal(mergeCopy(pull(), { status: { run: run({ state: 'running', execution_state: 'stopped' }), item: item({ state: 'reviewing' }) } }).facts.at(-1).text, 'No conflicts with main', 'a review you stopped says nothing')
})
