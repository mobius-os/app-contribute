import assert from 'node:assert/strict'
import test from 'node:test'
import { conversationCount, isBotAuthor, discoverPull, discoverPulls, discoverRepositories, matchingPulls, mayAssign, mayMerge, mergeSelection, collaborationRequest, reviewRunRequest, assignPulls, loadReviewPeople, requestReviewMany, loadReviewRuns, awaitsGithub, OBSERVE_EVERY_MS, reviewRunTitle, reviewForPull, runDetailsElsewhere, notOursToObserve } from '../collaboration.js'
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
  assert.equal(awaitsGithub({ state: 'needs_you', items: [{ state: 'verdict_unknown' }] }), true, 'an unconfirmed verdict is re-checked against GitHub')
  assert.equal(awaitsGithub({ state: 'needs_you', items: [{ state: 'verdict_pending' }] }), false, 'a verdict waiting for you is not on GitHub to find')
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
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary', 'POST /api/github/contributions/80/review-runs/run-q/observe', 'GET /api/github/contributions/80/review-runs?view=summary'])
  observed = false; calls.length = 0
  await loadReviewRuns('test', 80, { now: 1_000_000 + OBSERVE_EVERY_MS - 1 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary'], 'no second GitHub check within the minute')
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
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = choice => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice}));`)
  const html = render({mode:'review_merge', pulls:[pull(1), pull(2)]})
  assert.match(html, /Start, merge when safe/)
  assert.match(html, /all required checks pass, it merges each PR or adds it to the merge queue/); assert.match(html, /the merge of each PR\. No comments and no code changes\./, 'a batch merge discloses one merge per PR')
  assert.match(html, /<strong>#1<\/strong> A clear change<span>team\/repo<\/span>/)
  assert.match(html, /<strong>#2<\/strong> A clear change<span>team\/repo<\/span>/)
  assert.match(html, /Exact versions/, 'a saved pinned merge keeps its exact-version disclosure')
  assert.match(html, /Uses these exact versions\. Changed code needs a fresh approval\./)
  const privately = render({mode:'review', pulls:[pull(1)]})
  assert.match(privately, /What GitHub sees:<\/strong> nothing\. Only you see the review\./); assert.match(privately, /Start review/)
  const posting = render({mode:'review', pulls:[pull(1)], options:{post_review:true}})
  assert.doesNotMatch(posting, /Only you see the review/, 'a review posted on GitHub is never called private')
  // Only a verdict the agent explicitly marks public is posted (G2 `publish: true`).
  assert.match(posting, /at most one review comment from your account, only for a verdict the agent marks as public\. Questions to you and unverified results stay private\./)
  assert.doesNotMatch(posting, /verdict and findings is posted|Findings posted on GitHub/, 'posting is a grant, not a promise that every outcome is public')
  assert.match(posting, /Start, allow comment/)
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

test('the people Request review can offer are the repository’s people, read page by page to the end', async t => {
  const asked = []
  t.mock.method(globalThis, 'fetch', async url => {
    asked.push(new URL(url, 'http://app').searchParams.get('page'))
    const page = Number(asked.at(-1))
    return new Response(JSON.stringify({ assignees: page === 1 ? [{ login: 'sam' }, { login: 'kim' }] : [{ login: 'bo' }, {}], next_page: page === 1 ? 2 : null }))
  })
  assert.deepEqual(await loadReviewPeople('test', 80, pull(1)), ['sam', 'kim', 'bo'])
  assert.deepEqual(asked, ['1', '2'])
})

test('a repository with endless people is read for a few pages, not forever', async t => {
  let reads = 0
  t.mock.method(globalThis, 'fetch', async () => { reads += 1; return new Response(JSON.stringify({ assignees: [{ login: `p${reads}` }], next_page: reads + 1 })) })
  assert.equal((await loadReviewPeople('test', 80, pull(1))).length, 5)
  assert.equal(reads, 5)
})

test('merge option is enabled only for an entirely eligible exact selection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = (pulls, capabilities = {review_fix_merge:true, pr_machine:true, post_review:true, propose_verdict:true}, mode = 'review') => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice:{mode,pulls,intent:'review',options:{post_review:true,propose_verdict:true}},onModeChange:()=>{},onOptionsChange:()=>{},capabilities}));`)
  const eligible = render([pull(1)])
  assert.match(eligible, /Merge after I approve/)
  assert.doesNotMatch(eligible, /Not available for drafts|Needs merge rights/)
  // Merge after I approve explains why an exact selection is not eligible.
  assert.match(render([pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})]), /Needs merge rights on this repository\./)
  assert.match(render([pull(1, {isDraft:true})]), /Not available for drafts\./)
  // Review, fix and merge starts only for an entirely eligible selection, and says why not.
  assert.doesNotMatch(render([pull(1)], undefined, 'review_fix_merge'), /disabled="">Start, ask me before each push/)
  assert.doesNotMatch(render([pull(1, {isDraft:true})], undefined, 'review_fix_merge'), /disabled="">Start, ask me before each push/, 'a draft can be finished: the agent never readies it')
  for (const selection of [[pull(1), pull(2, {repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})]]) {
    const html = render(selection, undefined, 'review_fix_merge')
    assert.match(html, /disabled="">Start, ask me before each push/)
    assert.match(html, /Requires merge access to every selected PR/)
  }
  // A workflow this Möbius does not advertise is never offered (or claimed loading forever).
  assert.match(render([pull(1)], {}, 'review_fix_merge'), /Needs a newer Möbius/)
  assert.match(render([pull(1)], null, 'review_fix_merge'), /Checking what this Möbius supports/)
  // A permanent rights blocker is not hidden behind the pending draft check.
  {
    const html = render([pull(1, {isDraft:true, repository:{nameWithOwner:'team/repo',viewerPermission:'READ'}})], undefined, 'review_fix_merge')
    assert.match(html, /Requires merge access to every selected PR/)
  }
})


