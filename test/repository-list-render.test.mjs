// What a repository's screen shows of the list it holds: rows at once from a known list, titles with nothing that needs more
// than titles, an empty list known to be empty, and placeholders only for a list nothing is known of.
import assert from 'node:assert/strict'
import test from 'node:test'

import { fullPull } from './fake-lists.mjs'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { PullRequests } from './ui/PullRequests.jsx'
    import { RepositoryListsContext } from './ui/useRepositoryList.js'
    import { createRepositoryLists } from './repository-lists.js'
    import { AlwaysLoad } from './ui/AlwaysLoad.jsx'
    export const renderPin = props => renderToStaticMarkup(React.createElement(AlwaysLoad, props))
    export const makeLists = () => createRepositoryLists()
    export const render = (lists, props) => renderToStaticMarkup(React.createElement(RepositoryListsContext.Provider, { value: lists }, React.createElement(PullRequests, props)))
  `)
  return renderer
}

const project = { key: 'app:1', kind: 'app', name: 'Fixture', available: true, canonical_repo: 'o/r', base_sha: 'b'.repeat(40), reviewRequests: [] }
const props = { appId: 'app', token: 'token', project, conn: { state: 'connected', login: 'owner' }, refreshKey: 0, onOpenPage: () => {}, capabilities: {} }
const saved = (pulls, extra = {}) => ({ repo: 'o/r', syncedAt: '2026-11-12T07:00:00Z', openedAt: '', total: pulls.length, hasNextPage: false, endCursor: null, pulls, ...extra })
const titlesOf = pr => ({ ...fullPull('o/r', pr), titlesOnly: true, commits: undefined, labels: undefined, latestOpinionatedReviews: undefined, latestReviews: undefined, reviewThreads: undefined, assignees: undefined })

test('a repository with a last-known list shows its rows at once, with no placeholders, and says how old they are', async t => {
  const { makeLists, render } = await ui(t) || {}
  if (!render) return
  const lists = makeLists()
  lists.restore([saved([fullPull('o/r', 1, { title: 'Known change' }), fullPull('o/r', 2)])])
  const html = render(lists, props)
  assert.match(html, /Known change/)
  assert.equal((html.match(/class="co-pr-row/g) || []).length, 2)
  assert.doesNotMatch(html, /co-pr-skel|Loading pull requests/)
  assert.match(html, /<p class="co-pr-sync"><span class="co-sync-note"><span><time[^>]*>Last synced/)
  assert.doesNotMatch(html, /id="co-sync-note"/, 'the header names the one note by its id; the list\'s has none')
})

test('a repository nothing is known of shows placeholders and never an empty list', async t => {
  const { makeLists, render } = await ui(t) || {}
  if (!render) return
  const html = render(makeLists(), props)
  assert.match(html, /co-pr-skel/)
  assert.doesNotMatch(html, /No pull requests/)
})

test('a repository known to have no open PRs shows its empty list at once', async t => {
  const { makeLists, render } = await ui(t) || {}
  if (!render) return
  const lists = makeLists()
  lists.applyCounts(new Map([['o/r', 0]]))
  const html = render(lists, props)
  assert.match(html, /No pull requests/)
  assert.doesNotMatch(html, /co-pr-skel/)
})

test('a row that holds only its titles shows what it knows and offers nothing that needs more, and its filters do not guess', async t => {
  const { makeLists, render } = await ui(t) || {}
  if (!render) return
  const lists = makeLists()
  const list = lists.entry('o/r')
  lists.publish(list, [titlesOf(1), titlesOf(2)], lists.issue(list), { inventory: ['o/r#1', 'o/r#2'], data: { loading: false, updating: true, partial: true, total: 2 } })
  Object.assign(list, { listed: true, settled: true })
  const html = render(lists, props)
  assert.match(html, /Change 1/)
  assert.match(html, /Updating…/)
  assert.equal((html.match(/<input type="checkbox"[^>]*disabled=""[^>]*aria-label="Select o\/r #\d"/g) || []).length, 2, 'a row that holds only its titles cannot be ticked')
  assert.doesNotMatch(html, /co-agent-menu|Assign PR|Request review on PR|co-gh-checks|co-gh-label|Couldn’t read/)
  assert.doesNotMatch(html, /co-pr-filter-count/, 'counts of failing, assigned and unassigned wait for whole rows')
})

test('the same rows with their details offer their actions in the same place', async t => {
  const { makeLists, render } = await ui(t) || {}
  if (!render) return
  const lists = makeLists()
  lists.restore([saved([fullPull('o/r', 1)])])
  const html = render(lists, props)
  assert.match(html, /aria-label="Choose an action for PR 1"/)
  assert.doesNotMatch(html, /<input type="checkbox"[^>]*disabled=""[^>]*aria-label="Select/)
})

test('the Auto-sync button says in plain words what it does, and is pressed only for a repository that is pinned', async t => {
  const { renderPin } = await ui(t) || {}
  if (!renderPin) return
  const off = renderPin({ repo: 'o/r', pinned: false, onChange: () => {} })
  assert.match(off, /<span>Auto-sync<\/span>/)
  assert.match(off, /Keeps this repository’s pull requests up to date in the background\./)
  assert.match(off, /aria-pressed="false"/)
  assert.match(renderPin({ repo: 'o/r', pinned: true, onChange: () => {} }), /aria-pressed="true"/)
})
