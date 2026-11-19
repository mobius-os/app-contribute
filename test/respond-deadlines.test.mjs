// What the two deadlines do to the app's own reads and to Post: a stopped post can be tried again, an approved answer whose chat
// never started can be sent again or taken back, and neither ever posts anything twice.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { approveResponse, discardResponse, withdrawResponse } from '../respond-flow.js'
import { loadResponses, readFreshResult } from '../respond-store.js'
import { responseOutbox, responseStatus, responseView, stepDone } from '../respond-result.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const cases = JSON.parse(readFileSync(new URL('./respond-lifecycle.cases.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const SLUG = 'owner__repo__7'
const RESULT = `respond-results/${SLUG}.json`
const DECISION = `respond-decisions/${SLUG}.json`
const SENT = '2026-11-06T09:30:00Z'
const SENT_MS = Date.parse(SENT)
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })
const approval = (patch = {}) => ({ version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: SENT, ...patch })
const receipts = { push: { sha: TIP, at: '2026-11-06T09:30:08Z' }, replies: [{ index: 0, url: 'https://example.test/c/1', at: '2026-11-06T09:30:20Z' }], description: null, rerequest: null }
const LAST_STEP_MS = Date.parse('2026-11-06T09:30:20Z')

function fakeStorage(files = {}, { offline = false, removeFails = false } = {}) {
  const calls = []
  return {
    calls, files,
    async listWithStatus(prefix) {
      return { complete: true, entries: Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => ({ type: 'file', name: path.slice(prefix.length), path, content: structuredClone(content) })) }
    },
    async getWithVersion(path) { calls.push(['read', path]); return { value: files[path] === undefined ? null : structuredClone(files[path]), version: 'v1', offline } },
    async durableWrite(path, value) { calls.push(['write', path, structuredClone(value)]); files[path] = structuredClone(value); return { durability: 'synced' } },
    async remove(path) { calls.push(['remove', path]); if (removeFails) throw new Error('offline'); delete files[path] },
  }
}
const files = (result = {}, decision = approval()) => ({ [RESULT]: { ...example(), ...result }, ...(decision ? { [DECISION]: decision } : {}) })
const posting = (patch = {}) => files({ state: 'posting', receipts, ...patch })

const WITH_GRANT = { owner_confirm: true }
const asked = []
globalThis.window = { mobius: { ownerGrant: { request: async (...args) => { asked.push(args); return true } } } }
const delivered = []
const deliver = async (token, request) => { delivered.push(request); return { ok: true, chatId: request.chatId, outcome: 'sent' } }
const reset = () => { delivered.length = 0; asked.length = 0 }
const approve = (storage, extra = {}) => approveResponse({ slug: SLUG, digest: example().digest, pr: pull({ headRefOid: TIP }), chat: null, token: 't', capabilities: WITH_GRANT, storage, deliver, ...extra })

test('the saved answers are read with the lazy tick, so a post that went quiet reads failed with its receipts, and a live one does not', async () => {
  const storage = fakeStorage(posting())
  const [live] = await loadResponses(storage, undefined, LAST_STEP_MS + 179000)
  assert.equal(responseStatus(live, pull({ headRefOid: TIP })), 'posting')
  const [quiet] = await loadResponses(storage, undefined, LAST_STEP_MS + 180000)
  assert.equal(responseStatus(quiet, pull({ headRefOid: TIP })), 'failed', 'before the change this read posting for ever')
  assert.equal(stepDone(quiet.result, 'push'), true, 'what went out stays ticked')
  assert.equal(stepDone(quiet.result, 'replies'), false, 'one of the two replies is out: not all of them')
  assert.equal(responseOutbox(quiet, pull({ headRefOid: TIP })).state, 'unconfirmed')
  assert.equal(responseView([quiet], pull({ headRefOid: TIP })).status, 'failed')
  assert.equal(storage.calls.some(([kind]) => kind === 'write' || kind === 'remove'), false, 'reading writes nothing: the helper owns the result')
})

test('the helper’s stamp moves the deadline with every step, in the files the app reads', async () => {
  const stamp = cases.stamps[0].vector // POSTING since 100, deadline 330 after the second move
  const storage = fakeStorage(files({ state: 'posting', lifecycle: stamp }))
  assert.equal((await loadResponses(storage, undefined, 329000))[0].result.state, 'posting')
  assert.equal((await loadResponses(storage, undefined, 330000))[0].result.state, 'failed')
})

test('an approved answer whose chat never started reads as the owner’s move after 30 seconds, through the store', async () => {
  const storage = fakeStorage(files())
  const [young] = await loadResponses(storage, undefined, SENT_MS + 5000)
  assert.equal(responseOutbox(young, pull()).state, 'sending')
  const [old] = await loadResponses(storage, undefined, SENT_MS + 31000)
  assert.equal(responseStatus(old, pull()), 'approved', 'the card still says it was approved: it has its own 30 seconds')
  assert.equal(responseOutbox(old, pull()).state, 'drafted', 'before the change this read sending whatever its age')
})

