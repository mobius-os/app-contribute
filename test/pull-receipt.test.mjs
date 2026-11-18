// The owner's own Merge, Close, Open for review or Back to draft is written to the PR's contribution record in the step that
// confirms it, instead of waiting for the job's next pass. Shadow stores what the job would store; the engine setting stores the engine's result.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { PR_FIELDS } from '../api.js'
import { RECEIPTS, baseIsDefaultOf, emptiedAttention, recordAfterReceipt, writePullReceipt } from '../pull-receipt.js'

const NOW = 1763460000
const ISO = new Date(NOW * 1000).toISOString()
const PR = { id: 'rec-1', type: 'pr', status: 'open', number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r', plan: { repo: 'o/r', action: 'pr' }, updated_at: '2026-11-17T00:00:00Z' }
const after = (record, state, options = {}) => recordAfterReceipt(record, { ok: true, state }, { now: NOW, iso: ISO, ...options })

// ---- Shadow: the word, and the attention, the job writes for the same fact.
test('in shadow mode, a confirmed merge stores "merged" the way the job would, and no lifecycle field', () => {
  const next = after(PR, 'merged')
  assert.equal(next.status, 'merged')
  assert.deepEqual([next.needs_attention, next.attention], [false, null])
  assert.equal(next.updated_at, ISO)
  assert.equal('lifecycle' in next, false, 'shadow mode stores no lifecycle field')
  assert.equal(PR.status, 'open', 'the screen\'s record is not changed in place')
})

test('in shadow mode, a confirmed close stores "closed"; Open for review stores "open"; Back to draft stores "draft"', () => {
  assert.equal(after(PR, 'closed').status, 'closed')
  assert.equal(after({ ...PR, status: 'draft' }, 'ready').status, 'open')
  assert.equal(after(PR, 'draft').status, 'draft')
})

test('in shadow mode, a finished PR loses the attention GitHub raised, as the job empties it', () => {
  const raised = { ...PR, needs_attention: true, attention: { type: 'checks_failed', key: 'k' }, waiting_attention: [{ type: 'merge_conflict' }], outside_activity: { at: 'x' } }
  const next = after(raised, 'merged')
  assert.deepEqual([next.needs_attention, next.attention, next.waiting_attention, next.outside_activity], [false, null, [], null])
  assert.deepEqual(emptiedAttention({ ...PR, needs_attention: false, attention: null }), {}, 'a quiet record stays quiet')
})

test('in shadow mode, where the job would not write, nothing is written', () => {
  assert.equal(after({ ...PR, status: 'merged' }, 'merged'), null, 'the word is already stored')
  assert.equal(after({ ...PR, status: 'prepared' }, 'merged'), null, 'the job does not poll an update waiting on a public PR in shadow mode')
  assert.equal(after({ ...PR, status: 'landing' }, 'ready'), null, 'a landing record is only settled by a finished PR')
  assert.equal(after({ ...PR, status: 'landing' }, 'merged').status, 'merged')
  assert.equal(after(PR, 'queued'), null, 'the job writes nothing for a queue entry: the PR is still open')
  assert.equal(after({ ...PR, url: 'https://example.com/x' }, 'merged'), null)
  assert.equal(after({ ...PR, type: 'comment' }, 'merged'), null)
  assert.equal(after(PR, 'requested'), null, 'a request for review changes no status')
  assert.deepEqual(Object.keys(RECEIPTS).sort(), ['closed', 'draft', 'merged', 'queued', 'ready'])
})

// ---- Engine: the engine's result, stored in the same write.
const ENGINE = { engine: true }

test('in engine mode, a confirmed merge raises MERGED as the owner\'s event and stores the lifecycle with the status it derives', () => {
  const next = after(PR, 'merged', ENGINE)
  assert.equal(next.status, 'merged')
  assert.equal(next.lifecycle.regions.publication.state, 'MERGED')
  const merged = next.lifecycle.history.find(entry => entry.type === 'MERGED' && entry.region === 'publication')
  assert.deepEqual([merged.source, merged.from, merged.to], ['owner', 'OPEN', 'MERGED'])
  assert.equal(next.updated_at, ISO)
})

test('in engine mode, a close, a queue entry, Open for review and Back to draft move the publication region', () => {
  assert.equal(after(PR, 'closed', ENGINE).lifecycle.regions.publication.state, 'CLOSED')
  assert.equal(after(PR, 'closed', ENGINE).status, 'closed')
  const queued = after(PR, 'queued', ENGINE)
  assert.deepEqual([queued.lifecycle.regions.publication.state, queued.status], ['QUEUED', 'open'])
  const draft = { ...PR, status: 'draft' }
  assert.equal(after(draft, 'ready', ENGINE).lifecycle.regions.publication.state, 'OPEN')
  assert.equal(after(PR, 'draft', ENGINE).lifecycle.regions.publication.state, 'DRAFT')
})

test('in engine mode, a state that does not accept the event stores nothing, and a stack member is merged into another branch', () => {
  assert.equal(after({ ...PR, status: 'merged' }, 'merged', ENGINE), null, 'already merged')
  assert.equal(after({ ...PR, status: 'prepared', number: undefined, url: undefined }, 'merged', ENGINE), null, 'not on GitHub')
  const member = { ...PR, plan: { repo: 'o/r', stack: { parent: 'p' } } }
  const next = after(member, 'merged', { ...ENGINE, baseRef: 'feature-parent' })
  assert.equal(next.lifecycle.regions.publication.state, 'MERGED_ELSEWHERE')
  assert.equal(next.status, 'merged')
  assert.equal(next.github_base_ref, 'feature-parent', 'the route watch reads this branch')
})

test('in engine mode, an owner request stands on a finished PR; what GitHub raised goes', () => {
  const asked = { ...PR, needs_attention: true, attention: { type: 'owner_request', key: 'q' } }
  const next = after(asked, 'closed', ENGINE)
  assert.equal(next.attention.type, 'owner_request')
  const raised = { ...PR, needs_attention: true, attention: { type: 'checks_failed', key: 'k' } }
  assert.deepEqual([after(raised, 'closed', ENGINE).needs_attention, after(raised, 'closed', ENGINE).attention], [false, null])
})

// ---- The one checked write.
function versionedStore(files, { beforeWrite } = {}) {
  const versions = new Map(Object.keys(files).map(path => [path, 1]))
  const writes = []
  const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict', status: 412 })
  const storage = {
    get: async path => structuredClone(files[path] ?? null),
    getWithVersion: async path => ({ value: structuredClone(files[path] ?? null), version: path in files ? String(versions.get(path)) : null }),
    set: async () => { throw new Error('a blind write') },
    durableWrite: async (path, value, options) => {
      await beforeWrite?.(path, writes.length)
      if (options?.ifMatch !== String(versions.get(path))) throw conflict()
      files[path] = structuredClone(value)
      versions.set(path, versions.get(path) + 1)
      writes.push({ path, value: structuredClone(value), options })
    },
  }
  const change = (path, edit) => { files[path] = edit(structuredClone(files[path])); versions.set(path, versions.get(path) + 1) }
  return { storage, writes, files, change }
}
const useStorage = (t, files, options) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  const store = versionedStore(files, options)
  globalThis.window = { mobius: { online: true, storage: store.storage } }
  return store
}
const PATH = 'contributions/rec-1.json'

