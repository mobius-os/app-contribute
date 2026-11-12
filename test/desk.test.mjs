import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESK_VIEWS,
  NEEDS_CHIPS,
  deskViewKey,
  authoredPulls,
  chainPulls,
  deskCounts,
  needsRows,
  projectNeedsCount,
  mergedRecently,
  needsCount,
  newSince,
  railBadge,
  settleReviewRequest,
  splitProjects,
  stepOf,
} from '../desk.js'
import { standingFor } from '../pr-standing.js'
import { classifyReview } from '../review-list.js'
import { NAMES } from '../names.js'

const rollup = (passed, failed, pending = 0) => ({ nodes: [{ commit: { statusCheckRollup: { state: 'x', contexts: {
  totalCount: passed + failed + pending,
  checkRunCountsByState: [
    ...(passed ? [{ state: 'SUCCESS', count: passed }] : []),
    ...(failed ? [{ state: 'FAILURE', count: failed }] : []),
    ...(pending ? [{ state: 'PENDING', count: pending }] : []),
  ],
  statusContextCountsByState: [],
} } } }] })

const HEAD = 'a'.repeat(40)
// A PR as GitHub returns it complete: the shared decision reads a PR missing these facts as "could not be read".
const pr = (number, extra = {}) => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  author: { login: 'owner' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  headRefName: `head-${number}`,
  baseRefName: 'main',
  headRefOid: HEAD,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  latestOpinionatedReviews: { nodes: [] },
  viewerLatestReview: null,
  reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  updatedAt: '2026-11-02T08:00:00Z',
  ...extra,
})
const opinion = (state, who = 'teammate') => ({ latestOpinionatedReviews: { nodes: [{ state, author: { login: who }, commit: { oid: HEAD } }] } })
const approved = (extra = {}) => pr(2, { ...opinion('APPROVED'), ...extra })
// A finished review of PR `number` at HEAD, as the saved runs list it.
const reviewRun = (number, state = 'all_clear', head = HEAD) => ({ id: `run-${number}`, created_at: '2026-11-03T22:00:00Z', state: 'complete', execution_state: 'completed', chat_id: 'c', items: [{ repo: 'o/r', number, head_sha: head, state }] })
// The review list's row for a PR someone else wrote that the owner reviewed (a live read, classified as the page does).
const reviewed = (number, live, runs = []) => {
  const item = { repo: 'o/r', number, title: `Review of ${number}` }
  return { id: `o/r#${number}`, at: 1, run: { created_at: '2026-11-03T22:00:00Z' }, item, ...classifyReview({ item }, { login: 'owner', live, runs }) }
}

test('every PR waits on you under the step of its one shared decision: merge, fix, or review again', () => {
  const decide = (candidate, login = 'owner') => standingFor({ pr: candidate, login })
  const step = candidate => stepOf(decide(candidate))
  assert.equal(step(approved()), 'merge')
  assert.equal(step(pr(3, { commits: rollup(10, 2) })), 'fix', 'failing checks')
  assert.equal(step(pr(4, { mergeable: 'CONFLICTING' })), 'fix', 'a merge conflict')
  assert.equal(step(pr(5, opinion('CHANGES_REQUESTED'))), 'fix', 'a change request at this version')
  const theirs = (extra = {}) => pr(6, { author: { login: 'teammate' }, viewerLatestReview: { state: 'APPROVED', commit: { oid: HEAD } }, ...opinion('APPROVED', 'owner'), ...extra })
  assert.equal(step(theirs()), 'merge', 'a PR you reviewed that is ready to merge is a Merge too')
  assert.equal(step(theirs({ headRefOid: 'b'.repeat(40) })), 'again', 'new commits since your review')
})

test('the shared decision, not GitHub\'s review decision, says what waits: pending checks, an old approval, a plain comment', () => {
  const rows = incoming => needsRows({ pulls: incoming, login: 'owner' }).map(row => [row.pr.number, row.step])
  // Approved, but checks are still running or the PR has conflicts: not ready to merge.
  assert.deepEqual(rows([approved({ commits: rollup(3, 0, 1) }), approved({ mergeable: 'UNKNOWN' })]), [])
  // Approved at an older commit: waiting on the reviewer to look again, nothing for you.
  assert.deepEqual(rows([pr(3, { headRefOid: 'b'.repeat(40), ...opinion('APPROVED') })]), [])
  // GitHub's own decision is null here, yet the approval counts, and a reviewer's plain comment is a move of yours.
  assert.deepEqual(rows([pr(4, { reviewDecision: null, ...opinion('APPROVED') })]), [[4, 'merge']])
  assert.deepEqual(rows([pr(5, { latestReviews: { nodes: [{ state: 'COMMENTED', body: '', author: { login: 'teammate' }, commit: { oid: HEAD } }] } })]), [[5, 'fix']], 'commented, not approved')
  // Waiting on reviewers, a draft with failing checks, and a PR that could not be read completely say nothing to do yet.
  assert.deepEqual(rows([pr(6), pr(7, { isDraft: true, commits: rollup(1, 2) }), pr(8, { latestOpinionatedReviews: null })]), [])
})

