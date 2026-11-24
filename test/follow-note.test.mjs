// The owner is told, where a PR is sent, whether it will be followed; which PRs are followed does not change.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { followAfterSend, followAtSend, followWords, followedNow } from '../follow-note.js'

const NOW = 1763460000
const sent = (extra = {}) => ({ id: 'r', type: 'pr', status: 'open', number: 7, url: 'https://github.com/o/r/pull/7', plan: { repo: 'o/r', action: 'pr' }, ...extra })
const record = (extra = {}) => ({ id: 'r', type: 'pr', status: 'prepared', plan: { repo: 'o/r', action: 'pr' }, ...extra })

test('before the send, a PR is followed when the setting is on and this Möbius can follow, and never as a stack member', () => {
  assert.deepEqual(followAtSend(record(), { autopilotDefault: true, available: true }), { followed: true, why: '' })
  assert.deepEqual(followAtSend(record(), { autopilotDefault: false, available: true }), { followed: false, why: 'setting' })
  assert.deepEqual(followAtSend(record(), { autopilotDefault: true, available: false }), { followed: false, why: 'unavailable' })
  assert.deepEqual(followAtSend(record({ plan: { action: 'pr', stack: { id: 's', index: 1 } } }), { autopilotDefault: true, available: true }), { followed: false, why: 'stack' })
  assert.equal(followAtSend(record()).followed, false, 'with nothing known it is not promised')
})

test('after the send, the follow-up region says whether the platform stamped the grant', () => {
  assert.equal(followedNow(sent({ autopilot: { enabled: true, state: 'idle' } }), NOW), true)
  assert.equal(followedNow(sent({ autopilot: { enabled: false } }), NOW), true, 'paused is still a grant the owner holds')
  assert.equal(followedNow(sent(), NOW), false, 'no grant: an agent-opened PR, a stack member or a failed stamp')
  assert.deepEqual(followAfterSend(sent({ autopilot: { enabled: true } }), NOW), { followed: true, why: '' })
  assert.deepEqual(followAfterSend(sent(), NOW), { followed: false, why: 'stamp' })
  assert.deepEqual(followAfterSend(sent({ plan: { action: 'pr', stack: { id: 's' } } }), NOW), { followed: false, why: 'stack' })
})

test('the words say which it is and, when it is not, why', () => {
  assert.equal(followWords({ followed: true }), 'It will be followed: an agent answers its reviews and checks.')
  assert.equal(followWords({ followed: true }, { sent: true }), 'It is followed: an agent answers its reviews and checks.')
  assert.equal(followWords({ followed: false, why: 'setting' }), 'It will not be followed. Follow sent PRs is off in Settings.')
  assert.equal(followWords({ followed: false, why: 'stack' }, { sent: true }), 'It is not followed. A PR in a stack is not followed.')
  assert.equal(followWords({ followed: false, why: 'unavailable' }), 'It will not be followed. This Möbius cannot follow PRs.')
  assert.equal(followWords({ followed: false, why: 'stamp' }, { sent: true }), 'It is not followed. The grant could not be stamped, so it was not turned on.')
})

test('the app hands the answer to the Send card and the send result carries what the platform did; the send request is unchanged', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /followed: updating \? undefined : followAfterSend\(next\),/)
  assert.match(app, /followAtSend=\{record => followAtSend\(record, \{ autopilotDefault, available: conn\.autopilotAvailable === true \}\)\}/)
  assert.match(app, /autopilot: autopilotDefault && connRef\.current\.autopilotAvailable === true,/, 'which PRs are followed is as it was')
})

test('the answer needs no clock from the caller', () => {
  assert.equal(followAfterSend(sent({ autopilot: { enabled: true } })).followed, true)
  assert.equal(followAfterSend(sent()).followed, false)
})
