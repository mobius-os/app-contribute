import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCounts, checkGroups, checkRow, checkRows, countWords, durationWords, foldedRows, foldsAt, resultWord } from '../pull-checks.js'
import { checkSummary } from '../collaboration.js'
import { CHECK_RESULT_WORDS } from '../names.js'

const run = (id, name, extra = {}) => ({ id, name, status: 'completed', conclusion: 'success', started_at: '2026-11-12T10:00:00Z', completed_at: '2026-11-12T10:06:03Z', ...extra })
const status = (id, context, state) => ({ id, context, state, description: `${context} ${state}`, created_at: '2026-11-12T10:00:00Z', updated_at: '2026-11-12T10:02:00Z' })
const stateOf = item => checkRow(item).state

test('a check run is passed, skipped, failing or running by the same rule as the PR list\'s count', () => {
  const conclusions = ['success', 'skipped', 'neutral', 'failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required', 'stale']
  const expected = ['passed', 'skipped', 'skipped', 'failing', 'failing', 'failing', 'failing', 'failing', 'failing']
  assert.deepEqual(conclusions.map(conclusion => stateOf(run(1, 'x', { conclusion }))), expected)
  for (const status of ['in_progress', 'queued', 'waiting', 'requested', 'pending']) assert.equal(stateOf(run(1, 'x', { status, conclusion: null })), 'running', status)
})

test('the tab and the tab badge agree on what passes, fails and is still pending, for every state GitHub reports', () => {
  const rollup = state => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { totalCount: 1, checkRunCountsByState: [{ state, count: 1 }], statusContextCountsByState: [] } } } }] } })
  for (const conclusion of ['success', 'skipped', 'neutral', 'failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required', 'stale']) {
    const counts = checkCounts([checkRow(run(1, 'x', { conclusion }))])
    const badge = checkSummary(rollup(conclusion.toUpperCase()))
    assert.equal(counts.passing, badge.passed, `${conclusion} passes the same way`)
    assert.equal(counts.failing, badge.failed, `${conclusion} fails the same way`)
  }
})

test('a check with no settled result, or one this list does not know, is never counted as passed', () => {
  for (const item of [run(1, 'x', { conclusion: null }), run(2, 'x', { conclusion: 'something_new' }), run(3, 'x', { status: undefined, conclusion: undefined }), status(4, 'ci', 'expected')]) {
    assert.equal(stateOf(item), 'running', JSON.stringify(item))
    assert.equal(resultWord(checkRow(item)), 'Pending', 'it says it is not settled, not that it is running')
  }
  assert.equal(checkCounts([checkRow(run(1, 'x', { conclusion: null }))]).passing, 0)
})

test('a commit status is a row of its own: error and failure fail, pending runs, success passes, and its id never meets a check run\'s', () => {
  assert.deepEqual(['error', 'failure', 'pending', 'success'].map(state => stateOf(status(2, 'ci/build', state))), ['failing', 'failing', 'running', 'passed'])
  const rows = checkRows({ groups: [{ name: 'Check runs', items: [run(2, 'Tests')] }, { name: 'Commit statuses', items: [status(2, 'ci/build', 'success')] }] })
  assert.deepEqual(rows.map(row => row.key), ['run:2', 'status:2'])
  assert.equal(rows[1].name, 'ci/build', 'the context is its name')
  assert.equal(rows[1].detail, 'ci/build success', 'its description is its detail')
})

test('rows read GitHub\'s own result in words', () => {
  const word = conclusion => resultWord(checkRow(run(1, 'x', { conclusion })))
  assert.deepEqual(['success', 'failure', 'timed_out', 'cancelled', 'action_required', 'skipped', 'neutral'].map(word), ['Passed', 'Failed', 'Timed out', 'Cancelled', 'Needs action', 'Skipped', 'Neutral'])
  assert.equal(resultWord(checkRow(run(1, 'x', { status: 'in_progress', conclusion: null }))), 'Running')
  assert.equal(resultWord(checkRow(run(1, 'x', { status: 'queued', conclusion: null }))), 'Queued')
  assert.equal(resultWord(checkRow(status(1, 'ci', 'error'))), 'Failed')
  assert.ok(Object.values(CHECK_RESULT_WORDS).every(text => /^[A-Z]/.test(text)))
})

test('failing comes first, then running, passed and skipped, each in name order with numbers in order', () => {
  const rows = checkRows({ groups: [{ items: [
    run(1, 'backend-tests (10)'), run(2, 'e2e', { conclusion: 'skipped' }), run(3, 'upgrade-path', { status: 'in_progress', conclusion: null }),
    run(4, 'backend-tests (4)'), run(5, 'frontend-tests', { conclusion: 'failure' }), run(6, 'coverage', { conclusion: 'neutral' })] }] })
  assert.deepEqual(checkGroups(rows).map(group => [group.state, group.rows.map(row => row.name)]), [
    ['failing', ['frontend-tests']], ['running', ['upgrade-path']], ['passed', ['backend-tests (4)', 'backend-tests (10)']], ['skipped', ['coverage', 'e2e']]])
  assert.deepEqual(checkGroups(rows, 'passed').map(group => group.state), ['passed'], 'a filter shows only its own group')
  assert.deepEqual(checkGroups(rows, 'failing').map(group => group.rows.length), [1])
  assert.deepEqual(checkGroups([], 'all'), [], 'no checks, no groups')
})

