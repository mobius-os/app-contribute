import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { ACTION_COPY, allowedMergeMethods, mergeCopy, usesMergeQueue } from '../action-copy.js'
import { PR_FIELDS, PR_FIELDS_STAMP } from '../api.js'
import { forgetSameWork, markCarriedApprovals } from '../carried-approvals.js'
import { findingsAnswered, prFacts } from '../pr-facts.js'
import { decide } from '../pr-machine.js'
import { chipOf, frameOf, standingFor } from '../pr-standing.js'
import { POST_REFUSALS, postRefusal, postRefusalCode, postableFindings } from '../review-actions.js'
import { normalizeResult } from '../respond-result.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const rollup = { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }], statusContextCountsByState: [] } } } }] } }
const opinion = (login, state, oid = HEAD, extra = {}) => ({ state, author: { login, __typename: 'User' }, commit: { oid }, ...extra })
const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', baseRefOid: 'c'.repeat(40), mergeable: 'MERGEABLE', author: { login: 'Sam' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE', squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true },
  latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, ...rollup, ...extra,
})
const mine = extra => pull({ author: { login: 'Alex' }, ...extra })
const run = (item, extra = {}) => ({ id: 'r1', created_at: '2026-11-04T10:00:00Z', execution_state: 'completed', state: 'complete', mode: 'review',
  items: [{ repo: 'o/r', number: 7, head_sha: HEAD, base_ref: 'main', ...item }], ...extra })
const decideFor = (pr, runs = [], extra = {}) => decide(prFacts({ pr, login: 'alex', runs, ...extra }))
const action = (decision, id) => decision.actions.find(item => item.id === id)

// ---- A posted answer that covers the findings closes them.

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const answer = (state, patch = {}) => ({ slug: 'o__r__7', decision: null, result: normalizeResult({ ...example(), repo: 'o/r', number: 7, state, tip_sha: HEAD,
  pr: { ...example().pr, head_sha: HEAD }, points: [{ ...example().points[0], reviewer: 'Agent review' }], ...patch }) })
const findings = [run({ state: 'needs_you', summary: 'P1' })]

test('your PR’s findings are answered once a posted reply covers them, and not before', () => {
  assert.equal(decideFor(mine(), findings).state, 'author.findings')
  assert.equal(decideFor(mine(), findings, { responses: [answer('posted')] }).state, 'author.waiting_review', 'nothing is left to answer')
  const review = { run: findings[0], item: findings[0].items[0] }
  assert.equal(findingsAnswered([answer('posted')], mine(), review), true)
  // A reply that is only a draft, one made for another version, one that took on none of the review’s points, and one posted before the review do not.
  assert.equal(findingsAnswered([answer('ready')], mine(), review), false)
  assert.equal(findingsAnswered([answer('posted', { pr: { ...example().pr, head_sha: OLD } })], mine(), review), false)
  assert.equal(findingsAnswered([answer('posted', { points: [{ ...example().points[0], reviewer: 'alex' }] })], mine(), review), false)
  assert.equal(findingsAnswered([answer('posted', { created_at: '2026-11-03T10:00:00Z' })], mine(), review), false)
  assert.equal(findingsAnswered([], mine(), review), false)
  assert.equal(findingsAnswered([answer('posted')], mine(), null), false)
  // The PR moved on after the reply: the reply is history, and a review of the new version stands alone.
  assert.equal(decideFor(mine({ headRefOid: OLD }), findings, { responses: [answer('posted')] }).state, 'author.waiting_review')
})

// ---- A clean review you kept private does not lift your own change request.

test('your own change request of an older version outranks a clean private review of the new one', () => {
  const clean = [run({ state: 'all_clear' })]
  const requested = pull({ viewerLatestReview: { state: 'CHANGES_REQUESTED', commit: { oid: OLD } }, latestOpinionatedReviews: { nodes: [opinion('Alex', 'CHANGES_REQUESTED', OLD)] } })
  const decision = decideFor(requested, clean)
  assert.deepEqual([decision.state, decision.label, decision.turn], ['reviewer.re_review', 'New commits · review again', 'you'])
  assert.equal(decideFor(requested).state, 'reviewer.re_review', 'as it reads without the review')
  // Nothing else changes: with no request of yours the clean review is a private review of this version, and an older approval is not a request.
  assert.equal(decideFor(pull(), clean).state, 'reviewer.kept_private')
  const approvedOld = pull({ viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } }, latestOpinionatedReviews: { nodes: [opinion('Alex', 'APPROVED', OLD)] } })
  assert.equal(decideFor(approvedOld, clean).state, 'reviewer.kept_private')
  // A review you have not set aside is yours to send, as before.
  assert.equal(decideFor(requested, [run({ state: 'needs_you', summary: 'P1' })]).state, 'reviewer.result_ready')
})