test('authored pulls keep only the owner PRs that are not review requests', () => {
  const incoming = [
    pr(1, { reviewRequested: true }),
    pr(2, { author: { login: 'Owner' } }),
    pr(3, { author: { login: 'teammate' } }),
  ]
  assert.deepEqual(authoredPulls(incoming, 'owner').map(item => item.number), [2])
  assert.deepEqual(authoredPulls(incoming, ''), [])
})

test('chained PRs group into one stack in merge order, whatever order GitHub returned', () => {
  const second = pr(44, { baseRefName: 'head-43' })
  const third = pr(45, { baseRefName: 'head-44' })
  const first = pr(43, { baseRefName: 'main' })
  const lone = pr(9, { baseRefName: 'main' })
  const groups = chainPulls([third, lone, first, second])
  const chain = groups.find(group => group.length === 3)
  assert.deepEqual(chain.map(item => item.number), [43, 44, 45])
  assert.ok(groups.some(group => group.length === 1 && group[0].number === 9))
})

test('merged this week keeps only recent merged or superseded records', () => {
  const now = Date.parse('2026-11-02T09:00:00Z')
  const records = [
    { id: 'a', status: 'merged', updated_at: '2026-11-01T10:00:00Z' },
    { id: 'b', status: 'merged', updated_at: '2026-10-20T10:00:00Z' },
    { id: 'c', status: 'superseded', updated_at: '2026-10-30T10:00:00Z' },
    { id: 'd', status: 'open', updated_at: '2026-11-01T10:00:00Z' },
  ]
  assert.deepEqual(mergedRecently(records, now).map(record => record.id), ['a', 'c'])
})

test('new-since-you-looked needs a previous visit and a newer change', () => {
  assert.equal(newSince('2026-11-02T08:00:00Z', ''), false)
  assert.equal(newSince('2026-11-02T08:00:00Z', '2026-11-01T00:00:00Z'), true)
  assert.equal(newSince('2026-10-30T08:00:00Z', '2026-11-01T00:00:00Z'), false)
})

test('the counts name next steps and the rail badges follow them', () => {
  const incoming = [
    pr(1, { reviewRequested: true, author: { login: 'teammate' } }),
    approved(),
    pr(3, { commits: rollup(3, 1) }),
    pr(4, { isDraft: true }),
  ]
  const decisions = [
    { kind: 'public_attention', record: { number: 3 } },
    { kind: 'private_review', record: { number: 9 } },
  ]
  // Your check of the draft was clean, so it is ready to open: a quiet line, never a number in the chips.
  const counts = deskCounts({ decisions, incoming, records: [], login: 'owner', runs: [reviewRun(4)] })
  assert.equal(counts.questions, 1)
  assert.equal(counts.requests, 1)
  assert.equal(counts.merge, 1)
  assert.equal(counts.fix, 1)
  assert.equal(counts.again, 0)
  assert.equal(counts.drafts, 1)
  assert.equal(counts.mine, 3)
  assert.equal(needsCount(counts), 4)
  assert.equal(railBadge('needs', counts), 4)
  assert.equal(railBadge('requests', counts), 1)
  assert.equal(railBadge('runs', counts), 0)
  assert.equal(railBadge('runs', { reviewsRunning: 2 }), 2)
})

test('projects with review requests never fold into the quiet group', () => {
  const quiet = { key: 'a', kind: 'app', available: true, state: 'clean', localFiles: 0, compatibleFiles: 0, conflictFiles: 0, workingFiles: 0 }
  const asked = { ...quiet, key: 'b', reviewRequests: [pr(1)] }
  const groups = splitProjects([quiet, asked], {})
  assert.deepEqual(groups.quiet.map(project => project.key), ['a'])
  assert.deepEqual(groups.active.map(project => project.key), ['b'])
})

test('feedback on a published PR opens the PR itself; publication decisions keep their card', async () => {
  const { feedbackPull } = await import('../desk.js')
  const record = { number: 1791, repo: 'mobius-os/mobius' }
  assert.deepEqual(feedbackPull({ kind: 'public_attention', record }),
    { number: 1791, repository: { nameWithOwner: 'mobius-os/mobius' } })
  assert.equal(feedbackPull({ kind: 'publish', record }), null)
  assert.equal(feedbackPull({ kind: 'public_attention', record: { repo: 'o/r' } }), null)
})

