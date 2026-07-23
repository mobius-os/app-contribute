import assert from 'node:assert/strict'
import test from 'node:test'

import {
  connectCancel,
  connectPoll,
  connectToken,
  disconnect,
} from '../api.js'
import {
  ConnectionAttemptError,
  runDeviceConnection,
} from '../github-connection.js'

function started(overrides = {}) {
  return {
    attemptId: 'attempt-123',
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device',
    intervalMs: 5,
    expiresInMs: 100,
    ...overrides,
  }
}

test('resumes a persisted attempt without starting a replacement', async () => {
  let starts = 0
  const result = await runDeviceConnection({
    existingAttempt: started({ attemptId: 'resumed-attempt' }),
    transport: {
      async start() {
        starts += 1
        throw new Error('must not replace a resumable attempt')
      },
      async poll({ attemptId }) {
        assert.equal(attemptId, 'resumed-attempt')
        return { status: 'complete', login: 'octocat' }
      },
    },
    wait: async () => {},
  })

  assert.equal(starts, 0)
  assert.deepEqual(result, { status: 'complete', login: 'octocat' })
})

test('polls sequentially and completes without overlapping provider requests', async () => {
  let active = 0
  let maxActive = 0
  let polls = 0
  let clock = 0
  const pendingStates = []

  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll({ attemptId }) {
        assert.equal(attemptId, 'attempt-123')
        active += 1
        maxActive = Math.max(maxActive, active)
        polls += 1
        await Promise.resolve()
        active -= 1
        return polls === 3
          ? { status: 'complete', login: 'octocat' }
          : { status: 'pending' }
      },
    },
    onPending(value) {
      pendingStates.push(value)
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
  })

  assert.equal(maxActive, 1)
  assert.equal(polls, 3)
  assert.equal(result.status, 'complete')
  assert.equal(result.login, 'octocat')
  assert.equal(pendingStates.length, 1)
  assert.equal(pendingStates[0].userCode, 'ABCD-EFGH')
})

test('bounds repeated retryable poll failures and preserves the last detail', async () => {
  let polls = 0
  let clock = 0
  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        polls += 1
        throw new ConnectionAttemptError('GitHub is temporarily unavailable.', {
          code: 'backend_error',
          reason: 'upstream_unavailable',
          retryable: true,
        })
      },
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
    maxConsecutiveErrors: 3,
  })

  assert.equal(polls, 3)
  assert.deepEqual(result, {
    status: 'failed',
    issue: {
      code: 'backend_error',
      message: 'GitHub is temporarily unavailable.',
      reason: 'upstream_unavailable',
      retryable: true,
    },
  })
})

test('surfaces exact provider failure reasons instead of collapsing them to expired', async () => {
  let clock = 0
  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        return {
          status: 'failed',
          reason: 'incorrect_device_code',
          message: 'GitHub rejected this device code.',
        }
      },
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
  })

  assert.deepEqual(result, {
    status: 'failed',
    issue: {
      code: 'provider_failed',
      message: 'GitHub rejected this device code.',
      reason: 'incorrect_device_code',
      retryable: true,
    },
  })
})

test('returns an explicit failure for an unknown provider state', async () => {
  let clock = 0
  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        return { status: 'provider_added_a_new_state' }
      },
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.issue.code, 'unknown_status')
  assert.equal(result.issue.reason, 'provider_added_a_new_state')
  assert.match(result.issue.message, /provider_added_a_new_state/)
})

test('uses server retry pacing and preserves an expired terminal state', async () => {
  let clock = 0
  let polls = 0
  const waits = []
  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        polls += 1
        return polls === 1
          ? {
              status: 'pending',
              retryAfterMs: 23,
              lastError: 'github_unreachable',
            }
          : { status: 'expired', reason: 'expired_token' }
      },
    },
    now: () => clock,
    wait: async (ms) => {
      waits.push(ms)
      clock += ms
    },
  })

  assert.deepEqual(waits, [5, 23])
  assert.deepEqual(result, {
    status: 'failed',
    issue: {
      code: 'expired',
      message: 'GitHub sign-in expired. Please try again.',
      reason: 'expired_token',
      retryable: true,
    },
  })
})

test('preserves a server-side cancellation as its own terminal state', async () => {
  let clock = 0
  const result = await runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        return { status: 'cancelled', reason: 'cancelled' }
      },
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
  })

  assert.deepEqual(result, {
    status: 'cancelled',
    issue: {
      code: 'cancelled',
      message: 'GitHub sign-in was cancelled.',
      reason: 'cancelled',
      retryable: true,
    },
  })
})

test('cancellation aborts a pending wait without another poll', async () => {
  const controller = new AbortController()
  let polls = 0
  let releaseWait
  const waiting = new Promise((resolve) => {
    releaseWait = resolve
  })

  const run = runDeviceConnection({
    transport: {
      async start() {
        return started()
      },
      async poll() {
        polls += 1
        return { status: 'pending' }
      },
    },
    signal: controller.signal,
    wait: async (_ms, signal) => {
      releaseWait()
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    },
  })

  await waiting
  controller.abort()
  const result = await run

  assert.equal(polls, 0)
  assert.deepEqual(result, { status: 'cancelled', issue: null })
})

test('identified poll requests abort at their request deadline', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })

  await assert.rejects(
    connectPoll('test-token', 'attempt-timeout', { timeoutMs: 5 }),
    (error) => {
      assert.equal(error.code, 'request_timeout')
      assert.match(error.message, /timed out/)
      return true
    },
  )
})

test('PAT connect and disconnect cannot leave the account UI waiting forever', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })

  for (const request of [
    () => connectToken('test-token', 'github-token', { timeoutMs: 5 }),
    () => disconnect('test-token', { timeoutMs: 5 }),
  ]) {
    await assert.rejects(request(), (error) => {
      assert.equal(error.code, 'request_timeout')
      assert.match(error.message, /timed out/)
      return true
    })
  }
})

test('poll and cancel requests target the exact platform attempt', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const calls = []
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({
      url,
      method: options.method,
      body,
    })
    return new Response(JSON.stringify({
      attempt_id: body.attempt_id,
      status: 'pending',
    }), { status: 200 })
  }

  await connectPoll('test-token', 'attempt-poll')
  await connectCancel('test-token', 'attempt-cancel')

  assert.deepEqual(calls, [
    {
      url: '/api/github/connect/poll',
      method: 'POST',
      body: { attempt_id: 'attempt-poll' },
    },
    {
      url: '/api/github/connect/cancel',
      method: 'POST',
      body: { attempt_id: 'attempt-cancel' },
    },
  ])
})
