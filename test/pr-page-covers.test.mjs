// What a PR page covers (the project pane) stays mounted under it, only hidden, so that Back returns to it as it was. It must not keep working while
// nobody sees it: the project's status read every five seconds and a review's clock rest, and a docked window opened from it does not stay over the page.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { frontendModules, renderModule } from './render-harness.mjs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

let renderer
const ui = async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { SourceMap } from './ui/SourceMap.jsx'
    import { useCovered } from './ui/useReviewList.js'
    const Probe = () => React.createElement('span', { id: 'probe' }, useCovered() ? 'covered' : 'shown')
    export const view = pull => renderToStaticMarkup(React.createElement(SourceMap, {
      projects: [], conn: { state: 'connected' }, addProject: () => React.createElement(Probe),
      desk: { view: 'projects', onView() {}, counts: {}, login: '', records: [], lastLooked: '', decisionsFor: () => [], onOpenPull() {}, pull, onClosePull() {}, renderPull: () => React.createElement('p', { id: 'page' }, 'the PR page') },
    }))
  `)
  return renderer
}

test('what the PR page covers is told so, and only while the page is open; the page itself is never covered', async t => {
  const api = await ui(t)
  if (!api) return
  const open = api.view({ key: 'k', repo: 'o/r', number: 7 })
  assert.match(open, /<span id="probe">covered<\/span>/)
  assert.match(open, /class="co-desk-under" style="display:none"/)
  assert.ok(open.indexOf('id="page"') < open.indexOf('class="co-desk-under"'), 'the page sits outside the covered part')
  const closed = api.view(null)
  assert.match(closed, /<span id="probe">shown<\/span>/)
  assert.doesNotMatch(closed, /id="page"/)
})

test('a project’s status read and a review’s clock rest while covered, and start again when the page closes', () => {
  const cycle = read('ui/useProjectCycle.js')
  assert.match(cycle, /export function useProjectCycle\(projectKey, deliver, covered = false\)/)
  assert.match(cycle, /hub\.every\(\(\) => refresh\(cycle\.chatId\), cycle\.phase === 'complete' \|\| covered \? null : 5000\)/)
  assert.match(read('ui/ProjectControls.jsx'), /useProjectCycle\(projectCycleIdentity\(project\), onStart, useCovered\(\)\)/, 'the project\u2019s screen says whether it is covered')
  assert.match(cycle, /if \(wasCovered\.current && !covered\) void refresh\(cycle\.chatId\)/, 'the status is read once when the page closes')
  const tab = read('ui/ReviewTab.jsx')
  assert.match(tab, /if \(!running \|\| covered\) return undefined/)
  assert.match(tab, /\}, \[running, covered\]\)/)
})

test('opening a PR page closes the window docked over the project, which would otherwise stay over the page', () => {
  assert.match(read('ui/SourceMap.jsx'), /useEffect\(\(\) => \{ if \(pageOpen && selectedWorkId\) closeWork\(\) \}, \[pageOpen\]\)/)
})
