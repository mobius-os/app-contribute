// The repositories' last-known lists: what is saved, what the next visit trusts, and that a row reads the same from the copy.
import assert from 'node:assert/strict'
import test from 'node:test'

import { PR_FIELDS_STAMP } from '../api.js'
import { MAX_SAVED_LISTS, listCopyOf, listsToKeep, loadListCopy, normalizeListCopy, saveListCopy, slimPull } from '../repository-list-copy.js'
import { standingFor } from '../pr-standing.js'
import { fullPull } from './fake-lists.mjs'

const list = (repo, extra = {}) => ({ repo, syncedAt: '2026-11-13T07:00:00Z', openedAt: '', total: 1, hasNextPage: false, endCursor: null, pulls: [fullPull(repo, 1)], ...extra })
const review = (state, body, login = 'friend') => ({ state, body, submittedAt: '2026-11-03T10:00:00Z', author: { login, __typename: 'User' }, commit: { oid: 'a'.repeat(40) } })

// A copy as the app writes it (listCopyOf), so a test never repeats how it is stamped.
const written = async input => JSON.parse(JSON.stringify(listCopyOf({ login: 'owner', lists: [list('o/r')], ...input })))

test('a copy keeps each PR whole except the text of its latest reviews, which the list reads only as "has words"', () => {
  const long = 'A long review. '.repeat(400)
  const pr = fullPull('o/r', 1, { latestReviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [review('COMMENTED', long), review('APPROVED', ''), review('CHANGES_REQUESTED', '   ')] } })
  const slim = slimPull(pr)
  assert.deepEqual(slim.latestReviews.nodes.map(node => node.body), ['…', '', ''])
  assert.deepEqual({ ...slim, latestReviews: null }, { ...pr, latestReviews: null }, 'every other field is as read')
  assert.deepEqual(slim.latestReviews.nodes.map(({ body, ...rest }) => rest), pr.latestReviews.nodes.map(({ body, ...rest }) => rest))
  assert.ok(JSON.stringify(slim).length < JSON.stringify(pr).length / 3)
  assert.equal(slimPull(fullPull('o/r', 2, { latestReviews: undefined })).latestReviews, undefined, 'a PR without the list is left as it is')
})

test('a row decides the same from the copy of a PR as from the whole read, on every side of a review', () => {
  for (const nodes of [[], [review('COMMENTED', 'Please rename this.')], [review('COMMENTED', '')], [review('CHANGES_REQUESTED', 'No.')], [review('APPROVED', 'Looks good')]]) {
    const pr = fullPull('o/r', 1, { latestReviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes }, comments: { totalCount: 0, nodes: [] } })
    for (const login of ['owner', 'maker', 'friend']) {
      const decide = value => { const standing = standingFor({ pr: value, login }); return [standing.state, standing.turn, standing.label, standing.actions.map(action => action.id)] }
      assert.deepEqual(decide(slimPull(pr)), decide(pr), `${nodes.map(node => `${node.state}:${node.body}`)} as ${login}`)
    }
  }
})

test('a copy is trusted only when it names its account and its lists', async () => {
  const copy = await written({})
  assert.deepEqual(normalizeListCopy(copy).lists.map(item => item.repo), ['o/r'])
  assert.equal(normalizeListCopy(copy).login, 'owner')
  for (const broken of [null, {}, 'text', { ...copy, login: '' }, { ...copy, lists: {} }, { ...copy, lists: undefined }]) assert.equal(normalizeListCopy(broken), null)
})

test('only whole items of a copy are shown, so a damaged or older file never breaks a screen', async () => {
  const copy = await written({ lists: [list('o/r', { pulls: [fullPull('o/r', 1), fullPull('o/r', 3)] }), list('o/other')] })
  copy.lists[0].pulls.push({ number: 2 }, null, { ...fullPull('o/r', 4), titlesOnly: true })
  copy.lists[1].synced_at = 'not a moment'
  copy.lists.push({ repo: 'bad name', synced_at: '2026-11-13T07:00:00Z', pulls: [] }, { repo: 'o/third', synced_at: '2026-11-13T07:00:00Z', pulls: 'broken' }, 7)
  const read = normalizeListCopy(copy)
  assert.deepEqual(read.lists.map(item => item.repo), ['o/r'])
  assert.deepEqual(read.lists[0].pulls.map(pr => pr.number), [1, 3], 'a row with only its titles is no last-known row')
})

test('a copy whose PRs were read with other fields than this version asks for is not shown', async () => {
  const copy = await written({})
  assert.equal(copy.pr_fields, PR_FIELDS_STAMP, 'the stamp is part of the file, the same one the desk copy carries')
  assert.equal(normalizeListCopy({ ...copy, pr_fields: 'another version' }), null)
  assert.equal(normalizeListCopy({ ...copy, pr_fields: undefined }), null, 'a copy saved before the fields were recorded')
})

test('a saved list keeps its paging, so a repository of more than a page stays correct', async () => {
  const copy = await written({ lists: [list('o/big', { total: 120, hasNextPage: true, endCursor: 'c50', pulls: [fullPull('o/big', 1), fullPull('o/big', 2)] })] })
  const [read] = normalizeListCopy(copy).lists
  assert.deepEqual([read.total, read.hasNextPage, read.endCursor, read.pulls.length], [120, true, 'c50', 2])
  const noCursor = normalizeListCopy({ ...copy, lists: [{ ...copy.lists[0], end_cursor: null }] }).lists[0]
  assert.deepEqual([noCursor.hasNextPage, noCursor.endCursor], [false, null], 'a next page needs the cursor that opens it')
  const short = normalizeListCopy({ ...copy, lists: [{ ...copy.lists[0], total: 1, has_next_page: false }] }).lists[0]
  assert.equal(short.total, 2, 'the total is never below what the list holds')
})

test('the copy keeps the lists read last and no more than the file allows', async () => {
  const lists = Array.from({ length: MAX_SAVED_LISTS + 5 }, (_, index) => list(`o/r${index}`, { syncedAt: new Date(Date.UTC(2026, 10, 1, index)).toISOString() }))
  assert.deepEqual(listsToKeep(lists).map(item => item.repo), Array.from({ length: MAX_SAVED_LISTS }, (_, index) => `o/r${lists.length - 1 - index}`))
  assert.equal((await written({ lists })).lists.length, MAX_SAVED_LISTS)
})

test('the copy is saved as one file the next visit reads back', async () => {
  const writes = []
  globalThis.window = { mobius: { storage: { async set(path, value) { writes.push([path, value]) }, async get() { return writes.at(-1)?.[1] ?? null } } } }
  assert.equal(await saveListCopy(listCopyOf({ login: 'owner', lists: [list('o/r2', { syncedAt: '2026-11-13T08:00:00Z' })] })), true)
  assert.deepEqual(writes.map(([path]) => path), ['repository-lists.json'])
  assert.equal((await loadListCopy()).lists[0].syncedAt, '2026-11-13T08:00:00Z')
  const same = JSON.stringify(listCopyOf({ login: 'owner', lists: [list('o/r2', { syncedAt: '2026-11-13T08:00:00Z' })] }))
  assert.equal(same, JSON.stringify(writes[0][1]), 'what was written has one text, so a caller can tell whether anything moved')
})

test('a copy that cannot be read, or a runtime that cannot save one, is no failure', async () => {
  globalThis.window = { mobius: { storage: { get: async () => { throw new Error('offline') }, set: async () => { throw new Error('full') } } } }
  assert.equal(await loadListCopy(), null)
  assert.equal(await saveListCopy(listCopyOf({ login: 'owner', lists: [list('o/never')] })), false)
})