test('the counts are the chips\' numbers, and passing is passed plus skipped', () => {
  const rows = checkRows({ groups: [{ items: [run(1, 'a'), run(2, 'b'), run(3, 'c', { conclusion: 'skipped' }), run(4, 'd', { status: 'queued', conclusion: null }), run(5, 'e', { conclusion: 'failure' })] }] })
  assert.deepEqual(checkCounts(rows), { all: 5, failing: 1, running: 1, passed: 2, skipped: 1, passing: 3 })
  assert.equal(countWords(checkCounts(rows)), '1 failing · 1 running · 2 passed · 1 skipped')
  assert.equal(countWords({ all: 19, failing: 0, running: 1, passed: 12, skipped: 6 }), '1 running · 12 passed · 6 skipped', 'a state with no checks is left out')
  assert.equal(countWords(checkCounts([])), '', 'no checks, no words')
})

test('how long a check took: its start to its end, never for a check still going or one that was skipped', () => {
  assert.equal(checkRow(run(1, 'x')).duration, 363000)
  assert.equal(checkRow(run(1, 'x', { status: 'in_progress', conclusion: null, completed_at: null })).duration, null)
  assert.equal(checkRow(run(1, 'x', { conclusion: 'skipped' })).duration, null, 'a skipped check took nothing')
  assert.equal(checkRow(run(1, 'x', { started_at: null })).duration, null)
  assert.equal(checkRow(run(1, 'x', { completed_at: '2026-11-12T09:00:00Z' })).duration, null, 'an end before the start is not a duration')
  assert.equal(checkRow(status(1, 'ci', 'success')).duration, null, 'a commit status has no run time')
})

test('a row says when a running check started, how long a finished one took, or when GitHub last reported it, and never for a skipped or queued one', () => {
  const when = item => checkRow(item).when
  assert.deepEqual(when(run(1, 'x', { status: 'in_progress', conclusion: null })), { at: '2026-11-12T10:00:00Z', prefix: 'started ' })
  assert.equal(when(run(1, 'x', { status: 'queued', conclusion: null })), null)
  assert.equal(when(run(1, 'x')), null, 'a check that took 6m 03s says that, not when it ended')
  assert.equal(when(run(1, 'x', { conclusion: 'skipped' })), null)
  assert.deepEqual(when(status(1, 'ci', 'success')), { at: '2026-11-12T10:02:00Z', prefix: '' }, 'a commit status says when it was last reported')
  assert.equal(when(status(1, 'ci', 'pending')), null)
})

test('durations read short: 48s, 6m 03s, 1h 02m', () => {
  assert.deepEqual([0, 48000, 59600, 60000, 363000, 3599000, 3720000, 7380000].map(durationWords), ['0s', '48s', '1m 00s', '1m 00s', '6m 03s', '59m 59s', '1h 02m', '2h 03m'])
})

test('a long passed or skipped group folds to its first three rows; failing and running never fold, and one hidden row is not worth a button', () => {
  const group = (state, count) => ({ state, rows: Array.from({ length: count }, (_, index) => ({ name: `c${index}` })) })
  assert.equal(foldedRows(group('passed', 12), false).length, 3)
  assert.equal(foldedRows(group('passed', 12), true).length, 12)
  assert.equal(foldedRows(group('skipped', 5), false).length, 3)
  assert.equal(foldedRows(group('passed', 4), false).length, 4, 'four rows show, a fold would hide one')
  assert.equal(foldedRows(group('failing', 12), false).length, 12)
  assert.equal(foldedRows(group('running', 9), false).length, 9)
  assert.deepEqual([foldsAt('passed', 12), foldsAt('passed', 4), foldsAt('failing', 12)], [true, false, false])
})

test('a reason, a link and a name come through; an unnamed check says so', () => {
  const row = checkRow(run(7, '', { name: undefined, conclusion: 'failure', details_url: 'https://github.com/o/r/runs/7', output: { title: 'Process completed with exit code 1.' }, why: { steps: ['Run unit tests'], annotations: [] } }))
  assert.equal(row.name, 'Unnamed check')
  assert.equal(row.link, 'https://github.com/o/r/runs/7')
  assert.equal(row.detail, 'Process completed with exit code 1.')
  assert.deepEqual(row.why.steps, ['Run unit tests'])
  assert.equal(checkRow(status(1, 'ci', 'success')).link, '')
})
