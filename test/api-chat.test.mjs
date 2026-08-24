import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchOwnedAgentChats } from '../api.js'

test('cycle recovery lists only this app owned scope with the scoped token', async () => {
  const originalFetch = globalThis.fetch
  let seen = null
  globalThis.fetch = async (url, options) => {
    seen = { url, options }
    return new Response(JSON.stringify([{ id: 'cycle-chat' }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const chats = await fetchOwnedAgentChats('app-token', 'contribute-cycle')
    assert.deepEqual(chats, [{ id: 'cycle-chat' }])
    assert.equal(seen.url, '/api/app-chats?scope=contribute-cycle')
    assert.equal(seen.options.headers.Authorization, 'Bearer app-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an unavailable app chat index stays an ordinary empty recovery result', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  try {
    assert.deepEqual(await fetchOwnedAgentChats('app-token'), [])
  } finally {
    globalThis.fetch = originalFetch
  }
})