// ---- Your own approval of the same work still holds.

test('your own approval of an older commit still holds when the work is proved the same', async () => {
  forgetSameWork()
  const patch = { filename: 'a.js', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@\n+x' }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ files: [patch] }) })
  const alexApproved = { state: 'APPROVED', author: { login: 'Alex', __typename: 'User' }, commit: { oid: OLD } }
  const data = { p0: { pullRequest: pull({ latestOpinionatedReviews: { nodes: [{ ...alexApproved }] }, viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } } }) } }
  await markCarriedApprovals('t', data)
  const read = data.p0.pullRequest
  assert.equal(read.viewerLatestReview.sameWork, true, 'the reader marks the viewer’s own latest review too')
  const decision = decideFor(read)
  assert.equal(decision.state, 'reviewer.mergeable')
  assert.match(decision.headline, /your approval still holds, checks green\. The change is the same/)
  // The same approval without the proof is old, as before; so is the proof for a review that is not an approval.
  assert.equal(decideFor({ ...read, viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } }, latestOpinionatedReviews: { nodes: [alexApproved] } }).state, 'reviewer.re_review')
  const requested = { state: 'CHANGES_REQUESTED', commit: { oid: OLD }, sameWork: true }
  assert.equal(decideFor({ ...read, viewerLatestReview: requested, latestOpinionatedReviews: { nodes: [{ ...alexApproved, state: 'CHANGES_REQUESTED' }] } }).state, 'reviewer.re_review')
  // A viewer who is not a writer, or an approval at this version, is not looked up.
  const calls = []
  forgetSameWork()
  globalThis.fetch = async url => { calls.push(url); return { ok: false, status: 404, json: async () => null } }
  await markCarriedApprovals('t', { p0: { pullRequest: pull({ repository: { nameWithOwner: 'o/r', viewerPermission: 'READ' }, viewerLatestReview: { state: 'APPROVED', commit: { oid: OLD } } }) } })
  await markCarriedApprovals('t', { p0: { pullRequest: pull({ viewerLatestReview: { state: 'APPROVED', commit: { oid: HEAD } } }) } })
  assert.deepEqual(calls, [])
})

// ---- The merge queue.

test('the PR read asks GitHub whether the merge queue holds the PR and whether its branch uses one', () => {
  assert.match(PR_FIELDS, /mergeQueueEntry \{ id \}/)
  assert.match(PR_FIELDS, /isMergeQueueEnabled/)
  assert.match(PR_FIELDS_STAMP, /^\d+$/)
})

test('a PR in GitHub’s merge queue is in the merge queue: nobody’s step but GitHub’s, and Merge is off', () => {
  for (const [name, pr] of [['theirs', pull({ mergeQueueEntry: { id: 'mq1' } })], ['yours', mine({ mergeQueueEntry: { id: 'mq1' }, latestOpinionatedReviews: { nodes: [opinion('Sam', 'APPROVED')] } })]]) {
    const decision = decideFor(pr)
    assert.deepEqual([decision.state, decision.label, decision.turn, decision.waitingOn], ['in_merge_queue', 'In merge queue', 'other', 'GitHub'], name)
    assert.equal(decision.headline, 'In the merge queue. GitHub merges it when the queue reaches it')
    assert.deepEqual([action(decision, 'merge').enabled, action(decision, 'merge').reason], [false, 'This pull request is already in the merge queue.'], name)
    assert.equal(decision.next, '')
    assert.deepEqual([frameOf(decision), chipOf(decision)], ['idle', { label: 'In merge queue', tone: 'waiting' }])
  }
  // A PR that merged or closed is not "in the queue"; one the queue does not hold is as before.
  assert.equal(decideFor(pull({ mergeQueueEntry: { id: 'mq1' }, state: 'MERGED' })).state, 'merged')
  assert.equal(decideFor(pull({ mergeQueueEntry: null })).state, 'reviewer.to_review')
  assert.equal(prFacts({ pr: pull(), login: 'alex' }).queued, null, 'a read that does not say asks nothing')
})

