import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addressAllAction,
  contributionsNeedingAttention,
  blockedReviewCount,
  indexReviewStatus,
  partitionReviewUnits,
  reviewStateFor,
  summarizeReviewStatus,
} from '../review.js'

test('indexes only recognized review verdicts', () => {
  const indexed = indexReviewStatus({
    generated_at: '2026-07-15T02:00:00Z',
    records: [
      { id: 'good', state: 'ready', code: 'ready', message: 'Exact.' },
      { id: 'stale', state: 'needs_refresh', code: 'branch_moved', message: 'Moved.' },
      { id: 'future', state: 'maybe' },
      null,
    ],
  })
  assert.deepEqual(Object.keys(indexed.byId), ['good', 'stale'])
  assert.equal(indexed.checkedAt, '2026-07-15T02:00:00Z')
})

test('an unchecked retryable failure does not bounce a review into attention', () => {
  const state = reviewStateFor({
    id: 'old', status: 'prepared', last_submit_error: 'Branch changed.',
  }, { state: 'unavailable', byId: {} })
  assert.equal(state, null)
})

test('the failure message never overrides the verdict the platform gave', () => {
  // The platform reports upstream_conflict itself now, recomputed from the
  // branch. A message left by an earlier attempt describes a branch that may
  // already have been refreshed, so it must not outrank a fresh verdict.
  const ready = { state: 'ready', code: 'ready', message: 'Local checkout matches.' }
  const state = reviewStateFor({
    id: 'stale',
    status: 'prepared',
    last_submit_error: 'This PR no longer merges cleanly with upstream main.',
  }, { state: 'ready', byId: { stale: ready } })
  assert.deepEqual(state, ready)
})

test('a conflict the platform reports is passed through untouched', () => {
  const blocked = {
    state: 'needs_refresh',
    code: 'upstream_conflict',
    message: 'This no longer merges cleanly with the branch it targets.',
  }
  const state = reviewStateFor(
    { id: 'conflicted', status: 'prepared' },
    { state: 'ready', byId: { conflicted: blocked } },
  )
  assert.deepEqual(state, blocked)
})

test('a fresh ready verdict wins over retryable persisted submit failures', () => {
  for (const lastSubmitError of [
    'Could not inspect fork state. Try Send again.',
    'Could not submit this PR (500). Try Send again.',
  ]) {
    const ready = { state: 'ready', code: 'ready', message: 'Local checkout matches.' }
    const state = reviewStateFor({
      id: 'retryable', status: 'prepared', last_submit_error: lastSubmitError,
    }, { state: 'ready', byId: { retryable: ready } })
    assert.deepEqual(state, ready)
  }
})

test('summarizes ready, blocked, and unchecked reviews', () => {
  const records = [
    { id: 'a', status: 'prepared' },
    { id: 'b', status: 'prepared' },
    { id: 'c', status: 'prepared' },
    { id: 'open', status: 'open' },
  ]
  const review = indexReviewStatus({ records: [
    { id: 'a', state: 'ready' },
    { id: 'b', state: 'needs_refresh', message: 'Moved.' },
  ] })
  assert.deepEqual(summarizeReviewStatus(records, review), {
    total: 3, ready: 1, needsRefresh: 1, unchecked: 1,
  })
  assert.equal(blockedReviewCount(records, review), 1)
})

test('batch and feed share the same needs-attention partition', () => {
  const units = [
    {
      type: 'record', id: 'ready',
      record: { id: 'ready', status: 'prepared' },
      records: [{ id: 'ready', status: 'prepared' }],
    },
    {
      type: 'record', id: 'blocked',
      record: { id: 'blocked', status: 'prepared' },
      records: [{ id: 'blocked', status: 'prepared' }],
    },
    {
      type: 'stack', id: 'stack',
      records: [
        { id: 'stack-1', status: 'open' },
        { id: 'stack-2', status: 'prepared' },
      ],
    },
  ]
  const partition = partitionReviewUnits(units, {
    byId: {
      ready: { state: 'ready' },
      blocked: { state: 'needs_refresh' },
      'stack-2': { state: 'ready' },
    },
  })
  assert.deepEqual(partition.needsAttention.map((unit) => unit.id), ['blocked'])
  assert.deepEqual(partition.readyToSend.map((unit) => unit.id), ['ready', 'stack'])
})

test('address all collects active local and published blockers but not history', () => {
  const records = [
    {
      id: 'local', type: 'pr', status: 'prepared', repo: 'mobius-os/app-local',
      plan: { title: 'Refresh local change' },
    },
    {
      id: 'live', type: 'pr', status: 'open', repo: 'mobius-os/app-live',
      title: 'Fix live checks', url: 'https://github.com/mobius-os/app-live/pull/8',
      needs_attention: true,
      attention: { title: 'Checks failed', message: 'One test is red.' },
    },
    {
      id: 'history', type: 'pr', status: 'merged', title: 'Already merged',
      needs_attention: true,
    },
    {
      id: 'issue', type: 'issue', status: 'open', title: 'An issue',
      needs_attention: true,
    },
    { id: 'clean', type: 'pr', status: 'open', title: 'Clean PR' },
  ]
  const review = {
    byId: {
      local: {
        state: 'needs_refresh',
        message: 'The source branch moved.',
      },
    },
  }

  assert.deepEqual(
    contributionsNeedingAttention(records, review).map((rec) => rec.id),
    ['local', 'live'],
  )
  const action = addressAllAction(records, review)
  assert.equal(action.count, 2)
  assert.equal(action.autoSend, true)
  assert.match(action.draft, /Refresh local change — mobius-os\/app-local/)
  assert.match(action.draft, /The source branch moved\./)
  assert.match(action.draft, /Checks failed — One test is red\./)
  assert.match(action.draft, /Do not push, reply, publish, merge/)
  assert.doesNotMatch(action.draft, /Already merged|An issue|Clean PR/)
})
