import assert from 'node:assert/strict'
import test from 'node:test'
import { compactTimeAgo } from '../domain.js'

const ago = seconds => new Date(Date.now() - seconds * 1000).toISOString()

test('the sync note reads time as one letter of unit: s, m, h, d, w', () => {
  const cases = [[1, 'just now'], [4, 'just now'], [5, '5s ago'], [59, '59s ago'], [60, '1m ago'], [3599, '59m ago'], [3600, '1h ago'], [86399, '23h ago'],
    [86400, '1d ago'], [6 * 86400, '6d ago'], [7 * 86400, '1w ago'], [29 * 86400, '4w ago']]
  for (const [seconds, text] of cases) assert.equal(compactTimeAgo(ago(seconds)), text, `${seconds}s`)
})

test('a month or more ago is a date, and a missing or unreadable time says nothing', () => {
  assert.match(compactTimeAgo(ago(45 * 86400)), /^on \d{1,2} \w+|^on \w+ \d{1,2}/)
  assert.equal(compactTimeAgo(''), '')
  assert.equal(compactTimeAgo('not a time'), '')
  assert.equal(compactTimeAgo(new Date(Date.now() + 60000).toISOString()), 'just now', 'a clock a little ahead is not in the future')
})
