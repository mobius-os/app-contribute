// After "Take back Post" the next plain Post is a message of its own: the chat may still hold the first one, and the platform drops a repeated id as a duplicate.
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
  assert.equal(sentMessages[0], `respond-post-${example().id}`, 'the first Post is what it always was')
})

test('a Take back that was refused changes nothing, and a Post that was not taken back keeps its id, so a double press is still one message', async () => {
  sentMessages.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example(), id: 'r-3f9a1c2b04d6', digest: 'c'.repeat(64) } })
  const digest = 'c'.repeat(64)
  await post(storage, digest)
  const tooSoon = await withdrawResponse({ slug: SLUG, digest, storage, clock: () => SENT_MS + 5000 })
  assert.equal(tooSoon.ok, false, 'the chat is still starting')
  await post(storage, digest)
  assert.deepEqual(sentMessages, ['respond-post-r-3f9a1c2b04d6', 'respond-post-r-3f9a1c2b04d6'])
})
