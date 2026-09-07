import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collaborationRequest, matchingPulls, prKey, reviewForPull, reviewRunRequest,
} from '../collaboration.js'
import { loadCycleState, saveCycleState } from '../storage.js'
import { frontendModules, renderModule } from './render-harness.mjs'

// Real React SSR through the app's bundler. These tests do not claim browser
// click coverage, focus/scroll behavior, or component mount lifetime: the
// installed frontend supplies no jsdom or other DOM test environment.
const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const project = {
  key: 'app:fixture', kind: 'app', name: 'Fixture project', available: true,
  canonical_repo: 'owner/project', viewerPermission: 'WRITE',
  head_sha: HEAD, base_sha: BASE, localFiles: 1, workingFiles: 0,
}
const pull = (number = 7, extra = {}) => ({
  number, title: `Contribution ${number}`, headRefOid: HEAD,
  baseRefName: 'main', baseRefOid: BASE, isDraft: false,
  url: `https://github.com/owner/project/pull/${number}`,
  repository: { nameWithOwner: 'owner/project', viewerPermission: 'WRITE' },
  author: { login: 'owner' }, assignees: { nodes: [] }, ...extra,
})
const reviewItem = (extra = {}) => ({
  repo: 'owner/project', number: 7, head_sha: HEAD,
  base_ref: 'main', base_sha: BASE, state: 'all_clear', ...extra,
})
const work = (id, kind, status, record = {}) => ({
  id, kind, label: id, detail: 'owner/project',
  record: { id, type: 'pr', repo: 'owner/project', number: 7, title: id, status, ...record },
})
const run = (extra = {}) => ({ decisions: [], working: [], recent: [], archive: [], ...extra })