test('the receipt is written with a compare-and-swap, once, and the stored record says merged', async (t) => {
  const store = useStorage(t, { [PATH]: PR })
  const result = await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged', mergeSha: 'abc' } })
  assert.equal(result.ok.status, 'merged')
  assert.deepEqual(store.writes.map(write => [write.path, write.options]), [[PATH, { ifMatch: '1' }]])
  assert.equal(store.files[PATH].status, 'merged')
})

test('a save from another writer between the read and the write is kept, and the receipt is applied on top of it', async (t) => {
  const store = useStorage(t, { [PATH]: PR }, { beforeWrite: (path, count) => { if (count === 0 && !store.raced) { store.raced = true; store.change(PATH, record => ({ ...record, title: 'renamed' })) } } })
  const result = await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'closed' } })
  assert.equal(result.ok.status, 'closed')
  assert.equal(store.files[PATH].title, 'renamed', 'the other writer\'s field survives')
})

test('the engine setting stores the lifecycle in the same write; a record the job already settled is not written again', async (t) => {
  const store = useStorage(t, { [PATH]: PR, 'settings.json': { lifecycle_writer: 'engine' } })
  const result = await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } })
  assert.equal(result.ok.lifecycle.regions.publication.state, 'MERGED')
  assert.equal(store.writes.length, 1)
  const again = await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } })
  assert.deepEqual(again, { unchanged: true })
  assert.equal(store.writes.length, 1)
})

test('a failing or missing record never throws, and says nothing was written', async (t) => {
  useStorage(t, {})
  assert.deepEqual(await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } }), { gone: true })
  assert.deepEqual(await writePullReceipt({ rec: null, receipt: { ok: true, state: 'merged' } }), { unchanged: true })
  assert.deepEqual(await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'requested' } }), { unchanged: true })
  globalThis.window = { mobius: { storage: {} } }
  assert.equal((await writePullReceipt({ rec: { id: 'rec-1' }, receipt: { ok: true, state: 'merged' } })).error, 'Safe storage updates are unavailable.')
})

// ---- The screens hand the confirmed receipt to the write.
const pulls = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')

