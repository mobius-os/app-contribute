import test from 'node:test'
import assert from 'node:assert/strict'

import {
  abandonPrepared,
  buildFeedSnapshot,
  cacheSourceSnapshot,
  loadFreshContributionRecord,
  loadFreshContributionRecords,
  loadLedger,
  normalizeAppSettings,
  normalizeCycleState,
  normalizeSourceSnapshotCache,
  restoreAbandoned,
} from '../storage.js'

test('selected action records use bounded fresh reads and deduplicate ids', async (t) => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const paths = []
  globalThis.window = {
    mobius: {
      storage: {
        getWithVersion: async (path) => {
          paths.push(path)
          const id = path.match(/contributions\/(.+)\.json$/)?.[1]
          return { value: id ? { id, status: 'prepared' } : null, version: 'v1' }
        },
      },
    },
  }

  const records = await loadFreshContributionRecords(['one', 'two', 'one', '../unsafe'])
  assert.deepEqual(records.map((record) => record.id), ['one', 'two'])
  assert.deepEqual(paths.sort(), [
    'contributions/one.json',
    'contributions/two.json',
  ])
})

test('a publishing decision rejects an offline cached record', async (t) => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  globalThis.window = {
    mobius: {
      storage: {
        getWithVersion: async () => ({
          value: { id: 'cached', status: 'prepared' },
          version: 'v1',
          offline: true,
        }),
      },
    },
  }

  assert.equal(await loadFreshContributionRecord('cached'), null)
})

test('concurrent ledger refreshes share one enumeration but later refreshes stay fresh', async (t) => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  let release
  let calls = 0
  globalThis.window = {
    mobius: {
      online: true,
      storage: {
        list: async () => {
          calls += 1
          if (calls === 1) await new Promise((resolve) => { release = resolve })
          return [{
            type: 'file',
            name: 'one.json',
            path: 'contributions/one.json',
            content: { id: 'one', status: 'prepared' },
          }]
        },
      },
    },
  }

  const first = loadLedger()
  const duplicate = loadLedger()
  assert.equal(first, duplicate)
  release()
  assert.deepEqual((await first).records.map((record) => record.id), ['one'])
  assert.equal(calls, 1)

  await loadLedger()
  assert.equal(calls, 2)
})

test('follow sent PRs defaults on without overriding a saved choice', () => {
  assert.equal(normalizeAppSettings(null).autopilot_default, true)
  assert.equal(normalizeAppSettings({}).autopilot_default, true)
  assert.equal(normalizeAppSettings({ autopilot_default: false }).autopilot_default, false)
})

test('ledger uses JSON content batched into the storage listing', async () => {
  const gets = []
  let listOptions = null
  globalThis.window = {
    mobius: {
      storage: {
        async list(_prefix, options) {
          listOptions = options
          return [
            { name: 'a.json', type: 'file', content: { id: 'a' } },
            { name: 'b.json', type: 'file', content: { id: 'b' } },
            { name: 'proposal.diff', type: 'file' },
          ]
        },
        async get(path) { gets.push(path); return null },
      },
    },
  }

  const result = await loadLedger()
  assert.deepEqual(listOptions, { includeContent: true })
  assert.deepEqual(result.records.map((record) => record.id).sort(), ['a', 'b'])
  assert.deepEqual(gets, [])
  assert.deepEqual(result.omitted, [])
})

test('legacy record mirrors stay out of the canonical ledger', async () => {
  globalThis.window = {
    mobius: {
      storage: {
        async list() {
          return [
            {
              name: 'review.record.json', type: 'file', content: {
                id: 'review', status: 'prepared', updated_at: '2026-08-04T12:00:00Z',
              },
            },
            {
              name: 'review.json', type: 'file', content: {
                id: 'review', status: 'abandoned', updated_at: '2026-08-11T12:00:00Z',
              },
            },
            {
              name: 'legacy-only.record.json', type: 'file', content: {
                id: 'legacy-only', status: 'prepared',
              },
            },
          ]
        },
      },
    },
  }

  const { records } = await loadLedger()
  assert.deepEqual(records.map(({ id, status, path }) => ({ id, status, path })), [
    {
      id: 'review', status: 'abandoned',
      path: 'contributions/review.json',
    },
  ])
})

test('ledger isolates entries without batched content without request fan-out', async () => {
  const gets = []
  globalThis.window = {
    mobius: {
      storage: {
        async list() {
          return [
            { name: 'batched.json', type: 'file', content: { id: 'batched' } },
            { name: 'legacy.json', type: 'file' },
          ]
        },
        async get(path) { gets.push(path); return { id: 'legacy' } },
      },
    },
  }

  const result = await loadLedger()
  assert.deepEqual(result.records.map((record) => record.id), ['batched'])
  assert.deepEqual(result.omitted, ['contributions/legacy.json'])
  assert.deepEqual(gets, [])
})

test('an offline empty mirror falls back to the assembled feed cache', async () => {
  globalThis.window = {
    mobius: {
      online: false,
      storage: {
        async list() { return [] },
        async get(path) {
          assert.equal(path, 'feed-cache.json')
          return { schema: 2, records: [{ id: 'cached' }] }
        },
      },
    },
  }

  assert.deepEqual(await loadLedger(), {
    records: [{ id: 'cached' }],
    fromCache: true,
    omitted: [],
  })
})

