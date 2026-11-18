// What the app's own record and settings writers do under the lifecycle machine: discarding an update
// (behind the `lifecycle_writer` setting), dismissing the "Looks already landed" hint and
// the settings file's checked write. A versioned store like the runtime's stands in for storage.
import assert from 'node:assert/strict'
import test from 'node:test'

import { newVector } from '../lifecycle-engine.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'
import { abandonPrepared, clearReconciliationHint, lifecycleWriterOf, loadAppSettings, restoreAbandoned, saveAppSettings, updateAppSettings } from '../storage.js'

const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict', status: 412 })

// Every write bumps the file's version; a conditional write against another version is a 412, and a
// blind `set` is a failure of the test.
function versionedStore(files, { beforeWrite } = {}) {
  const versions = new Map(Object.keys(files).map(path => [path, 1]))
  const writes = []
  const storage = {
    get: async path => structuredClone(files[path] ?? null),
    getWithVersion: async path => ({ value: structuredClone(files[path] ?? null), version: path in files ? String(versions.get(path)) : null }),
    set: async () => { throw new Error('a blind write') },
    durableWrite: async (path, value, options) => {
      await beforeWrite?.(path, writes.length)
      const stale = options?.ifMatch !== undefined ? options.ifMatch !== String(versions.get(path)) : path in files
      if (stale) throw conflict()
      files[path] = structuredClone(value)
      versions.set(path, (versions.get(path) || 0) + 1)
      writes.push({ path, value: structuredClone(value), options })
      return { durability: 'synced' }
    },
  }
  // Another view's write: it changes the file and moves its version on.
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

const PULL = { number: 1797, url: 'https://github.com/o/r/pull/1797' }
const SETTINGS = 'settings.json'
const update = (more = {}) => ({ id: 'upd', type: 'pr', status: 'prepared', ...PULL, plan: { action: 'pr_update', head_sha: 'b'.repeat(40) }, updated_at: '2026-11-17T00:00:00Z', ...more })
const fresh = (id = 'new') => ({ id, type: 'pr', status: 'prepared', plan: { action: 'pr', head_sha: 'b'.repeat(40) }, updated_at: '2026-11-17T00:00:00Z' })
const stored = record => ({ [`contributions/${record.id}.json`]: record })
const states = record => ({ publication: record.lifecycle.regions.publication.state, update: record.lifecycle.regions.update.state })

// ---- Discarding an update must not abandon a live PR.
test('in shadow mode (the setting absent), discarding a prepared update is written exactly as before', async (t) => {
  const store = useStorage(t, stored(update()))
  const result = await abandonPrepared({ rec: { id: 'upd' } })
  assert.equal(result.ok.status, 'abandoned', 'today\'s write, kept until the owner turns the engine on')
  assert.equal('lifecycle' in result.ok, false, 'shadow mode stores no lifecycle field')
  assert.deepEqual([result.ok.number, result.ok.url], [PULL.number, PULL.url])
  assert.deepEqual(store.writes.map(write => write.options), [{ ifMatch: '1' }])
})

test('in engine mode, discarding a prepared update returns the record to its public status and keeps its PR', async (t) => {
  const store = useStorage(t, { ...stored(update()), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'upd' } })
  assert.equal(result.ok.status, 'open', 'never abandoned: the PR is live')
  assert.deepEqual([result.ok.number, result.ok.url], [PULL.number, PULL.url])
  assert.deepEqual(states(result.ok), { publication: 'OPEN', update: 'NONE' })
  assert.equal(result.ok.lifecycle.history.at(-1).type, 'DISCARD_UPDATE')
  assert.equal(result.ok.lifecycle.history.at(-1).source, 'owner')
  const written = store.writes.filter(write => write.path.startsWith('contributions/'))
  assert.equal(written.length, 1, 'the lifecycle and the derived status are stored in the same write')
  assert.deepEqual(written[0].options, { ifMatch: '1' })
  assert.equal(written[0].value.status, 'open')
})

test('in engine mode, work that was never sent is still abandoned, with its lifecycle stored beside the word', async (t) => {
  useStorage(t, { ...stored(fresh()), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'new' } })
  assert.equal(result.ok.status, 'abandoned')
  assert.deepEqual(states(result.ok), { publication: 'ABANDONED', update: 'NONE' })
})

test('in engine mode, an update whose PR merged first is dropped without touching the merged PR', async (t) => {
  const lifecycle = newVector(TABLES, { publication: 'MERGED', update: 'STRANDED_UPDATE', followup: 'CLOSED_OUT' }, 1_000)
  useStorage(t, { ...stored(update({ status: 'merged', lifecycle })), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'upd' } })
  assert.equal(result.ok.status, 'merged')
  assert.deepEqual(states(result.ok), { publication: 'MERGED', update: 'NONE' })
})

