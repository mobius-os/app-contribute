import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchLiveStates } from '../api.js'
import { prFacts } from '../pr-facts.js'
import { decide } from '../pr-machine.js'

// The Ask sheet names everyone who reviewed or commented (GitHub's newest review of each person), not only the writers
// whose opinions decide the merge standing.
const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
const review = (login, state, oid = HEAD, typename = 'User') => ({ state, author: { login, __typename: typename }, commit: { oid } })
const pull = (extra = {}) => ({
  id: 'PR_1', number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE',
  author: { login: 'alex' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [] }, latestReviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra,
})
const decideFor = pr => decide(prFacts({ pr, login: 'alex' }))
const ask = (decision, id) => decision.actions.find(action => action.id === id)
const by = decision => decision.askable.map(person => person.by)

test('a reviewer without write access, who GitHub’s opinions leave out, can be asked', () => {
  const outside = pull({ latestReviews: { nodes: [review('dana', 'CHANGES_REQUESTED', OLD)] } })
  const decision = decideFor(outside)
  assert.deepEqual(decision.askable, [{ by: 'dana', reason: 'changes_older', commit: OLD }])
  assert.equal(ask(decision, 'ask_approval').enabled, true)
  assert.equal(ask(decision, 'ask_rereview').enabled, true)
  assert.deepEqual(by(decideFor(pull({ latestReviews: { nodes: [review('dana', 'CHANGES_REQUESTED')] } }))), ['dana'])
  assert.equal(decideFor(pull({ latestReviews: { nodes: [review('dana', 'CHANGES_REQUESTED')] } })).askable[0].reason, 'changes_here')
  assert.equal(decideFor(pull({ latestReviews: { nodes: [review('dana', 'APPROVED', OLD)] } })).askable[0].reason, 'approved_older')
  assert.equal(decideFor(pull({ latestReviews: { nodes: [review('dana', 'COMMENTED', OLD)] } })).askable[0].reason, 'commented_older')
})

test('asking people never changes the merge standing: an outside request is no change request and an outside approval is no approval', () => {
  const alone = decideFor(pull())
  for (const state of ['CHANGES_REQUESTED', 'APPROVED']) {
    const decision = decideFor(pull({ latestReviews: { nodes: [review('dana', state, OLD)] } }))
    assert.equal(decision.state, alone.state)
    assert.deepEqual(decision.changesFrom, [])
    assert.deepEqual(decision.approvedBy, [])
  }
})

test('nobody whose approval of this version is on GitHub is asked; the author and bots never are', () => {
  const everyone = pull({
    latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [review('sam', 'APPROVED'), review('kim', 'CHANGES_REQUESTED', OLD)] },
    latestReviews: { nodes: [review('dana', 'APPROVED'), review('ALEX', 'COMMENTED'), review('ci-bot', 'COMMENTED', HEAD, 'Bot'), review('kim', 'COMMENTED'), review('eli', 'COMMENTED')] },
  })
  const decision = decideFor(everyone)
  assert.deepEqual(by(decision).sort(), ['eli', 'kim'], 'sam counts, dana already approved this version, alex is the author, ci-bot is a bot')
  assert.equal(decision.askable.find(person => person.by === 'kim').reason, 'looked_again', 'a writer keeps the merge reading of their reviews')
})

// A GitHub answer for a PR with `count` people who only commented, `first` of them on its first page.
const commenters = (from, to) => Array.from({ length: to - from }, (_, index) => review(`person-${from + index}`, 'COMMENTED'))
const answer = (data, extra = {}) => ({ ok: true, status: 200, json: async () => ({ data, ...extra }) })

test('more than one page of people who only commented: every one of them can be asked', async () => {
  const queries = []
  globalThis.fetch = async (url, options) => {
    const { query } = JSON.parse(options.body)
    queries.push(query)
    if (!query.includes('ContributeMoreReviewers')) {
      return answer({ p0: { pullRequest: pull({ latestReviews: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: commenters(0, 30) } }) } })
    }
    if (query.includes('"c1"')) return answer({ node: { latestReviews: { pageInfo: { hasNextPage: true, endCursor: 'c2' }, nodes: commenters(30, 130) } } })
    return answer({ node: { latestReviews: { pageInfo: { hasNextPage: false, endCursor: 'c3' }, nodes: commenters(130, 131) } } })
  }
  const data = await fetchLiveStates('t', 'query { p0 }')
  assert.equal(queries.length, 3, 'the first page and the two that follow, nothing more')
  assert.match(queries[1], /node\(id:"PR_1"\)/)
  const decision = decideFor(data.p0.pullRequest)
  assert.equal(decision.askable.length, 131)
  assert.equal(new Set(by(decision)).size, 131, 'one entry per person')
  assert.equal(ask(decision, 'ask_approval').enabled, true)
})

test('a page that cannot be read is said so: nobody is offered from a list that is not whole, and the read itself still answers', async () => {
  globalThis.fetch = async (url, options) => {
    const { query } = JSON.parse(options.body)
    return query.includes('ContributeMoreReviewers') ? { ok: false, status: 502, json: async () => null }
      : answer({ p0: { pullRequest: pull({ latestReviews: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: commenters(0, 30) } }) } })
  }
  const data = await fetchLiveStates('t', 'query { p0 }')
  assert.ok(data, 'the read is not failed by the missing page')
  const decision = decideFor(data.p0.pullRequest)
  assert.equal(data.p0.pullRequest.latestReviews.pageInfo.hasNextPage, true)
  for (const id of ['ask_approval', 'ask_rereview']) {
    assert.equal(ask(decision, id).enabled, false)
    assert.match(ask(decision, id).reason, /Could not read everyone who reviewed/)
  }
  assert.equal(ask(decision, 'respond').enabled, true, 'the rest of your actions are untouched')
})
