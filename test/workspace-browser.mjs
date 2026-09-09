// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/workspace-browser.mjs
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { frontendModules } from './render-harness.mjs'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const ENTRY = '\0workspace-browser-fixture'
const fixture = String.raw`
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SourceMap } from './ui/SourceMap.jsx'
import { ReviewSelection } from './ui/ReviewSelection.jsx'
import { RepositoryPicker } from './ui/RepositoryPicker.jsx'
import { ProjectControls } from './ui/ProjectControls.jsx'
import { PullRequests } from './ui/PullRequests.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { organizePrivateWorkAction } from './review.js'
import { CSS } from './theme.js'

const HEAD = 'a'.repeat(40), SECOND_HEAD = 'c'.repeat(40), BASE = 'b'.repeat(40)
const projects = [
  { key: 'app:fixture', kind: 'app', name: 'Fixture project', available: true,
    canonical_repo: 'owner/project', viewerPermission: 'WRITE', head_sha: HEAD,
    base_sha: BASE, localFiles: 1, workingFiles: 0 },
  { key: 'app:other', kind: 'app', name: 'Other project', available: true,
    canonical_repo: 'owner/other', viewerPermission: 'WRITE', head_sha: HEAD,
    base_sha: BASE, localFiles: 1, workingFiles: 0 },
]
const pull = (number, extra = {}) => ({
  number, title: 'Contribution ' + number, headRefOid: HEAD, baseRefOid: BASE,
  baseRefName: 'main', isDraft: false, url: 'https://github.com/owner/project/pull/' + number,
  repository: { nameWithOwner: 'owner/project', viewerPermission: 'WRITE' },
  changedFiles: 1, additions: 1, deletions: 0, createdAt: '2026-09-07T12:00:00Z', updatedAt: '2026-09-07T13:00:00Z',
  author: { login: 'owner' }, assignees: { nodes: [] }, ...extra,
})
const prepared = {
  id: 'fixture-prepared', type: 'pr', status: 'prepared', repo: 'owner/project',
  title: 'Reviewed local change', summary: 'Reviewed local change',
  plan: { action: 'pr', repo: 'owner/project', title: 'Reviewed local change',
    head_sha: HEAD, branch: 'fix/fixture' },
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD },
}
const calls = { requests: [], starts: [], publications: [], status: [], forbidden: [], opened: [] }
const values = new Map(), navigation = [], reviewRuns = []
const pulls = [pull(7), pull(8, { headRefOid: SECOND_HEAD, assignees: { nodes: [{ login: 'teammate' }] } })]
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const mutationRequests = () => calls.requests.filter(call => call.method !== 'GET' && call.url !== '/api/github/graphql')
function forbidden(kind) {
  return (...args) => { calls.forbidden.push({ kind, args: args.map(String) }); throw new Error('Forbidden fixture transport: ' + kind) }
}
window.fetch = async (url, options = {}) => {
  const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }
  calls.requests.push(call)
  if (call.url === '/api/github/graphql' && call.method === 'POST') {
    if (/mutation\b/i.test(call.body.query)) return forbidden('GraphQL mutation')(call)
    if (call.body.query.includes('ContributeReviewSelection')) return response({data:{p0:{nameWithOwner:'owner/project',viewerPermission:window.fixturePermission || 'WRITE',pullRequest:{...pulls[0],state:'OPEN'}}}})
    if (call.body.query.includes('ContributeRepository')) return response({data:{repository:{nameWithOwner:'team/community',viewerPermission:'WRITE'}}})
    let found = call.body.query.includes('repo:owner/other') ? [] : pulls
    const laterPage = call.body.query.includes('after:"fixture-page-2"')
    if (window.fixturePaging) found = laterPage ? found.slice(1) : found.slice(0,1)
    if (window.fixtureChangedHead) found = found.map(pr => pr.number===8 ? {...pr,headRefOid:'e'.repeat(40)} : pr)
    return response({ data: { search: { nodes: found, issueCount: pulls.length,
      pageInfo: { hasNextPage: Boolean(window.fixturePaging && !laterPage), endCursor: window.fixturePaging && !laterPage ? 'fixture-page-2' : null } } } })
  }
  if (call.url === '/api/github/contributions/fixture-app/review-runs') {
    if (call.method === 'GET') return response({ runs: reviewRuns })
    if (call.method !== 'POST') return forbidden('unexpected review method')(call.method)
    if (window.failReview) return new Response(JSON.stringify({detail:'Fixture review error'}), {status:503})
    const run = { id: 'review-' + (reviewRuns.length + 1), chat_id: 'review-chat-fixture',
      request_id: call.body.request_id, mode: call.body.mode, state: 'reviewing', items: call.body.items.map(item => ({ ...item, state: 'reviewing' })) }
    reviewRuns.unshift(run)
    return response({ run })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/assignees?') && call.method === 'GET') {
    return response({ assignees: [{ login: 'owner' }, { login: 'teammate' }], can_assign: true })
  }
  if (call.url === '/api/github/contributions/fixture-app/assign-review' && call.method === 'POST') {
    if (window.failAssignment === call.body.number) return new Response(JSON.stringify({detail:'Fixture assignment error'}), {status:503})
    const selected = pulls.find(pr => pr.number === call.body.number)
    selected.assignees.nodes.push({ login: call.body.assignee })
    return response({ ok: true })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/source-chats?') && call.method === 'GET') return response({ chats: [] })
  if (call.url.startsWith('/api/github/api/repos/owner/project/') && call.method === 'GET') {
    const number = Number(call.url.match(/(?:pulls|issues)\/(\d+)/)?.[1]); const pr=pulls.find(item=>item.number===number)
    if (call.url.includes('/files?')) return response([{filename:'change.js',additions:1,deletions:0,status:'modified',patch:'@@ -1 +1 @@\n-old\n+safe change'}])
    if (call.url.includes('/comments?')) return response([{id:1,body:'Please check this edge case',user:{login:'reviewer'},created_at:'2026-09-07T14:00:00Z'}])
    if (call.url.includes('/reviews?')) return response([])
    return response({body:'Fixture PR description '+number,head:{sha:pr.headRefOid},base:{sha:pr.baseRefOid,ref:pr.baseRefName}})
  }
  return forbidden('fetch')(call.url)
}
window.XMLHttpRequest = class { constructor() { forbidden('XMLHttpRequest')() } }
window.WebSocket = class { constructor() { forbidden('WebSocket')() } }
window.EventSource = class { constructor() { forbidden('EventSource')() } }
navigator.sendBeacon = forbidden('sendBeacon')
window.open = forbidden('window.open')
window.addEventListener('error', event => calls.forbidden.push({ kind: 'runtime error', message: event.message }))
window.addEventListener('unhandledrejection', event => calls.forbidden.push({ kind: 'unhandled rejection', message: String(event.reason) }))
window.mobius = {
  online: true,
  storage: {
    get: async key => structuredClone(values.get(key) ?? null),
    set: async (key, value) => { values.set(key, structuredClone(value)) },
    remove: async key => { values.delete(key) },
    subscribe: () => () => {},
    getWithVersion: async key => ({value:structuredClone(values.get(key) ?? null), version:values.has(key) ? 'fixture-version' : null}),
    durableWrite: async (key, value) => values.set(key,structuredClone(value)),
  },
  nav: {
    open(name, callbacks) {
      const handle = { name, callbacks, outcome: Promise.resolve({ status: 'owned' }),
        close() { const index = navigation.indexOf(handle); if (index >= 0) navigation.splice(index, 1) } }
      navigation.push(handle)
      return handle
    },
    back() { const handle = navigation.pop(); if (!handle) throw new Error('No owned navigation to go back'); handle.callbacks.onBack() },
  },
  chat: {
    start: async action => { calls.starts.push(structuredClone(action)); return { chatId: 'prepare-' + calls.starts.length } },
    status: async id => { calls.status.push(id); return { running: true } },
    stop: forbidden('unexpected chat stop'),
    open: id => calls.opened.push(id),
  },
}

function Fixture() {
  const [records, setRecords] = useState([prepared])
  const [selectionId, setSelectionId] = useState(null)
  const [allProjects, setAllProjects] = useState(projects)
  window.openSelectionFixture = setSelectionId
  function repositoryAdded(repo) { setAllProjects(old => [...old, {key:'external:' + repo.nameWithOwner,kind:'external',name:repo.nameWithOwner,canonical_repo:repo.nameWithOwner,contributions:[]}]) }

  function runFor(project) {
    const items = records.filter(record => record.repo === project.canonical_repo).map(record => ({
      id: (record.status === 'prepared' ? 'publish:' : 'public:') + record.id,
      kind: record.status === 'prepared' ? 'publish' : 'public', record,
      label: record.summary, detail: record.repo,
    }))
    return { revision: records.map(record => record.status).join('|'),
      decisions: items.filter(item => item.kind === 'publish'),
      working: items.filter(item => item.kind === 'public'), recent: [], archive: [],
      privateAction: organizePrivateWorkAction([], { byId: {} }, [project]) }
  }
  async function send(record) {
    calls.publications.push(structuredClone(record))
    const shared = { ...record, status: 'open', number: 9, url: 'https://github.com/owner/project/pull/9' }
    pulls.push(pull(9, { title: record.title }))
    setRecords(old => old.map(item => item.id === record.id ? shared : item))
    return { ok: true, record: shared }
  }
  async function start(action) { return { ok: true, ...await window.mobius.chat.start(action) } }
  return <div className="co-root"><style>{CSS}</style><main className="co-page is-sources">
    {selectionId ? <ReviewSelection selectionId={selectionId} token="fixture-only" appId="fixture-app" onClose={() => setSelectionId(null)} /> : <SourceMap projects={allProjects} snapshot={{ generated_at: 'fixture' }} conn={{ state: 'connected', login: 'owner' }}
      onRetry={forbidden('unexpected source refresh')}
      repositoryPicker={<RepositoryPicker token="fixture-only" connected onAdded={repositoryAdded} />}
      renderControls={project => project ? <ProjectControls appId="fixture-app" token="fixture-only" project={project}
        run={runFor(project)} mergeRun={runFor(project)} onStart={start} /> : null}
      renderActivity={(project, navigation) => project ? <ContributionRun run={runFor(project)}
        githubState="connected" publicationPreference="github" reviewStatus={{ byId: {} }}
        selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack} onSend={send}
        renderPublicWork={() => <PullRequests appId="fixture-app" token="fixture-only" project={project}
          conn={{ state: 'connected', login: 'owner' }} records={records.filter(record => record.repo === project.canonical_repo)} />}
      /> : null} />}
  </main></div>
}
createRoot(document.getElementById('root')).render(<Fixture />)

const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const text = node => node?.textContent?.replace(/\s+/g, ' ').trim() || ''
const query = selector => document.querySelector(selector)
const button = (name, root = document) => [...root.querySelectorAll('button')].find(node => text(node) === name)
const batchAction = () => [...document.querySelectorAll('.co-public-work .co-work-progress-row')].find(node => text(node).includes('Review or assign'))
const ensure = (condition, message) => { if (!condition) throw new Error(message) }
// CDP delivers the real browser key default; dispatchEvent would not toggle a
// checkbox natively and must not be used as keyboard-selection evidence.
const nativeSpace = () => new Promise((resolve, reject) => {
  window.finishNativeKey = error => error ? reject(new Error(error)) : resolve()
  window.workspaceNativeKey(JSON.stringify({ key:' ', code:'Space', keyCode:32 }))
})
const nativeEscape = () => new Promise((resolve, reject) => {
  window.finishNativeKey = error => error ? reject(new Error(error)) : resolve()
  window.workspaceNativeKey(JSON.stringify({ key:'Escape', code:'Escape', keyCode:27 }))
})
async function until(predicate, message) {
  const deadline = performance.now() + 5000
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message + '\nDOM: ' + text(query('main')).slice(0, 3000))
    await frame()
  }
  await frame()
}
async function click(node, message = 'Expected enabled visible control') {
  ensure(node && !node.disabled && node.getClientRects().length, message)
  node.click()
  await frame(); await frame()
}
async function fill(node, value) {
  ensure(node && node.getClientRects().length, 'Expected visible input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value)
  node.dispatchEvent(new Event('input',{bubbles:true}))
  await frame(); await frame()
}
async function inventory() {
  const close=query('.co-inline-close')
  if (close) await click(close)
}
async function chooseProject(name) {
  await inventory()
  const switcher = query('select[aria-label="Switch project"]')
  if (switcher?.getClientRects().length) {
    switcher.value = [...switcher.options].find(option => option.textContent === name).value
    switcher.dispatchEvent(new Event('change', { bubbles:true }))
    await frame(); await frame(); return
  }
  await click(button('All projects'))
  await until(() => query('.co-source-row'), 'Project list did not return')
  await click([...document.querySelectorAll('.co-source-row')].find(node => text(node.querySelector('strong')) === name))
}
window.runWorkspaceChecks = async () => {
  const checks = []
  async function check(name, run) { await run(); checks.push({ name, status: 'pass' }) }
  try {
    await until(() => query('.co-source-row'), 'Project list did not render')
    await check('project directory labels filters instead of pretending they are screens', async () => {
      ensure(query('.co-directory-filter select') && !query('.co-lens-nav'), 'Filters still look like views')
      await click(query('.co-source-row'))
      await until(() => document.querySelectorAll('.co-pr-row').length === 2 && !button('Prepare changes')?.disabled, 'Project did not settle')
      ensure(query('.co-workspace-inventory') && !query('.co-task-dock'), 'Opening a project displayed task work')
      ensure(!query('.co-task-content') && calls.starts.length === 0 && mutationRequests().length === 0, 'Opening project started work or opened an action')
    })
    const originalInventory = query('.co-workspace-inventory'), originalList = query('.co-pr-list'), originalRow = query('.co-pr-row')
    const inventoryNavigationDepth = navigation.length
    await check('PR filters are pressed buttons and change totals are an opt-in display choice', async () => {
      const filters=query('.co-pr-filters'), filterButtons=[...filters.querySelectorAll('button')]
      ensure(!query('.co-public-work select[aria-label="Filter pull requests"]'),'PR filters regressed to a native select')
      ensure(filterButtons.map(node => text(node)).join('|')==='All|Unassigned|Assigned to me|My PRs','PR filter choices drifted')
      ensure(button('All',filters).getAttribute('aria-pressed')==='true' && filterButtons.filter(node => node.getAttribute('aria-pressed')==='true').length===1,'Default filter is not exposed as one pressed button')
      ensure([...document.querySelectorAll('.co-pr-row .co-pr-meta')].every(node => !text(node).includes('files ·')),'Change totals were visible by default')
      await click(query('.co-display > summary'))
      const totals=query('.co-display input[type="checkbox"]')
      ensure(totals && !totals.checked,'Change totals did not default off')
      await click(totals)
      ensure([...document.querySelectorAll('.co-pr-row .co-pr-meta')].every(node => text(node).includes('1 files · +1 −0')),'Display choice did not reveal change totals')
      await click(totals)
      await click(query('.co-display > summary'))
      await click(button('My PRs',filters))
      ensure(button('My PRs',filters).getAttribute('aria-pressed')==='true' && button('All',filters).getAttribute('aria-pressed')==='false','Pressed filter state did not follow the choice')
      ensure(document.querySelectorAll('.co-pr-row').length===2,'Authored filter hid matching fixture PRs')
      await click(button('All',filters))
      ensure(query('.co-workspace-inventory')===originalInventory && mutationRequests().length===0,'Display-only controls replaced inventory or mutated GitHub')
    })
    const firstCheckbox = query('input[aria-label="Select owner/project #7"]')
    let secondCheckbox = query('input[aria-label="Select owner/project #8"]')
    function selectionStaysInInventory(focused) {
      ensure(navigation.length === inventoryNavigationDepth, 'Checkbox selection changed navigation')
      ensure(firstCheckbox.getClientRects().length && secondCheckbox.getClientRects().length, 'Batch selection hid checkboxes')
      ensure(document.activeElement === focused, 'Selection stole keyboard focus')
      ensure(query('.co-workspace-inventory') === originalInventory && query('.co-pr-row') === originalRow, 'Selection remounted inventory')
      ensure(mutationRequests().length === 0, 'Selection mutated GitHub or started review')
    }
    await check('multiple checkbox changes keep selection, focus and inventory stable', async () => {
      for (const [checkbox, one, two] of [[firstCheckbox,true,false],[secondCheckbox,true,true],[firstCheckbox,false,true],[firstCheckbox,true,true]]) {
        checkbox.focus(); await click(checkbox)
        ensure(firstCheckbox.checked === one && secondCheckbox.checked === two, 'Unrelated selection changed')
        ensure(text(query('.co-pr-selection')).includes((Number(one)+Number(two))+' selected'), 'Selection count drifted')
        selectionStaysInInventory(checkbox)
      }
    })
    await check('trusted keyboard Space selects and deselects without navigation', async () => {
      const events = []; const capture = event => events.push({code:event.code,trusted:event.isTrusted})
      secondCheckbox.addEventListener('keydown',capture); secondCheckbox.focus()
      for (const selected of [false,true]) { await nativeSpace(); await until(() => secondCheckbox.checked === selected,'Space did not toggle'); selectionStaysInInventory(secondCheckbox) }
      secondCheckbox.removeEventListener('keydown',capture)
      ensure(events.length === 2 && events.every(event => event.trusted && event.code === 'Space'),'Keyboard test was not native')
    })
    await check('compact selection tray keeps count and only the approved batch actions in one fixed header', async () => {
      const tray=query('.co-pr-selection'), scroller=query('.co-page')
      const heading=query('.co-selection-heading')
      ensure(heading && button('Assign…',heading) && button('Review 2',heading) && text(heading).includes('2 selected'),'Count and batch actions are not together in the tray header')
      ensure(!button('Review & merge',tray),'Tray exposed a redundant merge action')
      ensure(query('.co-selection-toggle').getAttribute('aria-expanded')==='false','Selection tray did not start compact')
      const before=tray.getBoundingClientRect()
      scroller.scrollTop=Math.min(160,Math.max(0,scroller.scrollHeight-scroller.clientHeight)); await new Promise(requestAnimationFrame)
      const after=tray.getBoundingClientRect()
      ensure(getComputedStyle(tray).position==='fixed' && Math.abs(before.bottom-after.bottom)<2 && after.bottom<=innerHeight && after.top>=0,'Selection tray left the viewport while browsing')
      ensure(query('.co-selected-cards').children.length===2,'Selected titles missing')
      await click(query('.co-selection-toggle'))
      ensure(query('.co-selection-toggle').getAttribute('aria-expanded')==='true','Selection list did not expand')
      await click(query('[aria-label="Remove PR 8 from selection"]'))
      ensure(firstCheckbox.checked && !secondCheckbox.checked,'Card removal changed the wrong PR')
      await click(secondCheckbox)
      await click(query('.co-selection-toggle'))
      ensure(mutationRequests().length===0,'Selection tray mutated remote work')
    })
    await check('refresh preserves selection across pages and announces changed versions', async () => {
      window.fixturePaging=true
      await click(query('[aria-label="Refresh pull requests"]'))
      await until(() => !query('[aria-label="Refresh pull requests"]').disabled,'Refresh did not finish')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Refresh discarded unchanged selection or skipped selected later page')
      window.fixtureChangedHead=true
      await click(query('[aria-label="Refresh pull requests"]'))
      await until(() => !query('[aria-label="Refresh pull requests"]').disabled,'Changed refresh did not finish')
      ensure(firstCheckbox.checked && !secondCheckbox.checked,'Changed head remained selected or unchanged head was lost')
      ensure(text(query('.co-public-work')).includes('Selection updated: owner/project#8'),'Selection change was not announced')
      window.fixturePaging=false; window.fixtureChangedHead=false
      await click(query('[aria-label="Refresh pull requests"]'))
      await until(() => !query('[aria-label="Refresh pull requests"]').disabled,'Restored refresh did not finish')
      await click(secondCheckbox)
    })
    await check('PR detail opens in a nonmodal dock without clearing list state or selected versions', async () => {
      const filters=query('.co-pr-filters'), search=query('input[aria-label="Find a pull request"]')
      await click(button('Unassigned',filters)); await fill(search,'Contribution')
      ensure(!query('input[aria-label="Select owner/project #8"]'),'Fixture filter did not hide selected PR')
      const card=[...document.querySelectorAll('.co-selected-open')].find(node => text(node).startsWith('#8'))
      const scroller=query('.co-page'), scrollBefore=scroller.scrollTop, listBefore=query('.co-pr-list')
      card.focus()
      await click(card)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 8'),'Filtered selected detail did not load')
      const dock=query('.co-task-dock'), dockRect=dock.getBoundingClientRect()
      ensure(dock.getAttribute('role')==='dialog' && dock.getAttribute('aria-modal')==='false','Dock is not exposed as a nonmodal dialog')
      ensure(getComputedStyle(dock).position==='fixed' && dockRect.bottom<=innerHeight && dockRect.right<=innerWidth,'PR detail is not docked to the viewport edge')
      ensure(query('.co-pr-detail').closest('.co-task-dock')===dock && !query('.co-pr-detail').closest('.co-pr-row'),'PR detail expanded a list row instead of using the dock')
      ensure(button('Unassigned',filters).getAttribute('aria-pressed')==='true' && search.value==='Contribution','Opening detail cleared filter or search')
      ensure(!query('input[aria-label="Select owner/project #8"]') && query('.co-pr-list')===listBefore && Math.abs(scroller.scrollTop-scrollBefore)<2,'Opening detail changed filtered list identity or scroll')
      ensure([...document.querySelectorAll('.co-selected-open')].map(node => text(node).slice(0,2)).join(',')==='#7,#8','Opening detail changed the exact selection')
      await nativeEscape()
      await until(() => !query('.co-task-dock'),'Escape did not close the dock')
      ensure(document.activeElement===card,'Escape did not return focus to the detail trigger')
      await fill(search,''); await click(button('All',filters))
      await until(() => document.querySelectorAll('.co-pr-row').length===2,'PR list did not restore after resetting filters')
      secondCheckbox=query('input[aria-label="Select owner/project #8"]')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Closing detail changed selected versions')
    })
    await check('cancelling batch actions restores their original keyboard trigger', async () => {
      for (const label of ['Review 2','Assign…']) {
        const trigger=button(label,query('.co-pr-selection')); trigger.focus(); await click(trigger)
        await until(() => query('.co-task-dock'),'Dock did not open')
        await click(button('Cancel',query('.co-task-dock')))
        await until(() => !query('.co-task-dock'),'Dock did not close')
        ensure(trigger.isConnected && document.activeElement===trigger,'Cancel lost keyboard focus instead of returning to the batch action')
      }
      ensure(mutationRequests().length===0,'Cancel submitted a workflow')
    })
    await check('individual PR detail leads with Description and retains review and merge choices', async () => {
      const title=document.querySelectorAll('.co-pr-open')[1]
      title.focus(); await click(title)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 8'),'Description did not load')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Opening detail replaced batch selection')
      ensure(!query('.co-file-disclosure') && !calls.requests.some(call => call.url.includes('/files?')),'Diff loaded by default')
      const tabs=query('.co-detail-tabs')
      ensure(button('Description',tabs).getAttribute('aria-pressed')==='true' && button('Files 1',tabs) && button('Activity',tabs),'Description, Files, and Activity tabs were not maintained')
      ensure(button('Review this PR',query('.co-task-dock')) && button('Review & merge',query('.co-task-dock')),'Individual review choices were lost')
      ensure(mutationRequests().length === 0 && navigation.length === inventoryNavigationDepth,'Opening PR changed work or screens')
    })
    await check('files load only on demand, remain collapsed, and activity is separate', async () => {
      await click(button('Files 1',query('.co-pr-detail')))
      await until(() => query('.co-file-disclosure'),'Files did not load')
      ensure(!query('.co-file-disclosure').open,'Patch opened by default')
      await click(query('.co-file-disclosure summary'))
      ensure(query('.co-file-disclosure').open && text(query('.co-file-disclosure pre')).includes('+safe change'),'Patch disclosure failed')
      await click(button('Activity',query('.co-pr-detail')))
      await until(() => text(query('.co-pr-detail')).includes('Please check this edge case'),'Activity did not load')
      ensure(!query('.co-file-disclosure'),'Files leaked into activity')
      const title=document.querySelectorAll('.co-pr-open')[1]
      await click(button('Review this PR',query('.co-task-dock')))
      await until(() => query('.co-pr-confirm'),'Individual review confirmation did not open')
      ensure(text(query('.co-pr-confirm')).includes('Contribution 8') && text(query('.co-pr-confirm')).includes('ccccccc') && !text(query('.co-pr-confirm')).includes('Contribution 7'),'Individual review changed PR scope or version')
      const mergeOption=query('.co-pr-confirm input[type="checkbox"]')
      ensure(mergeOption && !mergeOption.checked && button('Start private review'),'Individual review granted merge by default')
      await click(mergeOption)
      ensure(button('Allow review & merge'),'Individual merge choice did not require guarded approval')
      ensure(mutationRequests().length===0,'Changing individual review mode mutated GitHub')
      await click(button('Cancel',query('.co-task-dock')))
      await until(() => !query('.co-task-dock'),'Individual review did not close')
      ensure(document.activeElement===title,'Closing individual review did not return focus to its row trigger (focused '+(document.activeElement?.className || document.activeElement?.tagName)+': '+text(document.activeElement)+')')
    })
    await check('batch assignment uses one explicit person action and preserves selected PRs', async () => {
      const scrollBefore=query('.co-page').scrollTop
      await click(button('Assign…',query('.co-pr-selection')))
      await until(() => query('[aria-label="Assign to me"]'),'People did not load')
      ensure(mutationRequests().length === 0,'Opening picker assigned prematurely')
      ensure(document.activeElement === query('.co-person-search'),'People search did not receive focus')
      ensure(Math.abs(query('.co-page').scrollTop-scrollBefore)<2,'Assignment jumped the project scroll position')
      window.failAssignment = 8
      await click(query('[aria-label="Assign to me"]'))
      await until(() => mutationRequests().length === 2 && text(query('.co-pr-assignment')).includes('Only remaining'),'Partial result missing')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Partial assignment lost selection')
      window.failAssignment = null
      await click(query('[aria-label="Assign to me"]'))
      await until(() => mutationRequests().length === 3 && !query('.co-pr-assignment'),'Assignment retry did not finish')
      const assigned = mutationRequests().filter(call => call.url.endsWith('/assign-review'))
      ensure(assigned.map(call => call.body.number).join(',') === '7,8,8','Successful assignment was repeated')
      ensure(firstCheckbox.checked && secondCheckbox.checked && reviewRuns.length === 0,'Assignment started review or lost selection')
    })
    await check('batch review stays in a nonmodal dock, enumerates exact versions, and starts only after approval', async () => {
      await click(button('Review 2'))
      await until(() => query('.co-pr-confirm'),'No confirmation')
      ensure(query('.co-pr-confirm').closest('.co-task-dock')?.getAttribute('aria-modal')==='false','Batch review did not use the nonmodal dock')
      ensure(text(query('.co-pr-confirm')).includes('Contribution 7') && text(query('.co-pr-confirm')).includes('Contribution 8'),'Batch lost a PR')
      ensure(text(query('.co-pr-confirm')).includes('aaaaaaa') && text(query('.co-pr-confirm')).includes('ccccccc'),'Exact heads absent')
      ensure(!query('.co-pr-confirm input').checked && reviewRuns.length === 0,'Private review granted merge')
      ensure(navigation.length === inventoryNavigationDepth && query('.co-pr-list') === originalList,'Review changed screens or remounted list')
      const region=query('.co-pr-confirm'), rect=region.getBoundingClientRect()
      ensure(rect.top >= 0 && rect.top < innerHeight && document.activeElement === region,'Review not visible/focused')
      await click(query('.co-pr-confirm input'))
      ensure(reviewRuns.length === 0,'Mode toggle counted as approval')
      await click(button('Allow review & merge'))
      await until(() => reviewRuns.length === 1 && button('Open review conversation'),'Review did not start')
      const write=mutationRequests().at(-1)
      ensure(write.url.endsWith('/review-runs') && write.body.mode==='review_merge' && write.body.items.length===2,'Wrong workflow request')
      ensure(write.body.items[0].head_sha===HEAD && write.body.items[1].head_sha===SECOND_HEAD,'Approval lost selected heads')
      ensure(query('.co-pr-list')===originalList,'Review replaced inventory')
    })
    await check('review errors preserve exact selection for an explicit retry', async () => {
      await inventory(); await click(firstCheckbox); await click(button('Review 1'))
      window.failReview = true
      await click(button('Start private review'))
      await until(() => text(query('.co-pr-confirm')).includes('Fixture review error'),'No workflow error')
      ensure(firstCheckbox.checked && reviewRuns.length===1,'Failed review lost selection or started work')
      window.failReview=false; await click(button('Cancel')); await click(query('[aria-label="Clear selection"]'))
    })
    await check('explicit send joins the same public inventory without implying merge', async () => {
      await inventory(); await click(button('Review and send'))
      await until(() => button('Send to GitHub'),'Publication confirmation missing')
      ensure(calls.publications.length===0,'Opening publication sent work')
      await click(button('Send to GitHub'))
      await until(() => query('input[aria-label="Select owner/project #9"]'),'Published record absent')
      ensure(calls.publications.length===1 && calls.publications[0].plan.head_sha===HEAD,'Publication duplicated or lost reviewed head')
      ensure(query('.co-pr-list')===originalList,'Publication replaced inventory')
      await until(() => button('Review public contributions'),'Publication outcome missing')
      await click(button('Review public contributions'))
      ensure(query('input[aria-label="Select owner/project #9"]').getClientRects().length,'Published PR not selectable')
    })
    await check('source conversation scope loads lazily and remains separate from project preparation', async () => {
      await click(button('Prepare changes'))
      await until(() => query('[data-task="task:prepare"]'),'Preparation did not open')
      await click(button('All local changes'))
      await until(() => text(query('[data-task="task:scope"]')).includes('No source conversations'),'Scope did not load')
      ensure(calls.starts.length===0,'Choosing scope started work')
      await click([...document.querySelectorAll('.co-scope-row')][0])
    })
    await check('preparation starts once and project switching restores its durable owner', async () => {
      const prepareButton=button('Prepare changes',query('[data-task="task:prepare"]'))
      prepareButton.click(); prepareButton.click()
      await until(() => button('Open conversation'),'Preparation did not start')
      ensure(calls.starts.length===1 && calls.starts[0].draft.includes('app:fixture') && !calls.starts[0].draft.includes('app:other'),'Duplicate or wrong scope')
      await chooseProject('Other project'); ensure(!button('Open conversation'),'Other project inherited progress')
      await chooseProject('Fixture project')
      await until(() => text(query('.co-work-progress-row')).includes('Agent working'),'Saved task did not restore')
      await click(query('.co-work-progress-row'))
      await until(() => button('Open conversation'),'Saved conversation unavailable')
      ensure(calls.status.includes('prepare-1') && calls.starts.length===1,'Restore restarted work')
    })
    await check('host Back leaves the project once; docked details add no hidden back steps', async () => {
      await inventory(); await click(query('.co-pr-open'))
      const before = navigation.length
      window.mobius.nav.back()
      await until(() => !query('.co-workspace') && query('.co-source-row'),'Back did not restore directory')
      ensure(navigation.length===before-1,'Inline detail owned an extra back step')
    })
    const savedSelection = id => ({request_id:id,mode:'review_merge',items:[{repo:'owner/project',number:7,head_sha:HEAD,base_ref:'main',base_sha:BASE}]})
    async function showSelection(id, value = savedSelection(id)) {
      values.set('review-selections/' + id + '.json', value)
      window.openSelectionFixture(id)
      await until(() => !text(query('.co-selection-page')).includes('Checking the selected'), 'Approval link did not settle')
    }
    const beforeLink = mutationRequests().length
    await check('direct link opens exact approval without granting consent on navigation', async () => {
      await showSelection('selection-link-one')
      await until(() => button('Allow review & merge'), 'Review link did not reach exact approval')
      ensure(text(query('.co-selection-page')).includes('aaaaaaa → main (bbbbbbb)'), 'Link omitted selected version')
      ensure(mutationRequests().length === beforeLink, 'Opening an approval link mutated work')
    })
    await check('direct link confirmation posts exact scope once even after double click', async () => {
      const confirm = button('Allow review & merge')
      confirm.click(); confirm.click()
      await until(() => button('Open review conversation'), 'Approval did not open its owning conversation')
      ensure(mutationRequests().length === beforeLink + 1, 'Approval did not produce exactly one request')
      const body = mutationRequests().at(-1).body
      ensure(body.request_id === 'selection-link-one' && body.items[0].head_sha === HEAD && !body.chat_approval, 'Browser forged chat authority or changed selected work')
    })
    await check('already approved chat selection opens its owner without another approval', async () => {
      await click(button('Back to projects'))
      await showSelection('selection-link-one')
      await until(() => button('Open review conversation'), 'Existing selection did not resolve its owner')
      ensure(!button('Allow review & merge') && mutationRequests().length === beforeLink + 1, 'Existing selection asked for duplicate approval')
    })
    await check('changed public version invalidates a link without silently advancing it', async () => {
      await click(button('Back to projects'))
      const stale = savedSelection('selection-stale'); stale.items[0].head_sha = SECOND_HEAD
      await showSelection('selection-stale', stale)
      await until(() => text(query('.co-selection-page')).includes('changed or closed'), 'Changed version did not stop approval')
      ensure(!button('Allow review & merge') && mutationRequests().length === beforeLink + 1, 'Stale link mutated work')
    })
    await check('changed base version also invalidates a link without silently advancing it', async () => {
      await click(button('Back to projects'))
      const stale = savedSelection('selection-stale-base'); stale.items[0].base_sha = 'd'.repeat(40)
      await showSelection('selection-stale-base', stale)
      await until(() => text(query('.co-selection-page')).includes('changed or closed'), 'Changed base did not stop approval')
      ensure(!button('Allow review & merge') && mutationRequests().length === beforeLink + 1, 'Stale-base link mutated work')
    })
    await check('editing saved selection during confirmation never approves replacement work', async () => {
      await click(button('Back to projects'))
      await showSelection('selection-replaced')
      await until(() => button('Allow review & merge'), 'Proposal not ready')
      const changed = savedSelection('selection-replaced'); changed.items[0].number = 8
      values.set('review-selections/selection-replaced.json', changed)
      await click(button('Allow review & merge'))
      await until(() => text(query('.co-selection-page')).includes('changed while you were reading'), 'Proposal replacement was not detected')
      ensure(mutationRequests().length === beforeLink + 1, 'Replaced proposal was approved')
    })
    await check('read-only contributor can privately review but cannot approve merging', async () => {
      await click(button('Back to projects')); window.fixturePermission = 'READ'
      await showSelection('selection-reader')
      await until(() => button('Review privately instead'), 'Permission failure not explained')
      ensure(button('Allow review & merge')?.disabled, 'Read permission exposed active merge approval')
      await click(button('Review privately instead'))
      ensure(button('Start private review') && !button('Start private review').disabled, 'Private review became unavailable')
      ensure(mutationRequests().length === beforeLink + 1, 'Changing mode counted as approval')
      window.fixturePermission = 'WRITE'
    })
    await check('adding an external repository is an explicit saved choice, not a GitHub mutation', async () => {
      await click(button('Back to projects'))
      await click(query('.co-repository-picker summary'))
      const input = query('#co-repository-name')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'team/community')
      input.dispatchEvent(new Event('input',{bubbles:true}))
      await frame(); await click(button('Add'))
      await until(() => values.get('followed-repositories.json')?.includes('team/community'), 'Repository preference was not saved')
      ensure(query('.co-other-repositories') && !query('.co-other-repositories').open, 'Other repositories cluttered the default project list')
      await click(query('.co-other-repositories summary'))
      ensure([...document.querySelectorAll('.co-source-row')].some(node => node.getClientRects().length && text(node).includes('team/community')), 'Explicitly added repository was lost')
      ensure(mutationRequests().length === beforeLink + 1, 'Adding repository mutated GitHub')
    })
    ensure(calls.forbidden.length === 0, 'Unexpected runtime/transport: ' + JSON.stringify(calls.forbidden))
    return { status: 'pass', checks, calls: { reads: calls.requests.length - mutationRequests().length,
      reviewRequests: reviewRuns.length, assignments: mutationRequests().filter(call => call.url.endsWith('/assign-review')).length,
      preparations: calls.starts.length, publications: calls.publications.length }, forbidden: calls.forbidden }
  } catch (error) {
    return { status: 'fail', checks, error: error.stack, dom: text(query('main')).slice(0, 5000), calls, forbidden: calls.forbidden }
  }
}
`

