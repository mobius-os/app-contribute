import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchGithubStatus,
  fetchReviewStatus,
  markContributionReady,
  submitContribution,
  submitContributionStack,
  updateContribution,
  updateContributionStack,
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

async function captureRequest(response, run) {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), body: JSON.parse(options.body) }); return response }
  try { return { result: await run(), calls } } finally { globalThis.fetch = originalFetch }
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('every Send carries the exact confirmed snapshot only when asked to', async () => {
  const confirmed = { id: 'ready-pr', plan: { head_sha: 'a'.repeat(40) } }
  const single = await captureRequest(json({ record: { id: 'ready-pr', status: 'open' } }),
    () => submitContribution({ appId: 80, token: 't', rec: { id: 'ready-pr' }, expectedRecord: confirmed }))
  assert.deepEqual(single.calls[0].body.expected_record, confirmed)
  const update = await captureRequest(json({ record: { id: 'ready-pr', status: 'open' } }),
    () => updateContribution({ appId: 80, token: 't', rec: { id: 'ready-pr' }, expectedRecord: confirmed }))
  assert.deepEqual(update.calls[0].body, { expected_record: confirmed })
  const stack = await captureRequest(json({ records: [{ id: 'parent' }], submitted: ['parent'] }),
    () => submitContributionStack({ appId: 80, token: 't', recordIds: ['parent', 'child'], expectedRecords: [{ id: 'parent' }, { id: 'child' }] }))
  assert.deepEqual(stack.calls[0].body.expected_records.map(record => record.id), ['parent', 'child'])
  const updateStack = await captureRequest(json({ records: [{ id: 'parent' }], updated: ['parent'] }),
    () => updateContributionStack({ appId: 80, token: 't', recordIds: ['parent', 'child'], expectedRecords: [{ id: 'parent' }, { id: 'child' }] }))
  assert.equal(updateStack.calls[0].body.expected_records.length, 2)
  const legacy = await captureRequest(json({ record: { id: 'ready-pr' } }),
    () => submitContribution({ appId: 80, token: 't', rec: { id: 'ready-pr' } }))
  assert.equal('expected_record' in legacy.calls[0].body, false)
})

test('a changed confirmed snapshot is released only when the server certifies no attempt', async () => {
  const refusal = notAttempted => json({ detail: { code: 'approval_changed', changed_record_ids: ['ready-pr'], not_attempted: notAttempted } }, 409)
  const certified = await withFetch(refusal(true), () => submitContribution({ appId: 80, token: 't', rec: { id: 'ready-pr' }, expectedRecord: {} }))
  assert.equal(certified.notAttempted, true)
  assert.equal(certified.failure.code, 'approval_changed')
  const withRow = await withFetch(json({ detail: { code: 'approval_changed', not_attempted: true, record: { id: 'ready-pr', status: 'prepared' } } }, 409),
    () => submitContribution({ appId: 80, token: 't', rec: { id: 'ready-pr' }, expectedRecord: {} }))
  assert.deepEqual(withRow.record, { id: 'ready-pr', status: 'prepared' }, 'the current row is handed back for display')
  const uncertified = await withFetch(refusal(false), () => submitContributionStack({ appId: 80, token: 't', recordIds: ['a', 'b'], expectedRecords: [] }))
  assert.equal(uncertified.notAttempted, undefined)
  assert.match(uncertified.error, /earlier attempt/)
})

test('the platform advertises frozen publication binding; its absence is unsupported', async () => {
  const supported = await withFetch(json({ connected: true, login: 'owner', frozen_publication_binding: { record_fields: ['plan'] } }), () => fetchGithubStatus('t'))
  assert.equal(supported.frozenBinding, true)
  const legacy = await withFetch(json({ connected: true, login: 'owner' }), () => fetchGithubStatus('t'))
  assert.equal(legacy.frozenBinding, false)
})

test('review status can be asked for exactly the addressed records', async () => {
  const originalFetch = globalThis.fetch
  const urls = []
  globalThis.fetch = async url => { urls.push(String(url)); return json({ records: [] }) }
  try {
    await fetchReviewStatus('t', 80, ['old-record', 'a.b'])
    await fetchReviewStatus('t', 80)
  } finally { globalThis.fetch = originalFetch }
  assert.equal(urls[0], '/api/github/contributions/80/review-status?record_id=old-record&record_id=a.b')
  assert.equal(urls[1], '/api/github/contributions/80/review-status')
})
