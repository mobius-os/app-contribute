// The counts and the "waiting on" group-by: Needs you counts a review request only where the PR machine says the turn is the owner's, one
// function counts them for every screen, and everything the app waits on is grouped by who it waits on.
import assert from 'node:assert/strict'
import test from 'node:test'
import { NEEDS_CHIPS, deskCounts, needsCount, projectNeedsCount, requestsWaiting } from '../desk.js'
import { attachSourceProjects } from '../source-map.js'
import { WAIT_GROUPS, allowedSeconds, isStuck, waitingOnGroups } from '../waiting-on.js'

const HEAD = 'a'.repeat(40)
const NOW = 1763460000
// A PR GitHub read completely: the shared decision reads a PR without these facts as "could not be read".
const pull = (number, extra = {}) => ({ number, title: `Thing ${number}`, author: { login: 'octocat' }, repository: { nameWithOwner: 'acme/widgets', viewerPermission: 'WRITE' }, labels: { nodes: [] }, comments: { totalCount: 0 }, headRefName: `h${number}`, baseRefName: 'main', updatedAt: new Date((NOW - 7200) * 1000).toISOString(), isDraft: false,
  headRefOid: HEAD, state: 'OPEN', mergeable: 'MERGEABLE', latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] }, ...extra })
const requested = (number, extra = {}) => pull(number, { reviewRequested: true, ...extra })

