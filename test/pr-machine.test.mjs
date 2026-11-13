import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ACTIONS, STATES, decide, notReadyToMerge } from '../pr-machine.js'

const { cases } = JSON.parse(readFileSync(new URL('./pr-machine.cases.json', import.meta.url), 'utf8'))
const enabledIds = decision => decision.actions.filter(action => action.enabled).map(action => action.id)
const action = (decision, id) => decision.actions.find(item => item.id === id)

// Every combination of the facts that change a decision. The platform sweeps the same space.
const SPACE = {
  role: ['author', 'reviewer'], lifecycle: ['draft', 'open', 'unknown'], checks: ['pass', 'fail', 'pending', 'none', 'unknown'],
  mergeable: ['yes', 'conflict', 'unknown'], permission: ['READ', 'WRITE', 'MAINTAIN'],
  reviews: [[], [{ by: 'sam', state: 'APPROVED', commit: 'h2' }], [{ by: 'sam', state: 'APPROVED', commit: 'h1' }],
    [{ by: 'sam', state: 'CHANGES_REQUESTED', commit: 'h1' }], [{ by: 'qa-bot', state: 'APPROVED', commit: 'h2', bot: true }],
    [{ by: 'sam', state: 'APPROVED', commit: 'h1', sameWork: true }], [{ by: 'sam', state: 'APPROVED', commit: 'h1', sameWork: false }],
    [{ by: 'sam', state: 'CHANGES_REQUESTED', commit: 'h1' }, { by: 'sam', state: 'COMMENTED', commit: 'h2' }], [{ by: 'qa-bot', state: 'COMMENTED', commit: 'h2', bot: true }]],
  myReview: [null, { state: 'APPROVED', commit: 'h2' }, { state: 'CHANGES_REQUESTED', commit: 'h1' }],
  job: [null, { state: 'running' }, { state: 'stalled' }],
  outbox: [null, { head: 'h2', state: 'drafted' }, { head: 'h2', state: 'unconfirmed' }],
  readComplete: [true, false],
  result: [null, { head: 'h2', outcome: 'findings' }, { head: 'h2', outcome: 'clear' }],
}
const sweep = () => Object.entries(SPACE).reduce((combos, [key, values]) => combos.flatMap(facts => values.map(value => ({ ...facts, [key]: value }))),
  [{ head: 'h2', openThreads: 0 }]).map(facts => ({ ...facts, author: facts.role === 'author' ? 'alex' : 'sam' }))

// What changes the PR or starts an agent on it, and what a quiet readable PR always offers its author or its reviewer.
// Take over is left out of OFFERED: it stays for maintainers.
const CHANGES_THE_PR = ['merge', 'close', 'open_for_review', 'back_to_draft', 'check_my_pr', 'respond', 'finish_it', 'review', 'take_over']
const OFFERED = { author: ['check_my_pr', 'respond', 'finish_it', 'open_for_review', 'back_to_draft', 'request_review', 'merge', 'close'], reviewer: ['review', 'merge', 'close'] }
const otherApprovedThisVersion = facts => facts.reviews.some(review => review.state === 'APPROVED' && (review.commit === facts.head || review.sameWork === true) && !review.bot && review.by !== facts.author)
const INVARIANTS = {
  'an author never gets a public review action': decision => decision.role !== 'author' || !decision.actions.some(item => ['draft_verdict', 'review', 'take_over'].includes(item.id)),
  // Ready to merge words the standing and the highlighted step, and it is all the agent's unattended merge asks; Merge itself is never switched off by it.
  'ready to merge needs someone else’s approval of this version (or of the same work), green or no checks, no conflicts': (decision, facts) => notReadyToMerge(facts) !== ''
    || (otherApprovedThisVersion(facts) && ['pass', 'none'].includes(facts.checks) && facts.mergeable === 'yes' && facts.lifecycle === 'open'),
  'not ready to merge while anyone (but a bot) still asks for changes': (decision, facts) => notReadyToMerge(facts) !== ''
    || !facts.reviews.some(review => review.state === 'CHANGES_REQUESTED' && !review.bot && review.by !== facts.author),
  'no agent job starts while one is running on the PR': (decision, facts) => !facts.job || facts.job.state === 'stalled' || decision.actions.filter(item => item.by === 'agent').every(item => !item.enabled),
  'no agent job starts while something sent to GitHub is unconfirmed': (decision, facts) => !(facts.outbox?.head === facts.head && ['sending', 'unconfirmed'].includes(facts.outbox?.state))
    || decision.actions.filter(item => item.by === 'agent').every(item => !item.enabled),
  'unknown checks or conflicts are never ready to merge': (decision, facts) => !(facts.checks === 'unknown' || facts.mergeable === 'unknown' || facts.readComplete === false || facts.lifecycle === 'unknown') || notReadyToMerge(facts) !== '',
  'the Ask actions are offered whenever someone could be asked': (decision, facts) => facts.role !== 'author' || !decision.askable.length || facts.readComplete === false || !['open', 'draft'].includes(facts.lifecycle)
    || ['ask_rereview', 'ask_approval'].every(id => action(decision, id)?.enabled),
  'request review is the author’s whenever the PR can be read and is open, even before anyone has reviewed': (decision, facts) => (action(decision, 'request_review')?.enabled === true)
    === (facts.role === 'author' && ['open', 'draft'].includes(facts.lifecycle) && facts.readComplete !== false),
  'nobody who approved this version can be asked': (decision, facts) => decision.askable.every(person => !decision.approvedBy.some(name => name.toLowerCase() === person.by.toLowerCase())),
  'a PR that cannot be read is never acted on': (decision, facts) => !(facts.readComplete === false || facts.lifecycle === 'unknown')
    || !decision.actions.some(item => CHANGES_THE_PR.includes(item.id) && item.enabled),
  'with nothing in the way, every action of yours is offered, whatever the review standing': (decision, facts) => {
    const inTheWay = facts.readComplete === false || !['open', 'draft'].includes(facts.lifecycle) || (facts.job && facts.job.state !== 'stalled') || facts.outbox
    return inTheWay || OFFERED[facts.role].every(id => action(decision, id)?.enabled)
  },
  'take over is for maintainers only': (decision, facts) => !action(decision, 'take_over')?.enabled || ['MAINTAIN', 'ADMIN'].includes(facts.permission),
  'at most one action is highlighted': decision => decision.actions.filter(item => item.highlighted).length <= 1,
  'a state that highlights an action always offers it': decision => !decision.next || decision.actions.some(item => item.id === decision.next && item.enabled),
}

