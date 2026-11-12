import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'
import { NAMES } from '../names.js'
import { standingFor } from '../pr-standing.js'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskRail, DeskCounts, projectRailCount } from './ui/Desk.jsx'
    import { DeskView } from './ui/DeskViews.jsx'
    export { projectRailCount }
    export const rail = props => renderToStaticMarkup(React.createElement(DeskRail, props))
    export const counts = props => renderToStaticMarkup(React.createElement(DeskCounts, props))
    // Where the drafts line leads, found by pressing it (DeskCounts holds no hooks, so it can be called directly).
    export function draftsDestination(counts) {
      let pressed = null
      const line = DeskCounts({ counts, onFilter: () => {}, onView: view => { pressed = view } }).props.children[1]
      line.props.children[1].props.onClick()
      return pressed
    }
    export const view = props => renderToStaticMarkup(React.createElement(DeskView, props))
  `)
  return renderer
}

const HEAD = 'a'.repeat(40)
// A PR GitHub read completely: the shared decision reads a PR without these facts as "could not be read".
const pullFixture = (number, extra = {}) => ({
  number,
  title: `Improve thing ${number}`,
  author: { login: 'teammate' },
  repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  headRefOid: HEAD,
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  latestOpinionatedReviews: { nodes: [] },
  viewerLatestReview: null,
  reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  labels: { nodes: [{ name: 'enhancement', color: 'a2eeef' }] },
  comments: { totalCount: 2 },
  headRefName: `head-${number}`,
  baseRefName: 'main',
  updatedAt: '2026-11-02T08:00:00Z',
  isDraft: false,
  additions: 10,
  deletions: 3,
  ...extra,
})

const projectFixture = (key, extra = {}) => ({
  key,
  name: key === 'mobius' ? 'Möbius' : key,
  kind: 'app',
  available: true,
  localFiles: 0,
  compatibleFiles: 0,
  conflictFiles: 0,
  workingFiles: 0,
  incomingReviews: [],
  reviewRequests: [],
  ...extra,
})

const changesRequested = { latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'teammate' }, commit: { oid: HEAD } }] } }
const countsFixture = { questions: 1, requests: 2, merge: 3, fix: 1, again: 0, drafts: 0, mine: 4, merged: 0, reviewsRunning: 0 }

test('the rail shows its four views with their counts, the Repositories block apart, and marks the open project', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(1)] })
  const html = api.rail({ view: 'needs', counts: countsFixture, projects: [project], attention: { mobius: 2 }, selectedKey: 'mobius', onView: () => {}, onOpenProject: () => {} })
  assert.match(html, /Needs you/)
  for (const name of ['Needs you', 'Review requests', 'My PRs', 'Agent runs']) assert.match(html, new RegExp(name))
  assert.doesNotMatch(html, /Merged this week|To confirm|PR reviews|My work|Your edits/)
  // Projects are a block of their own: a labelled nav under the four views, with Add project last.
  assert.match(html, /<nav class="co-rail-projects" aria-labelledby="co-rail-projects-head"><h2 class="co-rail-head" id="co-rail-projects-head">Repositories<\/h2>/)
  assert.match(html, /Möbius/)
  // The project row shows exactly the count held for it (what its Needs you card lists).
  assert.equal(api.projectRailCount(project, { mobius: 3 }), 3)
  assert.equal(api.projectRailCount(project, {}), 0)
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?Möbius|Möbius[\s\S]*?aria-current/)
})

test('the side menu opens the Add repository form in flow, because the menu scrolls and would clip a floating panel', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const work = read('workspace-theme.js')
  assert.match(work, /\.co-rail \{[^}]*overflow-y:auto;/, 'the menu scrolls, so anything that floats out of it is cut off')
  assert.match(work, /\.co-rail-add \.co-repository-picker form,\.co-rail-add \.co-repository-note \{ position:static; width:auto;/, 'in the menu the form and the note take the menu\'s width in flow')
  assert.match(read('ui/RepositoryPicker.jsx'), /rootRef\.current\?\.scrollIntoView\(/, 'a short menu scrolls the opened form into view')
})

test('count chips name next steps, filter the list, and skip empty ones; drafts are a quiet line', async t => {
  const api = await ui(t)
  if (!api) return
  const html = api.counts({ counts: countsFixture, filter: 'merge', onFilter: () => {}, onView: () => {} })
  assert.match(html, />Review</)
  assert.match(html, /aria-pressed="true"><b>3<\/b><span>Merge<\/span></)
  assert.doesNotMatch(html, /files|Local changes/)
  assert.doesNotMatch(html, /co-desk-quiet-line/)
  const drafts = api.counts({ counts: { ...countsFixture, drafts: 4 }, onFilter: () => {}, onView: () => {} })
  assert.match(drafts, /4 drafts are ready to open for review\./)
  const none = api.counts({ counts: { ...countsFixture, questions: 0, requests: 0, merge: 0, fix: 0, drafts: 0 }, onFilter: () => {}, onView: () => {} })
  assert.equal(none, '')
  // The selected step stays even when a refresh empties it, so the control that clears the filter never vanishes
  // while the other steps still hold what needs you.
  const emptied = api.counts({ counts: { ...countsFixture, merge: 0 }, filter: 'merge', onFilter: () => {}, onView: () => {} })
  assert.match(emptied, /aria-pressed="true"><b>0<\/b><span>Merge<\/span></)
  assert.match(emptied, />Review</)
  const unselected = api.counts({ counts: { ...countsFixture, merge: 0 }, filter: '', onFilter: () => {}, onView: () => {} })
  assert.doesNotMatch(unselected, /Merge</)
  const allGone = api.counts({ counts: { ...countsFixture, questions: 0, requests: 0, merge: 0, fix: 0, drafts: 0 }, filter: 'merge', onFilter: () => {}, onView: () => {} })
  assert.match(allGone, /aria-pressed="true"><b>0<\/b><span>Merge<\/span></)
})

test('the drafts line leads to a view that lists what it counted', async t => {
  const api = await ui(t)
  if (!api) return
  // A draft of yours whose check came back clean: counted as a draft ready to open, with no saved decision behind it.
  const draft = pullFixture(9, { author: { login: 'owner' }, isDraft: true })
  const checked = { id: 'run', created_at: '2026-11-03T22:00:00Z', state: 'complete', execution_state: 'completed', items: [{ repo: 'o/r', number: 9, head_sha: HEAD, state: 'all_clear' }] }
  const project = projectFixture('kanban', { incomingReviews: [draft] })
  const counts = { ...countsFixture, questions: 0, requests: 0, merge: 0, fix: 0, editedFiles: 0, drafts: 1, mine: 1, work: 0 }
  const view = api.draftsDestination(counts)
  const html = api.view({ view, projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', runs: [checked], onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.match(html, /Improve thing 9/)
  assert.match(html, /Ready to open/)
})

test('a side view keeps each app inside one card whose icon and name open it', async t => {
  const api = await ui(t)
  if (!api) return
  const asked = pullFixture(1915, { updatedAt: '2026-11-02T08:00:00Z' })
  const project = projectFixture('mobius', { reviewRequests: [asked], incomingReviews: [asked] })
  const html = api.view({
    view: 'requests', projects: [project, projectFixture('quietapp')], records: [], login: 'owner',
    decisionsFor: () => [], lastLooked: '2026-11-01T00:00:00Z', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, /co-envelope/)
  assert.match(html, /class="co-btn co-btn-chip co-envelope-open" aria-label="Open [^"]+" title="[^"]+"><span class="co-project-icon[^>]*>.*?<strong>/, 'the icon and name are one button that opens the project')
  assert.doesNotMatch(html, /<button[^>]*>Open<svg/, 'no separate Open word button on a card header')
  assert.match(html, /Möbius/)
  assert.match(html, /Improve thing 1915/)
  assert.match(html, /Asks for your review/)
  assert.match(html, /enhancement/)
  // Changed after the last visit, so the quiet dot is on.
  assert.match(html, /co-newdot/)
  // The quiet app has nothing to show, so it gets no card at all.
  assert.doesNotMatch(html, /quietapp/)
})

test('my PRs read as a stack in merge order when they chain', async t => {
  const api = await ui(t)
  if (!api) return
  const mine = [
    pullFixture(44, { author: { login: 'owner' }, baseRefName: 'head-43' }),
    pullFixture(43, { author: { login: 'owner' } }),
  ]
  const project = projectFixture('kanban', { incomingReviews: mine })
  const html = api.view({
    view: 'mine', projects: [project], records: [], login: 'owner',
    decisionsFor: () => [], lastLooked: '', query: '',
    onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {},
  })
  assert.match(html, />Part 1 of 2</)
  assert.match(html, />Part 2 of 2</)
  assert.match(html, /Waiting on reviewers/)
})

test('the search filters rows and an empty view explains itself', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { reviewRequests: [pullFixture(7)] })
  const base = { view: 'requests', projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  assert.match(api.view({ ...base, query: 'thing 7' }), /Improve thing 7/)
  assert.doesNotMatch(api.view({ ...base, query: 'zzz' }), /co-envelope/)
  assert.match(api.view({ ...base, query: 'zzz' }), /Nothing matches your search/)
})

test('a project name in the search keeps that project’s rows in every view, and an author name finds their PRs', async t => {
  const api = await ui(t)
  if (!api) return
  const authored = pullFixture(5, { author: { login: 'owner' }, ...changesRequested })
  const project = projectFixture('kanban', {
    canonical_repo: 'o/r', incomingReviews: [authored, pullFixture(6, { author: { login: 'owner' }, ...changesRequested })], reviewRequests: [pullFixture(7, { author: { login: 'reviewer-person' } })],
  })
  const other = projectFixture('pages', { incomingReviews: [pullFixture(8, { author: { login: 'owner' }, ...changesRequested })] })
  const feedback = { id: 'f5', kind: 'public_attention', label: 'Feedback on five', record: { repo: 'o/r', number: 5 } }
  const merged = { id: 'm1', repo: 'o/r', status: 'merged', title: 'Landed work', number: 3, updated_at: new Date().toISOString() }
  const base = { projects: [project, other], records: [merged], login: 'owner', decisionsFor: item => (item === project ? [feedback] : []), lastLooked: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const found = { requests: /Improve thing 7/, needs: /Feedback on five[\s\S]*Improve thing 6/, mine: /Improve thing 5/, work: /Feedback on five/, merged: /Landed work/ }
  for (const [view, expected] of Object.entries(found)) {
    const html = api.view({ ...base, view, query: 'kanban' })
    assert.match(html, expected, view)
    // The other project's rows stay out: the name narrows the list.
    assert.doesNotMatch(html, /Improve thing 8/, view)
  }
  // The advertised person search reaches a PR's displayed author.
  assert.match(api.view({ ...base, view: 'requests', query: 'reviewer-person' }), /Improve thing 7/)
  assert.match(api.view({ ...base, view: 'mine', query: 'owner' }), /Improve thing 5/)
  assert.match(api.view({ ...base, view: 'needs', query: 'nobody-here' }), /Nothing matches your search/)
})

test('each app card folds with a chevron: down means open it, up means fold it', async t => {
  const api = await ui(t)
  if (!api) return
  const base = { view: 'requests', records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const two = api.view({ ...base, projects: [projectFixture('mobius', { reviewRequests: [pullFixture(7), pullFixture(8)] })] })
  assert.match(two, /class="co-btn co-btn-quiet co-btn-icon co-envelope-toggle"[^>]*aria-expanded="true"[^>]*aria-label="Collapse Möbius"/)
  assert.match(two, /Improve thing 7/)
  // One row has nothing to fold away.
  const one = api.view({ ...base, projects: [projectFixture('mobius', { reviewRequests: [pullFixture(7)] })] })
  assert.doesNotMatch(one, /co-envelope-toggle/)
})

test('a PR with a feedback card is listed once in Needs you, and My PRs keeps it', async t => {
  const api = await ui(t)
  if (!api) return
  const authored = pullFixture(5, { author: { login: 'owner' }, ...changesRequested })
  const quiet = pullFixture(6, { author: { login: 'owner' }, ...changesRequested })
  const project = projectFixture('mobius', { incomingReviews: [authored, quiet] })
  const feedback = { id: 'f5', kind: 'public_attention', label: 'Feedback on five', record: { repo: 'o/r', number: 5 } }
  const base = { projects: [project], records: [], login: 'owner', decisionsFor: () => [feedback], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const needs = api.view({ ...base, view: 'needs' })
  assert.equal((needs.match(/Improve thing 5/g) || []).length, 0)
  assert.match(needs, /Feedback on five/)
  // A PR with no feedback card still gets its own row.
  assert.match(needs, /Improve thing 6/)
  assert.match(api.view({ ...base, view: 'mine' }), /Improve thing 5/)
})

test('the new-dot legend shows only when a dot is on screen', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-desk-legend \{ display:none/)
  assert.match(css, /\.co-desk-pane:has\(\.co-desk-row \.co-newdot\) \.co-desk-legend \{ display:flex/)
})

test('the project screen has no status panel or warning row, and no action is a text link', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /co-project-position|co-status-|co-upstream-warning/)
  assert.doesNotMatch(css, /co-link-action/)
})

test('a feedback card is shaped like a PR row: title, then #number, then its state, then why, no second button', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius')
  const item = { id: 'f1', kind: 'public_attention', label: '#9 Feedback title', detail: 'A GitHub review requested changes.', record: { repo: 'o/r', number: 9, attention: { type: 'changes_requested', detected_at: '2026-11-02T08:00:00Z' } } }
  const html = api.view({ view: 'needs', projects: [project], records: [], login: 'owner', decisionsFor: () => [item], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.match(html, /class="co-desk-row is-changes"/)
  assert.match(html, /co-desk-row-title">Feedback title</, 'the number moves to the facts line, so the title is the title alone')
  assert.match(html, /co-desk-row-meta"><span>#9 · <time[^>]*>detected /)
  assert.match(html, /co-desk-chip is-tone">Changes requested/)
  assert.match(html, /co-desk-row-why">A GitHub review requested changes\./)
  assert.doesNotMatch(html, /View PR/)
})

// One PR, three screens, one label and one group (finding B1). The label is the shared decision's own words.
test('a PR says the same thing on Needs you, in a feedback card, and on My PRs: the label of its shared decision', async t => {
  const api = await ui(t)
  if (!api) return
  const feedbackOn = { reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'teammate' } }] } }] } }
  const own = pullFixture(5, { author: { login: 'owner' }, ...feedbackOn })
  const project = projectFixture('mobius', { canonical_repo: 'o/r', incomingReviews: [own] })
  const label = standingFor({ pr: own, login: 'owner' }).label
  assert.equal(label, 'Feedback to answer')
  const base = { projects: [project], records: [], login: 'owner', lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} }
  const needs = api.view({ ...base, view: 'needs', decisionsFor: () => [] })
  const mine = api.view({ ...base, view: 'mine', decisionsFor: () => [] })
  assert.match(needs, new RegExp(`co-desk-chip is-waiting">${label}<`), 'Needs you')
  assert.match(mine, new RegExp(`co-desk-chip is-waiting">${label}<`), 'My PRs')
  // The same PR as a saved feedback card: it was "Needs your decision"; now it reads as the PR does.
  const card = { id: 'f5', kind: 'public_attention', label: '#5 Improve thing 5', detail: 'A reviewer commented after the approval.', record: { repo: 'o/r', number: 5 } }
  const carded = api.view({ ...base, view: 'needs', decisionsFor: () => [card] })
  assert.match(carded, new RegExp(`co-desk-chip is-waiting">${label}<`), 'in the same pill the PR wears on My PRs')
  assert.doesNotMatch(carded, /Needs your decision/)
  assert.match(carded, /co-desk-row-title">Improve thing 5</, 'the PR\'s own title, with no number in front')
  assert.match(carded, /co-desk-row-meta"><span>#5 · yours<\/span>/)
})

