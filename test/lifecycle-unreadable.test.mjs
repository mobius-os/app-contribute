// A stored `lifecycle` the machine cannot read is ignored, as the platform's reader ignores it: the record is read from its facts. The same cases
// run in test/test_lifecycle_unreadable.py, so the two readers cannot disagree about what is readable.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { regionsOf, storedVector, vectorOf } from '../lifecycle-record.js'

const { cases } = JSON.parse(readFileSync(new URL('./lifecycle-unreadable.cases.json', import.meta.url)))

test('a stored vector is kept only when every part of it can be read; anything else is read from the record\'s facts', () => {
  for (const item of cases) {
    const found = regionsOf(item.record, 100)
    assert.deepEqual({ publication: found.publication, update: found.update, flags: found.vector.attention.flags }, item.reads, item.name)
    assert.equal(storedVector(item.record) !== null, item.stored, `${item.name}: stored`)
  }
})

test('an unreadable vector never fails a screen, and the vector read from the facts is a whole one', () => {
  for (const item of cases.filter(entry => !entry.stored)) {
    const vector = vectorOf(item.record, 100)
    assert.deepEqual(Object.keys(vector.regions).sort(), ['followup', 'publication', 'update'], item.name)
    assert.equal(vector.history.at(-1).type, 'SEEDED', `${item.name}: seeded, not repaired`)
  }
})

test('a record with no lifecycle at all is read from its facts as before', () => {
  const found = regionsOf({ type: 'pr', status: 'prepared', plan: { action: 'pr' } }, 100)
  assert.deepEqual([found.publication, found.update], ['PREPARED', 'NONE'])
  assert.equal(storedVector({ type: 'pr' }), null)
})
