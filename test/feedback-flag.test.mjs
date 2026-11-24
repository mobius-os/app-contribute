import assert from 'node:assert/strict'
import test from 'node:test'
import { decide } from '../pr-machine.js'
import { feedbackFlagOf } from '../feedback-flag.js'

const facts = (reviews, extra = {}) => ({ role: 'author', author: 'sam', head: 'h2', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE',
  reviews, openThreads: 0, myReview: null, job: null, result: null, outbox: null, readComplete: true, ...extra })
const review = (by, state, commit = 'h2') => ({ by, state, commit })
const saved = { type: 'changes_requested', url: 'https://github.com/o/r/pull/48#pullrequestreview-1' }
const flag = (reviews, extra, attention = saved) => feedbackFlagOf({ attention, decision: decide(facts(reviews, extra)) })

test('an approval of this version replaces the saved changes-requested flag with a green notice naming the approver', () => {
  // GitHub lists one standing opinion per person: Dana's approval has replaced their earlier request.
  const result = flag([review('dana', 'APPROVED')])
  assert.deepEqual([result.tone, result.label, result.note], ['clear', 'Review clear', 'dana approved this version.'])
})

test('a change request that still stands keeps the red flag and names who asked', () => {
  const result = flag([review('dana', 'CHANGES_REQUESTED')])
  assert.deepEqual([result.tone, result.note], ['blocker', 'dana asked for changes. Read the review under Comments.'])
})

test('one reviewer approving does not lift another reviewer’s standing request', () => {
  const result = flag([review('dana', 'CHANGES_REQUESTED'), review('lee', 'APPROVED')])
  assert.equal(result.tone, 'blocker')
  assert.match(result.note, /^dana asked for changes/)
})

test('a request on an older version still stands until the reviewer looks again', () => {
  assert.equal(flag([review('dana', 'CHANGES_REQUESTED', 'h1')]).tone, 'blocker')
})

test('a dismissed request that nobody approved leaves no flag', () => {
  assert.equal(flag([]), null)
  assert.equal(flag([review('dana', 'DISMISSED')]), null)
})

test('several approvers are named in one sentence', () => {
  const result = flag([review('dana', 'APPROVED'), review('lee', 'APPROVED')])
  assert.equal(result.note, 'dana and lee approved this version.')
})

test('reviews that could not be read leave the saved flag speaking: a warning is never hidden on a guess', () => {
  const result = flag([review('dana', 'APPROVED')], { readComplete: false })
  assert.deepEqual([result.tone, result.note], ['blocker', 'Not addressed yet. Read the review under Comments.'])
})

test('on someone else’s PR the machine does not speak for the saved flag', () => {
  assert.equal(flag([review('dana', 'APPROVED')], { role: 'reviewer' }).tone, 'blocker')
})

test('new feedback keeps its own flag, and an approving review or an all-clear run makes it green', () => {
  const attention = { type: 'github_activity', url: 'https://github.com/o/r/pull/48#issuecomment-2' }
  assert.equal(feedbackFlagOf({ attention, decision: null }).label, 'New feedback')
  assert.equal(feedbackFlagOf({ attention, decision: null, approvedInFeedback: true }).label, 'Review clear')
  assert.equal(feedbackFlagOf({ attention: null, decision: null }), null)
})
