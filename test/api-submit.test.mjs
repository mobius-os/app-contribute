import assert from 'node:assert/strict'
import test from 'node:test'

import {
  markContributionReady,
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

for (const [description, response] of [
  ['an empty', new Response(null, { status: 204 })],
  ['a malformed', new Response('not json', { status: 200 })],
]) {
  test(`a successful Ready mutation with ${description} response is reconciled`, async () => {
    const result = await withFetch(
      response,
      () => markContributionReady({
        appId: 80,
        token: 'token',
        rec: { id: 'public-draft', last_submit_push_sha: 'a'.repeat(40) },
      }),
    )

    assert.equal(result.uncertain, true)
    assert.equal(result.failure.owner, 'automatic')
    assert.equal(result.failure.code, 'ready_response_missing')
  })
}
