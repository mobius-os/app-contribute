// The ledger read at open: what the desk shows is read, settled history that did not move is not.
import assert from 'node:assert/strict'
import test from 'node:test'

import { buildFeedSnapshot, cacheFeed, listingStamp, loadLedger } from '../storage.js'

const DAY = 24 * 60 * 60 * 1000
const stamp = (name, at = '2026-11-01T10:00:00.000000Z', size = 100) => ({ name, path: `contributions/${name}`, type: 'file', modified_at: at, size })
const file = (id, at, size) => stamp(`${id}.json`, at, size)
const record = (id, extra = {}) => ({ id, status: 'merged', updated_at: '2026-11-01T10:00:00Z', ...extra })
const stampOfFile = (name, at, size) => listingStamp(stamp(name, at, size))

// One fake storage: `server` holds the record bodies, `listing` the folder as the server lists it, `saved` the feed
// the last visit saved. Every read is logged, so a test can say what was not read.
function fakeStorage({ saved = null, server = {}, listing, online = true, versioned = true } = {}) {
  const log = { lists: [], reads: [], gets: [], writes: [] }
  const storage = {
    async get(path) { log.gets.push(path); return structuredClone(saved) },
    async set(path, value) { log.writes.push({ path, value: structuredClone(value) }) },
    async listWithStatus(prefix, options) {
      log.lists.push({ prefix, options })
      if (!options?.includeContent) return { complete: true, entries: listing.map(entry => ({ ...entry })) }
      return { complete: true, entries: listing.map(entry => ({ ...entry, ...(entry.name.endsWith('.json') && server[entry.path] ? { content: structuredClone(server[entry.path]) } : {}) })) }
    },
  }
  if (versioned) {
    storage.getWithVersion = async path => {
      log.reads.push(path)
      if (!online) return { value: null, version: null, offline: true }
      if (server[path] === 'fail') throw new Error('read failed')
      return { value: structuredClone(server[path] ?? null), version: 'v' }
    }
  }
  globalThis.window = { mobius: { online, storage } }
  return log
}

// What a visit saved: the desk's records, and the index of every file it listed.
const savedFeed = (records, index) => ({ schema: 3, saved_at: '2026-11-13T07:00:00Z', records: records.map(rec => ({ ...rec, path: `contributions/${rec.id}.json` })), index })

test('a settled record that did not move is taken from the saved feed and never read again', async () => {
  const kept = record('kept', { title: 'from the saved feed' })
  const log = fakeStorage({
    saved: savedFeed([kept], { 'kept.json': { stamp: stampOfFile('kept.json'), current: false } }),
    listing: [file('kept')],
    server: { 'contributions/kept.json': record('kept', { title: 'from the server' }) },
  })
  const result = await loadLedger()
  assert.deepEqual(result.records.map(rec => rec.title), ['from the saved feed'])
  assert.deepEqual(log.reads, [])
  assert.deepEqual(log.lists, [{ prefix: 'contributions/', options: {} }], 'the folder is listed without any content')
  assert.deepEqual(result.omitted, [])
  assert.equal(result.fromCache, false)
})

test('a current record is read fresh at every open, whatever its stamp says', async () => {
  const log = fakeStorage({
    saved: savedFeed([record('mine', { status: 'open', title: 'old' })], { 'mine.json': { stamp: stampOfFile('mine.json'), current: true } }),
    listing: [file('mine')],
    server: { 'contributions/mine.json': record('mine', { status: 'open', title: 'new' }) },
  })
  const result = await loadLedger()
  assert.deepEqual(log.reads, ['contributions/mine.json'])
  assert.deepEqual(result.records.map(rec => rec.title), ['new'])
})

test('a record written since the last visit, and a file this visit has no word on, are read', async () => {
  const log = fakeStorage({
    saved: savedFeed([record('moved', { title: 'old' })], { 'moved.json': { stamp: stampOfFile('moved.json'), current: false } }),
    listing: [file('moved', '2026-11-13T09:00:00.000000Z'), file('brand-new')],
    server: {
      'contributions/moved.json': record('moved', { title: 'new' }),
      'contributions/brand-new.json': record('brand-new', { status: 'prepared' }),
    },
  })
  const result = await loadLedger()
  assert.deepEqual([...log.reads].sort(), ['contributions/brand-new.json', 'contributions/moved.json'])
  assert.deepEqual(result.records.map(rec => rec.id).sort(), ['brand-new', 'moved'])
  assert.equal(result.records.find(rec => rec.id === 'moved').title, 'new')
})

