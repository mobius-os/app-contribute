// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/workspace-browser.mjs
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
// PR98 deliberately moved the fixed selection tray into the list header,
// anchored detail/agent actions inline, and combined Description + Activity
// into Conversation. Test those placements without weakening the retained
// selection, focus-return, exact-consent, navigation or retry contracts.
// Local source comparison stays read-only; preparation/editing and applying
// accepted updates are explicit agent handoffs, not direct editor/apply buttons.
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
import ContributeApp from './index.jsx'

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
  baseRefName: 'main', baseRef: { target: { oid: BASE } }, state: 'OPEN', isDraft: false, url: 'https://github.com/owner/project/pull/' + number,
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
const calls = { restores: [], diffs: [], requests: [], starts: [], publications: [], status: [], forbidden: [], opened: [] }
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
  if (window.fullAppFixture) {
    if (call.url === '/api/github/status') return response({ connected: window.fullAppConnected, login: window.fullAppConnected ? 'reconnected-owner' : '' })
    if (call.url === '/api/github/source-status') return response({ apps: [], platform: null })
    if (call.url.endsWith('/review-status')) return response({ records: [] })
    if (call.url === '/api/github/graphql' && call.method === 'POST') {
      if (/mutation\b/i.test(call.body.query)) return forbidden('GraphQL mutation')(call)
      if (call.body.query.includes('resource(url:')) return response({data:{r0:{__typename:'PullRequest',state:'MERGED',isDraft:false}}})
      if (call.body.query.includes('ContributeRepositories')) return response({data:{viewer:{repositories:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}})
      if (call.body.query.includes('search(')) return response({data:{search:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}})
    }
    return forbidden('full-app fetch')(call.url)
  }
  if (call.url === '/api/github/graphql' && call.method === 'POST') {
    if (/mutation\b/i.test(call.body.query)) return forbidden('GraphQL mutation')(call)
    if (call.body.query.includes('ContributeReviewSelection')) return response({data:{p0:{nameWithOwner:'owner/project',viewerPermission:window.fixturePermission || 'WRITE',pullRequest:{...pulls[0],state:'OPEN'}}}})
    if (call.body.query.includes('ContributeRepository')) return response({data:{repository:{nameWithOwner:'team/community',viewerPermission:'WRITE'}}})
    if (call.body.query.includes('ContributeExactPull')) {
      const number=Number(call.body.query.match(/pullRequest\(number:(\d+)/)?.[1])
      const pr=pulls.find(pr=>pr.number===number)
      ensure(call.body.query.includes('owner:"owner"') && call.body.query.includes('name:"project"'),'Exact read used another repository')
      return response({data:{repository:{pullRequest:{...pr,
        headRefOid:window.exactHeadChanged?'e'.repeat(40):pr.headRefOid,
        baseRef:{target:{oid:window.liveBase || BASE}},
      }}}})
    }
    if (call.body.query.includes('ContributePullContext')) {
      const pr=pulls.find(pr=>pr.number===call.body.variables.number)
      ensure(call.body.variables.owner==='owner' && call.body.variables.name==='project','Wrong context repository')
      return response({data:{repository:{pullRequest:{...pr,
        reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},
        closingIssuesReferences:{nodes:[],pageInfo:{hasNextPage:false}},
        timelineItems:{nodes:[],pageInfo:{hasNextPage:false}},
      }}}})
    }
    if (!call.body.query.includes('ContributePullRequests')) return forbidden('unknown GraphQL query')(call.body.query)
    if(window.failPulls) return new Response(JSON.stringify({detail:'Fixture pull read error'}),{status:503})
    if(window.holdPulls) await new Promise(resolve=>{window.releasePulls=resolve})
    let found = call.body.query.includes('repo:owner/other') || window.emptyPulls ? [] : pulls
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
  if (call.url.startsWith('/api/github/contributions/fixture-app/source-chats?') && call.method === 'GET') {
    if(window.holdScope) await new Promise(resolve=>{window.releaseScope=resolve})
    if(window.failScope) return new Response(JSON.stringify({detail:'Fixture scope unavailable'}),{status:503})
    return response({ chats: [] })
  }
  if (call.url.startsWith('/api/github/api/repos/owner/project/') && call.method === 'GET') {
    if(call.url.includes('/commits/')) {
      const head=call.url.match(/commits\/([a-f0-9]+)\//)?.[1]
      ensure([HEAD,SECOND_HEAD].includes(head),'Checks lost their exact head')
      if(call.url.includes('/check-runs?')) return window.failChecks
        ? new Response(JSON.stringify({detail:'Fixture check runs unavailable'}),{status:503})
        : response({total_count:1,check_runs:[{id:1,name:'Unit tests',head_sha:head,status:'completed',conclusion:'success'}]})
      if(call.url.includes('/status?')) return response({sha:head,total_count:1,statuses:[{id:2,context:'Build',state:'success'}]})
      return forbidden('unknown commit read')(call.url)
    }
    const number = Number(call.url.match(/(?:pulls|issues)\/(\d+)/)?.[1]); const pr=pulls.find(item=>item.number===number)
    if (call.url.includes('/files?')) return response([{filename:'change.js',additions:1,deletions:0,status:'modified',patch:'@@ -1 +1 @@\n-old\n+safe change'}])
    if (call.url.includes('/comments?')) return response([{id:1,body:'Please check this edge case',user:{login:'reviewer'},created_at:'2026-09-07T14:00:00Z'}])
    if (call.url.includes('/reviews?')) return response([])
    if(!/\/pulls\/\d+$/.test(call.url)) return forbidden('unknown pull read')(call.url)
    return response({changed_files:pr.changedFiles,additions:pr.additions,deletions:pr.deletions,body:'Fixture PR description '+number,head:{sha:pr.headRefOid},base:{sha:pr.baseRefOid,ref:pr.baseRefName}})
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

async function loadProjectDiff(project) {
  calls.diffs.push({key:project.key,head:project.head_sha,base:project.base_sha})
  if(window.holdDiff) await new Promise(resolve=>{window.releaseDiff=resolve})
  if(window.diffMode==='error') return {ok:false}
  if(window.diffMode==='stale') return {ok:false,stale:true}
  return {ok:true,data:{diff:window.diffMode==='empty'?'':'diff --git a/local.js b/local.js\n--- a/local.js\n+++ b/local.js\n@@ -1 +1 @@\n-old\n+local improvement\n'}}
}
function Fixture() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [records, setRecords] = useState([prepared, {...prepared,id:'fixture-dismissed',title:'Dismissed local proposal',summary:'Dismissed local proposal',status:'abandoned',plan:{...prepared.plan,title:'Dismissed local proposal'}}])
  const [selectionId, setSelectionId] = useState(null)
  const [allProjects, setAllProjects] = useState(projects)
  window.openSelectionFixture = setSelectionId
  function repositoryAdded(repo) { setAllProjects(old => [...old, {key:'external:' + repo.nameWithOwner,kind:'external',name:repo.nameWithOwner,canonical_repo:repo.nameWithOwner,contributions:[]}]) }

  function runFor(project) {
    const items = records.filter(record => record.repo === project.canonical_repo).map(record => ({
      id: (record.status === 'abandoned' ? 'archived:' : record.status === 'prepared' ? 'publish:' : 'public:') + record.id,
      kind: record.status === 'abandoned' ? 'archived' : record.status === 'prepared' ? 'publish' : 'public', record,
      label: record.summary, detail: record.repo,
    }))
    return { revision: records.map(record => record.status).join('|'),
      decisions: items.filter(item => item.kind === 'publish'),
      working: items.filter(item => item.kind === 'public'), recent: [], archive: items.filter(item => item.kind === 'archived'),
      privateAction: organizePrivateWorkAction([], { byId: {} }, [project]) }
  }
  async function restore(record) {
    calls.restores.push(record.id)
    setRecords(old=>old.map(item=>item.id===record.id?{...item,status:'prepared'}:item))
    return {ok:true}
  }
  async function send(record) {
    calls.publications.push(structuredClone(record))
    const shared = { ...record, status: 'open', number: 9, url: 'https://github.com/owner/project/pull/9' }
    pulls.push(pull(9, { title: record.title }))
    setRecords(old => old.map(item => item.id === record.id ? shared : item))
    return { ok: true, record: shared }
  }
  async function start(action) { if(window.failStart) return {ok:false,error:'Fixture agent unavailable'}; return { ok: true, ...await window.mobius.chat.start(action) } }
  return <div className="co-root"><style>{CSS}</style><main className="co-page is-sources">
    {selectionId ? <ReviewSelection selectionId={selectionId} token="fixture-only" appId="fixture-app" onClose={() => setSelectionId(null)} /> : <SourceMap projects={allProjects} snapshot={{ generated_at: 'fixture-'+refreshKey }} conn={{ state: 'connected', login: 'owner' }}
      loadProjectDiff={loadProjectDiff} onRetry={async()=>{setRefreshKey(old=>old+1);return true}}
      repositoryPicker={<RepositoryPicker token="fixture-only" connected onAdded={repositoryAdded} />}
      renderActivity={(project, navigation) => project ? <ProjectControls key={project.key} appId="fixture-app" token="fixture-only" project={project}
        run={runFor(project)} mergeRun={runFor(project)} onStart={start}>
        {({controls,progress})=><ContributionRun run={runFor(project)} controls={controls} projectProgress={progress}
        githubState="connected" publicationPreference="github" reviewStatus={{ byId: {} }}
        selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack} onSend={send} onRestore={restore}
        renderPublicWork={() => <PullRequests refreshKey={refreshKey} appId="fixture-app" token="fixture-only" project={project}
          conn={{ state: 'connected', login: 'owner' }} records={records.filter(record => record.repo === project.canonical_repo)} />}
      />}</ProjectControls> : null} />}
  </main></div>
}
const root = createRoot(document.getElementById('root'))
root.render(<Fixture />)

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
  const back = query('[aria-label="Back to projects"]')
  if (back) await click(back)
  else { window.mobius.nav.back(); await frame(); await frame() }
  await until(() => query('.co-source-row'), 'Project list did not return')
  await click([...document.querySelectorAll('.co-source-row')].find(node => text(node.querySelector('strong')) === name))
}
window.runWorkspaceChecks = async () => {
  const checks = []
  async function check(name, run) {
    await run()
    const page=query('.co-page')
    ensure(!page || page.scrollWidth<=page.clientWidth+1,'Workspace overflows horizontally at '+name+': '+page.scrollWidth+' > '+page.clientWidth)
    checks.push({ name, status: 'pass' })
  }
  try {
    await until(() => query('.co-source-row'), 'Project list did not render')
    await check('project directory uses wrapped filter buttons instead of a dropdown or scroller', async () => {
      const filters=query('.co-directory-filters'), filterButtons=[...filters.querySelectorAll('button')]
      ensure(filters && !query('.co-directory-filter select') && !query('.co-lens-nav'), 'Project filters did not use the compact button group')
      ensure(filterButtons.map(node => text(node)).join('|')==='All|Changes2|Updates0', 'Project filter choices or counts drifted')
      ensure(button('All',filters).getAttribute('aria-pressed')==='true', 'The active project filter is not exposed')
      await click(query('.co-source-row'))
      await until(() => document.querySelectorAll('.co-pr-row').length === 2 && button('Prepare changes') && !button('Prepare changes').disabled, 'Project did not settle')
      ensure(query('.co-workspace-inventory') && !query('.co-task-content'), 'Opening a project displayed task work')
      ensure(!query('.co-task-content') && calls.starts.length === 0 && mutationRequests().length === 0, 'Opening project started work or opened an action')
    })
    const originalInventory = query('.co-workspace-inventory'), originalList = query('.co-pr-list'), originalRow = query('.co-pr-row')
    const inventoryNavigationDepth = navigation.length
    await check('PR filters are pressed buttons and change totals stay visible', async () => {
      const filters=query('.co-pr-filters'), filterButtons=[...filters.querySelectorAll('button')]
      ensure(!query('.co-public-work select[aria-label="Filter pull requests"]'),'PR filters regressed to a native select')
      ensure(filterButtons.map(node => text(node)).join('|')==='All|Unassigned|Assigned|Mine','PR filter choices drifted')
      ensure(button('All',filters).getAttribute('aria-pressed')==='true' && filterButtons.filter(node => node.getAttribute('aria-pressed')==='true').length===1,'Default filter is not exposed as one pressed button')
      ensure([...document.querySelectorAll('.co-pr-row .co-pr-meta')].every(node => text(node).includes('+1−0')),'Change totals were not visible by default')
      ensure(!query('.co-display'), 'The retired display menu returned')
      await click(button('Mine',filters))
      ensure(button('Mine',filters).getAttribute('aria-pressed')==='true' && button('All',filters).getAttribute('aria-pressed')==='false','Pressed filter state did not follow the choice')
      ensure(document.querySelectorAll('.co-pr-row').length===2,'Authored filter hid matching fixture PRs')
      await click(button('All',filters))
      ensure(query('.co-workspace-inventory')===originalInventory && mutationRequests().length===0,'Display-only controls replaced inventory or mutated GitHub')
    })
    let firstCheckbox = query('input[aria-label="Select owner/project #7"]')
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
        checkbox.focus(); const scroll=query('.co-page').scrollTop; await click(checkbox)
        ensure(Math.abs(query('.co-page').scrollTop-scroll)<2,'Checkbox selection scrolled the inventory')
        ensure(firstCheckbox.checked === one && secondCheckbox.checked === two, 'Unrelated selection changed')
        ensure(text(query('.co-pr-box-head')).includes((Number(one)+Number(two))+' selected'), 'Selection count drifted')
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
    await check('inline list header keeps count, bulk actions and visible selection without changing scope', async () => {
      const header=query('.co-pr-box-head')
      ensure(button('Assign',header) && button('Take on with agent',header) && text(header).includes('2 selected'),'Inline bulk actions missing')
      ensure(!button('Review & merge',header) && !query('.co-pr-selection'),'Obsolete tray or redundant merge action returned')
      ensure(getComputedStyle(header).position!=='fixed','Bulk header still floats outside inventory')
      await click(query('[aria-label="Select all visible pull requests"]'))
      ensure(!firstCheckbox.checked && !secondCheckbox.checked,'Deselect-visible changed the wrong scope')
      await click(query('[aria-label="Select all visible pull requests"]'))
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Select-visible failed')
      ensure(mutationRequests().length===0,'Bulk selection mutated remote work')
    })
    await check('refresh preserves selection across pages and announces changed versions', async () => {
      window.fixturePaging=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(() => !query('[aria-label="Refresh project status"]').disabled,'Refresh did not finish')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Refresh discarded unchanged selection or skipped selected later page')
      window.fixtureChangedHead=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(() => !query('[aria-label="Refresh project status"]').disabled,'Changed refresh did not finish')
      ensure(firstCheckbox.checked && !secondCheckbox.checked,'Changed head remained selected or unchanged head was lost')
      ensure(text(query('.co-public-work')).includes('Selection updated: owner/project#8'),'Selection change was not announced')
      window.fixturePaging=false; window.fixtureChangedHead=false
      await click(query('[aria-label="Refresh project status"]'))
      await until(() => !query('[aria-label="Refresh project status"]').disabled,'Restored refresh did not finish')
      await click(secondCheckbox)
    })
    await check('inline PR detail retains filters, hidden selection, list identity and keyboard return', async () => {
      const filters=query('.co-pr-filters'), search=query('input[aria-label="Find a pull request"]')
      await click(button('Unassigned',filters)); await fill(search,'Contribution')
      ensure(!query('input[aria-label="Select owner/project #8"]'),'Fixture filter did not hide selected PR')
      ensure(text(query('.co-pr-box-head')).includes('2 selected'),'Filtering discarded hidden selection')
      await click(button('Take on with agent',query('.co-pr-box-head')))
      await until(()=>query('.co-pr-confirm'),'Filtered batch preview missing')
      ensure(text(query('.co-pr-confirm')).includes('Contribution 7') && text(query('.co-pr-confirm')).includes('Contribution 8'),'Hidden selected identity omitted from confirmation')
      await click(button('Cancel',query('.co-pr-confirm')))
      const trigger=query('.co-pr-open'), listBefore=query('.co-pr-list')
      trigger.focus(); await click(trigger)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 7'),'Inline detail did not load')
      const region=query('[data-task="task:detail"]')
      ensure(region.getAttribute('role')==='region' && !query('.co-task-dock'),'Detail is not an inline nonmodal region')
      ensure(query('.co-pr-detail').closest('.co-pr-row')?.dataset.pr==='owner/project#7','Detail is not anchored to its PR')
      ensure(button('Unassigned',filters).getAttribute('aria-pressed')==='true' && search.value==='Contribution','Opening detail cleared filter or search')
      ensure(query('.co-pr-list')===listBefore && text(query('.co-pr-box-head')).includes('2 selected'),'Opening detail remounted list or changed selection')
      await nativeEscape(); await until(() => !query('.co-task-content'),'Escape did not close inline detail')
      ensure(document.activeElement===trigger,'Escape did not return focus to the detail trigger')
      await fill(search,''); await click(button('All',filters))
      await until(() => document.querySelectorAll('.co-pr-row').length===2,'PR list did not restore')
      secondCheckbox=query('input[aria-label="Select owner/project #8"]')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Closing detail changed selected versions')
    })
    await check('hiding an opened PR deliberately closes detail without losing filters or resurrecting it', async () => {
      const before=mutationRequests().length
      const search=query('[aria-label="Find a pull request"]'), filters=query('.co-pr-filters')
      const openSecond=async()=>{
        const trigger=[...document.querySelectorAll('.co-pr-open')].find(node=>text(node).includes('Contribution 8'))
        trigger.focus(); await click(trigger)
        await until(()=>query('.co-pr-detail'),'Detail did not open')
      }
      await openSecond()
      const unassigned=button('Unassigned',filters); unassigned.focus(); await click(unassigned)
      await until(()=>!query('.co-pr-detail'),'Filter did not hide target detail')
      ensure(document.activeElement===unassigned,'Closing filtered detail stole focus from its filter')
      await click(button('All',filters))
      ensure(!query('.co-pr-detail') && !query('[data-task="task:detail"]'),'Clearing filter resurrected a hidden detail task')
      await openSecond(); search.focus(); await fill(search,'Contribution')
      ensure(query('.co-pr-detail'),'A still-visible PR lost its detail')
      await fill(search,'Contribution 7')
      ensure(!query('.co-pr-detail') && document.activeElement===search,'Search did not close detail while retaining typing focus')
      await fill(search,'')
      ensure(!query('[data-task="task:detail"]'),'Clearing search resurrected a hidden detail task')
      await openSecond(); window.emptyPulls=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(()=>!query('.co-pr-row'),'Refresh did not remove fixture PRs')
      window.emptyPulls=false
      await click(query('[aria-label="Refresh project status"]'))
      await until(()=>document.querySelectorAll('.co-pr-row').length===2,'PRs did not reload')
      ensure(!query('[data-task="task:detail"]'),'Refreshing a removed PR resurrected its hidden task')
      ensure(navigation.length===inventoryNavigationDepth && mutationRequests().length===before,'Detail disappearance navigated or mutated work')
      // An empty successful refresh correctly clears the selected identities.
      await click(query('[aria-label="Select all visible pull requests"]'))
      await openSecond(); await click(button('Take on with agent',query('.co-pr-detail')))
      await until(()=>query('.co-pr-confirm'),'Individual confirmation did not open')
      await click(button('Unassigned',filters))
      ensure(query('.co-pr-confirm') && text(query('.co-pr-confirm')).includes('Contribution 8') && !text(query('.co-pr-confirm')).includes('Contribution 7'),'Detail cleanup closed or changed another active workflow')
      await click(button('Cancel',query('.co-pr-confirm'))); await click(button('All',filters))
      ensure(mutationRequests().length===before,'Filtering an existing confirmation approved work')
      firstCheckbox=query('input[aria-label="Select owner/project #7"]')
      secondCheckbox=query('input[aria-label="Select owner/project #8"]')
    })
    await check('cancelling batch actions restores their original keyboard trigger', async () => {
      for (const label of ['Take on with agent','Assign']) {
        const trigger=button(label,query('.co-pr-box-head')); trigger.focus(); await click(trigger)
        await until(() => query('.co-task-content'),'Inline action did not open')
        await click(button('Cancel',query('.co-task-content')))
        await until(() => !query('.co-task-content'),'Inline action did not close')
        ensure(trigger.isConnected && document.activeElement===trigger,'Cancel lost keyboard focus instead of returning to the batch action')
      }
      ensure(mutationRequests().length===0,'Cancel submitted a workflow')
    })
    await check('individual PR detail leads with Conversation and retains guarded review and merge choices', async () => {
      const title=document.querySelectorAll('.co-pr-open')[1]
      title.focus(); await click(title)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 8'),'Description did not load')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Opening detail replaced batch selection')
      ensure(!query('.co-file-disclosure') && !calls.requests.some(call => call.url.includes('/files?')),'Diff loaded by default')
      const tabs=query('.co-detail-tabs')
      ensure(button('Conversation',tabs).getAttribute('aria-pressed')==='true' && [...tabs.querySelectorAll('button')].some(node=>text(node).startsWith('Files changed1')) && button('Checks',tabs),'Conversation, Files changed, and Checks tabs were not maintained')
      ensure(button('Take on with agent',query('.co-task-content')),'Individual review choices were lost')
      ensure(mutationRequests().length === 0 && navigation.length === inventoryNavigationDepth,'Opening PR changed work or screens')
    })
    await check('files load only on demand and remain collapsed while discussion stays in Conversation', async () => {
      await click([...query('.co-detail-tabs').querySelectorAll('button')].find(node=>text(node).startsWith('Files changed')))
      await until(() => query('.co-file-disclosure'),'Files did not load')
      ensure(!query('.co-file-disclosure').open,'Patch opened by default')
      await click(query('.co-file-disclosure summary'))
      ensure(query('.co-file-disclosure').open && text(query('.co-file-disclosure .diff-view')).includes('safe change'),'Patch disclosure failed')
      window.failChecks=true
      await click(button('Checks',query('.co-pr-detail')))
      await until(()=>text(query('.co-pr-detail')).includes('Check runs: Could not load this information'),'Partial check failure missing')
      ensure(text(query('.co-pr-detail')).includes('Build') && text(query('.co-pr-detail')).includes('not an all-clear review'),'Successful sibling or check limitation disappeared')
      window.failChecks=false
      await click(button('Retry',query('.co-pr-detail')))
      await until(()=>text(query('.co-pr-detail')).includes('Unit tests') && !text(query('.co-pr-detail')).includes('Check runs: Could not load this information'),'Check retry did not settle')
      ensure(calls.requests.filter(call=>call.url.includes('/commits/')).every(call=>call.url.includes(SECOND_HEAD)),'Checks used another PR head')
      await click(button('Conversation',query('.co-pr-detail')))
      await until(() => text(query('.co-pr-detail')).includes('Please check this edge case'),'Activity did not load')
      ensure(!query('.co-file-disclosure'),'Files leaked into activity')
      const title=document.querySelectorAll('.co-pr-open')[1]
      await click(button('Take on with agent',query('.co-task-content')))
      await until(() => query('.co-pr-confirm'),'Individual review confirmation did not open')
      ensure(text(query('.co-pr-confirm')).includes('Contribution 8') && text(query('.co-pr-confirm')).includes('ccccccc') && !text(query('.co-pr-confirm')).includes('Contribution 7'),'Individual review changed PR scope or version')
      const mergeOption=query('.co-pr-confirm input[type="checkbox"]')
      ensure(mergeOption && !mergeOption.checked && button('Start private review'),'Individual review granted merge by default')
      await click(mergeOption)
      ensure(button('Allow review & merge'),'Individual merge choice did not require guarded approval')
      ensure(mutationRequests().length===0,'Changing individual review mode mutated GitHub')
      await click(button('Cancel',query('.co-task-content')))
      await until(() => !query('.co-task-content'),'Individual review did not close')
      ensure(document.activeElement===title,'Closing individual review did not return focus to its row trigger (focused '+(document.activeElement?.className || document.activeElement?.tagName)+': '+text(document.activeElement)+')')
    })
    await check('batch assignment uses one explicit person action and preserves selected PRs', async () => {
      await click(button('Assign',query('.co-pr-box-head')))
      await until(() => query('[aria-label="Assign to me"]'),'People did not load')
      ensure(mutationRequests().length === 0,'Opening picker assigned prematurely')
      ensure(document.activeElement === query('.co-person-search'),'People search did not receive focus')
      // #98 intentionally replaces the fixed dock with an inline region.
      // Opening it may scroll it into view; selection itself must not scroll.
      const assignmentRect=query('.co-person-search').getBoundingClientRect()
      ensure(assignmentRect.top>=0 && assignmentRect.bottom<=innerHeight && query('.co-pr-list')===originalList,'Inline assignment is not reachable or replaced the list')
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
    await check('inline batch review enumerates exact versions and starts only after approval', async () => {
      await click(button('Take on with agent'))
      await until(() => query('.co-pr-confirm'),'No confirmation')
      ensure(query('.co-pr-confirm').closest('.co-task-content')?.getAttribute('role')==='region','Batch review did not use an inline nonmodal region')
      ensure(text(query('.co-pr-confirm')).includes('Contribution 7') && text(query('.co-pr-confirm')).includes('Contribution 8'),'Batch lost a PR')
      ensure(text(query('.co-pr-confirm')).includes('aaaaaaa') && text(query('.co-pr-confirm')).includes('ccccccc'),'Exact heads absent')
      ensure(!query('.co-pr-confirm input').checked && reviewRuns.length === 0,'Private review granted merge')
      ensure(navigation.length === inventoryNavigationDepth && query('.co-pr-list') === originalList,'Review changed screens or remounted list')
      const region=query('.co-pr-confirm'), rect=region.getBoundingClientRect()
      ensure(rect.top >= 0 && rect.top < innerHeight && document.activeElement === region,'Review not visible/focused')
      await click(query('.co-pr-confirm input'))
      ensure(reviewRuns.length === 0,'Mode toggle counted as approval')
      window.liveBase='d'.repeat(40)
      await click(button('Allow review & merge'))
      await until(() => reviewRuns.length === 1 && button('Open review conversation'),'Review did not start')
      const write=mutationRequests().at(-1)
      ensure(write.url.endsWith('/review-runs') && write.body.mode==='review_merge' && write.body.items.length===2,'Wrong workflow request')
      ensure(write.body.items[0].head_sha===HEAD && write.body.items[1].head_sha===SECOND_HEAD,'Approval lost selected heads')
      ensure(write.body.items.every(item=>item.base_ref==='main' && item.base_sha===window.liveBase),'Exact launch did not re-read the current same-target tip')
      ensure(calls.requests.filter(call=>call.body?.query?.includes('ContributeExactPull')).length===2,'Launch did not read exactly its selected PRs')
      window.liveBase=null
      ensure(query('.co-pr-list')===originalList,'Review replaced inventory')
    })
    await check('review errors preserve exact selection for an explicit retry', async () => {
      await inventory(); await click(firstCheckbox); await click(button('Take on with agent'))
      window.failReview = true
      await click(button('Start private review'))
      await until(() => text(query('.co-pr-confirm')).includes('Fixture review error'),'No workflow error')
      ensure(firstCheckbox.checked && reviewRuns.length===1,'Failed review lost selection or started work')
      window.failReview=false; await click(button('Cancel')); await click(query('[aria-label="Clear selection"]'))
    })
    await check('changed exact code blocks an inline review instead of approving a refreshed head', async () => {
      const before=mutationRequests().length
      await click(firstCheckbox); await click(button('Take on with agent',query('.co-pr-box-head')))
      window.exactHeadChanged=true
      await click(button('Start private review'))
      await until(()=>text(query('.co-pr-confirm')).includes('changed since this list loaded'),'Changed code did not stop exact launch')
      ensure(mutationRequests().length===before && reviewRuns.length===1,'Changed code was approved')
      window.exactHeadChanged=false
      await click(button('Cancel')); await click(query('[aria-label="Clear selection"]'))
    })
    await check('explicit send joins the same public inventory without implying merge', async () => {
      await inventory(); await click(button('Review and send'))
      await until(() => button('Send to GitHub'),'Publication confirmation missing')
      ensure(calls.publications.length===0,'Opening publication sent work')
      await click(button('Send to GitHub'))
      await until(() => query('input[aria-label="Select owner/project #9"]'),'Published record absent')
      ensure(calls.publications.length===1 && calls.publications[0].plan.head_sha===HEAD,'Publication duplicated or lost reviewed head')
      ensure(query('.co-pr-list')===originalList,'Publication replaced inventory')
      await until(() => button('Done') && text(query('.co-task-content')).includes('Sent to GitHub'),'Publication outcome missing')
      ensure(!button('Send to GitHub'),'Settled publication remained actionable')
      await click(button('Done'))
      ensure(query('input[aria-label="Select owner/project #9"]').getClientRects().length,'Published PR not selectable')
    })
    await check('dismissed work is discoverable without a link and only explicit Restore changes its local state', async () => {
      const before=mutationRequests().length, publications=calls.publications.length
      const archive=query('.co-run-fold.is-recent')
      ensure(archive && !archive.open,'Dismissed contributions have no collapsed discovery route')
      await click(archive.querySelector('summary'))
      const row=[...archive.querySelectorAll('button')].find(node=>text(node).includes('Dismissed local proposal'))
      ensure(row && row.getClientRects().length,'Dismissed proposal is not discoverable')
      row.focus(); await click(row)
      await until(()=>button('Restore'),'Dismissed contribution cannot be restored from its discovered detail')
      ensure(calls.restores.length===0 && mutationRequests().length===before,'Inspecting dismissed work changed it')
      await nativeEscape(); await until(()=>!query('.co-task-content'),'Escape did not close dismissed detail')
      ensure(document.activeElement===row,'Dismissed detail did not return focus to its row')
      await click(row); await click(button('Restore'))
      await until(()=>calls.restores.length===1 && !query('.co-run-fold.is-recent'),'Restore did not move exact record out of history')
      ensure(calls.restores[0]==='fixture-dismissed' && calls.publications.length===publications && mutationRequests().length===before,'Restore published work or restored another record')
      await inventory()
      ensure(button('Review and send'),'Restored record did not return to private preparation')
    })
    await check('PR inventory distinguishes failed refresh, empty results and loading without mutations', async () => {
      const before=mutationRequests().length
      window.failPulls=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(()=>text(query('.co-public-work')).includes('Couldn’t load pull requests'),'Read failure missing')
      ensure(document.querySelectorAll('.co-pr-row').length===3,'Failed refresh erased saved inventory')
      window.failPulls=false
      await click(button('Try again',query('.co-public-work')))
      await until(()=>!query('.co-public-work [role="alert"]'),'Read retry did not clear error')
      window.emptyPulls=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(()=>text(query('.co-pr-empty')).includes('No pull requests'),'Empty inventory missing')
      ensure(!query('.co-pr-row'),'Empty result kept stale rows')
      window.emptyPulls=false; window.holdPulls=true
      await click(query('[aria-label="Refresh project status"]'))
      await until(()=>window.releasePulls && text(query('.co-pr-empty')).includes('Loading pull requests'),'Loading confused with empty')
      ensure(!text(query('.co-pr-empty')).includes('No pull requests'),'Loading claimed an empty result')
      window.holdPulls=false; window.releasePulls(); window.releasePulls=null
      await until(()=>document.querySelectorAll('.co-pr-row').length===3,'Released inventory did not load')
      const search=query('[aria-label="Find a pull request"]')
      await fill(search,'no-such-contribution')
      ensure(text(query('.co-pr-empty')).includes('No pull requests match'),'Search empty result missing')
      await fill(search,'')
      ensure(mutationRequests().length===before && query('.co-pr-list')===originalList,'Read states mutated work or remounted inventory')
    })
    await check('local comparison is lazy, versioned, read-only and distinguishes loading, failure, empty and stale', async () => {
      const before=mutationRequests().length
      ensure(calls.diffs.length===0,'Local source diff loaded before inspection')
      window.holdDiff=true; window.diffMode='error'
      const local=()=>[...document.querySelectorAll('.co-position-inspect')].find(node=>text(node).startsWith('Local'))
      await click(local())
      await until(()=>window.releaseDiff && query('.co-project-diff-loading'),'Comparison loader missing')
      window.holdDiff=false; window.releaseDiff(); window.releaseDiff=null
      await until(()=>button('Could not load diffs · try again'),'Comparison error missing')
      window.diffMode='empty'; await click(button('Could not load diffs · try again'))
      await until(()=>text(query('.co-project-diff-empty')).includes('No changed files'),'Empty comparison missing')
      await inventory(); window.diffMode='stale'; await click(local())
      await until(()=>button('Project changed · check again'),'Stale comparison not distinguished')
      window.diffMode='ready'; await click(button('Project changed · check again'))
      await until(()=>text(query('.diff-view')).includes('local improvement'),'Fresh comparison did not recover')
      await click(query('.co-position-details summary'))
      ensure(text(query('.co-position-details')).includes('aaaaaaa') && text(query('.co-position-details')).includes('bbbbbbb'),'Compared versions missing')
      ensure(calls.diffs.every(call=>call.key==='app:fixture' && call.head===HEAD && call.base===BASE),'Comparison drifted to another source')
      ensure(mutationRequests().length===before && calls.starts.length===0,'Read-only comparison started work')
      await inventory()
    })
    await check('source conversation scope loads lazily and remains separate from project preparation', async () => {
      await click(button('Prepare changes'))
      await until(() => query('[data-task="task:prepare"]'),'Preparation did not open')
      const scope = query('.co-prepare-scope')
      ensure(text(scope).includes('1 local file'),'Preparation did not show the collocated file scope')
      window.holdScope=true; window.failScope=true
      await click(scope)
      await until(()=>window.releaseScope && text(query('[data-task="task:scope"]')).includes('Finding source conversations'),'Scope loader missing')
      window.holdScope=false; window.releaseScope(); window.releaseScope=null
      await until(()=>text(query('[data-task="task:scope"]')).includes('Fixture scope unavailable'),'Scope failure missing')
      ensure(text(query('[data-task="task:scope"]')).includes('All local work'),'Scope failure hid project preparation')
      window.failScope=false; await click(button('Try again',query('[data-task="task:scope"]')))
      await until(() => text(query('[data-task="task:scope"]')).includes('No source conversations'),'Scope did not load')
      ensure(calls.starts.length===0,'Choosing scope started work')
      await click([...document.querySelectorAll('.co-scope-row')][0])
    })
    await check('preparation starts once and project switching restores its durable owner', async () => {
      const prepareButton=button('Start preparation',query('[data-task="task:prepare"]'))
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
    await check('pulling accepted changes requires one explicit scoped agent handoff and preserves failures', async () => {
      await chooseProject('Other project')
      const before=mutationRequests().length, starts=calls.starts.length
      await click(button('Pull updates'))
      await until(()=>button('Start pull') && !button('Start pull').disabled,'Pull action did not settle')
      ensure(calls.starts.length===starts && mutationRequests().length===before,'Opening update applied or published work')
      window.failStart=true; await click(button('Start pull'))
      await until(()=>text(query('[data-task="task:update"]')).includes('Fixture agent unavailable'),'Agent-start failure missing')
      ensure(calls.starts.length===starts,'Failed handoff counted as started')
      window.failStart=false
      const start=button('Start pull'); start.click(); start.click()
      await until(()=>calls.starts.length===starts+1 && button('Open conversation'),'Update did not start once')
      const action=calls.starts.at(-1)
      ensure(action.event==='update_source_projects' && action.draft.includes('app:other') && !action.draft.includes('app:fixture'),'Update scope drifted')
      ensure(action.draft.includes('update/apply approval') && action.draft.includes('uncommitted edits') && action.draft.includes('does not authorize preparing or publishing'),'Safe apply/overlay/publication boundaries missing')
      ensure(mutationRequests().length===before,'Update handoff mutated GitHub')
      await chooseProject('Fixture project')
    })
    await check('host Back leaves the project once; inline details add no hidden back steps', async () => {
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
      await click(query('[aria-label="Add repository"]'))
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
    await check('returning from Settings refreshes the full app account and live feed exactly once', async () => {
      // Mount the actual app, not a refresh helper. Only external storage and
      // fetch boundaries are faked; hooks, coordinator and reconciliation run.
      root.render(null)
      await frame(); await frame()
      window.fullAppFixture = true
      window.fullAppConnected = false
      values.clear()
      let ledgerReads = 0
      const liveRecord = {...prepared, status:'open', number:7, url:'https://github.com/owner/project/pull/7'}
      window.mobius.storage.listWithStatus = async prefix => {
        ensure(prefix === 'contributions/', 'Unexpected ledger path')
        ledgerReads++
        return {complete:true,entries:[{type:'file',name:liveRecord.id+'.json',content:structuredClone(liveRecord)}]}
      }
      root.render(<ContributeApp appId="fixture-app" token="fixture-only" />)
      await until(() => values.get('feed-cache.json')?.records?.[0]?.status === 'open', 'Initial ledger did not settle')
      ensure(ledgerReads === 1, 'Initial app performed duplicate ledger scans')
      const previous = calls.requests.length
      window.fullAppConnected = true
      // One authentic parent-window message represents returning from Settings.
      // No focus/click retries manufacture success or conceal duplicate work.
      window.postMessage({type:'moebius:frame-visibility',visible:true}, '*')
      await until(() => text(query('.co-settings summary')).includes('reconnected-owner'), 'Foreground did not display the new account')
      const returning = calls.requests.slice(previous)
      ensure(returning.filter(call => call.url === '/api/github/status').length === 1, 'Foreground checked the account more than once')
      const overlays = returning.filter(call => call.url === '/api/github/graphql' && call.body.query.includes('resource(url:'))
      ensure(overlays.length === 1, 'Expected one foreground live-feed query, got ' + overlays.length)
      await until(() => values.get('feed-cache.json')?.records?.[0]?.status === 'merged', 'Foreground live state was not reconciled and cached')
      ensure(ledgerReads === 2, 'Foreground did not own exactly one fresh ledger scan')
      ensure(returning.every(call => call.method === 'GET' || call.url === '/api/github/graphql'), 'Foreground mutated public work')
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
