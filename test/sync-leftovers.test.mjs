// What a Sync leaves to settle: one compare-and-swap for every record change, the Open for review decision tied to the platform's rule, and the
// Desk's "there may be more" taken from GitHub's own answer. The stuck list of waiting-on.js stays exposed (see the last test).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { fetchIncomingReviews, fetchOwnPulls, searchCutOf } from '../api.js'
import { casWriteRecord, clearReconciliationHint } from '../storage.js'
import { writePullReceipt } from '../pull-receipt.js'
import { buildContributionRun } from '../run.js'
import { INCOMING_PAGE, incomingCutOf } from '../desk.js'

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const withWindow = (t, storage, online = true) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  globalThis.window = { mobius: { online, storage } }
}
const conflict = (extra = {}) => Object.assign(new Error('changed'), extra)

// ---- storage.js casWriteRecord is the one compare-and-swap; pull-receipt.js no longer carries a copy.
test('the receipt writer uses storage.js\'s compare-and-swap and has none of its own', () => {
  assert.equal(typeof casWriteRecord, 'function')
  const receipt = source('pull-receipt.js')
  assert.match(receipt, /import \{ casWriteRecord, lifecycleWriterOf, loadAppSettings \} from '\.\/storage\.js'/)
  assert.doesNotMatch(receipt, /durableWrite|versionedReader|ifMatch/, 'no second copy of the write')
})

test('the shared write never changes a record from a copy the runtime gave because it was offline, and keeps its retry on a 412', async (t) => {
  let writes = 0
  withWindow(t, { getWithVersion: async () => ({ value: { id: 'r', status: 'prepared', reconciliation_hint: { type: 'already_landed' } }, version: 'v1', offline: true }), durableWrite: async () => { writes += 1 } })
  assert.deepEqual(await clearReconciliationHint({ rec: { id: 'r' } }), { error: 'offline' })
  assert.equal(writes, 0, 'the offline copy is not the record')
  let reads = 0
  withWindow(t, {
    getWithVersion: async () => { reads += 1; return { value: { id: 'r', status: 'prepared', n: reads }, version: `v${reads}` } },
    durableWrite: async (path, value) => { writes += 1; if (writes === 1) throw conflict({ status: 412 }); return { durability: 'synced' } },
  })
  const result = await casWriteRecord({ rec: { id: 'r' }, change: current => ({ ...current, seen: current.n }) })
  assert.deepEqual([result.ok.seen, reads], [2, 2], 'a rejected write (412, with or without the code) reads again and changes the newer record')
})

test('a receipt for a PR whose record is gone or offline is reported, never thrown, through the shared write', async (t) => {
  withWindow(t, { getWithVersion: async () => ({ value: null, version: null }), durableWrite: async () => assert.fail('nothing to write') })
  assert.deepEqual(await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } }), { gone: true })
  withWindow(t, { getWithVersion: async () => ({ value: null, version: null, offline: true }), durableWrite: async () => assert.fail('nothing to write') })
  assert.deepEqual(await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } }), { error: 'offline' })
})

// ---- run.js: Open for review is a decision only for a draft the platform would open for review (ready-offer.js).
const HEAD = 'b'.repeat(40)
const draft = (id, extra = {}) => ({ id, type: 'pr', repo: 'o/r', status: 'draft', title: id, number: 7, url: 'https://github.com/o/r/pull/7', submission_mode: 'github',
  plan: { head_sha: HEAD, repo: 'o/r' }, quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, last_submit_push_sha: HEAD, last_submit_base_branch: 'main', ...extra })
const kindOf = (record, kind) => buildContributionRun({ records: [record] }).decisions.some(item => item.kind === kind)

test('a draft the platform would refuse is not offered as Open for review, and is an ordinary draft on GitHub', () => {
  assert.equal(kindOf(draft('ok'), 'mark_ready'), true, 'the platform\'s own conditions hold')
  for (const [name, change] of [['no check', { quality_review: undefined }], ['a check that found problems', { quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } }],
    ['a push of another version', { last_submit_push_sha: 'a'.repeat(40) }], ['no branch recorded', { last_submit_base_branch: '' }]]) {
    const record = draft(name, change)
    assert.equal(kindOf(record, 'mark_ready'), false, name)
    assert.equal(buildContributionRun({ records: [record] }).working.find(item => item.record?.id === name)?.kind, 'public', name)
  }
  assert.equal(kindOf({ id: 'sparse', type: 'pr', repo: 'o/r', status: 'draft', title: 'Sparse' }, 'mark_ready'), true, 'a record that does not name its version is left to the platform, as before')
})