test('every shared case gives its state, its highlighted action and its allowed actions', () => {
  for (const { name, facts, state, next, enabled } of cases) {
    const decision = decide(facts)
    assert.equal(decision.state, state, name)
    assert.equal(decision.actions.find(item => item.highlighted)?.id || '', next, name)
    assert.deepEqual(enabledIds(decision), enabled, name)
  }
})

for (const [name, holds] of Object.entries(INVARIANTS)) {
  test(`invariant: ${name}`, () => {
    for (const facts of [...cases.map(item => item.facts), ...sweep()]) assert.ok(holds(decide(facts), facts), `${name}: ${JSON.stringify(facts)}`)
  })
}

test('every state and action named by the table exists, and every state is reachable', () => {
  const reached = new Set([...cases.map(item => item.facts), ...sweep()].map(facts => decide(facts).state))
  for (const key of Object.keys(STATES)) assert.ok(reached.has(key) || ['merged', 'closed', 'needs_answer', 'sending', 'author.approved_no_rights'].includes(key), `unreached state ${key}`)
  for (const state of Object.values(STATES)) if (state.next) assert.ok(ACTIONS.some(item => item.id === state.next), state.next)
})

test('each action carries the one refusal the screen shows, and an action of the other role is not offered at all', () => {
  const facts = cases.find(item => item.name.startsWith('Your PR, nobody approved')).facts
  const actions = decide(facts).actions
  assert.equal(action(decide(facts), 'merge').enabled, true, 'nobody approving it does not stop the owner’s own Merge')
  assert.equal(action(decide({ ...facts, job: { state: 'running' } }), 'merge').reason, 'An agent is already working on this PR.')
  assert.equal(action(decide({ ...facts, lifecycle: 'closed' }), 'close').reason, 'This PR is no longer open.')
  assert.equal(actions.some(action => action.id === 'take_over'), false, 'Take over is for someone else’s PR')
})

test('the agent’s own merge keeps the full readiness rule that the owner’s tap no longer carries', () => {
  const facts = cases.find(item => item.name.startsWith('Your PR, nobody approved')).facts
  assert.equal(action(decide(facts), 'merge').reason, '')
  assert.equal(notReadyToMerge(facts), 'Nobody but the author has approved it yet.')
})

test('a reply alone never brings their PR back for re-review; a new commit does', () => {
  const base = cases.find(item => item.name === 'You requested changes at this version').facts
  assert.equal(decide({ ...base, openThreads: 4 }).state, 'reviewer.waiting_author')
  assert.equal(decide({ ...base, head: 'h3' }).state, 'reviewer.re_review')
})
