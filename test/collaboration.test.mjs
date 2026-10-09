import { PR_FIELDS } from '../collaboration.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverPulls, discoverRepositories, matchingPulls, mayAssign, mayMerge, mergeSelection, collaborationRequest, reviewRunRequest, assignPulls, loadReviewRuns, awaitsGithub, OBSERVE_EVERY_MS, reviewRunTitle } from '../collaboration.js'
import { attachSourceProjects } from '../source-map.js'
import { frontendModules, renderModule } from './render-harness.mjs'
const pull = (number, extra = {}) => ({ number, title: 'A clear change', url: 'https://github.com/team/repo/pull/' + number,
  headRefOid: 'a'.repeat(40), baseRefName: 'main', baseRefOid: 'd'.repeat(40), baseRef: { target: { oid: 'b'.repeat(40) } }, repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' },
  author: { login: 'owner' }, assignees: { nodes: [] }, ...extra })

test('assignment and merge follow distinct repository permissions, never organisation membership', () => {
  for (const role of ['WRITE','MAINTAIN','ADMIN']) { assert.equal(mayAssign(role), true); assert.equal(mayMerge(role), true) }
  assert.equal(mayAssign('TRIAGE'), true); assert.equal(mayMerge('TRIAGE'), false)
  for (const role of [null, undefined, 'READ', 'mobius-os']) { assert.equal(mayMerge(role), false); assert.equal(mayAssign(role), false) }
})
test('assigned and own PRs remain selectable independently of unassigned work', () => {
  const rows = [pull(1), pull(2, { assignees: { nodes: [{ login: 'Owner' }] }, author: { login: 'other' } })]
  assert.deepEqual(matchingPulls(rows, 'unassigned', 'owner').map(pr => pr.number), [1])
  assert.deepEqual(matchingPulls(rows, 'assigned', 'owner').map(pr => pr.number), [2])
  assert.deepEqual(matchingPulls(rows, 'authored', 'owner').map(pr => pr.number), [1])
  assert.equal(matchingPulls(rows, 'all', 'owner').length, 2)
})
test('pagination replaces changed identities rather than duplicating them', () => {
  assert.equal(mergeSelection([pull(1)], [pull(1, { headRefOid: 'b'.repeat(40) })]).length, 1)
  assert.equal(mergeSelection([pull(1)], [pull(1, { headRefOid: 'b'.repeat(40) })])[0].headRefOid, 'b'.repeat(40))
})
test('repository access is not membership; explicitly added repositories retain permissions', () => {
  const repositories = [{ nameWithOwner: 'team/repo', viewerPermission: 'MAINTAIN', openPullRequestCount: 1 }]
  assert.deepEqual(attachSourceProjects(null, [], [], repositories), [])
  const projects = attachSourceProjects(null, [], [], repositories, ['team/repo'])
  assert.equal(projects.length, 1); assert.equal(projects[0].kind, 'external')
  assert.equal(projects[0].viewerPermission, 'MAINTAIN')
  assert.equal(projects[0].available, false)
})
test('PR discovery is read-only, includes own work, and reports pagination', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options }); return new Response(JSON.stringify({ data: { search: { nodes: [pull(1)], issueCount: 70, pageInfo: { hasNextPage: true, endCursor: 'next' } } } }))
  })
  const found = await discoverPulls('test', 'team/repo')
  assert.equal(found.hasNextPage, true); assert.equal(found.total, 70)
  assert.match(calls[0].body, /repo:team\/repo/)
  assert.doesNotMatch(calls[0].body, /mutation|no:assignee|-author/)
  await discoverPulls('test')
  assert.match(calls[1].body, /involves:@me/)
  await assert.rejects(discoverPulls('test', 'bad"repo'), /valid repository/)
})
test('missing GitHub data is an error, not a false empty queue', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ errors: [{ message: 'no access' }] })))
  await assert.rejects(discoverPulls('test'), /Could not check GitHub/)
  await assert.rejects(discoverRepositories('test'), /Could not check GitHub/)
})
test('old backend reports the activation requirement without mutation fallback', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 404 }) })
  await assert.rejects(collaborationRequest('test', 80, 'review-runs', { items: [] }), /activated/)
  assert.equal(calls, 1)
})
test('a run with a saved merge or push GitHub may have settled is observed read-only, at most once a minute', async t => {
  const queued = { id: 'run-q', state: 'reviewing', items: [{ number: 1674, state: 'queued' }, { number: 1673, state: 'reviewing' }] }
  const settled = { ...queued, items: [{ number: 1674, state: 'merged' }, { number: 1673, state: 'reviewing' }] }
  assert.equal(awaitsGithub(queued), true)
  assert.equal(awaitsGithub({ state: 'reviewing', items: [{ state: 'reviewing' }, { state: 'merged' }] }), false)
  assert.equal(awaitsGithub({ ...queued, state: 'complete' }), false)
  const calls = []
  let observed = false
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(`${init.method} ${url}`)
    if (url.endsWith('/observe')) { observed = true; return new Response(JSON.stringify({ run: settled })) }
    return new Response(JSON.stringify({ runs: [observed ? settled : queued] }))
  })
  const shown = []
  const first = await loadReviewRuns('test', 80, { now: 1_000_000, onList: list => shown.push(list.runs[0].items[0].state) })
  assert.deepEqual(shown, ['queued'], 'the saved list shows before GitHub is checked')
  assert.equal(first.runs[0].items[0].state, 'merged', 'the list is re-read after GitHub reconciliation')
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs', 'POST /api/github/contributions/80/review-runs/run-q/observe', 'GET /api/github/contributions/80/review-runs'])
  observed = false; calls.length = 0
  await loadReviewRuns('test', 80, { now: 1_000_000 + OBSERVE_EVERY_MS - 1 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs'], 'no second GitHub check within the minute')
})
test('a failed observation keeps the listed runs rather than hiding them', async t => {
  const run = { id: 'run-fail', state: 'reviewing', items: [{ number: 9, state: 'merge_unknown' }] }
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/observe')
    ? new Response(JSON.stringify({ detail: 'GitHub unavailable' }), { status: 502 })
    : new Response(JSON.stringify({ runs: [run] })))
  assert.deepEqual((await loadReviewRuns('test', 80, { now: 5_000_000 })).runs, [run])
})
test('review-and-merge confirmation names exact PRs and excludes extra public actions', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/PullRequests.jsx'; export const render = choice => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice}));`)
  const html = render({mode:'review_merge', pulls:[pull(1), pull(2)]})
  assert.match(html, /Allow review &amp; merge/)
  assert.match(html, /Public effect: these PRs may be merged or queued/); assert.match(html, /No branch edits or public comments/)
  assert.match(html, /<strong>#1 A clear change<\/strong><span>team\/repo<\/span>/)
  assert.match(html, /<strong>#2 A clear change<\/strong><span>team\/repo<\/span>/)
  assert.doesNotMatch(html, /version <code>/)
  const privately = render({mode:'review', pulls:[pull(1)]})
  assert.match(privately, /Private findings, no public changes/); assert.match(privately, /Start private review/)
  assert.doesNotMatch(privately, /Public effect/)
  const posting = render({mode:'review', pulls:[pull(1)], options:{post_review:true}})
  assert.doesNotMatch(posting, /Private findings|Start private review/, 'a review posted on GitHub is never called private')
  assert.match(posting, /Findings posted on GitHub\. No code changes\./)
  assert.match(posting, /Public effect: one comment review with the verdict and findings is posted on this PR from your connected GitHub account\. It never approves, requests changes, edits code or merges\./)
  assert.match(posting, /Review and post on GitHub/)
})


test('the grant request binds the selected head and the live target-branch tip, not the PR comparison base', () => {
  const pr = pull(1)
  const choice = { request_id: 'same-retry', mode: 'review_merge', pulls: [pr] }
  assert.deepEqual(reviewRunRequest(choice), { request_id: 'same-retry', mode: 'review_merge', items: [{
    repo: 'team/repo', number: 1, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40),
  }] })
})