// The job's question about a stranded update ("The update can no longer go out") is the owner's to answer; once the owner discards the update the
// job never reads this finished record again, so the discard must take the question with it. Other attention stays.
const request = { type: 'owner_request', key: 'owner_request:update:STRANDED_UPDATE:1000', title: 'The update can no longer go out' }
const strandedWith = (attention, extra = {}) => update({ status: 'merged', needs_attention: true, attention, ...extra,
  lifecycle: newVector(TABLES, { publication: 'MERGED', update: 'STRANDED_UPDATE', followup: 'CLOSED_OUT' }, 1_000) })

test('in engine mode, discarding a stranded update clears the owner request raised for it, in the same write', async (t) => {
  const store = useStorage(t, { ...stored(strandedWith(request)), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'upd' } })
  assert.deepEqual(states(result.ok), { publication: 'MERGED', update: 'NONE' })
  assert.deepEqual([result.ok.needs_attention, result.ok.attention], [false, null])
  assert.equal(store.writes.filter(write => write.path.startsWith('contributions/')).length, 1)
})

test('in engine mode, only the request raised for the region that moved is cleared; any other attention stays', async (t) => {
  const checks = { type: 'checks_failed', key: 'checks_failed:abc' }
  useStorage(t, { ...stored(strandedWith(checks)), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const kept = (await abandonPrepared({ rec: { id: 'upd' } })).ok
  assert.deepEqual([kept.needs_attention, kept.attention], [true, checks], 'GitHub\u2019s attention is not the discard\u2019s to clear')
  const elsewhere = { ...request, key: 'owner_request:publication:MERGED:1000' }
  useStorage(t, { ...stored(strandedWith(elsewhere)), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const other = (await abandonPrepared({ rec: { id: 'upd' } })).ok
  assert.equal(other.attention.key, 'owner_request:publication:MERGED:1000', 'a request about a region that still holds that state stays')
})

test('in engine mode, abandoning work that was never sent clears a request raised for its unconfirmed send', async (t) => {
  const vector = newVector(TABLES, { publication: 'NOT_CONFIRMED', update: 'NONE' }, 1_000)
  const asked = { ...fresh('new'), lifecycle: vector, needs_attention: true, attention: { ...request, key: 'owner_request:publication:NOT_CONFIRMED:1000' } }
  useStorage(t, { ...stored(asked), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'new' } })
  assert.deepEqual([result.ok.status, result.ok.needs_attention, result.ok.attention], ['abandoned', false, null])
})

test('in engine mode, a record the tables do not let the owner discard is not written', async (t) => {
  const store = useStorage(t, { ...stored(update({ status: 'submitting' })), [SETTINGS]: { lifecycle_writer: 'engine' } })
  const result = await abandonPrepared({ rec: { id: 'upd' } })
  assert.equal(result.conflict.status, 'submitting', 'reported as changed under the owner, like a stale tap today')
  assert.deepEqual(store.writes, [])
})

test('in engine mode, an offline or unwritable store never falls back to a blind write', async (t) => {
  useStorage(t, { ...stored(update()), [SETTINGS]: { lifecycle_writer: 'engine' } })
  delete globalThis.window.mobius.storage.durableWrite
  assert.deepEqual(await abandonPrepared({ rec: { id: 'upd' } }), { error: 'Safe storage updates are unavailable.' })
})

test('restoring a record that really was abandoned is unchanged in both modes', async (t) => {
  for (const settings of [{}, { lifecycle_writer: 'engine' }]) {
    const abandoned = { ...fresh('gone'), status: 'abandoned' }
    useStorage(t, { ...stored(abandoned), [SETTINGS]: settings })
    const result = await restoreAbandoned({ rec: { id: 'gone' } })
    assert.equal(result.ok.status, 'prepared', JSON.stringify(settings))
  }
})

test('the writer setting reads "engine" only when it says so', () => {
  assert.deepEqual([undefined, {}, { lifecycle_writer: 'shadow' }, { lifecycle_writer: 'ENGINE' }, { lifecycle_writer: 'engine' }].map(lifecycleWriterOf),
    ['shadow', 'shadow', 'shadow', 'shadow', 'engine'])
})

// ---- The hint is dismissed on its own.
const hinted = (more = {}) => ({ ...update({ plan: { action: 'pr' } }), ...more, reconciliation_hint: { type: 'already_landed', title: 'Looks already landed', main_sha: 'e'.repeat(40) } })

test('dismissing the hint clears it with a checked write and changes nothing else', async (t) => {
  const store = useStorage(t, stored(hinted()))
  const result = await clearReconciliationHint({ rec: { id: 'upd' } })
  assert.equal(result.ok.reconciliation_hint, null)
  const { reconciliation_hint: _gone, updated_at: _at, ...kept } = result.ok
  const { reconciliation_hint: _was, updated_at: _before, ...original } = hinted()
  assert.deepEqual(kept, original, 'status, plan and PR are untouched')
  assert.equal(result.ok.status, 'prepared')
  assert.deepEqual(store.writes.map(write => write.options), [{ ifMatch: '1' }])
})

test('a write that lands in between is kept, and the retry only clears the hint', async (t) => {
  let raced = false
  const store = useStorage(t, stored(hinted()), { beforeWrite: async () => {
    if (raced) return
    raced = true
    // The platform claims the record after the hint was read and before it was written.
    store.change('contributions/upd.json', record => ({ ...record, status: 'submitting' }))
  } })
  const result = await clearReconciliationHint({ rec: { id: 'upd' } })
  assert.equal(result.ok.reconciliation_hint, null)
  assert.equal(result.ok.status, 'submitting', 'the claim was not overwritten with the stale copy')
  assert.deepEqual(store.writes.map(write => write.options), [{ ifMatch: '2' }])
})

test('a record with no hint left is reported as changed and is not written', async (t) => {
  const store = useStorage(t, stored({ ...hinted(), reconciliation_hint: null }))
  const result = await clearReconciliationHint({ rec: { id: 'upd' } })
  assert.equal(result.conflict.status, 'prepared')
  assert.deepEqual(store.writes, [])
  const gone = useStorage(t, {})
  assert.deepEqual(await clearReconciliationHint({ rec: { id: 'upd' } }), { gone: true })
  assert.deepEqual(gone.writes, [])
})

// ---- Settings are never written blind.
test('a settings save is a checked write of the version it read', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } })
  const settings = await loadAppSettings()
  assert.equal(await saveAppSettings({ ...settings, ignored_reviews: { 'o/r#1@abc': { reason: 'out of scope' } } }), true)
  assert.deepEqual(store.writes.map(write => write.options), [{ ifMatch: '1' }])
  assert.deepEqual(store.files[SETTINGS].ignored_reviews, { 'o/r#1@abc': { reason: 'out of scope' } })
})