// ---- api.js: the Desk's note says "more" from GitHub's own answer.
const pr = (number, repo = 'o/r') => ({ number, url: `https://github.com/${repo}/pull/${number}`, repository: { nameWithOwner: repo } })
async function readWith(data, read) {
  const original = globalThis.fetch
  let query = ''
  globalThis.fetch = async (url, options) => { query = JSON.parse(options.body).query; return { ok: true, json: async () => ({ data }) } }
  try { return { rows: await read('token'), query } } finally { globalThis.fetch = original }
}

test('the review requests and involved PRs are read with GitHub\'s own page answer, and the list stays a plain list', async () => {
  const { rows, query } = await readWith({ involved: { pageInfo: { hasNextPage: true }, nodes: [pr(1), pr(2)] }, requested: { pageInfo: { hasNextPage: false }, nodes: [pr(1)] } }, fetchIncomingReviews)
  assert.match(query, /involved: search\([^)]*\) \{ pageInfo \{ hasNextPage \}/)
  assert.match(query, /requested: search\([^)]*\) \{ pageInfo \{ hasNextPage \}/)
  assert.deepEqual(rows.pageInfo, { requested: { hasNextPage: false }, involved: { hasNextPage: true } })
  assert.deepEqual(rows.map(row => row.number), [1, 2])
  assert.deepEqual(JSON.parse(JSON.stringify(rows)).length, 2, 'the answer rides on the list without becoming a row')
  const own = await readWith({ authored: { pageInfo: { hasNextPage: true }, nodes: [pr(3)] }, requested: { nodes: [] } }, fetchOwnPulls)
  assert.deepEqual(own.rows.pageInfo, { requested: null, authored: { hasNextPage: true } })
})

test('"there may be more" is exact when GitHub said so, and a full page of 50 with nothing after it is not cut', () => {
  assert.equal(searchCutOf({ requested: { hasNextPage: true }, involved: { hasNextPage: true } }), 'requests', 'the review requests first, as the Desk words them')
  assert.equal(searchCutOf({ requested: { hasNextPage: false }, involved: { hasNextPage: true } }), 'involved')
  assert.equal(searchCutOf({ requested: { hasNextPage: false }, involved: { hasNextPage: false } }), '')
  assert.equal(searchCutOf(undefined), null, 'a read that carries no answer falls back to the page-size guess')
  assert.equal(searchCutOf({ requested: null, involved: null }), null)
  const fullPage = Array.from({ length: INCOMING_PAGE }, (_, index) => pr(index + 1))
  assert.equal(incomingCutOf(fullPage), 'involved', 'the guess the Desk made before and still makes without an answer')
  const app = source('index.jsx')
  assert.match(app, /setIncomingMore\(searchCutOf\(rows\.pageInfo\)\)/)
  assert.match(app, /\.\.\.\(incomingMore === null \? \{\} : \{ incomingCut: incomingMore \}\),/)
})

// ---- The stuck list is read by no screen yet: the quiet block under Needs you lists your own PRs that wait on reviewers, one row shape.
test('the stuck list of waiting-on.js is exposed and not shown: the Waiting on others block has one row shape, for your own PRs', () => {
  const block = source('ui/WaitingOnOthers.jsx')
  assert.match(block, /rows\.map\(\(\{ project, pr, decision, days \}\)/, 'a row is a PR with its project, decision and days')
  assert.doesNotMatch(block, /stuck/)
  const screens = ['index.jsx', 'ui/DeskViews.jsx', 'ui/SourceMap.jsx', 'ui/Desk.jsx'].map(source).join('\n')
  assert.doesNotMatch(screens, /waitingOnGroups|waiting-on\.js/)
})
