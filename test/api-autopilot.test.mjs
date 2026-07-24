import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchGithubStatus } from '../api.js'

test('GitHub status preserves the autopilot capability field', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    connected: true,
    login: 'octocat',
    autopilot_available: true,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const status = await fetchGithubStatus('token')
    assert.equal(status.autopilotAvailable, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an older backend leaves autopilot unavailable', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    connected: true,
    login: 'octocat',
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  try {
    const status = await fetchGithubStatus('token')
    assert.equal(status.autopilotAvailable, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
