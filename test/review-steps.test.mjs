import assert from 'node:assert/strict'
import test from 'node:test'
import { STATES } from '../pr-machine.js'
import { reviewSteps, STEPS_LABEL } from '../review-steps.js'

const at = steps => steps.map(step => `${step.label}:${step.at}`)

test('a prepared fix waiting for Push puts your PR on the fix step, asking the question', () => {
  assert.deepEqual(at(reviewSteps({ role: 'author', state: 'to_confirm', coveredBy: 'repair' })),
    ['Answer feedback:passed', 'Check:passed', 'Fix ready: push?:current', 'Reviewers:ahead'])
})

test('a ready answer to feedback is the first step, and findings are the fix step', () => {
  assert.equal(reviewSteps({ role: 'author', state: 'to_confirm' }).find(step => step.at === 'current').label, 'Answer feedback')
  assert.equal(reviewSteps({ role: 'author', state: 'author.findings' }).find(step => step.at === 'current').label, 'Fix')
})

test('an agent job stands on the step its kind does', () => {
  assert.equal(reviewSteps({ role: 'author', state: 'working', jobKind: 'review' }).find(step => step.at === 'current').label, 'Check')
  assert.equal(reviewSteps({ role: 'author', state: 'working', jobKind: 'review_fix_merge' }).find(step => step.at === 'current').label, 'Fix')
})

test('someone else’s PR, a closed one, or a state with no step shows no strip rather than a guess', () => {
  assert.deepEqual(reviewSteps({ role: 'reviewer', state: 'reviewer.to_review' }), [])
  assert.deepEqual(reviewSteps({ role: 'author', state: 'merged' }), [])
  assert.deepEqual(reviewSteps({ role: 'author', state: 'working', jobKind: 'mystery' }), [])
  assert.deepEqual(reviewSteps(null), [])
})

test('Finish it for me checking its own pushed fix again stands on Check, not Fix', () => {
  const current = itemState => reviewSteps({ role: 'author', state: 'working', jobKind: 'review_fix_merge' }, { itemState }).find(step => step.at === 'current').label
  assert.equal(current('reviewing'), 'Check')
  assert.equal(current('repairing'), 'Fix')
})

test('a comment-only review keeps the strip on Reviewers instead of dropping it', () => {
  assert.deepEqual(at(reviewSteps({ role: 'author', state: 'author.commented' })),
    ['Answer feedback:passed', 'Check:passed', 'Fix:passed', 'Reviewers:current'])
})

test('every state of your own PR has a step, so the strip never vanishes while the PR is open', () => {
  const missing = Object.keys(STATES).filter(state => state.startsWith('author.') && !reviewSteps({ role: 'author', state }).length)
  assert.deepEqual(missing, [])
})

test('the strip is named, so it reads apart from the state line at the top of the page', () => {
  assert.equal(STEPS_LABEL, 'Your next steps')
})
