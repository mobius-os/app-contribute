import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PROBLEM_HEADLINES,
  STATUS_NARRATION,
  applyLiveStates,
  buildRefreshQuery,
  isSubmissionResolutionSettled,
  mergeRecordUpdates,
  problemHeadline,
  reconcileLedgerSnapshot,
  resolveUncertainSubmission,
  resolveUncertainLanding,
  statusNarration,
  summarizeSubmissionResolutions,
} from '../domain.js'

test('record updates preserve enumerated paths while replacing stale fields', () => {
  const original = [
    { id: 'one', status: 'prepared', path: 'contributions/one.json' },
    { id: 'two', status: 'open', path: 'contributions/two.json' },
  ]
  const next = mergeRecordUpdates(original, [
    { id: 'one', status: 'abandoned', title: 'Updated' },
  ])

  assert.deepEqual(next, [
    {
      id: 'one',
      status: 'abandoned',
      title: 'Updated',
      path: 'contributions/one.json',
    },
    original[1],
  ])
})

test('a slow rescan cannot overwrite a newer submit result', () => {
  const current = [{
    id: 'one', status: 'open', updated_at: '2026-07-15T02:00:02Z',
    path: 'contributions/one.json',
  }]
  const staleSnapshot = [{
    id: 'one', status: 'submitting', updated_at: '2026-07-15T02:00:01Z',
    path: 'contributions/one.json',
  }, {
    id: 'two', status: 'prepared', updated_at: '2026-07-15T02:00:00Z',
  }]
  assert.deepEqual(reconcileLedgerSnapshot(current, staleSnapshot), [
    current[0], staleSnapshot[1],
  ])
})

test('equal timestamps keep a live GitHub status overlay', () => {
  const current = [{ id: 'one', status: 'merged', updated_at: '2026-07-15T02:00:00Z' }]
  const stored = [{ id: 'one', status: 'open', updated_at: '2026-07-15T02:00:00Z' }]
  assert.equal(reconcileLedgerSnapshot(current, stored)[0].status, 'merged')
})

test('a lost submit response is reconciled from the durable ledger', () => {
  const rec = { id: 'one', status: 'prepared' }
  assert.equal(resolveUncertainSubmission(rec, {
    fromCache: false,
    records: [{ id: 'one', status: 'open', url: 'https://github.com/x/y/pull/1' }],
  }).state, 'published')
  assert.equal(resolveUncertainSubmission(rec, {
    fromCache: false,
    records: [{ id: 'one', status: 'submitting' }],
  }).state, 'publishing')
  assert.equal(resolveUncertainSubmission(rec, {
    fromCache: false,
    records: [{ id: 'one', status: 'prepared', last_submit_error: 'Conflict.' }],
  }).state, 'blocked')
  assert.equal(resolveUncertainSubmission(rec, {
    fromCache: true,
    records: [{ id: 'one', status: 'prepared' }],
  }).state, 'unconfirmed')
  const unchanged = resolveUncertainSubmission(rec, {
    fromCache: false,
    records: [{ id: 'one', status: 'prepared' }],
  })
  assert.equal(unchanged.state, 'unchanged')
  assert.equal(isSubmissionResolutionSettled(unchanged), false)
  assert.equal(isSubmissionResolutionSettled({ state: 'publishing' }), true)
})

test('a lost stack landing response is reconciled from the durable ledger', () => {
  const records = [{ id: 'one' }, { id: 'two' }]
  assert.equal(resolveUncertainLanding(records, {
    fromCache: false,
    records: [{ id: 'one', status: 'merged' }, { id: 'two', status: 'merged' }],
  }).state, 'landed')
  assert.equal(resolveUncertainLanding(records, {
    fromCache: false,
    records: [{ id: 'one', status: 'landing' }, { id: 'two', status: 'landing' }],
  }).state, 'landing')
  assert.equal(resolveUncertainLanding(records, {
    fromCache: false,
    records: [
      { id: 'one', status: 'open', last_land_error: 'CI pending' },
      { id: 'two', status: 'open', last_land_error: 'CI pending' },
    ],
  }).state, 'blocked')
})