test('settled history outside the desk set stays unread until a screen asks for it', async () => {
  const log = fakeStorage({
    saved: savedFeed([record('recent')], {
      'recent.json': { stamp: stampOfFile('recent.json'), current: false },
      'old.json': { stamp: stampOfFile('old.json'), current: false },
    }),
    listing: [file('recent'), file('old')],
    server: { 'contributions/recent.json': record('recent'), 'contributions/old.json': record('old') },
  })
  const desk = await loadLedger()
  assert.deepEqual(desk.records.map(rec => rec.id), ['recent'])
  assert.deepEqual(log.reads, [])

  const everything = await loadLedger({ history: true })
  assert.deepEqual(everything.records.map(rec => rec.id).sort(), ['old', 'recent'])
  assert.deepEqual(log.lists.at(-1).options, { includeContent: true }, 'history is one listing with content')
})

test('a layer of a stack the desk shows is read even when it is old settled history', async () => {
  const stack = (position) => ({ plan: { stack: { id: 's1', position, total: 2, base_branch: 'main' } } })
  const log = fakeStorage({
    saved: savedFeed([record('top', { status: 'open', ...stack(2) })], {
      'top.json': { stamp: stampOfFile('top.json'), current: true, stack: 's1' },
      'base.json': { stamp: stampOfFile('base.json'), current: false, stack: 's1' },
      'other.json': { stamp: stampOfFile('other.json'), current: false },
    }),
    listing: [file('top'), file('base'), file('other')],
    server: {
      'contributions/top.json': record('top', { status: 'open', ...stack(2) }),
      'contributions/base.json': record('base', stack(1)),
    },
  })
  const result = await loadLedger()
  assert.deepEqual(result.records.map(rec => rec.id).sort(), ['base', 'top'])
  assert.deepEqual([...log.reads].sort(), ['contributions/base.json', 'contributions/top.json'])
})

test('a file deleted since the last visit does not come back from the saved feed', async () => {
  fakeStorage({
    saved: savedFeed([record('kept'), record('deleted')], {
      'kept.json': { stamp: stampOfFile('kept.json'), current: false },
      'deleted.json': { stamp: stampOfFile('deleted.json'), current: false },
    }),
    listing: [file('kept')],
  })
  assert.deepEqual((await loadLedger()).records.map(rec => rec.id), ['kept'])
})

test('a record that cannot be read now is omitted and shown as the saved feed had it, never dropped', async () => {
  fakeStorage({
    saved: savedFeed([record('flaky', { status: 'open', title: 'last known' })], { 'flaky.json': { stamp: stampOfFile('flaky.json'), current: true } }),
    listing: [file('flaky')],
    server: { 'contributions/flaky.json': 'fail' },
  })
  const result = await loadLedger()
  assert.deepEqual(result.omitted, ['contributions/flaky.json'])
  assert.equal(result.fromCache, true)
  assert.deepEqual(result.records.map(rec => rec.title), ['last known'])
})

test('a file that is gone or not a record when it is read is skipped, not counted as omitted', async () => {
  fakeStorage({
    saved: savedFeed([], {}),
    listing: [file('vanished'), file('scratch'), file('renamed')],
    server: { 'contributions/scratch.json': [{ repo: 'x/y' }], 'contributions/renamed.json': record('other') },
  })
  const result = await loadLedger()
  assert.deepEqual(result.records, [])
  assert.deepEqual(result.omitted, [])
  assert.equal(result.fromCache, false)
})

test('the first visit, with no saved index, reads the whole ledger with its content in one listing', async () => {
  const log = fakeStorage({
    saved: { schema: 2, records: [] },
    listing: [file('a'), file('b')],
    server: { 'contributions/a.json': record('a'), 'contributions/b.json': record('b') },
  })
  const result = await loadLedger()
  assert.deepEqual(result.records.map(rec => rec.id), ['a', 'b'])
  assert.deepEqual(log.lists, [{ prefix: 'contributions/', options: { includeContent: true } }])
  assert.deepEqual(log.reads, [])
})

test('a runtime that cannot read one record fresh reads the whole ledger instead of trusting a stale read', async () => {
  const log = fakeStorage({
    saved: savedFeed([record('kept')], { 'kept.json': { stamp: stampOfFile('kept.json'), current: false } }),
    listing: [file('kept')],
    server: { 'contributions/kept.json': record('kept', { title: 'server' }) },
    versioned: false,
  })
  const result = await loadLedger()
  assert.deepEqual(log.lists, [{ prefix: 'contributions/', options: { includeContent: true } }])
  assert.deepEqual(result.records.map(rec => rec.title), ['server'])
})

