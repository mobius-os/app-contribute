import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  factsOf, publicationOf, regionsOf, sendableNow, stateOf, strandedUpdate, tracked, updateWaiting, vectorOf, waitsOn,
} from '../lifecycle-record.js'

const { cases } = JSON.parse(readFileSync(new URL('./lifecycle-record.cases.json', import.meta.url)))

test('the facts of a record are the ones the Python reader gives', () => {
  for (const item of cases) assert.deepEqual(factsOf(item.record), item.facts, item.name)
})

test('only pull-request and issue records are tracked', () => {
  assert.equal(tracked({ type: 'pr' }), true)
  assert.equal(tracked({ type: 'issue' }), true)
  assert.equal(tracked({ type: 'issue_comment' }), false)
  assert.equal(tracked(null), false)
})

test('a record with no stored lifecycle gets one from its facts, and deadlines pass on load', () => {
  const open = { type: 'pr', status: 'open', number: 3 }
  assert.equal(stateOf(vectorOf(open, 100), 'publication'), 'OPEN')
  const sending = vectorOf({ type: 'pr', status: 'submitting' }, 100)
  assert.equal(stateOf(sending, 'publication'), 'SENDING')
  const later = vectorOf({ type: 'pr', status: 'submitting', lifecycle: sending }, 100 + 301)
  assert.equal(stateOf(later, 'publication'), 'UNCERTAIN')
})

test('a stored lifecycle follows the status word another writer stored', () => {
  const stored = vectorOf({ type: 'pr', status: 'open', number: 3 }, 100)
  const merged = vectorOf({ type: 'pr', status: 'merged', number: 3, lifecycle: stored }, 200)
  assert.equal(stateOf(merged, 'publication'), 'MERGED')
  assert.equal(vectorOf({ type: 'issue_comment', status: 'commented' }, 1), null)
  assert.equal(stateOf(null, 'publication'), null)
})

// ---- The selectors a screen asks instead of reading the status word.
const PULL = { number: 5, url: 'https://github.com/o/r/pull/5' }
const waitingUpdate = (more = {}) => ({ type: 'pr', status: 'prepared', ...PULL, plan: { action: 'pr_update', head_sha: 'b'.repeat(40) }, ...more })
const sendable = record => sendableNow(record, 100)

test('an update waiting on a public pull request is public and waiting, not "prepared and private"', () => {
  assert.deepEqual([publicationOf(waitingUpdate(), 100), updateWaiting(waitingUpdate(), 100)], ['OPEN', true])
  assert.equal(strandedUpdate(waitingUpdate(), 100), false)
  assert.deepEqual(waitsOn(waitingUpdate(), 100).map(({ region, state, waits }) => [region, state, waits]), [['update', 'PREPARED_UPDATE', 'owner']])
  const privateWork = { type: 'pr', status: 'prepared', plan: { action: 'pr' } }
  assert.deepEqual([publicationOf(privateWork, 100), updateWaiting(privateWork, 100)], ['PREPARED', false])
  assert.equal(regionsOf({ type: 'issue_comment', status: 'commented' }, 100), null)
  assert.deepEqual(waitsOn({ type: 'issue_comment' }, 100), [])
})

test('a record is sendable now only when its regions wait for the owner and nothing is held or failed', () => {
  assert.equal(sendable({ type: 'pr', status: 'prepared', plan: { action: 'pr' } }), true)
  assert.equal(sendable(waitingUpdate()), true)
  const stuck = [
    { needs_attention: true },
    { last_submit_error: 'The push was refused.' },
    { last_submit_stage: 'push_ambiguous' }, // a send that may already be public
    { status: 'submitting' },
    { status: 'draft', plan: { action: 'pr' } },
    { status: 'abandoned' },
  ]
  for (const more of stuck) assert.equal(sendable({ type: 'pr', status: 'prepared', plan: { action: 'pr' }, ...more }), false, JSON.stringify(more))
  assert.equal(sendable({ id: 'untracked', status: 'prepared' }), false, 'a record the machine does not track is never decided here')
})

test('a stored attention flag holds a record that the status word alone would call ready', () => {
  const stored = vectorOf({ type: 'pr', status: 'prepared', plan: { action: 'pr' } }, 100)
  const flagged = { ...stored, attention: { flags: ['checks_failed'] } }
  assert.equal(sendable({ type: 'pr', status: 'prepared', plan: { action: 'pr' }, lifecycle: stored }), true)
  assert.equal(sendable({ type: 'pr', status: 'prepared', plan: { action: 'pr' }, lifecycle: flagged }), false)
})

test('a refused update is a refusal, not a lost send, once the pushed version is not the plan\'s', () => {
  const refused = (pushed) => waitingUpdate({ last_submit_stage: 'pushed', last_submit_error: 'Nothing was pushed.', ...(pushed ? { last_submit_push_sha: pushed } : {}) })
  assert.equal(stateOf(vectorOf(refused('a'.repeat(40)), 100), 'update'), 'PREPARED_UPDATE')
  assert.equal(stateOf(vectorOf(refused('b'.repeat(40)), 100), 'update'), 'UPDATE_UNCERTAIN', 'the push of this very version may be public')
  assert.equal(stateOf(vectorOf(refused(''), 100), 'update'), 'UPDATE_UNCERTAIN', 'no recorded sha cannot clear the doubt')
})

test('a record an older app abandoned while its update was waiting on a live PR reads as that live PR', () => {
  const stored = vectorOf(waitingUpdate(), 100)
  const abandoned = vectorOf({ ...waitingUpdate({ status: 'abandoned' }), lifecycle: stored }, 200)
  assert.deepEqual([stateOf(abandoned, 'publication'), stateOf(abandoned, 'update')], ['OPEN', 'NONE'])
  assert.equal(publicationOf({ ...waitingUpdate({ status: 'abandoned' }), lifecycle: stored }, 200), 'OPEN')
  const never = vectorOf({ type: 'pr', status: 'abandoned', plan: { action: 'pr' } }, 200)
  assert.equal(stateOf(never, 'publication'), 'ABANDONED', 'a record that was never sent stays discarded')
})

// The shadow-mode discard stores no lifecycle, so the status word `abandoned` is all that is left on a
// record whose update was dropped while its PR stayed public. The tables seed that as the live PR.
test('an abandoned update with no stored lifecycle reads as the live PR it still is', () => {
  const abandoned = waitingUpdate({ status: 'abandoned' })
  assert.equal('lifecycle' in abandoned, false)
  assert.deepEqual([publicationOf(abandoned, 200), updateWaiting(abandoned, 200), strandedUpdate(abandoned, 200)], ['OPEN', false, false])
  assert.equal(sendable(abandoned), false, 'the dropped update is not sendable: it is just the open PR')
  // Without a PR to point at, or without an update plan, abandoned still means discarded before sending.
  const noPull = { type: 'pr', status: 'abandoned', plan: { action: 'pr_update' } }
  const never = { type: 'pr', status: 'abandoned', ...PULL, plan: { action: 'pr' } }
  assert.deepEqual([noPull, never].map(record => publicationOf(record, 200)), ['ABANDONED', 'ABANDONED'])
})