test('500 missing-content entries never become 500 fallback GETs', async () => {
  let gets = 0
  globalThis.window = {
    mobius: {
      storage: {
        async list() {
          return Array.from({ length: 500 }, (_, index) => ({
            name: `${index}.json`,
            path: `contributions/${index}.json`,
            type: 'file',
          }))
        },
        async get() { gets += 1; return null },
      },
    },
  }

  const result = await loadLedger()
  assert.equal(result.records.length, 0)
  assert.equal(result.omitted.length, 500)
  assert.equal(gets, 0)
})

test('dismissal uses the runtime CAS version and never blind-writes', async () => {
  const writes = []
  globalThis.window = {
    mobius: {
      online: true,
      storage: {
        async _getWithVersion(path, format) {
          assert.equal(path, 'contributions/safe.json')
          assert.equal(format, 'json')
          return { value: { id: 'safe', status: 'prepared' }, version: 'v7' }
        },
        async durableWrite(path, value, options) {
          writes.push({ path, value, options })
        },
      },
    },
  }

  const result = await abandonPrepared({ rec: { id: 'safe' } })
  assert.equal(result.ok.status, 'abandoned')
  assert.deepEqual(writes.map(({ path, value, options }) => ({
    path, status: value.status, options,
  })), [{
    path: 'contributions/safe.json',
    status: 'abandoned',
    options: { ifMatch: 'v7' },
  }])
})

test('dismissal retries one CAS conflict against the newly read record', async () => {
  let reads = 0
  let writes = 0
  globalThis.window = {
    mobius: {
      online: true,
      storage: {
        async _getWithVersion() {
          reads += 1
          return {
            value: { id: 'race', status: 'prepared', revision: reads },
            version: `v${reads}`,
          }
        },
        async durableWrite(_path, value, options) {
          writes += 1
          if (writes === 1) throw Object.assign(new Error('changed'), { code: 'conflict' })
          assert.equal(value.revision, 2)
          assert.deepEqual(options, { ifMatch: 'v2' })
        },
      },
    },
  }

  const result = await abandonPrepared({ rec: { id: 'race' } })
  assert.equal(result.ok.status, 'abandoned')
  assert.equal(reads, 2)
  assert.equal(writes, 2)
})

test('restore refuses to write when a CAS version is unavailable', async () => {
  let writes = 0
  globalThis.window = {
    mobius: {
      online: true,
      storage: {
        async _getWithVersion() {
          return { value: { id: 'unsafe', status: 'abandoned' }, version: null }
        },
        async durableWrite() { writes += 1 },
      },
    },
  }

  const result = await restoreAbandoned({ rec: { id: 'unsafe' } })
  assert.equal(result.error, 'Safe storage updates are unavailable.')
  assert.equal(writes, 0)
})


test('first-load snapshot keeps every current item and only recent history', () => {
  const current = [
    { id: 'prepared', status: 'prepared' },
    { id: 'landing', status: 'landing' },
    { id: 'open', status: 'open' },
    { id: 'attention', status: 'merged', needs_attention: true },
  ]
  const history = Array.from({ length: 40 }, (_, index) => ({
    id: `history-${index}`,
    status: 'merged',
    updated_at: new Date(2026, 0, index + 1).toISOString(),
  }))

  const snapshot = buildFeedSnapshot([...history, ...current])
  assert.deepEqual(snapshot.slice(0, 4).map((record) => record.id), [
    'prepared', 'landing', 'open', 'attention',
  ])
  assert.equal(snapshot.length, 28)
  assert.equal(snapshot[4].id, 'history-39')
  assert.equal(snapshot.at(-1).id, 'history-16')
})

test('first-load snapshot ignores malformed entries', () => {
  assert.deepEqual(buildFeedSnapshot([null, {}, { id: 'ok', status: 'draft' }]), [
    { id: 'ok', status: 'draft' },
  ])
})

test('project snapshot cache accepts only the current wrapped shape', () => {
  const snapshot = { platform: { dirty: true }, apps: [] }
  assert.equal(normalizeSourceSnapshotCache({ snapshot }), snapshot)
  assert.equal(normalizeSourceSnapshotCache(snapshot), null)
  assert.equal(normalizeSourceSnapshotCache([]), null)
  assert.equal(normalizeSourceSnapshotCache(null), null)
})

test('project snapshot writer emits the current wrapped shape', async (t) => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const writes = []
  globalThis.window = { mobius: { storage: {
    set: async (path, value) => { writes.push({ path, value }) },
  } } }
  const snapshot = { platform: { dirty: false }, apps: [] }

  assert.equal(await cacheSourceSnapshot(snapshot), true)
  assert.equal(writes[0].path, 'source-cache.json')
  assert.deepEqual(writes[0].value.snapshot, snapshot)
  assert.equal(await cacheSourceSnapshot([]), false)
})

test('cycle state keeps only a bounded conversation pointer', () => {
  assert.deepEqual(normalizeCycleState({
    chat_id: ' cycle-chat ',
    started_at: '2026-08-24T00:00:00Z',
    scope: 'contribute-task:current',
    secret: 'drop',
  }), {
    chat_id: 'cycle-chat',
    started_at: '2026-08-24T00:00:00Z',
    scope: 'contribute-task:current',
  })
  assert.equal(normalizeCycleState({ chat_id: '  ' }), null)
})
