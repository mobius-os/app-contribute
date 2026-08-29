import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupContributionUnits,
  preparedContributionUnits,
  publicContributionUnits,
  stackMeta,
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
  assert.equal(units[0].total, 3)
})

test('batch review keeps an already-public draft parent in the chain', () => {
  const records = [layer(1, 'draft'), layer(2), layer(3)]
  const units = preparedContributionUnits(records.slice(1), records)
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].records.map((rec) => rec.status), ['draft', 'prepared', 'prepared'])
  assert.equal(stackReadiness(units[0]).ok, true)
})

test('reviewed existing-PR stacks are updateable only as one uniform action', () => {
  const updating = [layer(1), layer(2), layer(3)].map((rec) => ({
    ...rec,
    plan: { ...rec.plan, action: 'pr_update' },
  }))
  assert.equal(stackReadiness(groupContributionUnits(updating)[0]).ok, true)
  updating[1] = { ...updating[1], plan: { ...updating[1].plan, action: 'pr' } }
  const mixed = stackReadiness(groupContributionUnits(updating)[0])
  assert.equal(mixed.ok, false)
  assert.match(mixed.message, /same pull-request action/)
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

test('public stacks stay grouped while GitHub owns their acceptance', () => {
  const records = [layer(1, 'open'), layer(2, 'open'), layer(3, 'open')]
  const units = publicContributionUnits(records, records)
  assert.equal(units.length, 1)
  assert.equal(units[0].type, 'stack')
  assert.deepEqual(units[0].records.map((rec) => rec.id), [
    'layer-1', 'layer-2', 'layer-3',
  ])
})

test('a persisted landing layer remains grouped for reconciliation', () => {
  const records = [layer(1, 'merged'), layer(2, 'landing'), layer(3, 'open')]
  const units = publicContributionUnits(records.slice(1), records)
  assert.equal(units.length, 1)
  assert.equal(units[0].type, 'stack')
  assert.deepEqual(units[0].records.map((rec) => rec.status), [
    'merged', 'landing', 'open',
  ])
})
