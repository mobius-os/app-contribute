// The desk's last-known copy: what is saved, what the next visit trusts, and what a review row keeps.
import assert from 'node:assert/strict'
import test from 'node:test'

import { loadDeskCopy, normalizeDeskCopy, saveDeskCopy, slimReviewRow } from '../desk-copy.js'
import { withOwnerPulls } from '../desk.js'

const chip = { label: 'Draft to send', tone: 'owner' }
const entry = (extra = {}) => ({
  id: 'o/r#7', at: 1700000000000, bucket: 'waiting', confirm: true, chips: [chip],
  item: { repo: 'o/r', number: 7, title: 'A PR', head_sha: 'a'.repeat(40), summary: 'a long finding'.repeat(500), verdict_proposal: { body: 'x'.repeat(5000) } },
  run: { id: 'r1', created_at: '2026-11-03T22:00:00Z', items: [{ summary: 'every document of the run' }], options: { review_prompt: 'y'.repeat(4000) } },
  pull: { state: 'OPEN', isDraft: false, author: { login: 'someone' }, reviewThreads: { nodes: [{ big: true }] }, labels: { nodes: [] } },
  decision: { state: 'reviewer.result_ready', turn: 'you', role: 'reviewer', next: 'verdict', label: 'Draft to send', actions: [{ id: 'merge' }], headline: 'x'.repeat(300) },
  ...extra,
})

test('a review row keeps what the desk and its rows read, and nothing of the run or the PR beyond that', () => {
  const row = slimReviewRow(entry())
  assert.deepEqual(row, {
    id: 'o/r#7', at: 1700000000000, bucket: 'waiting', confirm: true, chips: [chip],
    item: { repo: 'o/r', number: 7, title: 'A PR' },
    run: { created_at: '2026-11-03T22:00:00Z' },
    pull: { state: 'OPEN', isDraft: false, author: { login: 'someone' } },
    decision: { state: 'reviewer.result_ready', turn: 'you', role: 'reviewer', next: 'verdict', label: 'Draft to send' },
  })
  assert.ok(JSON.stringify(row).length < 600)
})

test('only a review whose standing was read is a last-known row', () => {
  for (const bucket of ['checking', 'unknown']) assert.equal(slimReviewRow(entry({ bucket })), null, bucket)
  assert.equal(slimReviewRow(entry({ run: undefined })), null, 'a Respond conversation is not a saved review')
  for (const bucket of ['waiting', 'running', 'stalled', 'done']) assert.equal(slimReviewRow(entry({ bucket })).bucket, bucket)
})

test('a copy is trusted only when it names its account, its last sync and both lists', () => {
  const copy = { schema: 1, login: 'owner', synced_at: '2026-11-13T07:00:00Z', incoming: [{ number: 1 }], repositories: { repositories: [{ nameWithOwner: 'o/r' }], hasNextPage: true }, review_rows: [] }
  assert.deepEqual(normalizeDeskCopy(copy), { login: 'owner', syncedAt: '2026-11-13T07:00:00Z', incoming: [{ number: 1 }], repositories: copy.repositories, reviewRows: [] })
  for (const broken of [null, {}, { ...copy, login: '' }, { ...copy, synced_at: undefined }, { ...copy, incoming: {} }, { ...copy, review_rows: null }]) assert.equal(normalizeDeskCopy(broken), null)
  assert.deepEqual(normalizeDeskCopy({ ...copy, repositories: undefined }).repositories, { repositories: [], hasNextPage: false })
})

test('the copy is written when it changed and not again while it has not', async () => {
  const writes = []
  globalThis.window = { mobius: { storage: { async set(path, value) { writes.push([path, value]) }, async get() { return writes.at(-1)?.[1] ?? null } } } }
  const copy = { login: 'owner', syncedAt: '2026-11-13T07:00:00Z', incoming: [], repositories: { repositories: [], hasNextPage: false }, reviewRows: [] }
  assert.equal(await saveDeskCopy(copy), true)
  assert.equal(await saveDeskCopy({ ...copy }), false, 'nothing moved, nothing written')
  assert.equal(await saveDeskCopy({ ...copy, syncedAt: '2026-11-13T08:00:00Z' }), true)
  assert.deepEqual(writes.map(([path]) => path), ['desk-cache.json', 'desk-cache.json'])
  assert.equal((await loadDeskCopy()).syncedAt, '2026-11-13T08:00:00Z')
})

test('a copy that cannot be read, or a runtime that cannot save one, is no failure', async () => {
  globalThis.window = { mobius: { storage: { get: async () => { throw new Error('offline') }, set: async () => { throw new Error('full') } } } }
  assert.equal(await loadDeskCopy(), null)
  assert.equal(await saveDeskCopy({ login: 'owner', syncedAt: 'x', incoming: [1], repositories: { repositories: [] }, reviewRows: [] }), false)
})

test('the first answer replaces the PRs that concern the owner and leaves every other as it was', () => {
  const pr = (number, extra = {}) => ({ number, author: { login: 'someone' }, ...extra })
  const saved = [pr(1, { reviewRequested: true }), pr(2, { author: { login: 'Owner' } }), pr(3), pr(4, { author: { login: 'owner' } })]
  const owned = [pr(1, { reviewRequested: true, title: 'fresh' }), pr(2, { author: { login: 'owner' }, title: 'fresh' })]
  const merged = withOwnerPulls(saved, owned, 'owner')
  assert.deepEqual(merged.map(item => item.number), [1, 2, 3], 'PR 4 was the owner\'s and is not in the fresh answer: it is gone')
  assert.deepEqual(merged.filter(item => item.title === 'fresh').map(item => item.number), [1, 2])
  assert.deepEqual(withOwnerPulls(undefined, owned, 'owner').map(item => item.number), [1, 2])
})