test('batch assignment pins each head and reports partial failures without replaying successes', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body)
    return body.number === 2 ? new Response(JSON.stringify({detail:'PR changed'}), {status:409}) : new Response('{}')
  })
  const result = await assignPulls('test', 80, [pull(1), pull(2), pull(3)], 'reviewer')
  assert.deepEqual(result.map(item => item.ok), [true, false, true])
  assert.match(result[1].error, /PR changed/)
  assert.deepEqual(calls.map(item => item.number), [1,2,3])
  assert.ok(calls.every(item => item.assignee === 'reviewer' && item.expected_head_sha === 'a'.repeat(40)))
})

test('merge option is enabled only for an entirely eligible exact selection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/PullRequests.jsx'; export const render = pulls => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice:{mode:'review',pulls},onModeChange:()=>{}}));`)
  const eligible = render([pull(1)])
  assert.match(eligible, /Review, fix &amp; merge/)
  assert.doesNotMatch(eligible, /class="co-pr-mode"[^>]*disabled/)
  for (const selection of [[pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})], [pull(1, {isDraft:true})]]) {
    const html = render(selection)
    assert.match(html, /class="co-pr-mode"[^>]*disabled=""><strong>Review, fix &amp; merge/)
    // Before the served capability resolves a draft reads as a pending check, never a missing update.
    assert.match(html, /Checking draft support…|Requires merge access to every selected PR/)
    assert.doesNotMatch(html, /needs the Möbius update/)
  }
  // A permanent rights blocker is not hidden behind the pending draft check.
  {
    const html = render([pull(1, {isDraft:true, repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})])
    assert.match(html, /Requires merge access to every selected PR/)
  }
})


test('takeover eligibility distinguishes drafts, base merge rights and fork push rights', async () => {
  const { takeoverBlocker } = await import('../collaboration.js')
  const ready = pull(9, { repository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'}, headRepository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'} })
  assert.equal(takeoverBlocker([ready]), '')
  assert.match(takeoverBlocker([{...ready,isDraft:true}]), /Draft/)
  assert.match(takeoverBlocker([{...ready,repository:{viewerPermission:'READ'}}]), /merge access/)
  assert.equal(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'WRITE'}}]), '')
  assert.match(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'READ'}}]), /push access/)
})

test('draft takeover discovery needs explicit readiness support and never bypasses fork rights', async () => {
  const { takeoverBlocker, reviewRunRequest, DRAFT_TAKEOVER_SCOPE, TAKEOVER_SCOPE } = await import('../collaboration.js')
  const draft=pull(9,{isDraft:true,headRepository:{viewerPermission:'WRITE'}})
  assert.match(takeoverBlocker([draft]), /Draft/)
  assert.equal(takeoverBlocker([draft],{allowDraft:true}), '')
  assert.match(takeoverBlocker([{...draft,headRepository:{viewerPermission:'READ'}}],{allowDraft:true}), /push access/)
  const old={request_id:'fixture-old',mode:'review_fix_merge',pulls:[draft]}
  assert.equal(reviewRunRequest(old).confirmation_scope, TAKEOVER_SCOPE)
  assert.equal(reviewRunRequest({...old,confirmation_scope:DRAFT_TAKEOVER_SCOPE}).confirmation_scope, DRAFT_TAKEOVER_SCOPE)
})

test('a review run is named by what it does in public', () => {
  assert.equal(reviewRunTitle({ mode: 'review', options: { autopilot: true } }), 'Private review')
  assert.equal(reviewRunTitle({ mode: 'review', options: { post_review: true } }), 'GitHub review')
  assert.equal(reviewRunTitle({ mode: 'review_merge' }), 'Review & merge')
  assert.equal(reviewRunTitle({ mode: 'review_fix_merge', options: { post_review: true } }), 'Review, fix & merge')
})


test('PR metadata includes real discussion and commit totals without extra detail reads', () => {
  assert.match(PR_FIELDS, /comments \{ totalCount \}/)
  assert.match(PR_FIELDS, /reviews \{ totalCount \}/)
  assert.match(PR_FIELDS, /commits\(last:1\) \{ totalCount nodes/)
})
