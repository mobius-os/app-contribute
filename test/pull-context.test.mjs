import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPullChecks, loadPullThreads, loadPullRelated, loadPullActivity, pullFileDiff, pullTotals, safeDetailLink } from '../pull-details.js'
import { checkSummary, PR_FIELDS } from '../collaboration.js'

const head = 'a'.repeat(40), base = 'b'.repeat(40)
const pr = { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: head, baseRefOid: base, baseRefName: 'main' }
const detail = () => ({ head: { sha: head }, base: { sha: base, ref: 'main' } })
const graph = extra => ({ data: { repository: { pullRequest: { headRefOid: head, baseRefOid: base, baseRefName: 'main', ...extra } } } })
const response = data => new Response(JSON.stringify(data))

test('rollup summary counts checks like GitHub: skipped and neutral pass, failures named, never a review verdict', () => {
  assert.match(PR_FIELDS, /checkRunCountsByState/)
  assert.match(PR_FIELDS, /statusContextCountsByState/)
  const withCounts = contexts => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts } } }] } })
  assert.deepEqual(checkSummary(withCounts({ totalCount: 18,
    checkRunCountsByState: [{ state: 'SUCCESS', count: 15 }, { state: 'SKIPPED', count: 3 }],
    statusContextCountsByState: [] })), { passed: 18, failed: 0, total: 18, state: 'success' }, 'GitHub shows 18/18 here, not 15/18')
  assert.deepEqual(checkSummary(withCounts({ totalCount: 14,
    checkRunCountsByState: [{ state: 'SUCCESS', count: 11 }, { state: 'FAILURE', count: 2 }],
    statusContextCountsByState: [{ state: 'SUCCESS', count: 1 }] })), { passed: 12, failed: 2, total: 14, state: 'failure' })
  assert.deepEqual(checkSummary(withCounts({ totalCount: 4,
    checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }, { state: 'IN_PROGRESS', count: 2 }],
    statusContextCountsByState: [] })), { passed: 2, failed: 0, total: 4, state: 'pending' })
  assert.deepEqual(checkSummary(withCounts({ totalCount: 0, checkRunCountsByState: [], statusContextCountsByState: [] })), { passed: 0, failed: 0, total: 0, state: 'success' })
  assert.equal(checkSummary(withCounts({ totalCount: 14, checkRunCountsByState: null, statusContextCountsByState: [] })), null)
  assert.equal(checkSummary({}), null)
})
test('check/status reads use selected immutable head and report each provider independently', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    if (url.includes('/check-runs?')) return response({ total_count: 101, check_runs: [{ id: 1, head_sha: head, name: 'Tests', status: 'completed', conclusion: 'failure' }] })
    if (url.includes('/status?')) return new Response('', { status: 403 })
    return response(detail())
  })
  const data = await loadPullChecks('fixture', pr)
  assert.equal(data.groups[0].items[0].conclusion, 'failure')
  assert.equal(data.groups[0].total, 101)
  assert.equal(data.hasMore, true)
  assert.match(data.errors[0], /Commit statuses/)
  assert.ok(calls.filter(call => !call.url.endsWith('/pulls/7')).every(call => call.url.includes(`/commits/${head}/`)))
  assert.ok(calls.every(call => !call.options.method))
})
const actionsRun = (id, extra = {}) => ({ id, head_sha: head, name: `Job ${id}`, status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' }, output: { annotations_count: 0 }, ...extra })
const failedChecks = (runs, answers) => async url => {
  if (url.includes('/check-runs?')) return response({ total_count: runs.length, check_runs: runs })
  if (url.includes('/status?')) return response({ sha: head, total_count: 0, statuses: [] })
  for (const [part, answer] of Object.entries(answers)) if (url.includes(part)) return answer instanceof Response ? answer : response(answer)
  return response(detail())
}
test('a failed Actions check shows its failed step names and annotations, read through the read-only route', async t => {
  const reads = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { reads.push({ url, options }); return failedChecks([actionsRun(31, { output: { annotations_count: 2 } })], {
    '/actions/jobs/31': { steps: [{ name: 'Set up job', conclusion: 'success' }, { name: 'Run unit tests', conclusion: 'failure' }, { name: 'Post checkout', conclusion: 'skipped' }] },
    '/check-runs/31/annotations': [{ path: 'src/a.js', start_line: 9, annotation_level: 'notice', message: 'minor' }, { path: 'test/a.test.mjs', start_line: 12, annotation_level: 'failure', message: 'not ok 412 - desk counts a ready PR once' }],
  })(url) })
  const [run] = (await loadPullChecks('fixture', pr)).groups[0].items
  assert.deepEqual(run.why.steps, ['Run unit tests'])
  assert.deepEqual(run.why.annotations.map(note => [note.where, note.text]), [['test/a.test.mjs:12', 'not ok 412 - desk counts a ready PR once'], ['src/a.js:9', 'minor']], 'the failure reads before the notice')
  assert.ok(reads.some(call => call.url === '/api/github/api/repos/team/repo/actions/jobs/31') && reads.some(call => call.url.includes('/check-runs/31/annotations')))
  assert.ok(reads.every(call => !call.options.method), 'reads only')
})
test('a check that passed, or whose reason cannot be read, keeps its plain row and its GitHub link', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return failedChecks([actionsRun(1, { conclusion: 'success' }), actionsRun(2), actionsRun(3, { app: { slug: 'codecov' } })], {
    '/actions/jobs/2': new Response('', { status: 404 }),
  })(url) })
  const items = (await loadPullChecks('fixture', pr)).groups[0].items
  assert.ok(items.every(item => !item.why), 'no reason claimed')
  assert.ok(!calls.some(url => url.includes('/actions/jobs/1')) && !calls.some(url => url.includes('/actions/jobs/3')), 'only a failed Actions job is read')
})
test('only the first few failed checks are read, so a red page does not cost a request per check', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => { calls.push(url); return failedChecks(Array.from({ length: 9 }, (_, index) => actionsRun(index + 1)), { '/actions/jobs/': { steps: [{ name: 'Run', conclusion: 'failure' }] } })(url) })
  const items = (await loadPullChecks('fixture', pr)).groups[0].items
  assert.equal(items.filter(item => item.why).length, 5)
  assert.equal(calls.filter(url => url.includes('/actions/jobs/')).length, 5)
})
test('combined statuses remain distinct from check runs, with exact pagination', async t => {
  t.mock.method(globalThis, 'fetch', async url => response(url.includes('/check-runs?')
    ? { total_count: 0, check_runs: [] }
    : url.includes('/status?') ? { sha: head, total_count: 1, state: 'pending', statuses: [{ id: 2, context: 'build', state: 'pending' }] } : detail()))
  const data = await loadPullChecks('fixture', pr)
  assert.equal(data.groups.length, 2)
  assert.equal(data.groups[1].items[0].state, 'pending')
  assert.equal(data.hasMore, false)
  assert.equal(data.errors.length, 0)
})
test('checks reject stale head, base and branch after the reads', async t => {
  for (const changed of [{ head: { sha: 'c'.repeat(40) } }, { base: { sha: 'c'.repeat(40), ref: 'main' } }, { base: { sha: base, ref: 'release' } }]) {
    t.mock.method(globalThis, 'fetch', async url => response(url.includes('/check-runs?') ? { total_count: 0, check_runs: [] } : url.includes('/status?') ? { sha: head, total_count: 0, statuses: [] } : { ...detail(), ...changed }))
    await assert.rejects(loadPullChecks('fixture', pr), { code: 'stale' })
    t.mock.restoreAll()
  }
})
test('mismatched version-specific evidence cannot be masked by a successful sibling', async t => {
  for (const mismatch of ['check', 'status']) {
    t.mock.method(globalThis, 'fetch', async url => response(url.includes('/check-runs?') ? { total_count: 1, check_runs: [{ id: 1, head_sha: mismatch === 'check' ? base : head }] } : { total_count: 0, sha: mismatch === 'status' ? base : head, statuses: [] }))
    await assert.rejects(loadPullChecks('fixture', pr), { code: 'stale' })
    t.mock.restoreAll()
  }
})
test('all failed check sources remain errors, never no-checks/all-clear evidence', async t => {
  t.mock.method(globalThis, 'fetch', async url => url.endsWith('/pulls/7') ? response(detail()) : new Response('', { status: 503 }))
  const data = await loadPullChecks('fixture', pr)
  assert.equal(data.groups.length, 0)
  assert.equal(data.errors.length, 2)
  assert.equal(data.hasMore, false)
})
test('discussion reads preserve file, old/new line, resolution, cursor and reply truncation', async t => {
  const thread = { id: 't1', path: 'ui/file.js', line: 17, diffSide: 'LEFT', isResolved: true, isOutdated: false,
    comments: { nodes: [{ id: 'c1', body: 'Please test this', author: { login: 'reviewer' } }], totalCount: 60, pageInfo: { hasNextPage: true } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/github/graphql')
    assert.equal(options.method, 'POST')
    const { query, variables } = JSON.parse(options.body)
    assert.match(query, /^query /)
    assert.doesNotMatch(query, /\b(?:mutation|subscription)\b/)
    assert.equal(variables.after, 'opaque-cursor')
    assert.deepEqual([variables.owner, variables.name, variables.number], ['team', 'repo', 7])
    return response(graph({ reviewThreads: { nodes: [thread], pageInfo: { hasNextPage: true, endCursor: 'next' } } }))
  })
  const data = await loadPullThreads('fixture', pr, 'opaque-cursor')
  assert.deepEqual(data.threads[0], thread)
  assert.equal(data.hasMore, true)
  assert.equal(data.nextCursor, 'next')
})
test('thread GraphQL errors and missing fields are explicit; partial nodes survive', async t => {
  t.mock.method(globalThis, 'fetch', async () => response({ ...graph({ reviewThreads: { nodes: [{ id: 't1', comments: null }], pageInfo: { hasNextPage: false } } }), errors: [{ message: 'not accessible' }] }))
  const data = await loadPullThreads('fixture', pr)
  assert.equal(data.threads.length, 1)
  assert.equal(data.errors.length, 1)
  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => response(graph({ reviewThreads: null })))
  assert.match((await loadPullThreads('fixture', pr)).errors[0], /resolution is not known/)
})
test('discussion context also rejects a changed base', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(graph({ baseRefOid: head, reviewThreads: { nodes: [] } })))
  await assert.rejects(loadPullThreads('fixture', pr), { code: 'stale' })
})
test('related context uses API types, deduplicates relationship facts and discloses limits', async t => {
  const issue = { __typename: 'Issue', number: 2, title: 'Related issue', url: 'https://github.com/team/repo/issues/2', repository: { nameWithOwner: 'team/repo' } }
  const relatedPr = { ...issue, __typename: 'PullRequest', number: 3, title: 'Related PR', url: 'https://github.com/team/other/pull/3' }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const { query } = JSON.parse(options.body)
    assert.doesNotMatch(query, /\$after/)
    return response(graph({ closingIssuesReferences: { nodes: [issue], pageInfo: { hasNextPage: true } }, timelineItems: { nodes: [{ source: issue }, { source: relatedPr }, { source: { ...issue, __typename: 'Unknown' } }], pageInfo: { hasNextPage: false } } }))
  })
  const data = await loadPullRelated('fixture', pr)
  assert.equal(data.items.length, 2)
  assert.equal(data.items[0].__typename, 'Issue')
  assert.equal(data.items[1].__typename, 'PullRequest')
  assert.deepEqual(data.items[0].relationships, ['May close', 'Mentions this PR'])
  assert.equal(data.truncated, true)
})
test('one unavailable relationship connection does not erase successful context', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(graph({ closingIssuesReferences: { nodes: [{ __typename: 'Issue', number: 2, url: 'https://github.com/team/repo/issues/2' }], pageInfo: { hasNextPage: false } }, timelineItems: null })))
  const data = await loadPullRelated('fixture', pr)
  assert.equal(data.items.length, 1)
  assert.match(data.errors[0], /Cross-references/)
})
test('canonical patch parsing preserves hunk line numbers and quoted renamed paths', () => {
  const file = { filename: 'path with space/"file.js', previous_filename: 'old\tfile.js', patch: '@@ -2,2 +2,2 @@\n context\n-old\n+new' }
  const parsed = pullFileDiff(file)
  assert.equal(parsed.path, file.filename)
  assert.equal(parsed.oldPath, file.previous_filename)
  assert.equal(parsed.hunks[0].lines[2].type, 'add')
  assert.equal(parsed.hunks[0].lines[2].newNo, 3)
  assert.equal(pullFileDiff({ filename: 'binary.png' }), null)
})
test('missing LOC counts are unknown, not manufactured zero; unsafe links are not actions', () => {
  assert.deepEqual(pullTotals({ changed_files: 1, additions: 0 }), { files: 1, additions: 0, deletions: null })
  assert.deepEqual(pullTotals({}), { files: null, additions: null, deletions: null })
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'file:///tmp']) assert.equal(safeDetailLink(url), null)
  assert.equal(safeDetailLink('https://github.com/team/repo/pull/7'), 'https://github.com/team/repo/pull/7')
})
test('REST activity pagination is explicitly uncertain, capped and validated', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(Array.from({ length: 50 }, (_, id) => ({ id }))))
  assert.equal((await loadPullActivity('fixture', pr)).paginationUnknown, true)
  const last = await loadPullActivity('fixture', pr, 100)
  assert.equal(last.capped, true)
  assert.equal(last.hasMore, false)
  await assert.rejects(loadPullActivity('fixture', pr, 0))
  await assert.rejects(loadPullActivity('fixture', pr, 101))
})
