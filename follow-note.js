// Whether a pull request will be followed (an agent answers its reviews and checks), said where the owner sends it. Today the choice is only a setting
// ("Follow sent PRs"), and a send quietly leaves a PR unfollowed when the platform stamps no grant. This does not change which PRs are followed: it says
// what the send will do, and, once sent, what the platform did, from the follow-up region of the lifecycle.
import { stateOf, vectorOf } from './lifecycle-record.js'

const nowSeconds = () => Math.floor(Date.now() / 1000)
const stacked = record => Boolean(record?.plan?.stack) && typeof record.plan.stack === 'object'

// Before the send: what the request carries (index.jsx: `autopilot: autopilotDefault && autopilotAvailable === true`) and what the platform does with it
// (it never stamps a grant on a member of a stack). `followed` is the answer; `why` the first reason it is not.
export function followAtSend(record, { autopilotDefault = true, available = false } = {}) {
  if (stacked(record)) return { followed: false, why: 'stack' }
  if (!autopilotDefault) return { followed: false, why: 'setting' }
  return available === true ? { followed: true, why: '' } : { followed: false, why: 'unavailable' }
}

// After the send: the follow-up region says whether a grant was stamped (a PR the agent opened, a stack member and a failed stamp have none).
const GRANTED = new Set(['IDLE', 'RESPONDING', 'PAUSED', 'BLOCKED'])
export const followedNow = (record, now = nowSeconds()) => GRANTED.has(stateOf(vectorOf(record, now), 'followup'))

const WHY = {
  stack: 'a PR in a stack is not followed.',
  setting: 'Follow sent PRs is off in Settings.',
  unavailable: 'this Möbius cannot follow PRs.',
  stamp: 'the grant could not be stamped, so it was not turned on.',
}

// The sentence for either moment. `sent` is whether the PR is already sent, and `followed` the answer above.
export function followWords({ followed, why = '' }, { sent = false } = {}) {
  if (followed) return sent ? 'It is followed: an agent answers its reviews and checks.' : 'It will be followed: an agent answers its reviews and checks.'
  const reason = WHY[why] ? ` ${WHY[why][0].toUpperCase()}${WHY[why].slice(1)}` : ''
  return `${sent ? 'It is not followed.' : 'It will not be followed.'}${reason}`
}

// The line under a PR in the send window: before the send, what the send will do (`before` is followAtSend with this app's setting and
// capability); once it went out ('done'), what the platform did (the send's `followed`). Nothing for an update to a PR that is already public, while
// the send is under way or failed, or where no answer is known.
export function followLineOf(record, { before = null, state, followed = null }) {
  if (!before || record?.plan?.action === 'pr_update') return ''
  if (state === undefined) return followWords(before(record))
  return state === 'done' && followed ? followWords(followed, { sent: true }) : ''
}

// What a finished send says of the PR it opened, from the record the platform answered with.
export function followAfterSend(record, now = nowSeconds()) {
  if (followedNow(record, now)) return { followed: true, why: '' }
  return { followed: false, why: stacked(record) ? 'stack' : 'stamp' }
}