test('a PR with a feedback card and a fix step counts once in Needs you', () => {
  const owned = number => pr(number, opinion('CHANGES_REQUESTED'))
  const decisions = [{ kind: 'public_attention', record: { repo: 'o/r', number: 1 } }]
  const counts = deskCounts({ decisions, incoming: [owned(1), owned(2)], records: [], login: 'owner' })
  // One feedback card + two PRs to fix, but #1 is the same work as its card: it counts once, as the card.
  assert.equal(counts.questions, 1)
  assert.equal(counts.fix, 1)
  assert.equal(needsCount(counts), 2)
  assert.equal(railBadge('needs', counts), 2)
})

test('a project number is what its Needs you card lists: requests, feedback cards, and own PRs not already covered', () => {
  const owned = (number, extra = {}) => pr(number, { ...opinion('CHANGES_REQUESTED'), ...extra })
  const project = { reviewRequests: [{ number: 50 }], incomingReviews: [owned(1), owned(2), owned(3, { latestOpinionatedReviews: { nodes: [] } })] }
  const decisions = [{ kind: 'public_attention', record: { repo: 'o/r', number: 1 } }]
  // 1 request + 1 feedback card (#1) + #2 (needs a fix); #1 is covered and #3 is just waiting.
  assert.equal(projectNeedsCount(project, decisions, 'owner'), 3)
  assert.equal(projectNeedsCount({ incomingReviews: [] }, [], 'owner'), 0)
})

test('the rail has four views and every older view lands inside one of them', () => {
  assert.deepEqual(DESK_VIEWS.map(view => view.label), ['Needs you', 'Review requests', 'My PRs', 'Agent runs'])
  assert.deepEqual(DESK_VIEWS.map(view => view.key), ['needs', 'requests', 'mine', 'runs'])
  const landing = { confirm: 'needs', edits: 'needs', merged: 'mine', work: 'runs', reviews: 'runs', needs: 'needs', runs: 'runs' }
  for (const [old, now] of Object.entries(landing)) assert.equal(deskViewKey(old), now, old)
})

// Someone else's PR the owner reviewed at HEAD, now with `live` changes, as the Agent runs page classifies it.
const theirs = (number, live = {}, runs = []) => reviewed(number, pr(number, { author: { login: 'teammate' }, viewerLatestReview: { state: 'APPROVED', commit: { oid: HEAD } }, ...opinion('APPROVED', 'owner'), ...live }), runs)
const moved = { headRefOid: 'b'.repeat(40) }

test('the Needs you badge is the sum of the chips next to it, whatever the page holds', () => {
  const incoming = [
    pr(1, { reviewRequested: true, author: { login: 'teammate' } }),
    approved(),
    pr(3, { commits: rollup(3, 1) }),
    pr(4, { isDraft: true }),
  ]
  const entries = [
    theirs(7, moved),
    { id: 'o/r#8', bucket: 'running', item: { repo: 'o/r', number: 8 } },
    { id: 'o/r#9', bucket: 'done', item: { repo: 'o/r', number: 9 } },
  ]
  const counts = deskCounts({ decisions: [], incoming, records: [], login: 'owner', reviews: { running: 1 }, reviewEntries: entries, runs: [reviewRun(4)] })
  const chips = NEEDS_CHIPS.map(chip => chip.count(counts))
  assert.deepEqual(chips, [0, 1, 1, 1, 1])
  assert.equal(NEEDS_CHIPS.at(-1).label, NAMES.reviewAgain, 'the chip holds PRs to review again, so it says so')
  assert.equal(railBadge('needs', counts), chips.reduce((a, b) => a + b, 0))
  // A draft ready to open and local files are not urgent: they never enter the number.
  assert.equal(counts.drafts, 1)
})

test('a reviewed PR that is ready to merge counts under Merge, never under Review again', () => {
  const entries = [theirs(5), theirs(6, moved)]
  assert.deepEqual(entries.map(entry => entry.bucket), ['waiting', 'waiting'], 'the Agent runs page lists both as waiting on you')
  const counts = deskCounts({ reviewEntries: entries, login: 'owner' })
  assert.deepEqual([counts.merge, counts.again], [1, 1])
  assert.equal(needsCount(counts), 2)
})

