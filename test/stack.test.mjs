import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupContributionUnits,
  preparedContributionUnits,
  stackMeta,
  stackProgress,
} from '../stack.js'

function layer(position, status = 'prepared') {
  return {
    id: `layer-${position}`,
    status,
    updated_at: `2026-07-15T00:0${position}:00Z`,
    plan: {
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
  assert.deepEqual(stackProgress(units[0]), { ready: 2, open: 1, merged: 0, total: 3 })
})

test('batch review never includes an unapproved draft sibling', () => {
  const records = [layer(1, 'draft'), layer(2), layer(3)]
  const units = preparedContributionUnits(records.slice(1), records)
  assert.equal(units.length, 1)
  assert.deepEqual(units[0].records.map((rec) => rec.status), ['prepared', 'prepared'])
})