// A clean agent review of the very version, kept private: the PR machine reads it as nobody's turn (reviewer.kept_private).
const privateRun = { id: 'r1', state: 'complete', execution_state: 'completed', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', items: [{ repo: 'acme/widgets', number: 2, head_sha: HEAD, title: 'Thing 2', state: 'all_clear', summary: 'fine', public_review: null }] }

test('a review request counts only where the PR machine says it is your turn, not because GitHub lists it', () => {
  const requests = [requested(1, { isDraft: true }), requested(2), requested(3)]
  const facts = { runs: [privateRun] }
  assert.deepEqual(requestsWaiting(requests, 'owner', facts).map(pr => pr.number), [3], 'a draft is their move, a review you kept private is nobody\'s')
  const counts = deskCounts({ incoming: requests, login: 'owner', ...facts })
  assert.equal(counts.requests, 1, 'it was 3: every request GitHub lists was a row')
  assert.equal(needsCount(counts), 1)
})

test('a PR in the merge queue, a merged one and one that could not be read: only the last stays your move', () => {
  assert.deepEqual(requestsWaiting([requested(1, { mergeQueueEntry: { id: 'q' } })], 'owner'), [], 'GitHub merges it when the queue reaches it')
  assert.equal(requestsWaiting([requested(2, { state: 'MERGED' })], 'owner').length, 0)
  assert.equal(requestsWaiting([{ number: 50, reviewRequested: true }], 'owner').length, 1, 'Couldn\'t read: its next step, Try again, is yours')
})

// GitHub drops a request when its reviewer reviews, so a request listed beside the owner's own review of this version was made again
// (the author answered and asked for another look, pushing nothing). It read as "you reviewed this version", nobody's turn, and left every list.
const ownReview = state => ({ viewerLatestReview: { state, commit: { oid: HEAD } }, latestOpinionatedReviews: { nodes: state === 'COMMENTED' ? [] : [{ state, author: { login: 'owner' }, commit: { oid: HEAD } }] } })

test('a review the author asks for again after the owner reviewed this version stays a request, counted once everywhere', () => {
  for (const state of ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']) {
    const asked = requested(1, ownReview(state))
    assert.deepEqual(requestsWaiting([asked], 'owner').map(pr => pr.number), [1], `${state}: it was no row`)
    assert.equal(requestsWaiting([{ ...asked, reviewRequested: false }], 'owner').length, 0, `${state}: reviewed and not asked again is nobody's turn`)
    assert.equal(deskCounts({ incoming: [asked], login: 'owner' }).requests, 1, state)
  }
  const incoming = [requested(1, ownReview('APPROVED')), requested(2, ownReview('CHANGES_REQUESTED'))]
  const projects = attachSourceProjects({ apps: [{ key: 'widgets', name: 'Widgets', canonical_repo: 'acme/widgets', available: true }] }, [], incoming, [], [])
  assert.equal(projectNeedsCount(projects[0], [], 'owner', []), 2, 'the project tab and its body')
  assert.equal(deskCounts({ projects, incoming, login: 'owner' }).requests, 2)
})

// The Desk frames a request whose review is at work (pr-standing.js frameOf), so that row must stay while the agent works: the browser fixture's
// runDeskFrameChecks, runReviewHelperWaitChecks and runSyncChecks hold it. The PR machine's turn is the agent's, which is no reason to hide your request.
const reviewing = number => ({ id: 'r' + number, state: 'reviewing', execution_state: 'running', chat_id: 'c', created_at: '2026-11-03T22:00:00Z', items: [{ repo: 'acme/widgets', number, head_sha: HEAD, title: 'Thing ' + number, state: 'reviewing' }] })

test('a request whose review the agent is at work on stays your request, a row of Needs you counted once', () => {
  const requests = [requested(1), requested(2)]
  const facts = { runs: [reviewing(2)] }
  assert.deepEqual(requestsWaiting(requests, 'owner', facts).map(pr => pr.number), [1, 2])
  const counts = deskCounts({ incoming: requests, login: 'owner', ...facts })
  assert.equal(counts.requests, 2)
  const got = groups({ pulls: requests, facts })
  assert.deepEqual(got.owner.map(entry => entry.ref.pr.number).sort(), [1, 2])
  assert.deepEqual(got.agent, [], 'a row of Needs you is not also a wait on the agent')
  assert.equal(got.owner.length, needsCount(counts))
})

test('a project\'s card, the rail and the chips count the same requests', () => {
  const incoming = [requested(1, { isDraft: true }), requested(2), requested(3, { mergeQueueEntry: { id: 'q' } })]
  const projects = attachSourceProjects({ apps: [{ key: 'widgets', name: 'Widgets', canonical_repo: 'acme/widgets', available: true }] }, [], incoming, [], [])
  const counts = deskCounts({ projects, incoming, login: 'owner' })
  assert.equal(projectNeedsCount(projects[0], [], 'owner', []), 1)
  assert.equal(counts.requests, 1)
  assert.equal(NEEDS_CHIPS.find(chip => chip.key === 'review').count(counts), 1)
})

// ---- The group-by.
const record = (extra = {}) => ({ id: 'rec', type: 'pr', status: 'open', url: 'https://github.com/acme/widgets/pull/9', number: 9, repo: 'acme/widgets', plan: { repo: 'acme/widgets', action: 'pr' }, ...extra })
const groups = (args = {}) => waitingOnGroups({ login: 'owner', now: NOW, ...args })
const states = list => list.map(entry => `${entry.source}:${entry.state}`)

test('the Needs you number is the size of the owner group', () => {
  const incoming = [requested(1), requested(2, { isDraft: true }), pull(4, { author: { login: 'owner' }, latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'octocat' }, commit: { oid: HEAD } }] } })]
  const got = groups({ pulls: incoming })
  assert.deepEqual(Object.keys(got), [...WAIT_GROUPS, 'stuck'])
  assert.equal(got.owner.length, needsCount(deskCounts({ incoming, login: 'owner' })))
  assert.deepEqual(got.owner.map(entry => entry.ref.pr.number).sort(), [1, 4])
  assert.deepEqual(got.owner.map(entry => entry.waits), ['owner', 'owner'])
})

