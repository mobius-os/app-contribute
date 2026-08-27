import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchMobiusContributionStatus,
  submitContributionViaMobius,
  updateContribution,
  withdrawMobiusContribution,
} from '../api.js'

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
  }
}

test('Möbius submit uses the narrow relay endpoint and explicit draft checkpoint', async () => {
  const originalFetch = globalThis.fetch
  let seen = null
  globalThis.fetch = async (url, options) => {
    seen = { url, options }
    return response(200, {
      record: {
        id: 'review-1',
        status: 'submitting',
        submission_mode: 'mobius-bot',
        relay_contribution_id: 'ctr_12345678',
      },
    })
  }
  try {
    const outcome = await submitContributionViaMobius({
      appId: 80,
      token: 'scoped-token',
      rec: { id: 'review-1' },
    })
    assert.equal(
      seen.url,
      '/api/contribution-relay/80/review-1/submit',
    )
    assert.equal(seen.options.method, 'POST')
    assert.equal(seen.options.headers.Authorization, 'Bearer scoped-token')
    assert.deepEqual(JSON.parse(seen.options.body), {
      confirm_publication: true,
      public_identity: 'anonymous',
      submitter: 'contribute-button',
    })
    assert.equal(outcome.pending.relay_contribution_id, 'ctr_12345678')
    assert.equal(outcome.viaMobius, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Möbius status reader returns the saved draft URL', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/contribution-relay/80/review-1/status')
    assert.equal(options.headers.Authorization, 'Bearer scoped-token')
    return response(200, {
      record: {
        id: 'review-1',
        status: 'draft',
        url: 'https://github.com/owner/mobius/pull/123',
      },
    })
  }
  try {
    const outcome = await fetchMobiusContributionStatus({
      appId: 80,
      token: 'scoped-token',
      rec: { id: 'review-1' },
    })
    assert.equal(outcome.ok.status, 'draft')
    assert.equal(outcome.ok.url, 'https://github.com/owner/mobius/pull/123')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Möbius withdrawal requires an explicit confirmation body', async () => {
  const originalFetch = globalThis.fetch
  let seen = null
  globalThis.fetch = async (url, options) => {
    seen = { url, options }
    return response(200, {
      record: {
        id: 'review-1',
        status: 'closed',
        relay_status: 'withdrawn',
      },
    })
  }
  try {
    const outcome = await withdrawMobiusContribution({
      appId: 80,
      token: 'scoped-token',
      rec: { id: 'review-1' },
    })
    assert.equal(seen.url, '/api/contribution-relay/80/review-1/withdraw')
    assert.equal(seen.options.method, 'POST')
    assert.deepEqual(JSON.parse(seen.options.body), {
      confirm_withdrawal: true,
    })
    assert.equal(outcome.ok.relay_status, 'withdrawn')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('existing PR update uses the dedicated reviewed fast-forward endpoint', async () => {
  const originalFetch = globalThis.fetch
  let seen = null
  globalThis.fetch = async (url, options) => {
    seen = { url, options }
    return response(200, {
      record: {
        id: 'review-1',
        status: 'open',
        number: 58,
        url: 'https://github.com/mobius-os/app-contribute/pull/58',
      },
      url: 'https://github.com/mobius-os/app-contribute/pull/58',
    })
  }
  try {
    const outcome = await updateContribution({
      appId: 80,
      token: 'scoped-token',
      rec: { id: 'review-1' },
    })
    assert.equal(
      seen.url,
      '/api/github/contributions/80/review-1/update-existing',
    )
    assert.equal(seen.options.method, 'POST')
    assert.equal(seen.options.headers.Authorization, 'Bearer scoped-token')
    assert.deepEqual(JSON.parse(seen.options.body), {})
    assert.equal(outcome.ok.status, 'open')
    assert.equal(outcome.url, 'https://github.com/mobius-os/app-contribute/pull/58')
  } finally {
    globalThis.fetch = originalFetch
  }
})
