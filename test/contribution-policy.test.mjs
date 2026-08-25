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

test('disconnected owners use the Möbius bot only for mobius-os', () => {
  assert.deepEqual(
    contributionPathDecision(mobius, 'github', 'disconnected'),
    { method: 'mobius', error: '' },
  )
  assert.deepEqual(
    contributionPathDecision(external, 'mobius', 'disconnected'),
    {
      method: 'github',
      error: 'Connect GitHub to contribute to repositories outside mobius-os.',
    },
  )
})

test('connected owners default to GitHub but may choose the bot for mobius-os', () => {
  assert.equal(
    contributionPathDecision(mobius, 'github', 'connected').method,
    'github',
  )
  assert.equal(
    contributionPathDecision(mobius, 'mobius', 'connected').method,
    'mobius',
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
    'mobius',
  )
})
