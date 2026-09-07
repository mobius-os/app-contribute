import assert from 'node:assert/strict'
import test from 'node:test'
import { contributionLabelOutcome } from '../labels.js'

test('prepared records show only the two reviewed labels without claiming application', () => {
  const outcome = contributionLabelOutcome({
    status: 'prepared',
    plan: { labels: [' bug ', '', 'area: ui', 'hidden-third'] },
  })

  assert.deepEqual(outcome.requested, ['bug', 'area: ui'])
  assert.deepEqual(outcome.applied, [])
  assert.equal(outcome.hasOutcome, false)
  assert.equal(outcome.needsAttention, false)
})

test('the visible pair is capped before duplicate folding like core submit', () => {
  const outcome = contributionLabelOutcome({
    status: 'prepared',
    plan: { labels: ['bug', 'BUG', 'area: ui'] },
  })

  assert.deepEqual(outcome.requested, ['bug'])
})

test('an invalid visible label cannot promote a hidden third label', () => {
  const outcome = contributionLabelOutcome({
    status: 'prepared',
    plan: { labels: ['x'.repeat(51), 'area: backend', 'area: ui'] },
  })

  assert.deepEqual(outcome.requested, ['area: backend'])
})

test('a fully applied published outcome is confirmed and needs no intervention', () => {
  const outcome = contributionLabelOutcome({
    status: 'open',
    plan: { labels: ['bug', 'area: ui'] },
    last_submit_labels_requested: ['bug', 'area: ui'],
    last_submit_labels_applied: ['bug', 'area: ui'],
  })

  assert.deepEqual(outcome.applied, ['bug', 'area: ui'])
  assert.deepEqual(outcome.missing, [])
  assert.deepEqual(outcome.unconfirmed, [])
  assert.equal(outcome.needsAttention, false)
})

test('a lookup timeout keeps every requested label visibly unconfirmed', () => {
  const note = 'Timed out while checking repository labels; the pull request is open without confirmed labels.'
  const outcome = contributionLabelOutcome({
    status: 'open',
    plan: { labels: ['bug', 'area: backend'] },
    last_submit_labels_requested: ['bug', 'area: backend'],
    last_submit_labels_applied: [],
    last_submit_labels_note: note,
  })

  assert.deepEqual(outcome.unconfirmed, ['bug', 'area: backend'])
  assert.deepEqual(outcome.missing, [])
  assert.equal(outcome.note, note)
  assert.equal(outcome.needsAttention, true)
})

test('partial success separates applied, unavailable, and unconfirmed labels', () => {
  const outcome = contributionLabelOutcome({
    status: 'open',
    last_submit_labels_requested: ['bug', 'area: ui'],
    last_submit_labels_applied: ['bug'],
    last_submit_labels_missing: ['area: ui'],
    last_submit_labels_note: 'Some reviewed labels no longer exist.',
  })

  assert.deepEqual(outcome.applied, ['bug'])
  assert.deepEqual(outcome.missing, ['area: ui'])
  assert.deepEqual(outcome.unconfirmed, [])
  assert.equal(outcome.needsAttention, true)
})

test('an apply permission failure does not misreport requested labels as missing', () => {
  const outcome = contributionLabelOutcome({
    status: 'open',
    last_submit_labels_requested: ['bug'],
    last_submit_labels_applied: [],
    last_submit_labels_missing: [],
    last_submit_labels_note: 'GitHub did not confirm these labels were applied; the pull request is still open.',
  })

  assert.deepEqual(outcome.missing, [])
  assert.deepEqual(outcome.unconfirmed, ['bug'])
  assert.equal(outcome.needsAttention, true)
})

test('legacy published records show reviewed labels without inventing an outcome', () => {
  const outcome = contributionLabelOutcome({
    status: 'merged',
    plan: { labels: ['enhancement', 'area: apps'] },
  })

  assert.deepEqual(outcome.requested, ['enhancement', 'area: apps'])
  assert.equal(outcome.published, true)
  assert.equal(outcome.hasOutcome, false)
  assert.equal(outcome.needsAttention, false)
})
