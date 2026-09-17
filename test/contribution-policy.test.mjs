import assert from 'node:assert/strict'
import test from 'node:test'

import {
  contributionPathDecision,
  contributionStackDecision,
  isMobiusRepository,
} from '../contribution-policy.js'

const mobius = { repo: 'mobius-os/mobius' }
const external = { plan: { repo: 'owner/mobius' } }

test('recognizes only mobius-os repositories as bot-eligible', () => {
  assert.equal(isMobiusRepository(mobius), true)
  assert.equal(isMobiusRepository({ repo: 'MOBIUS-OS/docs' }), true)
  assert.equal(isMobiusRepository(external), false)
  assert.equal(isMobiusRepository({ repo: 'mobius-os' }), false)
})

test('new contributions require the connected owner GitHub identity', () => {
  assert.deepEqual(
    contributionPathDecision(mobius, 'github', 'disconnected'),
    { method: 'github', error: 'Connect GitHub to contribute as your account.' },
  )
  assert.deepEqual(
    contributionPathDecision(external, 'mobius', 'disconnected'),
    {
      method: 'github',
      error: 'Connect GitHub to contribute as your account.',
    },
  )
})

test('connected owners always use GitHub for new contributions', () => {
  assert.equal(contributionPathDecision(mobius, undefined, 'connected').method, 'github')
  assert.equal(
    contributionPathDecision(mobius, 'github', 'connected').method,
    'github',
  )
  assert.equal(
    contributionPathDecision(mobius, 'mobius', 'connected').method,
    'github',
  )
  assert.equal(
    contributionPathDecision(external, 'mobius', 'connected').method,
    'github',
  )
})

test('a stack follows personal GitHub if any layer is outside mobius-os', () => {
  assert.equal(
    contributionStackDecision([mobius, external], 'mobius', 'connected').method,
    'github',
  )
  assert.equal(
    contributionStackDecision([mobius], 'mobius', 'connected').method,
    'github',
  )
})

test('legacy Möbius-bot records retain their compatibility route', () => {
  assert.equal(
    contributionPathDecision({ ...mobius, submission_mode: 'mobius-bot' }, undefined, 'connected').method,
    'mobius',
  )
})
