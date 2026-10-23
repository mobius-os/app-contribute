import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublished, publicationUnits, sendBlocker } from '../send-readiness.js'

const HEAD = 'a'.repeat(40)
const record = (id, extra = {}) => ({ id, type: 'pr', status: 'prepared', repo: 'o/r',
  plan: { action: 'pr', repo: 'o/r', head_sha: HEAD, branch: `fix/${id}`, ...extra.plan },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, ...extra.record })

test('one blocker order serves the workspace card and the chat card', () => {
  assert.equal(sendBlocker(record('a'), null), '')
  assert.match(sendBlocker(record('a'), null, { requireCheck: true }), /current source check/)
  assert.equal(sendBlocker(record('a'), { state: 'ready' }, { requireCheck: true }), '')
  assert.match(sendBlocker(record('a'), { state: 'needs_refresh' }), /source changed/)
  assert.match(sendBlocker(record('a', { record: { last_submit_error: 'x' } }), null), /last send/)
  assert.match(sendBlocker(record('a', { record: { quality_review: {} } }), null), /needs review first/)
  assert.match(sendBlocker(record('a', { record: { status: 'abandoned' } }), null), /dismissed/)
  assert.match(sendBlocker(undefined, null), /no longer in Contribute/)
})

test('records resolve to distinct publication units; a stack is one unit with its next phase', () => {
  const base = record('base', { plan: { branch: 'stack/s/01', stack: { id: 's', position: 1, total: 2, base_branch: 'main' } } })
  const top = record('top', { plan: { branch: 'stack/s/02', base_sha: HEAD, stack: { id: 's', position: 2, total: 2, base_branch: 'stack/s/01', parent_record_id: 'base' } } })
  const units = publicationUnits(['top', 'base', 'solo', 'gone'], [base, top, record('solo')], { byId: {} })
  assert.deepEqual(units.map(unit => unit.key), ['stack:s', 'record:solo', 'record:gone'])
  assert.deepEqual(units[0].ready.map(r => r.id), ['base', 'top'])
  assert.equal(units[2].reason, 'This contribution is no longer in Contribute.')
  const invalid = record('bad', { plan: { stack: { id: 's2' } } })
  assert.match(publicationUnits(['bad'], [invalid], {})[0].reason, /invalid layer metadata/)
})

test('published means an exact PR receipt, not just a public-looking status', () => {
  assert.equal(isPublished({ status: 'open', repo: 'o/r', number: 3, url: 'https://github.com/o/r/pull/3' }), true)
  assert.equal(isPublished({ status: 'open', repo: 'o/r', number: 3, url: 'https://github.com/o/other/pull/3' }), false)
  assert.equal(isPublished({ status: 'submitting', repo: 'o/r', number: 3, url: 'https://github.com/o/r/pull/3' }), false)
})
