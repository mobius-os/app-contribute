// After "Take back Post" the next plain Post is a message of its own: the chat may still hold the first one, and the platform drops a repeated id as a duplicate.
// Which Post a message belongs to is stored with the answer's decision, not in the page, so it is the same for a reloaded app and for a second open frame.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { approveResponse, withdrawResponse } from '../respond-flow.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const SLUG = 'owner__repo__7'
const RESULT = `respond-results/${SLUG}.json`
const DECISION = `respond-decisions/${SLUG}.json`
const SENT = '2026-11-06T09:30:00Z'
const SENT_MS = Date.parse(SENT)
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })

function fakeStorage(files = {}) {
  return {
    files,
    async listWithStatus(prefix) {
      return { complete: true, entries: Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => ({ type: 'file', name: path.slice(prefix.length), path, content: structuredClone(content) })) }
    },
    async getWithVersion(path) { return { value: files[path] === undefined ? null : structuredClone(files[path]), version: 'v1', offline: false } },
    async durableWrite(path, value) { files[path] = structuredClone(value); return { durability: 'synced' } },
    async remove(path) { delete files[path] },
  }
}

const WITH_GRANT = { owner_confirm: true }
globalThis.window = { mobius: { ownerGrant: { request: async () => true } } }
const sentMessages = []
const deliver = async (token, request) => { sentMessages.push(request.cid); return { ok: true, chatId: request.chatId, outcome: 'sent' } }
const post = (storage, digest = example().digest) => approveResponse({ slug: SLUG, digest, pr: pull(), chat: null, token: 't', capabilities: WITH_GRANT, storage, deliver, now: () => SENT })

test('after Take back Post a plain Post is sent as a message of its own, every time', async () => {
  sentMessages.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example() } })
  assert.deepEqual(await post(storage), { ok: true })
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage, clock: () => SENT_MS + 31000 }), { ok: true })
  assert.equal(storage.files[DECISION], undefined)
  assert.deepEqual(await post(storage), { ok: true })
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage, clock: () => SENT_MS + 31000 }), { ok: true })
  assert.deepEqual(await post(storage), { ok: true })
  assert.equal(new Set(sentMessages).size, 3, 'three Posts, three messages')
  for (const cid of sentMessages) assert.match(cid, new RegExp(`^respond-post-${example().id}-[0-9a-f]{12}$`), 'the answer, then the Post it belongs to')
})

test('a Take back that was refused changes nothing, and a Post that was not taken back keeps its id, so a double press is still one message', async () => {
  sentMessages.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example(), id: 'r-3f9a1c2b04d6', digest: 'c'.repeat(64) } })
  const digest = 'c'.repeat(64)
  await post(storage, digest)
  const tooSoon = await withdrawResponse({ slug: SLUG, digest, storage, clock: () => SENT_MS + 5000 })
  assert.equal(tooSoon.ok, false, 'the chat is still starting')
  await post(storage, digest)
  assert.equal(sentMessages.length, 2)
  assert.equal(sentMessages[0], sentMessages[1], 'one Post, pressed twice: the same message id, so the platform drops the second')
  assert.match(sentMessages[0], /^respond-post-r-3f9a1c2b04d6-[0-9a-f]{12}$/)
})

// A reopened app and a second frame hold none of the first page's memory: each is a module instance of its own.
const page = name => import(`../respond-flow.js?${name}`)
const postFrom = (flow, storage, digest = example().digest) => flow.approveResponse({ slug: SLUG, digest, pr: pull(), chat: null, token: 't', capabilities: WITH_GRANT, storage, deliver, now: () => SENT })
const takeBackFrom = (flow, storage) => flow.withdrawResponse({ slug: SLUG, digest: example().digest, storage, clock: () => SENT_MS + 31000 })

test('Post, Take back Post, then Post from a reloaded app is a message of its own, as is a Post from another open frame', async () => {
  sentMessages.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example() } })
  const [first, reloaded, other] = await Promise.all([page('first'), page('reloaded'), page('other')])
  assert.deepEqual(await postFrom(first, storage), { ok: true })
  assert.equal(storage.files[DECISION].attempt, sentMessages[0].split('-').at(-1), 'the decision names the Post the message belongs to')
  assert.deepEqual(await takeBackFrom(first, storage), { ok: true })
  assert.deepEqual(await postFrom(reloaded, storage), { ok: true }, 'the reopened app knows nothing of the first Post, and must not need to')
  assert.deepEqual(await takeBackFrom(other, storage), { ok: true }, 'another frame takes it back, from the stored decision')
  assert.deepEqual(await postFrom(other, storage), { ok: true })
  assert.equal(new Set(sentMessages).size, 3, `three Posts, three messages: ${sentMessages.join(' ')}`)
})

test('a Post pressed again from another frame while the first is standing is the same message, and a decision with no Post named gets one', async () => {
  sentMessages.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example() } })
  const [first, other] = await Promise.all([page('standing-1'), page('standing-2')])
  await postFrom(first, storage)
  await postFrom(other, storage)
  assert.equal(sentMessages[0], sentMessages[1], 'the stored attempt is shared by every frame')
  // An approval an older version wrote has no attempt: the next Post names one rather than reusing the plain id.
  const older = fakeStorage({ [RESULT]: { ...example() }, [DECISION]: { version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: SENT } })
  await postFrom(first, older)
  assert.match(sentMessages.at(-1), /-[0-9a-f]{12}$/)
  assert.match(older.files[DECISION].attempt, /^[0-9a-f]{12}$/)
})

test('an approval for another answer, or for the same answer changed, is not the Post being repeated', async () => {
  sentMessages.length = 0
  const stale = { version: 1, result_id: example().id, digest: 'f'.repeat(64), decision: 'approved', at: SENT, attempt: 'a'.repeat(12) }
  const storage = fakeStorage({ [RESULT]: { ...example() }, [DECISION]: stale })
  await postFrom(await page('other-answer'), storage)
  assert.notEqual(storage.files[DECISION].attempt, stale.attempt, 'a decision that does not name this answer carries no Post of it')
})