test('a merge this app’s review queued reads as in the queue until GitHub’s own answer says otherwise, never as sending', () => {
  const queued = [run({ state: 'queued' }, { state: 'queued' })]
  assert.equal(decideFor(pull(), queued).state, 'in_merge_queue')
  assert.equal(decideFor(pull({ mergeQueueEntry: null }), queued).state, 'reviewer.to_review', 'GitHub says the queue does not hold it: the saved word is stale')
  assert.equal(decideFor(pull({ headRefOid: OLD }), queued).state, 'reviewer.to_review', 'a queue entry is of one version')
})

test('where the base branch uses a merge queue the sheet offers no way to land it: the queue chooses', () => {
  const copy = mergeCopy(pull())
  assert.equal(copy.choices.options.length, 3)
  assert.equal(allowedMergeMethods(pull().repository).length, 3)
  for (const pr of [pull({ isMergeQueueEnabled: true }), pull({ isMergeQueueEnabled: true, mergeQueueEntry: null })]) {
    const queue = mergeCopy(pr, { method: 'rebase' })
    assert.equal(queue.choices, null, 'no choice of method')
    assert.equal(queue.confirm, 'Merge', 'and no method named on the button')
    assert.equal(usesMergeQueue(pr), true)
  }
  assert.equal(usesMergeQueue(pull({ isMergeQueueEnabled: false })), false)
  assert.equal(usesMergeQueue(pull()), false, 'an older copy of the PR asks as before')
  assert.equal(ACTION_COPY.merge, mergeCopy)
  assert.equal(mergeCopy(pull({ isMergeQueueEnabled: true })).done({ state: 'queued' }).title, 'Added to the merge queue')
})

// ---- Post findings is offered only where the platform would accept it.

test('findings are offered for posting only where the platform would take them', () => {
  const found = extra => ({ state: 'needs_you', summary: 'P1 found', ...extra })
  assert.equal(postableFindings(found()), true)
  assert.equal(postableFindings(found({ state: 'all_clear' })), true, 'a clean review can be posted too')
  const refused = [
    ['blocked', found({ blocked: true })],
    ['no_result', found({ summary: '  ' })], ['no_result', found({ summary: undefined })], ['no_result', found({ state: 'failed' })], ['no_result', found({ state: 'reviewing' })],
    ['has_verdict', found({ verdict_proposal: { state: 'discarded', event: 'REQUEST_CHANGES' } })], ['has_verdict', found({ verdict_proposal: { state: 'proposed', event: 'COMMENT' } })],
    ['already_sent', found({ public_review: { state: 'posting' } })], ['already_sent', found({ public_review: { state: 'posted', url: 'u' } })], ['already_sent', found({ public_review: { state: 'unknown' } })],
  ]
  for (const [code, item] of refused) {
    assert.equal(postableFindings(item), false, JSON.stringify(item))
    assert.equal(postRefusalCode(item), code)
    assert.equal(postRefusal(item), POST_REFUSALS[code])
  }
  assert.equal(postRefusal(found()), '')
  assert.match(POST_REFUSALS.blocked, /did not finish, so there is nothing to post/)
})

test('the platform’s own answer on an item decides, in its own words, and an answer this app does not know reads as no result', () => {
  const item = { state: 'needs_you', summary: 'P1 found' }
  assert.equal(postableFindings({ ...item, post_findings: { allowed: true } }), true)
  assert.equal(postableFindings({ ...item, post_findings: { allowed: false, code: 'has_verdict' } }), false)
  assert.equal(postRefusal({ ...item, post_findings: { allowed: false, code: 'has_verdict' } }), 'This review already has a verdict. Submit or discard that one.')
  assert.equal(postRefusalCode({ ...item, post_findings: { allowed: false, code: 'something_new' } }), 'no_result')
  // An item with no such answer (an older platform) is read from its own fields.
  assert.equal(postableFindings({ ...item, post_findings: {} }), true)
  assert.equal(postableFindings({ state: 'needs_you', summary: 'P1', blocked: true, post_findings: undefined }), false)
})

test('the standing keeps working with an old platform that returns none of the new fields', () => {
  const decision = standingFor({ pr: pull(), login: 'alex', runs: [run({ state: 'needs_you', summary: 'P1', blocked: true })] })
  assert.equal(decision.state, 'reviewer.to_review')
  assert.equal(prFacts({ pr: pull(), login: 'alex', runs: [run({ state: 'all_clear' })] }).queued, null)
})
