// The PR page keeps old tabs, and Back loses your place. The snapshot of a PR page is kept per version of the PR including when GitHub last
// updated it; what the page covers stays mounted under it; the page is one entry of the app's own Back navigation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function ui(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { SourceMap } from './ui/SourceMap.jsx'
    export { detailKey } from './ui/useRepositoryList.js'
    export const map = props => renderToStaticMarkup(React.createElement(SourceMap, props))
  `)
  return renderer
}

const HEAD = 'a'.repeat(40)
const pr = (extra = {}) => ({ number: 7, repository: { nameWithOwner: 'Acme/Widgets' }, headRefOid: HEAD, baseRefOid: 'b'.repeat(40), baseRefName: 'main', updatedAt: '2026-11-02T08:00:00Z', ...extra })

test('a PR that GitHub updated since is a new snapshot, so its page reads GitHub again; the same version keeps its snapshot', async t => {
  const api = await ui(t)
  if (!api) return
  const { detailKey } = api
  assert.notEqual(detailKey(pr({ updatedAt: '2026-11-02T09:00:00Z' })), detailKey(pr()), 'it was equal: the key ignored updatedAt')
  assert.equal(detailKey(pr()), detailKey(pr({ title: 'renamed' })), 'a field the page does not read from GitHub changes nothing')
  assert.notEqual(detailKey(pr({ headRefOid: 'c'.repeat(40) })), detailKey(pr()))
  assert.equal(detailKey(pr({ repository: { nameWithOwner: 'acme/widgets' } })), detailKey(pr()), 'letter case is not another PR')
})

const project = { key: 'app:1', kind: 'app', name: 'Fixture', available: true, canonical_repo: 'owner/repo', base_sha: 'b'.repeat(40), reviewRequests: [], contributions: [] }
const desk = pull => ({ view: 'projects', onView: () => {}, counts: {}, login: 'owner', records: [], lastLooked: '', decisionsFor: () => [], onOpenPull() {}, pull, onClosePull() {}, renderPull: () => 'THE-PR-PAGE' })

test('with a PR page open the project pane stays in the page, hidden, and Back shows it as it was', async t => {
  const api = await ui(t)
  if (!api) return
  const props = { projects: [project], conn: { state: 'connected' }, attention: {} }
  const closed = api.map({ ...props, desk: desk(null) })
  assert.match(closed, /class="co-desk-under" style="display:contents"/, 'with no page open the pane lays out as it did')
  assert.doesNotMatch(closed, /co-pull-page|THE-PR-PAGE/)
  const open = api.map({ ...props, desk: desk({ key: 'app:1', repo: 'owner/repo', number: 7 }) })
  assert.match(open, /class="co-pull-page"[\s\S]*THE-PR-PAGE/)
  assert.match(open, /class="co-desk-under" style="display:none"/, 'hidden, not unmounted: its tab, filter, search and selection live on')
  assert.match(open, /co-project-index/, 'the list under the page is still in the page')
})

test('the PR page is one entry of the app\'s own Back navigation, and a page of another version never inherits the tabs of this one', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /window\.mobius\.nav\.open\('contribute-pull', \{/)
  assert.match(app, /onBack: \(\) => \{ if \(pullNav\.current !== handle\) return; pullNav\.current = null; pullFocusRef\.current = null; setPullPage\(null\) \}/)
  assert.match(app, /onForward: \(\) => \{ pullNav\.current = handle; setPullPage\(lastPullPage\.current\) \}/)
  assert.match(app, /if \(!pullOpen\) \{\s*const finished = pullNav\.current/, 'closing the page closes its entry')
  const detail = readFileSync(new URL('../ui/PullRequestDetail.jsx', import.meta.url), 'utf8')
  assert.match(detail, /const bornWith = useRef\(cacheStore\)/)
  assert.match(detail, /if \(!cacheStore \|\| cacheStore !== bornWith\.current\) return/)
})