test('a project run that stopped or failed is Needs you; a run still working waits on the agent', () => {
  const stopped = { key: 'platform', name: 'Möbius', record: { chat_id: 'c', started_at: '2026-11-18T08:00:00Z' }, phase: 'stopped', observedAt: new Date((NOW - 600) * 1000).toISOString() }
  const failed = { ...stopped, key: 'repo:acme/widgets', name: 'Widgets', phase: 'failed' }
  const working = { ...stopped, key: 'repo:acme/other', phase: 'running', observedAt: new Date((NOW - 60) * 1000).toISOString() }
  const got = groups({ projectRuns: [stopped, failed, working] })
  assert.deepEqual(states(got.owner).sort(), ['run:FAILED', 'run:STOPPED'])
  assert.deepEqual(got.owner.map(entry => entry.age).sort((a, b) => a - b), [600, 600], 'dated by when the platform said so')
  assert.deepEqual(states(got.agent), ['run:RUNNING'])
  assert.equal(deskCounts({ incoming: [], login: 'owner', projectRuns: [{ ...stopped, rows: [{ region: 'run', state: 'STOPPED', waits: 'owner', since: NOW - 600 }] }] }).questions, 1, 'the run is a To look at row of Needs you')
})

test('records, answers and PRs are grouped by who they wait on, longest wait first', () => {
  const sending = record({ id: 'a', status: 'submitting', url: undefined, number: undefined })
  const queued = record({ id: 'b', lifecycle: { v: 1, regions: { publication: { state: 'QUEUED', since: NOW - 3600, deadline: NOW + 18000 }, update: { state: 'NONE', since: NOW - 3600, deadline: null }, followup: { state: 'OFF', since: NOW - 3600, deadline: null } }, attention: { flags: [] }, history: [] } })
  const waitingPr = pull(5, { author: { login: 'owner' } })
  const got = groups({ records: [sending, queued], pulls: [waitingPr] })
  assert.deepEqual(states(got.platform), ['record:SENDING'])
  assert.deepEqual(states(got.github), ['record:QUEUED'])
  assert.equal(got.github[0].age, 3600)
  assert.deepEqual(states(got.other), ['pr:author.waiting_review'])
  assert.equal(got.other[0].who, 'reviewers')
  assert.equal(got.other[0].age, 7200, 'since is GitHub\'s updatedAt')
})

test('a saved answer whose post has not started waits on the platform; a stalled one is the owner\'s', () => {
  const answer = (state, decision, extra = {}) => ({ result: { id: 'x1', state, repo: 'acme/widgets', number: 5, digest: 'd', pr: { head_sha: HEAD }, points: [], receipts: { replies: [] }, created_at: new Date((NOW - 20) * 1000).toISOString(), ...extra }, decision: decision && { result_id: 'x1', digest: 'd', decision, at: new Date((NOW - 20) * 1000).toISOString() } })
  const got = groups({ responses: [answer('ready', 'approved')], pulls: [pull(5, { author: { login: 'owner' } })] })
  assert.deepEqual(states(got.platform), ['respond:APPROVED'])
  assert.equal(got.platform[0].age, 20)
})

test('a wait on a machine for longer than its state allows is stuck', () => {
  const old = { ...{ key: 'p', record: { chat_id: 'c' } }, phase: 'running', observedAt: new Date((NOW - 3 * 3600) * 1000).toISOString() }
  const got = groups({ projectRuns: [old] })
  assert.deepEqual(states(got.stuck), ['run:RUNNING'], 'an hour of silence, three hours old')
  assert.equal(allowedSeconds({ region: 'run', state: 'RUNNING' }), 3600)
  assert.equal(allowedSeconds({ region: 'run', state: 'STOPPED' }), null)
  assert.equal(isStuck({ waits: 'owner', region: 'run', state: 'RUNNING', age: 99999 }), false, 'what waits on you is never stuck')
  assert.equal(isStuck({ waits: 'agent', region: 'run', state: 'RUNNING', age: 3599 }), false)
  assert.equal(isStuck({ waits: 'agent', region: 'run', state: 'RUNNING', age: null }), false, 'no date, no claim')
  assert.deepEqual(groups({ projectRuns: [{ ...old, observedAt: new Date((NOW - 60) * 1000).toISOString() }] }).stuck, [])
})