test('a running review is the frame alone, with no tag on the row; one that stopped says so', async t => {
  const api = await ui(t)
  if (!api) return
  const project = projectFixture('mobius', { canonical_repo: 'o/r', incomingReviews: [pullFixture(5, { author: { login: 'owner' } })] })
  const run = execution => ({ id: 'run', created_at: '2026-11-03T22:00:00Z', state: 'running', execution_state: execution, chat_id: 'c', items: [{ repo: 'o/r', number: 5, head_sha: HEAD, state: 'reviewing' }] })
  const mine = runs => api.view({ view: 'mine', projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', runs, onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  const working = mine([run('running')])
  assert.match(working, /data-frame="reviewing"/)
  assert.doesNotMatch(working, /Agent working|Waiting on reviewers/, 'the frame says it; no tag does')
  const stopped = mine([run('failed')])
  assert.match(stopped, /data-frame="verdict"/)
  assert.match(stopped, /co-desk-chip is-waiting">Agent stopped</)
})

test('an approved PR is a Merge row, whatever GitHub\'s own decision says; pending checks are not', async t => {
  const api = await ui(t)
  if (!api) return
  const approvedBy = { latestOpinionatedReviews: { nodes: [{ state: 'APPROVED', author: { login: 'teammate' }, commit: { oid: HEAD } }] } }
  const ready = pullFixture(5, { author: { login: 'owner' }, reviewDecision: null, ...approvedBy })
  const running = pullFixture(6, { author: { login: 'owner' }, ...approvedBy, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING', contexts: { totalCount: 1, checkRunCountsByState: [{ state: 'PENDING', count: 1 }], statusContextCountsByState: [] } } } }] } })
  const project = projectFixture('mobius', { canonical_repo: 'o/r', incomingReviews: [ready, running] })
  const html = api.view({ view: 'needs', needsFilter: 'merge', projects: [project], records: [], login: 'owner', decisionsFor: () => [], lastLooked: '', query: '', onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  assert.match(html, /Improve thing 5/)
  assert.match(html, /co-desk-chip is-ready">Ready to merge</)
  assert.doesNotMatch(html, /Improve thing 6/, 'approved, but its checks are still running')
})

// Every Needs you row, whatever it is, reads title, then facts, then status, then a one-line reason (finding B4).
test('every Needs you row has one layout: title, #number · who · when, status, then a one-line reason', async t => {
  const api = await ui(t)
  if (!api) return
  const feedbackOn = { reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ author: { login: 'teammate' } }] } }] } }
  const project = projectFixture('mobius', { canonical_repo: 'o/r', reviewRequests: [pullFixture(1)], incomingReviews: [pullFixture(2, { author: { login: 'owner' }, ...changesRequested, ...feedbackOn })] })
  const note = 'The follow-up agent stopped: a reviewer raised a product trade-off that needs your decision. '.repeat(5).trim()
  const card = { id: 'f3', kind: 'public_attention', label: '#3 Card title', detail: note, record: { repo: 'o/r', number: 3, attention: { type: 'github_activity', detected_at: '2026-11-02T08:00:00Z' } } }
  const reviewedPull = pullFixture(4, { headRefOid: 'b'.repeat(40), viewerLatestReview: { state: 'APPROVED', commit: { oid: HEAD } } })
  const entry = { id: 'o/r#4', at: 1, bucket: 'waiting', run: { created_at: '2026-11-03T22:00:00Z' }, item: { repo: 'o/r', number: 4, title: 'Reviewed title' }, chips: [{ label: 'New commits · review again', tone: 'owner' }], pull: reviewedPull, decision: standingFor({ pr: reviewedPull, login: 'owner' }) }
  const html = api.view({ view: 'needs', projects: [project], records: [], login: 'owner', decisionsFor: () => [card], lastLooked: '', query: '', reviews: { entries: [entry] }, onOpenProject: () => {}, onOpenPull: () => {}, onOpenRecord: () => {} })
  const items = html.split('<div class="co-desk-item').slice(1)
  assert.equal(items.length, 4, 'a request, a card, an own PR that needs a step, a PR to review again')
  for (const row of items) {
    const at = marker => row.indexOf(marker)
    assert.ok(at('co-desk-row-title') > -1 && at('co-desk-row-title') < at('co-desk-row-meta'), 'title, then facts')
    assert.ok(at('co-desk-row-meta') < at('co-row-pills'), 'facts, then status')
    assert.match(row, /co-desk-row-meta"><(span class="co-desk-order"|span)>(Part \d of \d)?/, 'the facts line is the first thing under the title')
    assert.doesNotMatch(row.slice(at('co-desk-row-title'), at('co-desk-row-meta')), /co-desk-chip/, 'no pill in the title')
  }
  // Only a row with a saved note has a reason, and it follows the status, outside the button that opens the PR.
  const withNote = items.filter(row => row.includes('co-desk-note'))
  assert.equal(withNote.length, 1)
  assert.ok(withNote[0].indexOf('co-row-pills') < withNote[0].indexOf('co-desk-note') && withNote[0].indexOf('</button><div class="co-desk-note"') > -1)
  assert.ok(withNote[0].includes(`>${note}<`), 'the whole note is in the page; one line shows and Show more reveals the rest')
  assert.match(items.at(-1), /Reviewed title/)
  assert.match(items.at(-1), /#4 · teammate · <time[^>]*>you reviewed /)
  assert.doesNotMatch(html, /Pull request #4/)
})

test('rail badges mark only what waits on you; information shows a quiet number', async t => {
  const api = await ui(t)
  if (!api) return
  const html = api.rail({ view: 'needs', counts: countsFixture, projects: [], attention: {}, selectedKey: '', onView: () => {}, onOpenProject: () => {} })
  assert.match(html, /co-rail-count is-you">7</)
  // My PRs is a quiet total, never a pill; Agent runs says how many are running.
  assert.match(html, /co-rail-total">4</)
  const running = api.rail({ view: 'needs', counts: { ...countsFixture, reviewsRunning: 2 }, projects: [], attention: {}, selectedKey: '', onView: () => {}, onOpenProject: () => {} })
  assert.match(running, /co-rail-total">2 running</)
})

test('the sync note keeps the last successful time visible beside a failed retry, including on phones', () => {
  const guard = readFileSync(new URL('../ui/GithubParts.jsx', import.meta.url), 'utf8')
  assert.match(guard, /note\.failed \? 'Couldn’t sync'/)
  assert.match(guard, /Last synced /)
  const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
  assert.match(theme, /\.co-sync-copy \{ display:flex; flex-direction:column/)
  assert.doesNotMatch(theme, /\.co-toolbar \.co-label-long, \.co-sync-note \{ display: none; \}/)
})

test('list labels are filled pills like the PR page, two at most, and a bot says bot', async t => {
  const html = await (async () => {
    if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
    const mod = await renderModule(`
      import React from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { PullLabels, PullStateChips } from './ui/GithubParts.jsx'
      export const labels = pr => renderToStaticMarkup(React.createElement(PullLabels, { pr }))
      export const chips = (pr, machineChip) => renderToStaticMarkup(React.createElement(PullStateChips, { pr, machineChip }))
    `)
    return mod
  })()
  if (!html) return
  const node = (name, color = '0075ca') => ({ name, color })
  const human = html.labels({ author: { login: 'owner' }, labels: { nodes: [node('area: ui'), node('bug', 'd73a4a'), node('maintenance')] } })
  assert.match(human, /class="co-gh-label"[^>]*--co-label-dark-bg[^>]*>ui</)
  assert.doesNotMatch(human, /area:/)
  assert.match(human, /co-label-more" title="maintenance">\+1</)
  assert.equal((human.match(/class="co-gh-label"/g) || []).length, 2)
  const bot = html.labels({ author: { login: 'dependabot' }, labels: { nodes: [node('dependencies'), node('javascript')] } })
  assert.match(bot, /co-gh-label is-plain">bot</)
  assert.doesNotMatch(bot, /dependencies/)
  const chips = html.chips({ isDraft: true, reviewDecision: 'APPROVED' })
  assert.match(chips, /co-desk-chip">Draft</)
  assert.match(chips, /co-desk-chip is-ready">Approved</)
  // One verdict per row: once the PR machine has its own chip, GitHub's raw decision is not shown beside it.
  const contradicting = html.chips({ reviewDecision: 'CHANGES_REQUESTED' }, { label: 'Fixes pushed', tone: 'waiting' })
  assert.doesNotMatch(contradicting, /Changes requested/)
  assert.match(html.chips({ reviewDecision: 'CHANGES_REQUESTED' }, null), /co-desk-chip is-blocker">Changes requested</)
  assert.match(html.chips({ isDraft: true, reviewDecision: 'APPROVED' }, { label: 'Ready to merge', tone: 'owner' }), /co-desk-chip">Draft</)
})

test('rows keep their checkbox and Assign out of sight until wanted, and the header checkbox stays', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-row \.co-pr-select \{ opacity:0/)
  // Keyboard focus reveals them; a mouse user who closed a picker is not left with them showing.
  assert.match(css, /html\[data-input="keyboard"\] \.co-pr-row:has\(:focus-visible\) \.co-pr-select/)
  assert.match(css, /\.co-pr-row\.is-assigning \.co-pr-assign\.is-quiet \{ opacity:1/)
  assert.match(css, /\.co-pr-assign\.is-quiet \{ opacity:0/)
  assert.match(css, /@media \(hover:none\) \{ \.co-pr-row \.co-pr-select, \.co-pr-assign\.is-quiet \{ opacity:1/)
  assert.doesNotMatch(css, /\n\.co-pr-select \{ opacity:0/)
})

test('state chips sit beside the title, and the hover Assign is an icon so the row keeps its width', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-pr-headline \{ display:flex;[^}]*justify-content:space-between/)
  assert.match(css, /\.co-pr-assign\.is-quiet span \{ display:none; \}/)
  assert.match(css, /\.co-pr-assign\.is-quiet span \{ display:inline; \}/)
})

test('a row reads title, facts, labels, then pills, each on its own line, in list rows and desk rows', () => {
  const list = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  assert.match(list, /<div className="co-pr-meta">[\s\S]*?<\/div>\s*<div className="co-pr-labels"><PullLabels pr=\{pr\} \/><\/div>\s*<div className="co-row-pills">\s*<PullStateChips pr=\{pr\} machineChip=\{standing\.role === 'author' \? review\.chip : null\} \/>/)
  // Every desk row is one DeskRow: title, facts, labels, pills, in that order, all inside the button that opens the PR.
  const row = readFileSync(new URL('../ui/DeskRow.jsx', import.meta.url), 'utf8')
  assert.match(row, /<span className="co-desk-row-title">\{title\}<\/span>\s*<span className="co-desk-row-meta">\{facts\}<\/span>\s*\{labels\}\s*\{pills\.length \? <span className="co-row-pills">/)
  const desk = readFileSync(new URL('../ui/DeskViews.jsx', import.meta.url), 'utf8')
  assert.match(desk, /labels=\{<span className="co-pr-labels"><PullLabels pr=\{pr\} \/><\/span>\}\s*pills=\{pills\.map/)
  // The facts line holds no pill: the status lives on the pills line.
  const factsLine = desk.slice(desk.indexOf('facts={<>'), desk.indexOf('labels={<span'))
  assert.doesNotMatch(factsLine, /co-desk-chip|StatusPill/)
})

test('the attention bar does not sit inside a second border', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-decisions:has\(> \.co-attn:only-child\) \{ border:0; \}/)
})

test('the decisions box does not clip, so a menu can open past its bottom edge', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const box = css.match(/\n\.co-decisions \{[^}]*\}/)?.[0] || ''
  assert.ok(box && !/overflow/.test(box), 'The box around the prepared-PR bar clips its open-for-review menu')
})

test('a row only counts as assigning while the picker pane is actually open', () => {
  const list = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')
  // The pane's own close button leaves the assigning state set; the pane being open is what counts.
  assert.match(list, /assignAnchor === key && task\?\.activeId === 'task:assign' \? ' is-assigning'/)
})

test('the attention bar toggle has no frame and swaps its word with the chevron', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  const toggle = css.match(/\.co-attn-toggle \{[^}]*\}/)?.[0] || ''
  assert.ok(toggle && !/border|background/.test(toggle))
  assert.match(css, /\.co-attn-hide, \.co-attn\[open\] \.co-attn-show \{ display:none; \}/)
  assert.match(css, /\.co-attn\[open\] \.co-attn-toggle \.co-icon \{ transform:rotate\(180deg\)/)
})

test('attention rows and the show-more control stay inside the bar', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-attention-row \{ box-sizing:border-box;/)
  assert.match(css, /\.co-attn-more \{ box-sizing:border-box;/)
})

test('on a phone the four views are one segmented bar with every segment on screen, and the repository list is a button of its own', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderToStaticMarkup, React, DeskChips } = await (await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { DeskChips } from './ui/Desk.jsx'
    export { React, renderToStaticMarkup, DeskChips }
  `))
  const html = renderToStaticMarkup(React.createElement(DeskChips, { view: 'needs', counts: { questions: 1, requests: 2, merge: 3, fix: 1, mine: 17, reviewsRunning: 0 }, onView() {} }))
  assert.equal((html.match(/<button/g) || []).length, 5, 'four views plus the project link, no scrolling row of nine')
  assert.match(html, /aria-pressed="true" aria-label="Needs you, 7"><span>Needs you<\/span><b>7<\/b>/)
  assert.match(html, /aria-label="Review requests, 2"><span>Requests<\/span><b>2<\/b>/)
  assert.match(html, /aria-label="Agent runs"><span>Agent runs<\/span><\/button>/, 'a zero shows no number at all, not a stray 0 or dot')
  assert.doesNotMatch(html, /·/)
  assert.match(html, /co-desk-chips-projects[^>]*>.*?All repositories/)
  const withProjects = renderToStaticMarkup(React.createElement(DeskChips, { view: 'projects', counts: { mine: 1 }, projects: [{ key: 'a', name: 'Alpha' }, { key: 'b', name: 'Beta' }, { key: 'c', name: 'Gamma' }, { key: 'd', name: 'Delta' }], onView() {} }))
  assert.match(withProjects, /class="co-desk-chips-projects" aria-pressed="true"/, 'the button is lit while the repositories are shown')
  assert.equal((withProjects.match(/co-project-icon/g) || []).length, 3, 'three project icons, never more')
  assert.match(withProjects, /All repositories<\/span><b>4<\/b>/, 'it says how many repositories there are')
  assert.doesNotMatch(html, /To confirm|Merged this week|PR reviews|My work|Your edits/)
})

test('the phone keeps Sync and Settings labelled, a sticky review footer and decision bar, and an unsqueezed group header', () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const theme = read('theme.js'), work = read('workspace-theme.js'), app = read('index.jsx')
  assert.match(app, /<span className="co-label-short">\{refreshingAll \? 'Syncing…' : NAMES\.syncShort\}<\/span>/)
  assert.equal(NAMES.syncShort, 'Sync', 'the phone keeps the short word; the full name is Sync with GitHub')
  assert.match(theme, /\.co-toolbar \.co-label-short \{ display: inline; \}/)
  assert.doesNotMatch(work, /\.co-header \.co-settings > summary > span \{ display:none; \}/, 'Settings keeps its word on a phone')
  assert.match(work, /\.co-rw-foot \{ position:sticky; bottom:0;/)
  assert.match(work, /\.co-decision-bar \{ display:flex; position:sticky; bottom:0;/)
  assert.match(work, /\.co-envelope-head \.co-project-icon,\.co-envelope-head \.co-source-tag,\.co-envelope-head \.co-rail-count \{ flex:none; \}/)
  assert.match(work, /\.co-envelope-head strong \{ min-width:0;/)
})

// Needs you and Repositories are one layout: a filter line, then the same search field, then the list.
test('Needs you and Repositories share one filter line and one search field, in the same order', () => {
  const source = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
  assert.equal((source.match(/<SearchField /g) || []).length, 2, 'both screens use the one search component')
  assert.doesNotMatch(source, /type="search"/, 'no screen draws its own search field')
  const directory = source.slice(source.indexOf('<div className="co-directory">'))
  assert.ok(directory.indexOf('<FilterLine') > -1 && directory.indexOf('<FilterLine') < directory.indexOf('<SearchField'), 'Repositories: filters, then search')
  assert.ok(source.indexOf('<DeskCounts') < source.indexOf('<SearchField label="Find a PR'), 'Needs you: filters, then search')
})

// Every search in the app is one component, so none looks like a different control (the Assign window's field once was a bare browser input).
test('every search in the app is the one SearchField, with Clear while there is text', async t => {
  const { readdirSync } = await import('node:fs')
  const ui = new URL('../ui/', import.meta.url)
  const own = readdirSync(ui).filter(name => name.endsWith('.jsx') && name !== 'SearchField.jsx')
    .filter(name => /type=["']search["']/.test(readFileSync(new URL(name, ui), 'utf8')))
  assert.deepEqual(own, [], 'a screen draws its own search input')
  for (const [file, label] of [['PullRequests.jsx', 'Find a person'], ['PullRequests.jsx', 'Find a pull request'], ['PullFiles.jsx', 'Filter files by name']]) {
    assert.match(readFileSync(new URL(file, ui), 'utf8'), new RegExp(`<SearchField [^>]*label="${label}"`), `${label} uses SearchField`)
  }
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderToStaticMarkup, React, SearchField } = await (await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { SearchField } from './ui/SearchField.jsx'
    export { React, renderToStaticMarkup, SearchField }
  `))
  const empty = renderToStaticMarkup(React.createElement(SearchField, { label: 'Find a person', value: '', onChange() {} }))
  assert.match(empty, /placeholder="Find a person"[^>]*aria-label="Find a person"|aria-label="Find a person"[^>]*placeholder="Find a person"/)
  assert.doesNotMatch(empty, /co-search-clear/, 'no Clear on an empty field')
  const typed = renderToStaticMarkup(React.createElement(SearchField, { label: 'Find a person', value: 'ada', onChange() {} }))
  assert.match(typed, /co-search-clear" aria-label="Clear search"/)
  const off = renderToStaticMarkup(React.createElement(SearchField, { label: 'Find a person', value: 'ada', disabled: true, onChange() {} }))
  assert.doesNotMatch(off, /co-search-clear/, 'a disabled field cannot be cleared')
})