test('live PR refresh carries the CI rollup used by stack landing', () => {
  const records = [{
    id: 'one', type: 'pr', status: 'open',
    url: 'https://github.com/mobius-os/app-demo/pull/1',
  }]
  const request = buildRefreshQuery(records)
  assert.match(request.query, /statusCheckRollup \{ state \}/)
  const next = applyLiveStates(records, request.aliases, {
    r0: {
      __typename: 'PullRequest', state: 'OPEN', isDraft: false,
      statusCheckRollup: { state: 'SUCCESS' },
    },
  })
  assert.equal(next[0].live_checks_state, 'SUCCESS')
})

test('submitting stays publishing until every reconciled pull request is durable', () => {
  assert.deepEqual(summarizeSubmissionResolutions([
    { state: 'publishing' },
  ]), {
    state: 'publishing', total: 1, published: 0, publishing: 1, blocked: 0,
  })
  assert.deepEqual(summarizeSubmissionResolutions([
    { state: 'published' },
    { state: 'publishing' },
  ]), {
    state: 'publishing', total: 2, published: 1, publishing: 1, blocked: 0,
  })
  assert.equal(summarizeSubmissionResolutions([
    { state: 'published' },
    { state: 'published' },
  ]).state, 'published')
})

test('status narration leads each lifecycle state with human copy', () => {
  assert.equal(statusNarration({ status: 'prepared' }), 'Waiting for your OK')
  assert.equal(
    statusNarration({ status: 'submitting' }),
    'Publishing — this can take up to a minute',
  )
  assert.equal(
    statusNarration({ status: 'open' }),
    'Sent — maintainers will review it; this can take days',
  )
  assert.equal(statusNarration({ status: 'closed' }), 'Not merged — tap to see why')
  // Every narration key resolves through the helper and stays calm (no shout).
  for (const [status, copy] of Object.entries(STATUS_NARRATION)) {
    assert.equal(statusNarration({ status }), copy)
    assert.ok(copy.length > 0 && !copy.includes('!'))
  }
})

test('an attention record defers to its callout, and unknown states omit the line', () => {
  // needs_attention wins: the attention callout owns that state's copy.
  assert.equal(statusNarration({ status: 'open', needs_attention: true }), '')
  assert.equal(statusNarration({ status: 'no_such_state' }), '')
  assert.equal(statusNarration(null), '')
})

test('problem codes map to short human headlines, unknown falls back to raw', () => {
  assert.equal(
    problemHeadline('branch_moved'),
    'This changed since you reviewed it — ask your agent to refresh it',
  )
  assert.equal(
    problemHeadline('working_changes'),
    'Unsaved local edits are in the way — your agent can tidy them up',
  )
  assert.equal(
    problemHeadline('invalid_checkout'),
    'The prepared files can no longer be verified — your agent can restage it',
  )
  assert.equal(
    problemHeadline('review_unavailable'),
    'This review could not be verified — ask your agent to check it',
  )
  // The map's keys are exactly the backend's _review_status_problem codes
  // (routes/github.py) — an invented key is dead copy, a missing real code
  // silently drops its friendly headline.
  assert.deepEqual(Object.keys(PROBLEM_HEADLINES).sort(), [
    'branch_moved', 'diff_mismatch', 'invalid_ancestry', 'invalid_checkout',
    'invalid_plan', 'invalid_stack', 'missing_checkout', 'missing_coauthor',
    'missing_diff', 'missing_diff_hash', 'parent_merged', 'review_changed',
    'review_unavailable', 'upstream_conflict', 'working_changes',
  ])
  // Unknown / empty / non-string codes return '' so the caller shows the raw
  // backend message unchanged (lenient read).
  assert.equal(problemHeadline('brand_new_backend_code'), '')
  assert.equal(problemHeadline(''), '')
  assert.equal(problemHeadline(undefined), '')
  // Every mapped headline is a non-empty, calm string.
  for (const headline of Object.values(PROBLEM_HEADLINES)) {
    assert.ok(headline.length > 0 && !headline.includes('!'))
  }
})
