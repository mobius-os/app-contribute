import assert from 'node:assert/strict'
import test from 'node:test'

import { holdCode } from '../card-asks.js'
import { uncertainPublication } from '../domain.js'
import { localHold } from '../inline-session.js'
import { sendBlocker } from '../send-readiness.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
// An update to a PR that already went out once: the platform keeps the first send's `pushed` stage and push sha.
const update = more => ({ type: 'pr', status: 'prepared', number: 5, plan: { action: 'pr_update', head_sha: HEAD },
  last_submit_stage: 'pushed', last_submit_error: 'This update changed since it was prepared. Nothing was pushed.', ...more })

test('a refused update whose first send pushed another version is not a send GitHub has not confirmed', () => {
  assert.equal(uncertainPublication(update({ last_submit_push_sha: OLD })), false)
})

test('a pushed stage with an error stays unconfirmed for the plan\'s own version, or when no version can be compared', () => {
  assert.equal(uncertainPublication(update({ last_submit_push_sha: HEAD })), true)
  assert.equal(uncertainPublication(update({ last_submit_push_sha: HEAD.toUpperCase() })), true, 'shas compare case-insensitively, as the platform compares them')
  assert.equal(uncertainPublication(update({})), true, 'no recorded sha cannot clear the doubt')
  assert.equal(uncertainPublication(update({ last_submit_push_sha: OLD, plan: { action: 'pr_update' } })), true, 'a plan with no head cannot either')
})

test('an unsettled stage or an unconfirmed code is unconfirmed whatever sha was pushed', () => {
  assert.equal(uncertainPublication(update({ last_submit_push_sha: OLD, last_submit_stage: 'push_ambiguous' })), true)
  assert.equal(uncertainPublication(update({ last_submit_push_sha: OLD, last_submit_error_code: 'update_unconfirmed' })), true)
})

test('a send still claimed is uncertain, and a relay or non-PR record never is', () => {
  assert.equal(uncertainPublication(update({ status: 'submitting', last_submit_push_sha: OLD })), true)
  assert.equal(uncertainPublication(update({ submission_mode: 'mobius-bot', last_submit_push_sha: HEAD })), false)
  assert.equal(uncertainPublication(update({ type: 'issue', last_submit_push_sha: HEAD })), false)
})

test('the card calls a refused update Not sent and asks for a fix, instead of "Checking GitHub" with no ask', () => {
  const refused = { ...update({ last_submit_push_sha: OLD }), id: 'r-1', quality_review: { state: 'all_clear', reviewed_head_sha: HEAD } }
  assert.equal(localHold(refused), 'Not sent')
  assert.equal(holdCode(refused), 'send_failed')
  assert.equal(sendBlocker(refused), 'The last send needs attention in Contribute.')
  // The same record whose last push IS the plan's version is still a send GitHub has not confirmed.
  const lost = { ...refused, last_submit_push_sha: HEAD }
  assert.equal(localHold(lost), 'Checking GitHub')
  assert.equal(holdCode(lost), '')
  assert.equal(sendBlocker(lost), 'GitHub has not confirmed the last send yet.')
})

