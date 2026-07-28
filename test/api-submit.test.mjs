import assert from 'node:assert/strict'
import test from 'node:test'

import { submitContribution, submitContributionStack } from '../api.js'

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
