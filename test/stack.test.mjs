import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupContributionUnits,
  preparedContributionUnits,
  publicContributionUnits,
  stackMeta,
  stackLandingReadiness,
  stackProgress,
  stackReadiness,
} from '../stack.js'

function layer(position, status = 'prepared') {
  return {
    id: `layer-${position}`,
    type: 'pr',
    repo: 'mobius-os/mobius',
    branch: `stack/chat-flow/0${position}`,
    status,
    updated_at: `2026-07-15T00:0${position}:00Z`,
    plan: {
      action: 'pr',
      repo: 'mobius-os/mobius',
      branch: `stack/chat-flow/0${position}`,
      base_sha: position === 1 ? 'base' : String(position - 1).repeat(40),
      head_sha: String(position).repeat(40),
      stack: {
        id: 'chat-flow', name: 'Chat flow', position, total: 3,
        base_branch: position === 1 ? 'main' : `stack/chat-flow/0${position - 1}`,
        parent_record_id: position === 1 ? '' : `layer-${position - 1}`,
      },
    },
  }
}

test('recognizes valid additive stack metadata', () => {
  assert.deepEqual(stackMeta(layer(2)), {
    id: 'chat-flow', name: 'Chat flow', position: 2, total: 3,
    baseBranch: 'stack/chat-flow/01', parentRecordId: 'layer-1',
  })
  assert.equal(stackMeta({ plan: {} }), null)
  assert.equal(stackMeta({ plan: { stack: { id: 'x', position: 1, total: 1 } } }), null)
})

test('groups and orders stack layers without swallowing standalone records', () => {
  const standalone = { id: 'solo', status: 'prepared' }
  const units = groupContributionUnits([layer(3), standalone, layer(1), layer(2)])
  assert.equal(units.length, 2)
  const stack = units.find((unit) => unit.type === 'stack')
  assert.deepEqual(stack.records.map((rec) => rec.id), ['layer-1', 'layer-2', 'layer-3'])
  assert.equal(units.find((unit) => unit.type === 'record').record, standalone)
})

test('a ready child keeps its already-open parent visible in batch review', () => {
  const records = [layer(1, 'open'), layer(2), layer(3)]
  const units = preparedContributionUnits(records.slice(1), records)
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].records.map((rec) => rec.status), ['open', 'prepared', 'prepared'])
  assert.deepEqual(stackProgress(units[0]), { ready: 2, open: 1, landing: 0, merged: 0, total: 3 })
})

test('batch review keeps an already-public draft parent in the chain', () => {
  const records = [layer(1, 'draft'), layer(2), layer(3)]
  const units = preparedContributionUnits(records.slice(1), records)
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].records.map((rec) => rec.status), ['draft', 'prepared', 'prepared'])
  assert.equal(stackReadiness(units[0]).ok, true)
})

test('incomplete chains stay reviewable but cannot be sent', () => {
  const records = [layer(1), layer(3)]
  const unit = groupContributionUnits(records)[0]
  const result = stackReadiness(unit)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'incomplete')
  assert.match(result.message, /2 of 3 layers/)
})

test('a private child after a merged parent requires a fresh review', () => {
  const unit = groupContributionUnits([layer(1, 'merged'), layer(2), layer(3)])[0]
  const result = stackReadiness(unit)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'refresh')
  assert.match(result.message, /parent PR has merged/i)
})

test('malformed stack intent never falls back to a standalone send card', () => {
  const malformed = {
    id: 'broken-layer',
    type: 'pr',
    status: 'prepared',
    plan: { action: 'pr', stack: { id: 'broken', total: 2 } },
  }
  const units = preparedContributionUnits([malformed], [malformed])
  assert.equal(units.length, 1)
  assert.equal(units[0].type, 'stack')
  assert.equal(stackReadiness(units[0]).ok, false)
})

test('public stacks stay grouped and land only after every CI rollup is green', () => {
  const records = [layer(1, 'open'), layer(2, 'open'), layer(3, 'open')]
    .map((rec) => ({ ...rec, live_checks_state: 'SUCCESS' }))
  const units = publicContributionUnits(records, records)
  assert.equal(units.length, 1)
  assert.equal(units[0].type, 'stack')
  assert.equal(stackLandingReadiness(units[0]).ok, true)

  records[1] = { ...records[1], live_checks_state: 'PENDING' }
  const waiting = publicContributionUnits(records, records)[0]
  assert.equal(stackLandingReadiness(waiting).code, 'pending')
})

test('an in-flight atomic landing cannot be started twice', () => {
  const records = [layer(1, 'open'), layer(2, 'landing'), layer(3, 'open')]
    .map((rec) => ({ ...rec, live_checks_state: 'SUCCESS' }))
  const unit = publicContributionUnits(records, records)[0]
  assert.equal(stackLandingReadiness(unit).code, 'landing')
  assert.deepEqual(stackProgress(unit), {
    ready: 0, open: 3, landing: 1, merged: 0, total: 3,
  })
})
