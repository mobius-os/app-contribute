import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectPublishedApp,
  submitContribution,
  submitContributionStack,
} from '../api.js'

async function withFetch(response, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => response
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('a repeated single send is an already-handled result, not an error', async () => {
  const result = await withFetch(
    new Response(JSON.stringify({
      detail: 'This contribution is no longer waiting for approval.',
    }), { status: 409, headers: { 'content-type': 'application/json' } }),
    () => submitContribution({ appId: 80, token: 'token', rec: { id: 'ready-pr' } }),
  )

  assert.deepEqual(result, { alreadyHandled: true })
})

test('a repeated stack send is an already-handled result, not an error', async () => {
  const result = await withFetch(
    new Response(JSON.stringify({
      detail: 'Every PR in this stack has already been submitted.',
    }), { status: 409, headers: { 'content-type': 'application/json' } }),
    () => submitContributionStack({
      appId: 80,
      token: 'token',
      recordIds: ['parent', 'child'],
    }),
  )

  assert.deepEqual(result, { alreadyHandled: true })
})

test('a publication connection posts to the exact reviewed record', async () => {
  const originalFetch = globalThis.fetch
  let request = null
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      record: { id: 'publish-maps', status: 'merged' },
      connection: { status: 'connected', app_id: 101 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await connectPublishedApp({
      appId: 80,
      token: 'token',
      recordId: 'publish maps/2026',
    })
    assert.deepEqual(result, {
      ok: { id: 'publish-maps', status: 'merged' },
      connection: { status: 'connected', app_id: 101 },
    })
    assert.equal(
      request.url,
      '/api/github/contributions/80/publish%20maps%2F2026/connect-app',
    )
    assert.equal(request.options.method, 'POST')
    assert.equal(request.options.headers.Authorization, 'Bearer token')
  } finally {
    globalThis.fetch = originalFetch
  }
})