test('the confirm sheet hands its outcome to onReceipt, and the app writes it to the PR\'s record and shows it', () => {
  assert.match(pulls, /onDone=\{outcome => \{[\s\S]*?onReceipt\?\.\(acting\.pr, outcome\)/)
  assert.match(app, /const onPullReceipt = useCallback\(async \(pr, receipt\) => \{[\s\S]*?writePullReceipt\(\{ rec: record, receipt, baseRef: pr\.baseRefName, baseIsDefault: baseIsDefaultOf\(pr\) \}\)[\s\S]*?applyRecordUpdates\(\{ \.\.\.written\.ok, path: record\.path \}\)/)
  assert.equal((app.match(/onReceipt=\{onPullReceipt\}/g) || []).length, 2, 'the project list and the PR page both pass it')
})

test('a receipt that finishes the PR marks its notice as still owed, so the job tells it once and closes out the grant', () => {
  const record = { id: 'r', type: 'pr', status: 'open', url: 'https://github.com/o/r/pull/1', number: 1 }
  for (const engine of [false, true]) {
    assert.equal(recordAfterReceipt(record, { state: 'merged' }, { engine }).merged_announced, false, `merged, engine ${engine}`)
    assert.equal(recordAfterReceipt(record, { state: 'closed' }, { engine }).closed_announced, false, `closed, engine ${engine}`)
  }
  const stackMember = { ...record, plan: { stack: { position: 2 } } }
  assert.equal('merged_announced' in recordAfterReceipt(stackMember, { state: 'merged' }, { engine: true }), false, 'a merge into a side branch is the route watch\'s to announce')
})

test('an in-app Merge or Close with an update still waiting strands the update and marks its notice as owed, so the job asks the owner once', () => {
  const waiting = { ...PR, status: 'prepared', plan: { repo: 'o/r', action: 'pr_update' } }
  for (const [state, marker] of [['merged', 'merged_announced'], ['closed', 'closed_announced']]) {
    const next = after(waiting, state, ENGINE)
    assert.equal(next.lifecycle.regions.update.state, 'STRANDED_UPDATE', state)
    assert.equal(next.stranded_announced, false, `${state}: the update's notice is owed`)
    assert.equal(next[marker], false, `${state}: the finish notice is owed too`)
  }
  const side = after(waiting, 'merged', { ...ENGINE, baseRef: 'release-2', baseIsDefault: false })
  assert.deepEqual([side.lifecycle.regions.update.state, side.stranded_announced], ['STRANDED_UPDATE', false], 'a merge into a side branch strands it as well')
  assert.equal('stranded_announced' in after(PR, 'merged', ENGINE), false, 'no update waiting: nothing owed')
  assert.equal('stranded_announced' in after(PR, 'closed', ENGINE), false)
  assert.equal('stranded_announced' in after({ ...waiting, status: 'open' }, 'merged'), false, 'shadow mode has no stranded state')
})

// ---- A merge into a branch that is not the repository's default one is not a shipped contribution.
test('the screen says whether the PR\u2019s base is the default branch from the PR read, and says nothing when it was not read', () => {
  const read = (base, name) => ({ baseRefName: base, repository: { nameWithOwner: 'o/r', ...(name === undefined ? {} : { defaultBranchRef: { name } }) } })
  assert.equal(baseIsDefaultOf(read('main', 'main')), true)
  assert.equal(baseIsDefaultOf(read('release-2', 'main')), false)
  for (const unread of [read('main'), read('main', null), read('', 'main'), { baseRefName: 'main' }, null, undefined]) assert.equal(baseIsDefaultOf(unread), null, JSON.stringify(unread))
  assert.match(PR_FIELDS, /repository \{[^}]*defaultBranchRef \{ name \}/, 'every PR read the screens share asks for the default branch')
})

test('in engine mode, an in-app Merge into a side branch is merged elsewhere and never owes the "shipped" notice; into the default branch it does', () => {
  const side = after(PR, 'merged', { ...ENGINE, baseRef: 'release-2', baseIsDefault: false })
  assert.equal(side.lifecycle.regions.publication.state, 'MERGED_ELSEWHERE')
  assert.deepEqual([side.status, side.github_base_ref, 'merged_announced' in side], ['merged', 'release-2', false])
  const home = after(PR, 'merged', { ...ENGINE, baseRef: 'main', baseIsDefault: true })
  assert.deepEqual([home.lifecycle.regions.publication.state, home.merged_announced], ['MERGED', false])
  assert.equal(after(PR, 'merged', { ...ENGINE, baseRef: 'main' }).lifecycle.regions.publication.state, 'MERGED', 'an unknown default branch keeps today\u2019s behaviour')
  const member = { ...PR, plan: { repo: 'o/r', stack: { parent: 'p' } } }
  assert.equal(after(member, 'merged', { ...ENGINE, baseRef: 'parent', baseIsDefault: true }).lifecycle.regions.publication.state, 'MERGED_ELSEWHERE', 'a stack member is never in the default branch')
})

test('in shadow mode, the word is written as before, but a merge into a side branch owes no notice (the job\u2019s "ships to everyone" would be untrue)', () => {
  const side = after(PR, 'merged', { baseIsDefault: false })
  assert.deepEqual([side.status, 'merged_announced' in side, 'lifecycle' in side], ['merged', false, false])
  assert.equal(after(PR, 'merged', { baseIsDefault: true }).merged_announced, false)
  assert.equal(after(PR, 'merged').merged_announced, false, 'unknown: today\u2019s behaviour')
  assert.equal(after(PR, 'closed', { baseIsDefault: false }).closed_announced, false, 'a close has no branch to ship to')
  assert.equal('merged_announced' in after({ ...PR, plan: { repo: 'o/r', stack: { parent: 'p' } } }, 'merged'), false, 'a stack member merges into its parent\u2019s branch')
})