let renderer
async function rendered(t) {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
    return null
  }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { TaskContext, TaskPane } from './ui/TaskPane.jsx'
    import { SourceMap } from './ui/SourceMap.jsx'
    import { ProjectControls } from './ui/ProjectControls.jsx'
    import { PullRequests, ReviewConfirmation } from './ui/PullRequests.jsx'
    import { ContributionRun } from './ui/Feed.jsx'

    const components = { SourceMap, ProjectControls, PullRequests, ReviewConfirmation, ContributionRun, TaskPane }
    export function render(name, props, task) {
      const content = React.createElement(components[name], props)
      return renderToStaticMarkup(task === undefined ? content :
        React.createElement(TaskContext.Provider, { value: task }, content))
    }
    export function renderPublicRun(props, pullProps, task) {
      return render('ContributionRun', {
        ...props, renderPublicWork: () => React.createElement(PullRequests, pullProps),
      }, task)
    }
  `)
  return renderer
}

test('review verdict belongs to the exact repository, PR, head, base commit and base branch', () => {
  const item = reviewItem({ repo: 'OWNER/PROJECT' })
  const reviewed = { id: 'exact-run', items: [item] }
  assert.deepEqual(reviewForPull([reviewed], pull()), { run: reviewed, item })
  for (const [field, value] of [
    ['repo', 'owner/another-project'], ['number', 8], ['head_sha', 'c'.repeat(40)],
    ['base_sha', 'c'.repeat(40)], ['base_ref', 'release'],
  ]) {
    assert.equal(reviewForPull([{ items: [reviewItem({ [field]: value })] }], pull()), null, field)
  }
  assert.equal(reviewForPull([], pull()), null)
})

test('a newer run for a changed target cannot replace the exact saved verdict', () => {
  const exact = { id: 'exact', items: [reviewItem()] }
  const changed = { id: 'changed-target', items: [reviewItem({ base_sha: 'c'.repeat(40), state: 'merged' })] }
  assert.equal(reviewForPull([changed, exact], pull()).run, exact)
  assert.equal(reviewForPull([exact], pull(7, { baseRefOid: 'c'.repeat(40) })), null)
})

test('missing target identity never counts as an exact reviewed base', () => {
  for (const [reviewField, pullField] of [['base_sha', 'baseRefOid'], ['base_ref', 'baseRefName']]) {
    for (const missing of [undefined, null, '']) {
      assert.equal(reviewForPull([{ items: [reviewItem({ [reviewField]: missing })] }],
        pull(7, { [pullField]: missing })), null, `${reviewField}: ${String(missing)}`)
    }
  }
})

test('own and assigned PR selection constructs a review without assigning anyone or sending a request', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ run: { id: 'fixture-review' } }))
  })
  const pulls = [pull(), pull(8, { assignees: { nodes: [{ login: 'teammate' }] } })]
  const before = structuredClone(pulls)
  const selected = matchingPulls(pulls, 'authored', 'OWNER')
  assert.deepEqual(selected.map(prKey), ['owner/project#7', 'owner/project#8'])
  const request = reviewRunRequest({ request_id: 'explicit-confirmation', mode: 'review', pulls: selected })
  assert.deepEqual(calls, [], 'selection and request construction are not mutations')
  assert.deepEqual(pulls, before, 'selection must preserve existing assignment')
  assert.ok(request.items.every(item => item.head_sha === HEAD && item.base_sha === BASE && item.base_ref === 'main'))
  assert.ok(request.items.every(item => !('assignee' in item)))

  await collaborationRequest('fixture-only', 'fixture-app', 'review-runs', request)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/github/contributions/fixture-app/review-runs')
  assert.equal(calls[0].options.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].options.body), request)
  assert.doesNotMatch(calls[0].url, /assign|merge/)
})

test('SSR review confirmation offers merging for own PRs only when the entire selection is eligible', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const renderChoice = (pulls, mode = 'review', busy = false) => ui.render('ReviewConfirmation', {
    choice: { request_id: 'fixture-choice', mode, pulls }, busy, onModeChange: () => {},
  })
  for (const permission of ['WRITE', 'MAINTAIN', 'ADMIN']) {
    const html = renderChoice([pull(7, { repository: { nameWithOwner: project.canonical_repo, viewerPermission: permission } })])
    assert.match(html, /Merge when safe/, permission)
    assert.match(html, /Start review/)
    assert.doesNotMatch(html, /type="checkbox"[^>]*checked/)
  }
  for (const permission of ['READ', 'TRIAGE', null]) {
    const html = renderChoice([pull(), pull(8, { repository: { nameWithOwner: project.canonical_repo, viewerPermission: permission } })])
    assert.doesNotMatch(html, /Merge when safe/, String(permission))
    assert.match(html, /Start review/)
  }
  assert.doesNotMatch(renderChoice([pull(7, { isDraft: true })]), /Merge when safe/)
  const merge = renderChoice([pull()], 'review_merge', true)
  assert.match(merge, /type="checkbox"[^>]*checked/)
  assert.match(merge, /version aaaaaaa → main \(bbbbbbb\)/)
  assert.match(merge, /exact versions/)
  assert.match(merge, /No branch edits or public review comments/)
  assert.match(merge, /disabled=""/)
})

test('SSR local preparation remains inventory when another task owns the outlet', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const props = { project, run: { privateAction: { title: 'Prepare', draft: 'Private preparation' } }, cycle: { phase: 'idle' } }
  const html = ui.render('ProjectControls', props, { activeId: 'task:review', host: null })
  assert.match(html, /Your local work/)
  assert.match(html, /Current code/)
  assert.doesNotMatch(html, /Prepare your changes|Check &amp; update safely/)
  assert.equal(ui.render('TaskPane', { id: 'task:prepare', children: 'Task body' }, { activeId: 'task:review', host: null }), '')
  assert.equal(ui.render('TaskPane', { id: 'task:prepare', children: 'Task body' }), 'Task body')
})

test('SSR preparation checks its own durable conversation before offering another start', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const privateAction = { title: 'Prepare', draft: 'Private preparation' }
  const html = ui.render('ProjectControls', { project, run: { privateAction }, mergeRun: { privateAction } })
  assert.match(html, /role="status"/)
  assert.match(html, /Prepare your changes/)
  assert.match(html, /Checking existing work/ )
  assert.match(html, /disabled=""/) // no agent action until the saved project conversation is checked
})

test('durable project conversation shortcuts stay isolated across projects and the legacy global cycle', async t => {
  const previousWindow = globalThis.window
  t.after(() => { globalThis.window = previousWindow })
  const values = new Map()
  const calls = []
  globalThis.window = { mobius: { storage: {
    get: async key => { calls.push(['get', key]); return values.get(key) },
    set: async (key, value) => { calls.push(['set', key]); values.set(key, structuredClone(value)) },
  } } }
  assert.equal(await saveCycleState({ chat_id: 'legacy-chat', title: 'Legacy global work' }), true)
  assert.equal(await loadCycleState(project.key), null, 'global work is not another project’s conversation')
  await Promise.all([
    saveCycleState({ chat_id: 'first-chat', title: 'Prepare first project' }, project.key),
    saveCycleState({ chat_id: 'second-chat', title: 'Update other project' }, 'external:owner/other'),
  ])
  assert.equal((await loadCycleState(project.key)).chat_id, 'first-chat')
  assert.equal((await loadCycleState('external:owner/other')).chat_id, 'second-chat')
  assert.equal((await loadCycleState()).chat_id, 'legacy-chat')
  assert.equal(await loadCycleState('app:never-started'), null)
  assert.equal(new Set(calls.filter(([operation]) => operation === 'set').map(([, key]) => key)).size, 3)
})

test('SSR selecting a focused contribution retains the project inventory and history', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const privateWork = work('Private work', 'private_review', 'prepared')
  const current = run({
    decisions: [privateWork], working: [work('Published work', 'public', 'open')],
    recent: [work('Accepted work', 'done', 'merged')], archive: [work('Historical work', 'archived', 'abandoned')],
  })
  for (const selectedId of ['', privateWork.id, 'task:pulls', 'task:review']) {
    const html = ui.render('ContributionRun', { run: current, selectedId }, { activeId: selectedId, host: null })
    for (const label of ['Private work', 'Published work', 'Accepted work', 'Historical work']) {
      assert.match(html, new RegExp(label), `${label} remains listed for ${selectedId}`)
    }
    assert.doesNotMatch(html, /This contribution moved/)
  }
})

test('SSR public review inventory replaces duplicate public rows but retains private and accepted work', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const current = run({
    decisions: [work('Private work', 'private_review', 'prepared')],
    working: [work('Duplicate open row', 'public', 'open'), work('Duplicate draft row', 'public', 'draft', { number: 8 }),
      work('Unfetched PR', 'public', 'open', { number: 9 }), work('Different repository', 'public', 'open', { repo: 'owner/other' }),
      work('Still preparing', 'preparing', 'prepared')],
    recent: [work('Accepted work', 'done', 'merged')],
  })
  const html = ui.renderPublicRun({ run: current, githubState: 'connected', selectedId: 'task:review' }, {
    appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected', login: 'owner' },
  }, { activeId: 'task:review', host: null, publicKeys: new Set(['owner/project#7', 'owner/project#8']) })
  assert.match(html, /aria-label="Pull requests"/)
  assert.match(html, /My PRs/)
  assert.match(html, /Assigned to me/)
  for (const label of ['Private work', 'Still preparing', 'Accepted work', 'Unfetched PR', 'Different repository']) assert.match(html, new RegExp(label))
  assert.doesNotMatch(html, /Duplicate open row|Duplicate draft row|This contribution moved/)
})

test('SSR unavailable GitHub cannot hide saved public contributions behind an empty review inventory', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const current = run({ working: [work('Saved public contribution', 'public', 'open')] })
  for (const state of ['disconnected', 'unknown', 'unsupported']) {
    const html = ui.renderPublicRun({ run: current, githubState: state }, {
      appId: 'fixture-app', token: 'fixture-only', project, conn: { state },
    })
    assert.match(html, /Saved public contribution/, state)
  }
})

test('SSR a partially fetched public stack keeps its saved group until every member has a review row', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const first = work('First layer', 'public', 'open').record
  const second = work('Unfetched layer', 'public', 'open', { number: 8 }).record
  const stack = { id: 'stack:fixture', kind: 'public', label: 'Saved related contributions', record: first,
    unit: { type: 'stack', id: 'fixture', records: [first, second] } }
  const props = { run: run({ working: [stack] }), githubState: 'connected' }
  const pullProps = { appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected' } }
  const partial = ui.renderPublicRun(props, pullProps, { host: null, publicKeys: new Set(['owner/project#7']) })
  assert.match(partial, /Saved related contributions/)
  const complete = ui.renderPublicRun(props, pullProps, { host: null, publicKeys: new Set(['owner/project#7', 'owner/project#8']) })
  assert.doesNotMatch(complete, /Saved related contributions/)
  assert.match(complete, /aria-label="Pull requests"/)
})

test('SSR opening project and review surfaces never performs transport or invokes mutation callbacks', async t => {
  const ui = await rendered(t)
  if (!ui) return
  const calls = []
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args)
    throw new Error('Network is forbidden in workspace SSR tests')
  })
  const mutate = () => assert.fail('Rendering is not approval to mutate')
  const choice = { request_id: 'fixture-choice', mode: 'review_merge', pulls: [pull()] }
  ui.render('ReviewConfirmation', { choice, onConfirm: mutate, onCancel: mutate, onModeChange: mutate })
  ui.render('ProjectControls', { project, run: { privateAction: { draft: 'Private work' } }, onStart: mutate })
  ui.render('PullRequests', { appId: 'fixture-app', token: 'fixture-only', project, conn: { state: 'connected' }, onChanged: mutate })
  const overview = ui.render('SourceMap', { projects: [project], conn: { state: 'connected' }, onRetry: mutate })
  assert.match(overview, /Open Fixture project/)
  assert.deepEqual(calls, [])
})