test('a PR an answer is already working on shows once', () => {
  const answer = { result: { id: 'x1', state: 'posting', repo: 'acme/widgets', number: 5, digest: 'd', pr: { head_sha: HEAD }, points: [], receipts: { replies: [] }, created_at: new Date((NOW - 10) * 1000).toISOString() }, decision: null }
  const got = groups({ responses: [answer], pulls: [pull(5, { author: { login: 'owner' } })], facts: { chats: [{ repo: 'acme/widgets', number: 5, chat_id: 'c', state: 'running' }] } })
  assert.equal([...got.agent, ...got.platform].filter(entry => entry.key === 'acme/widgets#5').length, 1)
})

// ---- The screens: one list for the badge, the tab body, the Requests view and the project's line.
import { readFileSync } from 'node:fs'
import { readProjectRuns, runProjects } from '../project-runs.js'
import { projectCycleIdentity } from '../source-map.js'
const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const pullsSource = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
const viewsSource = readFileSync(new URL('../ui/DeskViews.jsx', import.meta.url), 'utf8')
const mapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')

test('the repository\u2019s list and the PR page mark a request GitHub lists, so they say what the Desk says about it', () => {
  assert.match(pullsSource, /const standingOf = pr => standingFor\(\{ pr: requestedKeys\.has\(prKey\(pr\)\) && !pr\.reviewRequested \? \{ \.\.\.pr, reviewRequested: true \} : pr,/)
})

test('the badge, the Review requests tab, the Requests view and the project\'s line read the same requests', () => {
  assert.match(app, /reviewRequestCount=\{project \? projectAsked\[project\.key\] \?\? requestsWaiting\(project\.reviewRequests, login, standingFacts\)\.length : 0\}/)
  assert.match(app, /const projectAsked = useMemo\(\(\) => Object\.fromEntries\(sourceProjects\.map\(project => \[project\.key, requestsWaiting\(/)
  assert.match(pullsSource, /const asked = requestsWaiting\(project\?\.reviewRequests, conn\.login, \{ runs, chats: respondChats, responses, ignored: ignoredReviews \}\)/)
  assert.match(pullsSource, /\.\.\.asked\.filter\(pr => !pulls\.some\(item => prKey\(item\) === prKey\(pr\)\)\)/, 'a counted request the list has not read is still shown')
  assert.match(viewsSource, /requestsWaiting\(project\.reviewRequests, login, facts\)\.filter/)
  assert.match(mapSource, /if \(reviewRequests && asked === null\)/, 'given the count of requests that are yours, the line says one number')
})

// ---- The project runs the Desk follows.
const cycle = (extra = {}) => ({ chat_id: 'chat-1', k: 1, started_at: '2026-11-18T10:00:00Z', ...extra })
const phaseOf = runtime => runtime.phase
const reader = (records, statuses) => ({ loadState: async key => records[key] ?? null, chatStatus: async id => { const found = statuses[id]; if (found instanceof Error) throw found; return found }, phaseOf, now: NOW })

test('every project\'s run is read from its cycle record and what the platform says about its chat', async () => {
  const stopped = { phase: 'stopped', updated_at: new Date((NOW - 300) * 1000).toISOString() }
  const done = { phase: 'complete' }
  const runs = await readProjectRuns([{ key: 'platform', name: 'Möbius' }, { key: 'repo:a/b', name: 'B' }, { key: 'repo:a/c', name: 'C' }, { key: 'repo:a/d', name: 'D' }],
    reader({ platform: cycle(), 'repo:a/b': cycle({ chat_id: 'chat-2' }), 'repo:a/c': null }, { 'chat-1': stopped, 'chat-2': done }))
  assert.deepEqual(runs.map(run => [run.key, run.rows.map(row => `${row.state}:${row.waits}`)]), [['platform', ['STOPPED:owner']]], 'a finished run, no record and no run owe nothing')
  assert.equal(runs[0].rows[0].since, NOW - 300)
})

test('a status that cannot be read keeps what was last known; a cycle whose start was never confirmed asks the owner after two minutes', async () => {
  const before = [{ key: 'platform', name: 'Möbius', record: cycle(), phase: 'stopped', observedAt: null, rows: [{ region: 'run', state: 'STOPPED', waits: 'owner', since: NOW - 900, deadline: null }] }]
  const kept = await readProjectRuns([{ key: 'platform', name: 'Möbius' }], { ...reader({ platform: cycle() }, { 'chat-1': new Error('offline') }), previous: before })
  assert.deepEqual(kept, before, 'a failed read is no evidence that the run started again')
  const unsent = { cycle: { cid: 'platform:1', k: 1, started_at: new Date((NOW - 600) * 1000).toISOString(), delivered: false, closed: false } }
  const late = await readProjectRuns([{ key: 'platform', name: 'Möbius' }], reader({ platform: unsent }, {}))
  assert.deepEqual(late.map(run => run.rows.map(row => `${row.state}:${row.waits}`)), [['NOT_SENT:owner']])
})

test('the Desk follows each installed project once, under the key its run is saved with', () => {
  const projects = [{ key: 'platform', kind: 'platform', name: 'Möbius' }, { key: 'app:1', kind: 'app', name: 'A', canonical_repo: 'o/a' }, { key: 'app:2', kind: 'app', name: 'A again', canonical_repo: 'O/A' }, { key: 'external:o/x', kind: 'external', name: 'X', canonical_repo: 'o/x' }]
  assert.deepEqual(runProjects(projects, projectCycleIdentity).map(project => project.key), ['platform', 'repo:o/a'])
})

// ---- Rendered: the run row and the project's line.
import { frontendModules, renderModule } from './render-harness.mjs'
let renderer
const ui = async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskView } from './ui/DeskViews.jsx'
    import { ProjectRow } from './ui/SourceMap.jsx'
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
    export const row = props => renderToStaticMarkup(React.createElement(ProjectRow, props))
  `)
  return renderer
}
const widgets = () => attachSourceProjects({ apps: [{ key: 'widgets', name: 'Widgets', canonical_repo: 'acme/widgets', available: true }] }, [], [requested(1)], [], [])

test('a stopped project run is a row of Needs you, counted with the others, and it opens its project', async t => {
  const api = await ui(t)
  if (!api) return
  const projects = widgets()
  const projectRuns = [{ key: 'repo:acme/widgets', name: 'Widgets', rows: [{ region: 'run', state: 'STOPPED', waits: 'owner', since: NOW - 600, deadline: null }] }]
  const opened = []
  const html = api.view({ projects, records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', reviews: { entries: [] }, counts: {}, view: 'needs', projectRuns, onOpenProject: key => opened.push(key), onOpenPull() {}, onOpenRecord() {} })
  assert.match(html, /The agent’s run stopped/)
  assert.match(html, />Stopped</)
  assert.match(html, /It stopped before it finished\. Open the project to see where it got to, or start it again\./)
  const rows = (html.match(/class="co-desk-row(?: is-[a-z_]+)*"/g) || []).length
  assert.equal(rows, projectNeedsCount(projects[0], [], 'owner', [], { projectRuns }), 'the card lists exactly what the rail counts')
  assert.equal(rows, 2, 'the review request and the stopped run')
  assert.equal(deskCounts({ projects, incoming: [requested(1)], login: 'owner', projectRuns }).questions, 1)
})

test('given how many requests are the owner\'s move, the project\'s line says one number; without it the line is as it was', async t => {
  const api = await ui(t)
  if (!api) return
  const project = widgets()[0]
  const line = props => (api.row({ project, onSelect() {}, ...props }).match(/class="co-source-attention">([^<]*)</) || [])[1]
  assert.equal(line({ needs: 2, asked: 1 }), '2 things need you.', 'the request is one of the two things, not a third')
  assert.equal(line({ needs: 1, asked: 1 }), '1 thing needs you.')
  assert.equal(line({ needs: 0, asked: 0 }), undefined, 'a request that is nobody\'s move to make is not a line')
  assert.equal(line({ needs: 2 }), '1 PR waits for your review. 2 things need you.')
})