test('an incomplete listing, or being offline, serves the saved feed', async () => {
  fakeStorage({ saved: savedFeed([record('cached')], {}), listing: [] })
  window.mobius.storage.listWithStatus = async () => ({ complete: false, entries: [] })
  assert.deepEqual(await loadLedger(), { records: [{ ...record('cached'), path: 'contributions/cached.json' }], fromCache: true, omitted: [] })
})

test('a canonical record still wins over a legacy-named copy in the desk read', async () => {
  fakeStorage({
    saved: savedFeed([], {}),
    listing: [stamp('twin.record.json'), file('twin')],
    server: {
      'contributions/twin.record.json': record('twin', { status: 'prepared' }),
      'contributions/twin.json': record('twin', { status: 'abandoned', updated_at: '2026-11-12T10:00:00Z' }),
    },
  })
  const { records } = await loadLedger()
  assert.deepEqual(records.map(rec => [rec.id, rec.status, rec.path]), [['twin', 'abandoned', 'contributions/twin.json']])
})

test('the saved feed carries the index of the folder as the last read found it', async () => {
  const log = fakeStorage({
    saved: savedFeed([], {}),
    listing: [file('open-one'), file('merged-one', '2026-11-02T10:00:00.000000Z', 70)],
    server: {
      'contributions/open-one.json': record('open-one', { status: 'open' }),
      'contributions/merged-one.json': record('merged-one'),
    },
  })
  const { records } = await loadLedger()
  await cacheFeed(records)
  const [{ value }] = log.writes
  assert.equal(value.schema, 3)
  assert.deepEqual(value.index, {
    'open-one.json': { stamp: stampOfFile('open-one.json'), current: true },
    'merged-one.json': { stamp: stampOfFile('merged-one.json', '2026-11-02T10:00:00.000000Z', 70), current: false },
  })
})

test('the status a record has in its file, not one laid over it from GitHub, decides whether it is current', async () => {
  const log = fakeStorage({
    saved: savedFeed([], {}),
    listing: [file('landed')],
    server: { 'contributions/landed.json': record('landed', { status: 'open' }) },
  })
  const { records } = await loadLedger()
  await cacheFeed(records.map(rec => ({ ...rec, status: 'merged' })))
  assert.equal(log.writes[0].value.index['landed.json'].current, true)
  assert.equal(log.writes[0].value.records[0].status, 'merged', 'the display status is what the feed shows')
})

test('listingStamp changes with a write and is empty when the listing gives none', () => {
  assert.notEqual(listingStamp(stamp('a.json', '2026-11-01T10:00:00.000000Z', 5)), listingStamp(stamp('a.json', '2026-11-01T10:00:00.000001Z', 5)))
  assert.notEqual(listingStamp(stamp('a.json', undefined, 5)), listingStamp(stamp('a.json', undefined, 6)))
  assert.equal(listingStamp({ name: 'a.json' }), '')
})

test('the desk set keeps current work, the newest history, the merged week and every layer of a shown stack', () => {
  const now = Date.parse('2026-11-13T12:00:00Z')
  const at = days => new Date(now - days * DAY).toISOString()
  const history = Array.from({ length: 30 }, (_, index) => record(`old-${index}`, { updated_at: at(20 + index) }))
  const thisWeek = Array.from({ length: 3 }, (_, index) => record(`week-${index}`, { updated_at: at(1 + index) }))
  const stack = position => ({ plan: { stack: { id: 's', position, total: 2, base_branch: 'main' } } })
  const layer = record('old-layer', { updated_at: at(90), ...stack(1) })
  const top = record('top', { status: 'open', updated_at: at(1), ...stack(2) })
  const kept = buildFeedSnapshot([...history, ...thisWeek, layer, top, record('attention', { needs_attention: true })], now).map(rec => rec.id)
  assert.equal(kept.filter(id => id.startsWith('old-') && id !== 'old-layer').length, 24 - thisWeek.length, 'the 24 newest settled records include the week')
  for (const id of ['top', 'attention', 'week-0', 'week-1', 'week-2', 'old-layer']) assert.ok(kept.includes(id), id)
  assert.ok(!kept.includes('old-29'))
})

test('many busy opens at once share one read of the folder and the saved feed', async () => {
  const log = fakeStorage({ saved: savedFeed([], {}), listing: [file('a')], server: { 'contributions/a.json': record('a') } })
  const [first, second] = [loadLedger(), loadLedger()]
  assert.equal(first, second)
  await first
  assert.equal(log.lists.length, 1)
  assert.equal(log.gets.length, 1)
})