test('a save from another view that lands in between is kept; only what this save changed is replayed', async (t) => {
  let raced = false
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } }, { beforeWrite: async () => {
    if (raced) return
    raced = true
    // Another view saves "follow sent PRs: off" after this save read the file and before it wrote.
    store.change(SETTINGS, settings => ({ ...settings, autopilot_default: false }))
  } })
  const settings = await loadAppSettings()
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), true)
  assert.equal(store.files[SETTINGS].autopilot_default, false, 'the other view\'s save survives')
  assert.equal(store.files[SETTINGS].new_pr_stage, 'draft', 'and so does this one')
  assert.deepEqual(store.writes.map(write => write.options), [{ ifMatch: '2' }])
})

test('two saves built from the same read keep each other\'s changes', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, new_pr_stage: 'ready' } })
  const settings = await loadAppSettings()
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), true)
  assert.equal(await saveAppSettings({ ...settings, ignored_reviews: { 'o/r#1@abc': { reason: 'out of scope' } } }), true)
  assert.equal(store.files[SETTINGS].new_pr_stage, 'draft', 'the first save is not laid over by the second')
  assert.deepEqual(store.files[SETTINGS].ignored_reviews, { 'o/r#1@abc': { reason: 'out of scope' } })
})

test('a key the caller removed is removed from what the file holds now', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true, review_agent: { provider: 'claude' } } })
  const { review_agent: _replaced, ...without } = await loadAppSettings()
  assert.equal(await saveAppSettings(without), true)
  assert.equal('review_agent' in store.files[SETTINGS], false)
})

test('a file that keeps changing is given up on after a few tries, never overwritten blind', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true } }, { beforeWrite: async () => {
    store.change(SETTINGS, settings => ({ ...settings, churn: (settings.churn || 0) + 1 }))
  } })
  const settings = await loadAppSettings()
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), false)
  assert.deepEqual(store.writes, [])
  assert.equal('new_pr_stage' in store.files[SETTINGS], false)
})

test('nothing is written when the version cannot be read or the store cannot write conditionally', async (t) => {
  const store = useStorage(t, { [SETTINGS]: { autopilot_default: true } })
  const settings = await loadAppSettings()
  store.storage.getWithVersion = async () => ({ value: null, version: null, offline: true })
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), false, 'offline')
  store.storage.getWithVersion = async () => { throw new Error('unreachable') }
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), false, 'unreadable')
  delete store.storage.durableWrite
  assert.equal(await saveAppSettings({ ...settings, new_pr_stage: 'draft' }), false, 'no conditional write')
  assert.equal(await updateAppSettings(current => current), false)
  assert.deepEqual(store.files[SETTINGS], { autopilot_default: true })
})