test('Finish it for me and Take over need a Möbius that asks before every push: fresh or saved, an older one is blocked', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ReviewConfirmation} from './ui/ReviewConfirmation.jsx'; export const render = (capabilities, extra = {}) => renderToStaticMarkup(React.createElement(ReviewConfirmation, {choice:{mode:'review_fix_merge',intent:'finish_it',pulls:[${JSON.stringify(pull(1))}],...extra},onModeChange:()=>{},capabilities}));`)
  const start = /<button[^>]*>Start, ask me before each push/
  // The Möbius before the PR machine advertises review_fix_merge but pushes without asking and can merge.
  const older = { review_fix_merge: true, draft_takeover: true, merge_now: true }
  for (const extra of [{}, { preview_sha256: 'f'.repeat(64) }]) {
    const html = render(older, extra)
    assert.match(html, /Needs a newer Möbius/, `an older Möbius is refused${extra.preview_sha256 ? ' for a saved link too' : ''}`)
    assert.match(html, /disabled="">Start, ask me before each push/)
    const current = render({ ...older, pr_machine: true }, extra)
    assert.doesNotMatch(current, /Needs a newer Möbius/)
    assert.doesNotMatch(current, /disabled="">Start, ask me before each push/)
    assert.match(render(null, extra), /Checking what this Möbius supports/, 'unknown is a pending check, never a start')
  }
})

test('takeover eligibility distinguishes base merge rights and fork push rights; a draft is never in the way', async () => {
  const { takeoverBlocker } = await import('../collaboration.js')
  const ready = pull(9, { repository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'}, headRepository:{nameWithOwner:'team/repo',viewerPermission:'WRITE'} })
  assert.equal(takeoverBlocker([ready]), '')
  assert.equal(takeoverBlocker([{...ready,isDraft:true}]), '', 'a draft can be taken over: the agent never readies it, you do')
  assert.match(takeoverBlocker([{...ready,repository:{viewerPermission:'READ'}}]), /merge access/)
  assert.equal(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'WRITE'}}]), '')
  assert.match(takeoverBlocker([{...ready,headRepository:{nameWithOwner:'fork/repo',viewerPermission:'READ'}}]), /push access/)
  // GitHub reports a deleted source fork as an explicit null.
  assert.match(takeoverBlocker([{...ready,headRepository:null}]), /source repository was deleted/)
  const { headRepository, ...legacy } = ready
  assert.equal(takeoverBlocker([legacy]), '', 'an absent field (older snapshot) defers to the server preflight')
})

test('a takeover never asks to mark a draft ready: one repair scope, and a reason only when you gave one', async () => {
  const { takeoverBlocker, reviewRunRequest, TAKEOVER_SCOPE } = await import('../collaboration.js')
  const draft = pull(9, { isDraft: true, headRepository: { viewerPermission: 'WRITE' } })
  assert.equal(takeoverBlocker([draft]), '', 'a draft can be taken over: the agent never readies it, you do')
  assert.match(takeoverBlocker([{ ...draft, headRepository: { viewerPermission: 'READ' } }]), /push access/)
  const old = { request_id: 'fixture-old', mode: 'review_fix_merge', pulls: [draft] }
  assert.equal(reviewRunRequest(old).confirmation_scope, TAKEOVER_SCOPE)
  assert.equal(reviewRunRequest({ ...old, confirmation_scope: 'named_pr_repairs_ready_and_reviewed_successors' }).confirmation_scope, TAKEOVER_SCOPE, 'an older saved draft-ready scope is never sent again')
  assert.equal('takeover_reason' in reviewRunRequest(old), false)
  assert.equal(reviewRunRequest({ ...old, takeover_reason: '  the author is away  ' }).takeover_reason, 'the author is away')
  assert.equal('confirmation_scope' in reviewRunRequest({ request_id: 'r', mode: 'review', pulls: [draft] }), false)
})

test('a review run is named by what it does in public', () => {
  assert.equal(reviewRunTitle({ mode: 'review', options: { autopilot: true } }), 'Private review')
  assert.equal(reviewRunTitle({ mode: 'review', options: { post_review: true } }), 'GitHub review')
  assert.equal(reviewRunTitle({ mode: 'review_merge' }), 'Review & merge')
  assert.equal(reviewRunTitle({ mode: 'review_fix_merge', options: { post_review: true } }), 'Review, fix & merge')
})

test('an exact PR read rejects a response for another repository or number', async t => {
  let answer
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: { repository: { pullRequest: answer } } })))
  answer = pull(7)
  assert.equal((await discoverPull('test', 'team/repo', 7)).number, 7)
  for (const wrong of [pull(8), pull(7, { repository: { nameWithOwner: 'other/repo', viewerPermission: 'WRITE' } }), null]) {
    answer = wrong
    await assert.rejects(discoverPull('test', 'team/repo', 7), /unavailable to your GitHub account/)
  }
  await assert.rejects(discoverPull('test', 'not a repository', 7), /valid pull request/)
  await assert.rejects(discoverPull('test', 'team/repo', 0), /valid pull request/)
})

// G1's committed minimized projection (2541f4f12, out/G1.md) of a core review
// run Contribute did not start: no prompts, options, findings or brief.
const minimized = (extra = {}, item = {}) => ({ id: 'core-run', chat_id: 'owner-chat', state: 'reviewing', execution_state: 'running',
  mode: 'review', created_at: '2026-10-23T09:00:00Z', app_id: null, can_stop: false, post_review: false, details_in_owning_chat: true,
  items: [{ repo: 'team/repo', number: 7, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40), state: 'reviewing', ...item }], ...extra })

test('a minimized core run is titled by its mode and top-level post_review flag', () => {
  assert.equal(runDetailsElsewhere(minimized()), true)
  assert.equal(runDetailsElsewhere({ id: 'own', app_id: 80, mode: 'review', items: [] }), false)
  assert.equal(reviewRunTitle(minimized()), 'Private review')
  assert.equal(reviewRunTitle(minimized({ post_review: true })), 'GitHub review')
  assert.equal(reviewRunTitle(minimized({ mode: 'review_merge' })), 'Review & merge')
  assert.equal(reviewRunTitle(minimized({ mode: 'review_fix_merge', post_review: true })), 'Review, fix & merge')
  // Only the committed top-level flag counts for a minimized run.
  assert.equal(reviewRunTitle(minimized({ post_review: false, options: { post_review: true } })), 'Private review')
  assert.equal(reviewRunTitle({ mode: 'review', options: { post_review: true } }), 'GitHub review', 'own runs keep their frozen options')
})

test('a minimized core run attaches to its PR row by repository, number, head and base', () => {
  const run = minimized()
  assert.equal(reviewForPull([run], pull(7))?.run, run)
  assert.equal(reviewForPull([run], pull(7)).exactBase, true)
  assert.equal(reviewForPull([run], pull(7, { headRefOid: 'c'.repeat(40) })), null)
  assert.equal(reviewForPull([run], pull(8)), null)
  assert.equal(reviewForPull([minimized({}, { base_ref: 'release' })], pull(7)), null)
})

test('a minimized core run is never observed; a details_in_owning_chat refusal stops polling and is not an error', async t => {
  const calls = []
  let runs = [minimized({}, { state: 'queued', public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' } })]
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(`${init.method} ${url}`)
    if (url.endsWith('/observe')) return new Response(JSON.stringify({ detail: { code: 'details_in_owning_chat', message: 'Open the owning conversation to observe this core review run.' } }), { status: 403 })
    return new Response(JSON.stringify({ runs }))
  })
  const list = await loadReviewRuns('test', 80, { now: 9_000_000 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary'], 'a marked run is not observed')
  assert.deepEqual(list.runs[0].items[0].public_review, { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' })
  // A run listed without the marker that the server refuses as not ours is never asked again.
  const unmarked = { id: 'core-unmarked', state: 'reviewing', items: [{ number: 3, state: 'queued' }] }
  runs = [unmarked]; calls.length = 0
  const first = await loadReviewRuns('test', 80, { now: 20_000_000 })
  assert.deepEqual(first.runs, [unmarked], 'the refusal keeps the listed run')
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary', 'POST /api/github/contributions/80/review-runs/core-unmarked/observe'])
  calls.length = 0
  await loadReviewRuns('test', 80, { now: 20_000_000 + 10 * OBSERVE_EVERY_MS })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary'], 'polling stopped after the not-ours refusal')
  // The structured code is surfaced on request errors.
  const error = await collaborationRequest('test', 80, 'review-runs/core-unmarked/observe', {}).catch(error => error)
  assert.equal(notOursToObserve(error), true)
  assert.equal(notOursToObserve(Object.assign(new Error('x'), { status: 403 })), false)
})

test('a minimized run detail points to the owning conversation and offers no Stop or prompt warnings', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { render } = await renderModule(`import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {RunDetail} from './ui/RunDetail.jsx'; export const render = (run, pulls) => renderToStaticMarkup(React.createElement(RunDetail, {run, pulls, listState: {}, onStop: () => {}}));`)
  const html = render(minimized({ post_review: true }, { public_review: { state: 'posted', url: 'https://github.com/team/repo/pull/7#r' } }), [pull(7)])
  assert.match(html, /<h3>GitHub review<\/h3>/)
  assert.match(html, /Its instructions and findings are in the chat that ran it/)
  assert.match(html, /Open the chat for details/)
  assert.match(html, /Matches loaded PR version/)
  assert.match(html, /View the posted review on GitHub/)
  assert.doesNotMatch(html, /Stop agent run|Stop workflow|prompt snapshot|Older PR version|Instructions used by this run|findings will appear here|not a new approval/)
  assert.match(render({ id: 'own', app_id: 80, mode: 'review', state: 'reviewing', items: [] }, []), /This older run did not save a prompt snapshot/)
})

test('the Agent menu jobs map to exact platform modes and publishing presets', async () => {
  const { reviewIntent, requestOptions, WHO_OPTIONS } = await import('../collaboration.js')
  const PRIVATE = { post_review: false, propose_verdict: false, agent_submits_verdict: false }
  const DRAFT = { post_review: true, propose_verdict: true, agent_submits_verdict: false }
  // Without a host that offers drafting, Review and Check my PR both open private; the window can still switch.
  assert.deepEqual(reviewIntent('review'), { intent: 'review', mode: 'review', options: PRIVATE })
  assert.deepEqual(reviewIntent('check_my_pr'), { intent: 'check_my_pr', mode: 'review', options: PRIVATE })
  assert.deepEqual(reviewIntent('finish_it'), { intent: 'finish_it', mode: 'review_fix_merge' })
  assert.deepEqual(reviewIntent('take_over'), { intent: 'take_over', mode: 'review_fix_merge' })
  // Someone else's PR opens on "Draft for me" where the host offers it; your own PR keeps the private check; "Agent posts" is never a default.
  assert.deepEqual(reviewIntent('review', true), { intent: 'review', mode: 'review', options: DRAFT })
  assert.deepEqual(reviewIntent('check_my_pr', true), { intent: 'check_my_pr', mode: 'review', options: PRIVATE })
  assert.deepEqual(reviewIntent('finish_it', true), { intent: 'finish_it', mode: 'review_fix_merge' })
  assert.deepEqual(WHO_OPTIONS, { private: PRIVATE, draft: DRAFT, agent: { ...DRAFT, agent_submits_verdict: true } })
  // A raw mode (a retry) passes through with its own defaults.
  assert.deepEqual(reviewIntent('review_merge'), { mode: 'review_merge' })
  // The agent may post only on a plain review, and only with a drafted verdict; never with merging.
  const agent = { post_review: true, propose_verdict: true, agent_submits_verdict: true }
  assert.equal(requestOptions(agent, 'review').agent_submits_verdict, true)
  assert.equal('agent_submits_verdict' in requestOptions(agent, 'review_merge'), false)
  assert.equal('agent_submits_verdict' in requestOptions({ post_review: true, agent_submits_verdict: true }, 'review'), false)
})

test('a Review tapped before the host\'s capabilities arrive takes the draft default once they do, and a window already settled is left alone', async () => {
  const { settleDraftDefault, reviewIntent, WHO_OPTIONS } = await import('../collaboration.js')
  const draftHost = { post_review: true, propose_verdict: true }
  const pending = { ...reviewIntent('review'), pulls: [], request_id: 'first', draftPending: true }
  assert.equal(pending.options, WHO_OPTIONS.private, 'opened without capabilities: the private default')
  assert.equal(settleDraftDefault(pending, null), pending, 'still waiting: nothing changes')
  const settled = settleDraftDefault(pending, draftHost)
  assert.deepEqual([settled.options, settled.mode, 'draftPending' in settled], [WHO_OPTIONS.draft, 'review', false])
  assert.notEqual(settled.request_id, 'first', 'a new options answer is a new request')
  const plain = settleDraftDefault(pending, {})
  assert.deepEqual([plain.options, 'draftPending' in plain, plain.request_id], [WHO_OPTIONS.private, false, 'first'], 'a host without drafting keeps the private default')
  const chosen = { ...settled, options: WHO_OPTIONS.private }
  assert.equal(settleDraftDefault(chosen, draftHost), chosen, 'a choice already made is never overridden')
  const known = { ...reviewIntent('review', true), request_id: 'known' }
  assert.equal(settleDraftDefault(known, draftHost), known, 'a window opened with capabilities known is not touched')
  assert.equal(settleDraftDefault(null, draftHost), null)
})

test('"Draft for me" is offered only by a Möbius that can post a review and propose its verdict', async () => {
  const { offersDraft } = await import('../collaboration.js')
  assert.equal(offersDraft({ post_review: true, propose_verdict: true }), true)
  for (const capabilities of [null, undefined, {}, { post_review: true }, { propose_verdict: true }, { post_review: false, propose_verdict: true }]) assert.equal(offersDraft(capabilities), false)
})

test('a PR changed after its review still finds that review, as an earlier version', async () => {
  const { earlierReviewForPull, reviewForPull } = await import('../collaboration.js')
  const pr = { number: 233, headRefOid: 'new'.padEnd(40, '1'), baseRefName: 'main', repository: { nameWithOwner: 'Team/Repo' } }
  const run = (id, at, head, number = 233, repo = 'team/repo') => ({ id, created_at: at, items: [{ repo, number, head_sha: head, base_ref: 'main', state: 'all_clear' }] })
  const older = run('older', '2026-11-03T08:00:00Z', 'old'.padEnd(40, '0'))
  const newest = run('newest', '2026-11-03T09:30:00Z', 'mid'.padEnd(40, '0'))
  const runs = [older, newest, run('other-pr', '2026-11-03T09:40:00Z', 'zzz'.padEnd(40, '0'), 9), run('other-repo', '2026-11-03T09:50:00Z', 'yyy'.padEnd(40, '0'), 233, 'team/else')]
  // Nothing was reviewed at the current head, so it is not "never reviewed".
  assert.equal(reviewForPull(runs, pr), null)
  assert.equal(earlierReviewForPull(runs, pr).run.id, 'newest')
  assert.equal(earlierReviewForPull([], pr), null)
  // A review of the current head is the review, not an earlier one.
  const current = run('current', '2026-11-03T10:00:00Z', pr.headRefOid)
  assert.equal(earlierReviewForPull([current], pr), null)
})

test('a row counts the conversation the PR page lists: comments plus reviews', () => {
  assert.equal(conversationCount({ comments: { totalCount: 1 }, reviews: { totalCount: 2 } }), 3)
  assert.equal(conversationCount({ comments: { totalCount: 0 }, reviews: { totalCount: 2 } }), 2)
  assert.equal(conversationCount({}), 0)
})

test('drafts, failing checks and bots are filters of their own', () => {
  const failing = { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'FAILURE', count: 1 }, { state: 'SUCCESS', count: 1 }], statusContextCountsByState: [] } } } }] } }
  const rows = [{ number: 1, isDraft: true, author: { login: 'owner' } }, { number: 2, author: { login: 'dependabot' }, ...failing }, { number: 3, author: { login: 'renovate[bot]' } }]
  assert.deepEqual(matchingPulls(rows, 'drafts', 'owner').map(pr => pr.number), [1])
  assert.deepEqual(matchingPulls(rows, 'failing', 'owner').map(pr => pr.number), [2])
  assert.deepEqual(matchingPulls(rows, 'bots', 'owner').map(pr => pr.number), [2, 3])
  assert.equal(isBotAuthor('ArminKorajlic'), false)
  for (const person of ['abbot', 'talbot', 'robot']) assert.equal(isBotAuthor(person), false, person)
  for (const bot of ['qa-bot', 'review_bot', 'copilot[bot]']) assert.equal(isBotAuthor(bot), true, bot)
})

test('the review clock of a run that pushed a fix starts when you pressed Push', async () => {
  const { reviewStartedAt } = await import('../collaboration.js')
  const run = { created_at: '2026-11-06T13:46:00Z' }
  assert.equal(reviewStartedAt(run, { repair_attempts: [] }), '2026-11-06T13:46:00Z')
  assert.equal(reviewStartedAt(run, { repair_attempts: [{ state: 'pushed', decided_at: '2026-11-06T15:01:00Z' }, { state: 'discarded', decided_at: '2026-11-06T15:30:00Z' }] }), '2026-11-06T15:01:00Z')
})

// Request review over several PRs: one request each, naming only who may be asked there.
const owned = (number, extra = {}) => ({ ...pull(number), author: { login: 'Alex' }, ...extra })
const replyPerPr = answers => async (url, options) => {
  const body = JSON.parse(options.body)
  const answer = answers[body.number] || { status: 200, json: { state: 'requested', observed_head_sha: 'a'.repeat(40) } }
  return new Response(JSON.stringify(answer.json), { status: answer.status })
}

test('Request review on several PRs sends each its own request, without the author or who approved that PR', async t => {
  const sent = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ state: 'requested', observed_head_sha: 'a'.repeat(40) })) })
  const approved = { 2: ['kim'] }
  const outcome = await requestReviewMany('t', 80, [owned(1), owned(2)], ['alex', 'kim', 'sam'], { approvedBy: pr => approved[pr.number] || [] })
  assert.deepEqual(outcome, { ok: true, state: 'requested', asked: [1, 2], skipped: [] })
  assert.deepEqual(sent.map(item => [item.url, item.body.number, item.body.reviewers]), [
    ['/api/github/contributions/80/pulls/request-review', 1, ['kim', 'sam']],
    ['/api/github/contributions/80/pulls/request-review', 2, ['sam']]])
})

test('a PR with nobody left to ask is skipped, not an error, and is named in the result', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(JSON.parse(options.body).number); return new Response(JSON.stringify({ state: 'requested', observed_head_sha: 'a'.repeat(40) })) })
  const outcome = await requestReviewMany('t', 80, [owned(1), owned(2)], ['kim'], { approvedBy: pr => (pr.number === 1 ? ['kim'] : []) })
  assert.deepEqual(outcome, { ok: true, state: 'requested', asked: [2], skipped: [1] })
  assert.deepEqual(calls, [2])
})

test('a refused PR names its reason, the others are still asked, and a retry asks only the PR that is left', async t => {
  const calls = []
  const answers = { 2: { status: 409, json: { detail: 'The author of a pull request cannot be asked to review it.' } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(JSON.parse(options.body).number); return replyPerPr(answers)(url, options) })
  const done = new Set()
  const first = await requestReviewMany('t', 80, [owned(1), owned(2), owned(3)], ['sam'], { done })
  assert.deepEqual(first, { error: 'Not asked: #2: The author of a pull request cannot be asked to review it.. Asked on #1, #3.' })
  assert.deepEqual(calls, [1, 2, 3])
  delete answers[2]
  calls.length = 0
  const retry = await requestReviewMany('t', 80, [owned(1), owned(2), owned(3)], ['sam'], { done })
  assert.deepEqual(calls, [2], 'who was already asked is not asked again')
  assert.deepEqual(retry, { ok: true, state: 'requested', asked: [2], skipped: [] })
})

test('a retry with a changed selection asks each PR only the people it was not asked, and nobody twice', async t => {
  const sent = []
  const answers = { 8: { status: 409, json: { detail: 'GitHub refused.' } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => { const body = JSON.parse(options.body); sent.push([body.number, body.reviewers]); return replyPerPr(answers)(url, options) })
  const done = new Set()
  const first = await requestReviewMany('t', 80, [owned(7), owned(8)], ['new-colleague'], { done })
  assert.match(first.error, /#8: GitHub refused\..* Asked on #7/)
  delete answers[8]
  sent.length = 0
  const retry = await requestReviewMany('t', 80, [owned(7), owned(8)], ['second-reviewer'], { done })
  assert.deepEqual(sent, [[7, ['second-reviewer']], [8, ['second-reviewer']]], 'the new person is asked on both PRs')
  assert.deepEqual(retry, { ok: true, state: 'requested', asked: [7, 8], skipped: [] })
  sent.length = 0
  await requestReviewMany('t', 80, [owned(7), owned(8)], ['new-colleague', 'second-reviewer'], { done })
  assert.deepEqual(sent, [[8, ['new-colleague']]], 'only the pair never asked is sent')
})

test('closing Möbius’s sheet after an unconfirmed request still reads it back and never sends it again', async t => {
  const sent = []
  const answers = { 1: { status: 502, json: { detail: { code: 'reviewers_unconfirmed', message: 'GitHub may have asked.' } } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => { sent.push(JSON.parse(options.body).number); return replyPerPr(answers)(url, options) })
  const done = new Set()
  let confirmed = 0
  const shell = { shellConfirm: async () => (++confirmed === 2 ? { cancelled: true } : null) }
  const cancelledSecond = await requestReviewMany('t', 80, [owned(1), owned(2)], ['sam'], { done, shell })
  assert.equal(cancelledSecond.pending, true)
  assert.match(cancelledSecond.error, /on #1\. Check it before trying again\. You closed Möbius’s sheet/)
  assert.deepEqual(sent, [1])
  // Another PR was asked before the cancel: the uncertainty still wins over the plain error.
  const sentAfter = []
  t.mock.method(globalThis, 'fetch', async (url, options) => { sentAfter.push(JSON.parse(options.body).number); return replyPerPr(answers)(url, options) })
  confirmed = 0
  const three = { shellConfirm: async () => (++confirmed === 3 ? { cancelled: true } : null) }
  const mixed = await requestReviewMany('t', 80, [owned(4), owned(1), owned(3)], ['sam'], { shell: three })
  assert.equal(mixed.pending, true)
  assert.match(mixed.error, /on #1\./)
  // The pair is held, so a retry in the same sheet does not send #1 again.
  const retry = await requestReviewMany('t', 80, [owned(1)], ['sam'], { done })
  assert.deepEqual(retry, { ok: true, state: 'requested', asked: [], skipped: [] })
  assert.deepEqual(sent, [1], '#1 was never sent a second time')
})

test('an unconfirmed request on one PR is read back, never repeated, and the others are still asked', async t => {
  const calls = []
  const answers = { 2: { status: 502, json: { detail: { code: 'reviewers_unconfirmed', message: 'GitHub may have asked.' } } } }
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(JSON.parse(options.body).number); return replyPerPr(answers)(url, options) })
  const outcome = await requestReviewMany('t', 80, [owned(1), owned(2), owned(3)], ['sam'])
  assert.deepEqual(calls, [1, 2, 3])
  assert.deepEqual(outcome, { pending: true, error: 'GitHub may have asked for the review on #2. Check it before trying again.' })
})

// A new Möbius answers the short list (documents left out, marked "view": "summary"); an older one ignores the
// option and answers in full with no marker. Contribute reads both: a short run is marked for the screens that show documents.
test('the runs are asked for as the short list, and a short run is marked while a full one is left as it is', async t => {
  const calls = []
  let answer
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push(`${init.method} ${url}`); return new Response(JSON.stringify(answer)) })
  answer = { view: 'summary', runs: [{ id: 'short-run', state: 'complete', items: [{ repo: 'o/r', number: 1, state: 'all_clear' }] }], respond_chats: [] }
  const short = await loadReviewRuns('test', 80, { now: 1 })
  assert.deepEqual(calls, ['GET /api/github/contributions/80/review-runs?view=summary'])
  assert.deepEqual(short.runs.map(run => run.summary_only), [true], 'a screen that shows documents knows this run has none')
  assert.equal(short.view, 'summary')
  answer = { runs: [{ id: 'full-run', state: 'complete', items: [{ repo: 'o/r', number: 1, state: 'all_clear', summary: 'whole findings' }] }], respond_chats: [] }
  const full = await loadReviewRuns('test', 80, { now: 1 })
  assert.deepEqual(full.runs.map(run => run.summary_only), [undefined], 'an older Möbius answered in full: nothing to read separately')
  assert.deepEqual(full, answer)
})