test('the fresh read Post checks applies the same tick, and the app writes nothing into the helper’s file', async () => {
  const storage = fakeStorage(posting())
  const before = structuredClone(storage.files[RESULT])
  assert.equal((await readFreshResult(SLUG, storage, LAST_STEP_MS + 179000)).state, 'posting')
  assert.equal((await readFreshResult(SLUG, storage, LAST_STEP_MS + 180000)).state, 'failed')
  assert.deepEqual(storage.files[RESULT], before)
  assert.equal(await readFreshResult(SLUG, fakeStorage(posting(), { offline: true }), LAST_STEP_MS + 180000), null, 'an offline answer is not trusted')
})

test('Post is refused while a post is live and allowed once it went quiet (the clock is the store’s own)', async () => {
  reset()
  const live = fakeStorage(files({ state: 'posting', receipts, lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: Math.floor(Date.now() / 1000), deadline: Math.floor(Date.now() / 1000) + 170 } }, history: [] } }))
  const refused = await approve(live, { again: true })
  assert.deepEqual(refused, { ok: false, error: 'This answer is already being posted.' })
  assert.deepEqual(delivered, [])
  const nowS = Math.floor(Date.now() / 1000)
  const quiet = fakeStorage(files({ state: 'posting', receipts, lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: nowS - 400, deadline: nowS - 220 } }, history: [] } }))
  const retried = await approve(quiet, { again: true })
  assert.deepEqual(retried, { ok: true })
  assert.equal(asked.length, 1, 'a fresh confirmation of the owner, on Möbius’s own sheet')
  assert.equal(delivered.length, 1)
  assert.match(delivered[0].cid, /^respond-retry-r-3f9a1c2b04d5-\d+$/, 'a new message id: the first one would be dropped as a duplicate')
  assert.equal(quiet.calls.filter(([kind]) => kind === 'write').length, 1, 'only the owner’s decision is written')
  assert.equal(quiet.calls.filter(([kind, path]) => kind === 'write' && path === RESULT).length, 0, 'never the result: the helper’s file, with the receipts, is untouched')
  assert.deepEqual(quiet.files[RESULT].receipts, receipts)
})

test('a post that went quiet but whose PR moved for another reason is still refused, as before', async () => {
  reset()
  const nowS = Math.floor(Date.now() / 1000)
  const quiet = fakeStorage(files({ state: 'posting', receipts, lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: nowS - 400, deadline: nowS - 220 } }, history: [] } }))
  const elsewhere = await approve(quiet, { again: true, pr: pull({ headRefOid: 'c'.repeat(40) }) })
  assert.match(elsewhere.error, /PR changed after this answer/)
  assert.equal(quiet.calls.some(([kind]) => kind === 'write'), false)
  assert.deepEqual(delivered, [])
})

test('Discard is still refused for a post that is running, and is allowed for one that went quiet', async () => {
  const nowS = Math.floor(Date.now() / 1000)
  const running = fakeStorage(posting({ lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: nowS - 5, deadline: nowS + 175 } }, history: [] } }))
  assert.match((await discardResponse({ slug: SLUG, digest: example().digest, storage: running })).error, /being posted/)
  const quiet = fakeStorage(posting()) // its last step is long past the 3 minutes: it reads as stopped
  assert.deepEqual(await discardResponse({ slug: SLUG, digest: example().digest, storage: quiet }), { ok: true })
})

test('Take back Post removes the approval once the chat did not start, and says why when it cannot', async () => {
  const clock = ms => () => SENT_MS + ms
  const waiting = fakeStorage(files())
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage: waiting, clock: clock(5000) }),
    { ok: false, error: 'The chat is still starting, so Post cannot be taken back yet.' })
  assert.deepEqual(waiting.files[DECISION], approval(), 'inside the 30 seconds the approval stays')
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage: waiting, clock: clock(31000) }), { ok: true })
  assert.equal(waiting.files[DECISION], undefined, 'the decision file is gone: nothing is approved, nothing can be posted')
  assert.equal(waiting.calls.some(([kind, path]) => kind === 'write' && path === RESULT), false)
  const [back] = await loadResponses(waiting, undefined, SENT_MS + 40000)
  assert.equal(responseStatus(back, pull()), 'ready', 'the answer reads "Replies ready" again, and Post is offered')
  const again = await withdrawResponse({ slug: SLUG, digest: example().digest, storage: waiting, clock: clock(41000) })
  assert.deepEqual(again, { ok: false, error: 'There is nothing to take back.' })
})

test('Take back Post never touches a post that has begun, a different answer, or an approval it could not remove', async () => {
  const clock = () => SENT_MS + 3600000
  const started = fakeStorage(posting({ receipts: { push: null, replies: [], description: null, rerequest: null }, lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: Math.floor(clock() / 1000) - 5, deadline: Math.floor(clock() / 1000) + 175 } }, history: [] } }))
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage: started, clock }), { ok: false, error: 'This answer is being posted, so Post cannot be taken back.' })
  assert.ok(started.files[DECISION])
  const other = fakeStorage(files())
  assert.match((await withdrawResponse({ slug: SLUG, digest: 'f'.repeat(64), storage: other, clock })).error, /changed while you were reading it/)
  assert.ok(other.files[DECISION])
  const stuck = fakeStorage(files(), { removeFails: true })
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage: stuck, clock }), { ok: false, error: 'Post could not be taken back. Sync and try again.' })
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage: fakeStorage(files(), { offline: true }), clock }), { ok: false, error: 'This answer is no longer saved.' })
})
