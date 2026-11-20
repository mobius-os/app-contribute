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
  queued: [undefined, true],
  reviewRequested: [undefined, true],
}
// The fact reader sets a review request only on someone else's PR (pr-facts.js), so an author with one is not swept: half the cost.
const sweep = () => Object.entries(SPACE).reduce((combos, [key, values]) => combos.flatMap(facts => values.map(value => ({ ...facts, [key]: value }))),
  [{ head: 'h2', openThreads: 0 }]).filter(facts => !(facts.role === 'author' && facts.reviewRequested)).map(facts => ({ ...facts, author: facts.role === 'author' ? 'alex' : 'sam' }))

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
    const inTheWay = facts.readComplete === false || !['open', 'draft'].includes(facts.lifecycle) || (facts.job && facts.job.state !== 'stalled') || facts.outbox || facts.queued === true
    return inTheWay || OFFERED[facts.role].every(id => action(decision, id)?.enabled)
  },
  'take over is for maintainers only': (decision, facts) => !action(decision, 'take_over')?.enabled || ['MAINTAIN', 'ADMIN'].includes(facts.permission),
  'a PR GitHub’s merge queue holds reads as in the merge queue, and its Merge is off for that reason': (decision, facts) => {
    const held = facts.queued === true && ['open', 'draft'].includes(facts.lifecycle) && facts.readComplete !== false
    return !held || (decision.state === 'in_merge_queue' && action(decision, 'merge').reason === 'This pull request is already in the merge queue.')
  },
  // GitHub drops a request when its reviewer reviews, so a request listed beside a review of this version was made again.
  'a request GitHub lists beside your review of this version is your turn to review, unless the PR is a draft or already has an agent job, a draft of yours or the queue': (decision, facts) => {
    const free = facts.role === 'reviewer' && facts.reviewRequested === true && facts.myReview?.commit === facts.head && facts.lifecycle === 'open'
      && facts.readComplete !== false && !facts.job && !facts.outbox && facts.queued !== true
    return !free || (decision.state === 'reviewer.re_requested' && decision.turn === 'you' && action(decision, 'review')?.highlighted === true)
  },
  'a review request changes the words and the turn only: what may be done is exactly what it is without it': (decision, facts) => facts.reviewRequested !== true
    || JSON.stringify(decide({ ...facts, reviewRequested: undefined }).actions.map(({ id, enabled, reason }) => [id, enabled, reason])) === JSON.stringify(decision.actions.map(({ id, enabled, reason }) => [id, enabled, reason])),
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

// The sweep decides about 131,000 PRs, so it runs once for every invariant together: a sweep per invariant
// takes ten times as long. Each invariant keeps its own test and reports the first facts that broke it.
const sweepOnce = () => {
  const broken = new Map()
  const reached = new Set()
  for (const facts of [...cases.map(item => item.facts), ...sweep()]) {
    const decision = decide(facts)
    reached.add(decision.state)
    Object.entries(INVARIANTS).filter(([name, holds]) => !broken.has(name) && !holds(decision, facts)).forEach(([name]) => broken.set(name, facts))
  }
  return { broken, reached }
}
const SWEPT = sweepOnce()

for (const name of Object.keys(INVARIANTS)) {
  test(`invariant: ${name}`, () => {
    assert.ok(!SWEPT.broken.has(name), `${name}: ${JSON.stringify(SWEPT.broken.get(name))}`)
  })
}

test('every state and action named by the table exists, and every state is reachable', () => {
  const { reached } = SWEPT
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

test('a review request listed again after your review of this version is your turn, whatever your review said', () => {
  const base = cases.find(item => item.name === 'You requested changes at this version').facts
  for (const state of ['CHANGES_REQUESTED', 'APPROVED', 'COMMENTED']) {
    const decision = decide({ ...base, myReview: { state, commit: 'h2' }, reviewRequested: true })
    assert.deepEqual([decision.state, decision.turn, decision.label, decision.next], ['reviewer.re_requested', 'you', 'Asked to review again', 'review'], state)
    assert.equal(decide({ ...base, myReview: { state, commit: 'h2' } }).state === 'reviewer.re_requested', false, `${state}: without the request`)
  }
  assert.equal(decide({ ...base, reviewRequested: true, lifecycle: 'draft' }).state, 'reviewer.waiting_author', 'a draft stays its author’s to finish')
  assert.equal(decide({ ...base, reviewRequested: true, queued: true }).state, 'in_merge_queue')
  assert.equal(decide({ ...base, reviewRequested: true, job: { state: 'running' } }).state, 'working', 'an agent already on it comes first')
  assert.equal(decide({ ...base, reviewRequested: false }).state, 'reviewer.waiting_author')
  assert.equal(decide({ ...base, role: 'author', author: 'alex', reviewRequested: true }).state.startsWith('reviewer.'), false, 'an own PR is never read as a request to you')
})

test('a reply alone never brings their PR back for re-review; a new commit does', () => {
  const base = cases.find(item => item.name === 'You requested changes at this version').facts
  assert.equal(decide({ ...base, openThreads: 4 }).state, 'reviewer.waiting_author')
  assert.equal(decide({ ...base, head: 'h3' }).state, 'reviewer.re_review')
})