async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(path)) return path
  }
  const directory = '/opt/agent-browser/browsers'
  if (existsSync(directory)) for (const name of (await readdir(directory)).sort().reverse()) {
    const path = join(directory, name, 'chrome')
    if (existsSync(path)) return path
  }
  throw new Error('No installed Chromium found; set CHROMIUM_PATH. This test never installs a browser.')
}

function cdp(browser) {
  let serial = 0, buffer = ''
  const pending = new Map(), events = [], listeners = new Set()
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let end
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (message.id) {
        const entry = pending.get(message.id)
        if (!entry) continue
        pending.delete(message.id); clearTimeout(entry.timer)
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      } else { events.push(message); for (const listener of listeners) listener(message) }
    }
  })
  return { events, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) }, send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)) }, 45000)
      pending.set(id, { resolve, reject, timer })
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  } }
}

async function main() {
  if (!frontendModules) throw new Error('MOBIUS_FRONTEND_NODE_MODULES is required')
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  const build = await rolldown({ input: ENTRY, platform: 'browser', tsconfig: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [{ name: 'workspace-browser-fixture',
      resolveId(id, importer) { if (id === ENTRY) return id; if (importer === ENTRY && id.startsWith('.')) return join(root, id) },
      load(id) { if (id === ENTRY) return { code: fixture, moduleType: 'jsx' } },
    }],
  })
  const { output } = await build.generate({ format: 'iife' })
  await build.close()
  const temporary = await mkdtemp(join(tmpdir(), 'contribute-workspace-browser-'))
  let browser
  try {
    const page = join(temporary, 'fixture.html')
    await writeFile(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'">' +
      '<style>:root{--bg:#fff;--surface:#f5f5f5;--surface-2:#eee;--text:#222;--muted:#666;--border:#ddd;--accent:#2454cc;--accent-dim:#eef;--font:Arial}html,body,#root{height:100%;margin:0}</style>' +
      '</head><body><div id="root"></div><script>' + output[0].code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>')
    browser = spawn(await chromiumPath(), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--remote-debugging-pipe', '--user-data-dir=' + join(temporary, 'profile'), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    browser.stderr.resume()
    const protocol = cdp(browser), reports = []
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true })
      const inputErrors = []
      const unsubscribeInput = protocol.onEvent(event => {
        if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceNativeKey') return
        void (async () => {
          let error = ''
          try {
            const input = JSON.parse(event.params.payload)
            if (!['Space','Escape'].includes(input.code)) throw new Error('Unknown native input request')
            for (const type of ['keyDown', 'keyUp']) await protocol.send('Input.dispatchKeyEvent', {
              type, key: input.key, code: input.code, windowsVirtualKeyCode: input.keyCode, nativeVirtualKeyCode: input.keyCode,
            }, sessionId)
          } catch (failure) { error = failure.message }
          await protocol.send('Runtime.evaluate', { expression: `window.finishNativeKey(${JSON.stringify(error)})` }, sessionId)
        })().catch(error => inputErrors.push(error.message))
      })
      await protocol.send('Runtime.enable', {}, sessionId)
      await protocol.send('Runtime.addBinding', { name: 'workspaceNativeKey' }, sessionId)
      await protocol.send('Network.enable', {}, sessionId)
      await protocol.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] }, sessionId)
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'phone' }, sessionId)
      await protocol.send('Page.enable', {}, sessionId)
      await protocol.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId)
      const evaluated = await protocol.send('Runtime.evaluate', { expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        function ready() { if (window.runWorkspaceChecks) window.runWorkspaceChecks().then(resolve, reject);
          else if (Date.now() > deadline) reject(new Error('Fixture did not load'));
          else setTimeout(ready, 20); }
        ready();
      })`, awaitPromise: true, returnByValue: true }, sessionId)
      const report = evaluated.result?.value || { status: 'fail', error: evaluated.exceptionDetails || evaluated }
      unsubscribeInput()
      if (inputErrors.length) { report.status = 'fail'; report.nativeInputErrors = inputErrors }
      const network = protocol.events.filter(event => event.sessionId === sessionId && event.method === 'Network.requestWillBeSent'
        && !event.params.request.url.startsWith('file:')).map(event => event.params.request.url)
      if (network.length) { report.status = 'fail'; report.unexpectedNetwork = network }
      reports.push({ viewport, ...report })
      await protocol.send('Target.closeTarget', { targetId })
    }
    const passed = reports.every(report => report.status === 'pass')
    console.log(JSON.stringify({ status: passed ? 'pass' : 'fail', reports }, null, 2))
    if (!passed) process.exitCode = 1
    await protocol.send('Browser.close')
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      // Browser.close owns graceful shutdown, including profile writers. Do
      // not interrupt that shutdown and race its child processes during rm.
      await new Promise(resolve => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 3000)
        browser.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'fail', error: error.stack })); process.exitCode = 1 })
