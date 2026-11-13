// The reads that fill a repository's list: titles, details in groups, the probe, the counts.
import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { PR_FIELDS } from '../api.js'
import { TITLE_FIELDS, moveSignature, readListProbe, readOpenCounts, readPullGroups, readTitles } from '../list-reads.js'
import { forgetSameWork } from '../carried-approvals.js'
import { fullPull, installGithub } from './fake-lists.mjs'

let github
afterEach(() => { github?.restore(); github = null; forgetSameWork() })
const many = (repo, count) => Array.from({ length: count }, (_, index) => fullPull(repo, index + 1))

test('the titles are asked for with titles and status only, and every row says it holds nothing more', async () => {
  github = installGithub({ 'o/r': many('o/r', 3) })
  const read = await readTitles('token', 'o/r')
  assert.equal(github.calls[0].name, 'ContributeListTitles')
  assert.doesNotMatch(github.calls[0].query, /latestReviews|commits|reviewThreads|labels|assignees/, 'the quick question carries none of the heavy fields')
  assert.ok(TITLE_FIELDS.length < PR_FIELDS.length / 4)
  assert.deepEqual(read.pulls.map(pr => [pr.number, pr.titlesOnly, pr.title]), [[1, true, 'Change 1'], [2, true, 'Change 2'], [3, true, 'Change 3']])
  assert.deepEqual([read.total, read.hasNextPage], [3, false])
  assert.equal(read.pulls[0].latestOpinionatedReviews, undefined, 'a row with only its titles has no review facts to misread')
})

test('the titles of a repository with more than a page say so, with the cursor for the rest', async () => {
  github = installGithub({ 'o/big': many('o/big', 70) })
  const read = await readTitles('token', 'O/Big')
  assert.equal(read.pulls.length, 50)
  assert.deepEqual([read.total, read.hasNextPage, read.endCursor], [70, true, 'c50'])
  await assert.rejects(readTitles('token', 'not a repository'), /valid repository/)
})

test('an answer GitHub did not give is an error, never an empty list', async () => {
  globalThis.fetch = async () => new Response('{}', { status: 502 })
  await assert.rejects(readTitles('token', 'o/r'), /Could not check GitHub/)
  await assert.rejects(readPullGroups('token', [{ repo: 'o/r', number: 1 }]), /Could not read/)
  await assert.rejects(readListProbe('token', ['o/r']), /Could not check GitHub/)
})

test('details are read in groups of ten, all at once, and each group is shown as it answers', async () => {
  let arrived = 0
  const release = []
  github = installGithub({ 'o/r': many('o/r', 25) }, { hold: () => new Promise(resolve => { release.push(resolve); if (++arrived === 3) release.reverse().forEach(go => go()) }) })
  const shown = []
  const read = await readPullGroups('token', many('o/r', 25).map(pr => ({ repo: 'o/r', number: pr.number })), { onGroup: pulls => shown.push(pulls.map(pr => pr.number)) })
  assert.equal(arrived, 3, 'the three groups were all out before any answered')
  assert.deepEqual(github.calls.map(call => (call.query.match(/p\d+:repository/g) || []).length).sort((a, b) => a - b), [5, 10, 10])
  assert.equal(shown.length, 3)
  assert.deepEqual(read.map(pr => pr.number).sort((a, b) => a - b), Array.from({ length: 25 }, (_, index) => index + 1))
  assert.ok(read.every(pr => !pr.titlesOnly && pr.latestOpinionatedReviews), 'whole PRs, with everything PR_FIELDS asks for')
})

test('a group that fails does not take the answered groups with it: they are shown, then the failure is thrown', async () => {
  let asked = 0
  github = installGithub({ 'o/r': many('o/r', 20) }, { hold: () => { if (++asked === 2) throw Object.assign(new Error('GitHub is down'), { status: 502 }) } })
  const shown = []
  await assert.rejects(readPullGroups('token', many('o/r', 20).map(pr => ({ repo: 'o/r', number: pr.number })), { onGroup: pulls => shown.push(pulls.length) }), /Could not read the pull requests/)
  assert.deepEqual(shown, [10], 'the group that answered stays')
})