test('each PR counts once: a request, a card or an own PR already listed is not counted again for its review run', () => {
  const asked = pr(1, { reviewRequested: true, author: { login: 'teammate' } })
  // #7 is a draft of yours with failing checks and a review that found problems: one Fix, not a Fix and a Review again.
  const draft = pr(7, { isDraft: true, commits: rollup(1, 2) })
  const entries = [theirs(1, moved), reviewed(7, draft, [reviewRun(7, 'needs_you')])]
  const counts = deskCounts({ incoming: [asked, draft], login: 'owner', reviewEntries: entries, runs: [reviewRun(7, 'needs_you')] })
  assert.deepEqual([counts.requests, counts.fix, counts.again], [1, 1, 0])
  assert.equal(needsCount(counts), 2)
  // A review run on a PR the desk has no other row for is its own row, stopped or waiting.
  const stopped = reviewed(2, pr(2, { author: { login: 'teammate' } }), [{ ...reviewRun(2, 'reviewing'), state: 'running', execution_state: 'failed' }])
  assert.equal(stopped.bucket, 'stalled')
  assert.equal(deskCounts({ reviewEntries: [stopped], login: 'owner' }).again, 1)
})

// The incoming PRs and the review list read GitHub on their own, so for a while they can show one PR at two versions.
const NEWER = 'b'.repeat(40)

test('a review that waits on you is not hidden by a PR list that is a version behind', () => {
  // The PR list still has #7 at the old version (waiting on reviewers, so no row); the review list's newer read has findings at the new one.
  const behind = pr(7)
  const entry = reviewed(7, pr(7, { headRefOid: NEWER }), [reviewRun(7, 'needs_you', NEWER)])
  assert.equal(standingFor({ pr: behind, login: 'owner' }).state, 'author.waiting_review')
  assert.equal(entry.decision.state, 'author.findings')
  assert.deepEqual(needsRows({ pulls: [behind], entries: [entry], login: 'owner' }).map(row => [row.step, row.entry?.id]), [['fix', 'o/r#7']])
  // Every place that counts the rows counts it: the chips, the rail's number and the repository's own.
  const counts = deskCounts({ incoming: [behind], login: 'owner', reviewEntries: [entry] })
  assert.deepEqual([counts.fix, needsCount(counts)], [1, 1])
  assert.equal(projectNeedsCount({ canonical_repo: 'o/r', incomingReviews: [behind], reviewRequests: [] }, [], 'owner', [entry]), 1)
})

test('a PR already listed as a row is not listed a second time for its review, at either version', () => {
  const run = reviewRun(7, 'needs_you')
  const entry = reviewed(7, pr(7), [run])
  const rows = needsRows({ pulls: [pr(7)], entries: [entry], login: 'owner', facts: { runs: [run] } })
  assert.deepEqual(rows.map(row => [row.step, !!row.pr, !!row.entry]), [['fix', true, false]], 'one row, the PR\'s own')
  // Failing checks make the PR list's row at the old version; the review list's newer read of the same PR adds nothing.
  const failing = pr(8, { commits: rollup(1, 2) })
  const newer = reviewed(8, pr(8, { headRefOid: NEWER, commits: rollup(1, 2) }), [reviewRun(8, 'needs_you', NEWER)])
  assert.deepEqual(needsRows({ pulls: [failing], entries: [newer], login: 'owner' }).map(row => [row.step, !!row.pr]), [['fix', true]])
})

test('a draft ready to open stays a quiet line, whether or not the PR list holds it, but findings on a newer version of it wait on you', () => {
  const draft = pr(8, { isDraft: true })
  const quiet = reviewed(8, draft, [reviewRun(8)])
  assert.equal(quiet.decision.state, 'author.draft_ready')
  assert.deepEqual(needsRows({ pulls: [draft], entries: [quiet], login: 'owner' }), [])
  assert.deepEqual(needsRows({ pulls: [], entries: [quiet], login: 'owner' }), [])
  assert.equal(needsCount(deskCounts({ incoming: [draft], login: 'owner', reviewEntries: [quiet] })), 0)
  const found = reviewed(8, pr(8, { isDraft: true, headRefOid: NEWER }), [reviewRun(8, 'needs_you', NEWER)])
  assert.deepEqual(needsRows({ pulls: [draft], entries: [found], login: 'owner' }).map(row => row.step), ['fix'])
})

test('a submitted review takes only its own PR out of the review requests', () => {
  const asks = number => pr(number, { reviewRequested: true })
  const other = { ...asks(9), repository: { nameWithOwner: 'o/other' } }
  const rows = [asks(7), asks(8), other]
  const settled = settleReviewRequest(rows, 'O/R', 7)
  assert.deepEqual(settled.map(row => row.reviewRequested), [false, true, true])
  assert.equal(settled[0].title, 'PR 7', 'the PR stays listed, as GitHub still counts it as involving the owner')
  assert.equal(settled[1], rows[1], 'other rows are untouched')
  assert.equal(rows[0].reviewRequested, true, 'the list it was given is not changed')
})
