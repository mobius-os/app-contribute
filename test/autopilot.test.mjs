import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACTIONABLE_ATTENTION,
  BLOCKED_REASON,
  HUMAN_REQUIRED,
  autopilotNarration,
  autopilotRounds,
  autopilotState,
  isActionableAttention,
  isAutopilotBlocked,
  isAutopilotEnabled,
  isAutopilotResponding,
  needsHuman,
} from '../autopilot.js'

test('autopilotState returns the mirror block or null', () => {
  assert.equal(autopilotState(null), null)
  assert.equal(autopilotState({}), null)
  const block = { enabled: true, state: 'idle' }
  assert.equal(autopilotState({ autopilot: block }), block)
})

test('enabled and responding read the mirror block', () => {
  assert.equal(isAutopilotEnabled({ autopilot: { enabled: true } }), true)
  assert.equal(isAutopilotEnabled({ autopilot: { enabled: false } }), false)
  assert.equal(isAutopilotEnabled({}), false)
  assert.equal(
    isAutopilotResponding({ autopilot: { enabled: true, state: 'responding' } }),
    true,
  )
  assert.equal(
    isAutopilotResponding({ autopilot: { enabled: true, state: 'idle' } }),
    false,
  )
})

test('isActionableAttention gates on grant + type, excludes human_required', () => {
  const on = { autopilot: { enabled: true } }
  for (const type of ACTIONABLE_ATTENTION) {
    assert.equal(isActionableAttention({ ...on, attention: { type } }), true)
  }
  // human_required is never "actionable" — it means hand back to the human.
  assert.equal(
    isActionableAttention({ ...on, attention: { type: HUMAN_REQUIRED } }),
    false,
  )
  // A paused / ungranted record is never actionable.
  assert.equal(
    isActionableAttention({
      autopilot: { enabled: false }, attention: { type: 'changes_requested' },
    }),
    false,
  )
  assert.equal(
    isActionableAttention({ attention: { type: 'changes_requested' } }),
    false,
  )
})

test('a blocked record is stopped: not responding, not actionable, narrated as stopped', () => {
  const blocked = { enabled: true, state: 'blocked', last_round: { outcome: 'failed' } }
  assert.equal(isAutopilotBlocked({ autopilot: blocked }), true)
  assert.equal(isAutopilotBlocked({ autopilot: { ...blocked, enabled: false } }), false)
  assert.equal(isAutopilotBlocked({ autopilot: { enabled: true, state: 'idle' } }), false)
  assert.equal(isAutopilotBlocked({}), false)
  assert.equal(isAutopilotResponding({ autopilot: blocked }), false)
  // A newer event overwrote the escalation, but nothing is working it.
  for (const type of ACTIONABLE_ATTENTION) {
    assert.equal(isActionableAttention({ autopilot: blocked, attention: { type } }), false)
  }
  // Its last round failed, yet "will retry shortly" would be untrue: it is stopped.
  assert.equal(autopilotNarration({ autopilot: blocked }), BLOCKED_REASON)
})

test('a comment from outside the repository is never autopilot work', () => {
  assert.equal(ACTIONABLE_ATTENTION.has('outside_activity'), false)
  const rec = {
    autopilot: { enabled: true },
    needs_attention: true,
    attention: { type: 'outside_activity', key: 'outside_activity:x' },
  }
  assert.equal(isActionableAttention(rec), false)
})

test('needsHuman detects the escalation flag', () => {
  assert.equal(
    needsHuman({ needs_attention: true, attention: { type: HUMAN_REQUIRED } }),
    true,
  )
  assert.equal(
    needsHuman({ needs_attention: true, attention: { type: 'checks_failed' } }),
    false,
  )
  assert.equal(needsHuman({ attention: { type: HUMAN_REQUIRED } }), false)
})

test('narration reflects escalation, responding, and last outcome', () => {
  assert.equal(autopilotNarration({}), '')
  assert.equal(autopilotNarration({ autopilot: { enabled: false } }), '')
  assert.match(
    autopilotNarration({
      autopilot: { enabled: true, state: 'responding' },
    }),
    /responding/i,
  )
  assert.match(
    autopilotNarration({
      needs_attention: true,
      autopilot: { enabled: true, state: 'idle' },
      attention: { type: HUMAN_REQUIRED, message: 'Need a decision.' },
    }),
    /Need a decision/,
  )
  assert.match(
    autopilotNarration({
      autopilot: { enabled: true, state: 'idle', last_round: { outcome: 'pushed' } },
    }),
    /pushed/i,
  )
})

test('autopilotRounds returns newest-first plain-text entries', () => {
  const rec = {
    autopilot: {
      enabled: true,
      rounds: [
        { outcome: 'pushed', summary: 'first', finished_at: '2026-07-01T00:00:00Z' },
        { outcome: 'replied', summary: 'second', finished_at: '2026-07-02T00:00:00Z' },
      ],
    },
  }
  const rounds = autopilotRounds(rec)
  assert.equal(rounds.length, 2)
  assert.equal(rounds[0].summary, 'second')
  assert.equal(rounds[0].label, 'Replied to review')
  assert.equal(rounds[1].label, 'Pushed a fix')
  assert.deepEqual(autopilotRounds({}), [])
})