test('a read of details still completes the reviewers and marks approvals of an older commit', async () => {
  const reviewer = login => ({ state: 'COMMENTED', body: '', submittedAt: '2026-11-02T10:00:00Z', author: { login, __typename: 'User' }, commit: { oid: 'a'.repeat(40) } })
  const approval = { state: 'APPROVED', author: { login: 'friend', __typename: 'User' }, commit: { oid: 'c'.repeat(40) } }
  const pr = fullPull('o/r', 1, {
    latestReviews: { pageInfo: { hasNextPage: true, endCursor: 'next' }, nodes: [reviewer('first')] },
    latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [approval] },
  })
  github = installGithub({ 'o/r': [pr] }, { moreReviewers: { [pr.id]: [reviewer('second')] } })
  const [read] = await readPullGroups('token', [{ repo: 'o/r', number: 1 }])
  assert.deepEqual(read.latestReviews.nodes.map(node => node.author.login), ['first', 'second'], 'the second page of reviewers was read')
  assert.equal(read.latestReviews.pageInfo.hasNextPage, false)
  assert.ok(github.compared.length > 0 && read.latestOpinionatedReviews.nodes[0].sameWork === null, 'the approval of an older commit was compared and marked')
})

test('the probe answers a signature per PR in list order, one question for every repository', async () => {
  github = installGithub({ 'o/a': many('o/a', 2), 'o/b': [], 'o/c': many('o/c', 1) })
  const probe = await readListProbe('token', ['o/a', 'o/b', 'O/C', 'o/a', 'bad'])
  assert.equal(github.calls.length, 1)
  assert.deepEqual([...probe.keys()], ['o/a', 'o/b', 'o/c'])
  assert.deepEqual(probe.get('o/a').pulls.map(pr => pr.number), [1, 2])
  assert.deepEqual([probe.get('o/b').total, probe.get('o/b').pulls.length], [0, 0])
  assert.equal((await readListProbe('token', [])).size, 0)
})

test('a PR signs the same from the whole read as from the probe, and moves when something a row shows moves', async () => {
  const world = { 'o/r': [fullPull('o/r', 1)] }
  github = installGithub(world)
  const probe = (await readListProbe('token', ['o/r'])).get('o/r').pulls[0].signature
  assert.equal(probe, moveSignature(world['o/r'][0]))
  const moves = {
    updated: { updatedAt: '2026-11-03T10:00:00Z' }, pushed: { headRefOid: 'd'.repeat(40) }, drafted: { isDraft: true }, conflicting: { mergeable: 'CONFLICTING' },
    checkFailed: { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }, { state: 'FAILURE', count: 1 }], statusContextCountsByState: [] } } } }] } },
    checkProgress: { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { totalCount: 5, checkRunCountsByState: [{ state: 'SUCCESS', count: 3 }, { state: 'IN_PROGRESS', count: 2 }], statusContextCountsByState: [] } } } }] } },
  }
  for (const [name, change] of Object.entries(moves)) assert.notEqual(moveSignature(fullPull('o/r', 1, change)), probe, name)
  assert.equal(moveSignature(fullPull('o/r', 1, { title: 'Renamed', comments: { totalCount: 9 } })), probe, 'what the update time already covers is not read twice')
})

test('the counts of open PRs come as one question, and a repository GitHub did not answer for has none', async () => {
  github = installGithub({ 'o/a': many('o/a', 3), 'o/b': [] })
  const counts = await readOpenCounts('token', ['o/a', 'o/b'])
  assert.equal(github.calls.length, 1)
  assert.deepEqual([...counts], [['o/a', 3], ['o/b', 0]])
  github.restore()
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { r0: { issueCount: 2 }, r1: null } }))
  assert.deepEqual([...await readOpenCounts('token', ['o/a', 'o/b'])], [['o/a', 2]])
  const many50 = Array.from({ length: 120 }, (_, index) => `o/r${index}`)
  let questions = 0
  globalThis.fetch = async () => { questions += 1; return new Response(JSON.stringify({ data: {} })) }
  await readOpenCounts('token', many50)
  assert.equal(questions, 3, 'fifty repositories to a question')
})
