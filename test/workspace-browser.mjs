// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/workspace-browser.mjs
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
import { runFallbackMixedChecks } from './test/inline-fallback-mixed-fixture.jsx'
import { runFallbackActivationChecks } from './test/inline-fallback-activation-fixture.jsx'
import { runFallbackAttributionChecks } from './test/inline-fallback-attribution-fixture.jsx'
import { runInlineCanonicalFailureChecks } from './test/inline-canonical-failure-fixture.jsx'
import { runUpperUiStatusChecks } from './test/upper-ui-status-fixture.jsx'
import { SourceMap } from './ui/SourceMap.jsx'
import { ReviewSelection } from './ui/ReviewSelection.jsx'
import { RepositoryPicker } from './ui/RepositoryPicker.jsx'
import { ProjectControls } from './ui/ProjectControls.jsx'
import { PullRequests } from './ui/PullRequests.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { organizePrivateWorkAction } from './review.js'
import { CSS } from './theme.js'
import { InlinePreparedView, InlineBatchView } from './ui/InlinePreparedView.jsx'
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
  baseRefName: 'main', baseRef: { target: { oid: BASE } }, isDraft: false, url: 'https://github.com/owner/project/pull/' + number,
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
const calls = { requests: [], starts: [], publications: [], status: [], forbidden: [], opened: [], stops: [], lists: [] }
const values = new Map(), versions = new Map(), navigation = [], reviewRuns = []
const pulls = [pull(7), pull(8, { headRefOid: SECOND_HEAD, assignees: { nodes: [{ login: 'teammate' }] } })]
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
const mutationRequests = () => calls.requests.filter(call => call.method !== 'GET' && call.url !== '/api/github/graphql' && !call.url.endsWith('/review-preview'))
function forbidden(kind) {
  return (...args) => { calls.forbidden.push({ kind, args: args.map(String) }); throw new Error('Forbidden fixture transport: ' + kind) }
}
window.fetch = async (url, options = {}) => {
  const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null }
  calls.requests.push(call)
  if (call.url === '/api/models') return response({providers:{codex:[{id:'fixture-model',label:'Fixture model',available:true,effort_levels:['low','high'],default_effort:'low'}]}})
  if (call.url === '/api/owner/model-prefs') return response({hidden_ids:[]})
  if (call.url === '/api/auth/providers/status') return response({codex:{configured:true,available:true,name:'OpenAI Codex'}})
  if (call.url === '/api/github/contributions/fixture-app/review-presets' && call.method === 'GET') return response({presets:{review_prompt:'Review fixture',fix_prompt:'Fix fixture',merge_prompt:'Merge fixture',autopilot:true},capabilities:{draft_takeover:window.fixtureDraftSupport !== false}})
  if (call.url === '/api/github/contributions/fixture-app/review-preview' && call.method === 'POST') return response({preview_sha256:'f'.repeat(64)})
  if (window.fullAppFixture) {
    if (call.url === '/api/github/status') return response({ connected: window.fullAppConnected, login: window.fullAppConnected ? 'reconnected-owner' : '' })
    if (call.url.startsWith('/api/github/source-status')) {
      if (window.deferSourceDiscovery) return new Promise(resolve => { window.releaseSourceDiscovery = value => resolve(response(value)) })
      return response({ apps: [], platform: null })
    }
    if (call.url.endsWith('/review-status')) {
      if (window.fixtureReviewUnavailable) return new Response(JSON.stringify({detail:'Fixture unavailable'}), {status:503})
      return response({ records: window.fixtureInlineReviewReady ? [{id:'focused-record',state:'ready'}] : [] })
    }
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
    if (call.body.query.includes('ContributeExactPull')) {
      const number=Number(call.body.query.match(/pullRequest\(number:(\d+)\)/)?.[1])
      const found=number===11 ? pull(11,{state:'CLOSED',title:'Closed contribution'}) : pulls.find(pr=>pr.number===number)
      return response({data:{repository:{pullRequest:found && window.fixtureRetarget ? {...found, baseRefName:'release', baseRef:{target:{oid:'d'.repeat(40)}}} : found || null}}})
    }
    if (call.body.query.includes('ContributeRepository')) return response({data:{repository:{nameWithOwner:'team/community',viewerPermission:'WRITE'}}})
    if (call.body.query.includes('ContributePullContext')) {
      const last = call.body.variables.after === 'thread-page-2'
      return response({data:{repository:{pullRequest:{headRefOid:pulls.find(pr=>pr.number===call.body.variables.number)?.headRefOid,baseRefOid:BASE,baseRefName:'main',closingIssuesReferences:{nodes:[],pageInfo:{hasNextPage:false}},
        reviewThreads:{nodes:[{id:last?'thread-last':'thread-first',path:last?'last.js':'first.js',line:1,diffSide:'RIGHT',isResolved:false,comments:{nodes:[],pageInfo:{hasNextPage:false}}}],pageInfo:{hasNextPage:!last,endCursor:last?null:'thread-page-2'}},
        timelineItems:{nodes:[],pageInfo:{hasNextPage:false}}}}}})
    }
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
    getWithVersion: async key => ({value:structuredClone(values.get(key) ?? null), version:versions.get(key) || null}),
    durableWrite: async (key, value, condition = {}) => {
      const version = versions.get(key) || null
      if ((condition.ifNoneMatch && version) || (condition.ifMatch && condition.ifMatch !== version)) throw Object.assign(new Error('CAS conflict'), {code:'conflict',status:412})
      const next = 'fixture-version-' + (versions.size + calls.starts.length + calls.requests.length + Date.now())
      values.set(key,structuredClone(value)); versions.set(key,next)
      return {durability:'synced',version:next}
    },
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
    stop: async id => { calls.stops.push(id); return {stopped:true} },
    list: async options => { calls.lists.push(structuredClone(options)); return [] },
    open: id => calls.opened.push(id),
  },
}

function Fixture() {
  const [records, setRecords] = useState([prepared])
  const [selectionId, setSelectionId] = useState(null)
  const [focusPull,setFocusPull] = useState(null)
  const [focusProject,setFocusProject] = useState(null)
  const [allProjects, setAllProjects] = useState(projects)
  // Mirrors the app: the one project-level refresh renews the PR list too.
  const [refreshKey, setRefreshKey] = useState(0)
  window.openSelectionFixture = setSelectionId
  window.focusPullFixture = setFocusPull
  window.focusProjectFixture = setFocusProject
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
    {selectionId ? <ReviewSelection selectionId={selectionId} token="fixture-only" appId="fixture-app" onClose={() => setSelectionId(null)} /> : <SourceMap projects={allProjects} focusKey={focusProject} snapshot={{ generated_at: 'fixture' }} conn={{ state: 'connected', login: 'owner' }}
      onRetry={async () => { setRefreshKey(value => value + 1); return true }}
      repositoryPicker={<RepositoryPicker token="fixture-only" connected onAdded={repositoryAdded} />}
      renderActivity={(project, navigation) => project ? <ProjectControls appId="fixture-app" token="fixture-only" project={project}
        run={runFor(project)} onStart={start}>
        {({controls,progress}) => <ContributionRun run={runFor(project)} projectProgress={progress}
        githubState="connected" publicationPreference="github" reviewStatus={{ byId: {} }} controls={controls}
        selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack} onSend={send}
        renderPublicWork={() => <PullRequests appId="fixture-app" token="fixture-only" project={project} focusPull={focusPull} refreshKey={refreshKey}
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
// Detail tabs carry counts and totals after their name (e.g. "Files changed1+1−0").
const detailTab = name => [...(query('.co-pr-detail .co-detail-tabs')?.querySelectorAll('button') || [])].find(node => text(node).startsWith(name))
const modeButton = (name, root = document) => [...root.querySelectorAll('.co-pr-mode')].find(node => text(node.querySelector('strong')) === name)
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
const pullSearches = () => calls.requests.filter(call => call.body?.query?.includes('ContributePullRequests')).length
// The per-list refresh was folded into the one project-level refresh, which
// renews the PR list as well. Wait for the exact page reads it must make.
async function refreshPulls(pages, message) {
  const refresh = query('[aria-label="Refresh project status"]'), before = pullSearches()
  await click(refresh, 'Project refresh unavailable')
  await until(() => !refresh.disabled && pullSearches() === before + pages, message)
  await frame(); await frame()
  ensure(pullSearches() === before + pages, message + ': unexpected extra page reads')
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
  async function check(name, run) { await run(); checks.push({ name, status: 'pass' }) }
  try {
    checks.push(...await runFallbackMixedChecks())
    checks.push(...await runFallbackActivationChecks())
    checks.push(...await runFallbackAttributionChecks())
    await check('mounted cycle Refresh recovers a lost start and ambiguous Stop without duplicate admission', async () => {
      const originalChat={...window.mobius.chat}
      let visible=false, offline=false, stopped=false, startCount=0, stopCount=0, recoveredScope=''
      window.mobius.chat.start=async action=>{startCount++;recoveredScope=action.scope;throw Error('Lost fixture start response')}
      window.mobius.chat.list=async({scope})=>{
        ensure(scope===recoveredScope,'Recovery changed the exact saved reservation scope')
        if(offline) throw Error('Fixture offline')
        return visible?[{id:'recovered-cycle-chat',title:'Same admitted work',created_at:'2026-09-10T12:00:00Z'}]:[]
      }
      window.mobius.chat.status=async id=>{
        ensure(id==='recovered-cycle-chat','Recovery observed another chat')
        if(offline)throw Error('Fixture offline')
        return stopped?{running:false,goal:{status:'stopped'}}:{running:true}
      }
      window.mobius.chat.stop=async id=>{stopCount++;ensure(id==='recovered-cycle-chat','Stop targeted another chat');stopped=true;return {stopped:false}}
      root.render(<div className="co-root"><style>{CSS}</style><main className="co-page"><ProjectControls appId="fixture-app" token="fixture-only" project={projects[0]}
        run={{privateAction:{title:'Prepare fixture',event:'private',count:1,draft:'Only app:fixture'}}} onStart={async action=>({ok:true,...await window.mobius.chat.start(action)})} /></main></div>)
      await until(()=>button('Start fresh full merge cycle') && !button('Start fresh full merge cycle').disabled,'Recovery fixture did not restore idle')
      await click(button('Start fresh full merge cycle'))
      await until(()=>[...values.values()].some(value=>value?.pending?.id) && button('Start fresh full merge cycle').disabled,'Lost start was not kept uncertain')
      const cycleKey=[...values.keys()].find(key=>key.startsWith('project-cycles/'))
      ensure(values.get(cycleKey)?.pending?.id && startCount===1,'Lost start reservation was not saved exactly once')
      ensure(button('Recheck saved work'),'Mounted unknown cycle offered no explicit read-only recovery')
      await click(button('Recheck saved work'))
      ensure(values.get(cycleKey)?.pending?.id && button('Start fresh full merge cycle').disabled,'Empty lookup released the reservation')
      offline=true;await click(button('Recheck saved work'))
      ensure(values.get(cycleKey)?.pending?.id && startCount===1,'Offline lookup released or readmitted work')
      offline=false;visible=true
      await click(button('Recheck saved work'))
      await until(()=>values.get(cycleKey)?.chat_id==='recovered-cycle-chat' && button('Cancel active work'),'Explicit recheck did not recover the existing chat')
      ensure(!values.get(cycleKey).pending && startCount===1,'Recheck started another cycle')
      ensure(button('Open current conversation') && values.get(cycleKey).chat_id==='recovered-cycle-chat','Recovery lost its owning conversation link')
      await click(button('Cancel active work'))
      await until(()=>text(query('.co-cycle-outlet')).includes('Status unknown') && button('Start fresh full merge cycle').disabled,'Ambiguous Stop did not remain uncertain')
      offline=true;await click(button('Recheck saved work'))
      ensure(button('Start fresh full merge cycle').disabled,'Offline Stop recheck allowed duplicate admission')
      offline=false;await click(button('Recheck saved work'))
      await until(()=>text(query('main')).includes('Work stopped') && !button('Start fresh full merge cycle').disabled,'Stop status did not reconcile in the same mounted view')
      ensure(startCount===1 && stopCount===1,'Read-only recovery started or stopped work again')
      window.mobius.chat=originalChat
      root.render(null);await frame();await frame()
      values.clear();versions.clear()
      for(const list of Object.values(calls))list.splice(0)
      root.render(<Fixture />)
    })
    await check('legacy single and batch malformed stacks cannot call either publication handler', async () => {
      const broken={...prepared,id:'broken-inline',plan:{...prepared.plan,stack:{id:'chain',total:2}}}
      let singleCalls=0,stackCalls=0
      const props={appId:'fixture-app',records:[broken],ledgerReady:true,reviewStatus:{state:'ready',byId:{[broken.id]:{state:'ready'}}},
        onSend:async()=>{singleCalls++;return {ok:true}},onSendStack:async()=>{stackCalls++;return {ok:true}},loadDiff:async()=>''}
      for (const confirm of [true,false]) {
        root.render(<div className="co-root"><style>{CSS}</style><InlinePreparedView {...props} target={{kind:'prepared',id:broken.id,confirm}} /></div>)
        await until(()=>text(query('.co-inline-view')).includes('invalid layer metadata'),'Malformed legacy single fell back to standalone')
        ensure(![...document.querySelectorAll('button')].some(node=>!node.disabled && /^Contribute(?: |$)/.test(text(node))),'Malformed legacy single offered publication')
      }
      root.render(<div className="co-root"><style>{CSS}</style><InlineBatchView {...props} target={{kind:'batch',ids:[broken.id]}} /></div>)
      await until(()=>button('Contribute all 0')?.disabled && text(query('.co-inline-view')).includes('invalid layer metadata'),'Malformed legacy batch became eligible')
      button('Contribute all 0').click();await frame();await frame()
      ensure(singleCalls===0 && stackCalls===0,'Malformed legacy metadata called a publication handler')
      root.render(null);await frame();await frame()
      root.render(<Fixture />)
    })
    await until(() => query('.co-source-row'), 'Project list did not render')
    await check('project directory uses wrapped filter buttons instead of a dropdown or scroller', async () => {
      const filters=query('.co-directory-filters'), filterButtons=[...filters.querySelectorAll('button')]
      ensure(filters && !query('.co-directory-filter select') && !query('.co-lens-nav'), 'Project filters did not use the compact button group')
      ensure(filterButtons.map(node => text(node)).join('|')==='All|Changes2|Updates0', 'Project filter choices or counts drifted')
      ensure(button('All',filters).getAttribute('aria-pressed')==='true', 'The active project filter is not exposed')
      await click(query('.co-source-row'))
      await until(() => document.querySelectorAll('.co-pr-row').length === 2 && !button('Prepare changes')?.disabled, 'Project did not settle')
      ensure(query('.co-workspace-inventory') && !query('.co-task-dock'), 'Opening a project displayed task work')
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
    await check('inline selection toolbar stays in flow and exposes only scoped actions', async () => {
      const tray=query('.co-pr-box-head')
      ensure(tray && text(tray).includes('2 selected') && button('Assign',tray), 'Inline selection toolbar missing')
      ensure(query('[aria-label="Take selected PRs on with agent"]') && !query('.co-task-dock'), 'Take-on action or inline composition missing')
      ensure(getComputedStyle(tray).position !== 'fixed' && !query('.co-selection-toggle'), 'Obsolete fixed selection dock returned')
      ensure(query('[aria-label="Select all visible pull requests"]'), 'Select-all affordance missing')
      ensure(mutationRequests().length===0, 'Toolbar mutated remote work')
    })
    await check('refresh preserves selection across pages and announces changed versions', async () => {
      window.fixturePaging=true
      await refreshPulls(2,'Refresh did not finish')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Refresh discarded unchanged selection or skipped selected later page')
      window.fixtureChangedHead=true
      await refreshPulls(2,'Changed refresh did not finish')
      ensure(firstCheckbox.checked && !secondCheckbox.checked,'Changed head remained selected or unchanged head was lost')
      ensure(text(query('.co-public-work')).includes('Selection updated: owner/project#8'),'Selection change was not announced')
      window.fixturePaging=false; window.fixtureChangedHead=false
      await refreshPulls(1,'Restored refresh did not finish')
      await click(secondCheckbox)
    })
    let detailReread=false
    await check('inline detail preserves filters, selection, focus and reserved geometry', async () => {
      const filters=query('.co-pr-filters'), searchToggle=query('[aria-label="Search pull requests"]')
      await click(button('Unassigned',filters)); if (searchToggle?.getClientRects().length) await click(searchToggle)
      const search=query('input[aria-label="Find a pull request"]'); await fill(search,'Contribution')
      const listBefore=query('.co-pr-list'), selectedBefore=[firstCheckbox.checked,secondCheckbox.checked]
      const title=query('.co-pr-open'); title.focus(); await click(title)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 7'),'Inline detail did not load')
      ensure(query('.co-pr-detail').closest('.co-pr-row') && !query('.co-task-dock'),'Detail did not expand inside its row')
      ensure(button('Unassigned',filters).getAttribute('aria-pressed')==='true' && search.value==='Contribution','Detail cleared filters')
      ensure(query('.co-pr-list')===listBefore && firstCheckbox.checked===selectedBefore[0] && secondCheckbox.checked===selectedBefore[1],'Detail replaced list or changed selection')
      const before=calls.requests.filter(call=>call.url.includes('/pulls/7')).length
      await click(query('.co-inline-close'))
      await until(() => !query('.co-pr-detail'),'Inline detail did not close')
      ensure(document.activeElement===title,'Close lost row trigger focus')
      await click(title); await until(() => query('.co-pr-detail'),'Detail did not reopen')
      detailReread=calls.requests.filter(call=>call.url.includes('/pulls/7')).length!==before
      await nativeEscape(); await until(() => !query('.co-pr-detail'),'Escape did not close inline detail')
      ensure(document.activeElement===title,'Escape lost row trigger focus')
      await fill(search,''); await click(button('All',filters)); await until(() => document.querySelectorAll('.co-pr-row').length===2,'List did not restore')
    })
    await check('cancelling inline batch actions restores their original keyboard trigger', async () => {
      for (const trigger of [query('[aria-label="Take selected PRs on with agent"]'),query('[aria-label="Assign selected PRs to a person"]')]) {
        trigger.focus(); await click(trigger)
        await until(() => query('[data-task="task:review"]') || query('[data-task="task:assign"]'),'Inline action did not open')
        await click(button('Cancel',query('.co-task-content')))
        await until(() => !query('[data-task="task:review"]') && !query('[data-task="task:assign"]'),'Inline action did not close')
        ensure(trigger.isConnected && document.activeElement===trigger,'Cancel lost keyboard focus')
      }
      ensure(mutationRequests().length===0,'Cancel submitted work')
    })
    await check('each PR offers a visible agent action without modifying batch selection or starting work', async () => {
      const trigger = query('[aria-label="Take PR 7 on with an agent"]')
      const svg = trigger?.querySelector('svg')
      ensure(trigger && svg?.getBoundingClientRect().width >= 20 && svg.querySelector('path'), 'Individual agent icon is absent or collapsed')
      const before = [...query('.co-pr-list').querySelectorAll('input[type=checkbox]')].map(node=>node.checked).join(',')
      const mutations = mutationRequests().length
      await click(trigger)
      await until(()=>query('.co-pr-confirm'), 'Individual agent choice did not open')
      ensure(text(query('.co-pr-confirm h3'))==='Take on #7 with an agent', 'Single-PR action borrowed the batch selection')
      ensure(query('.co-pr-confirm').closest('[data-pr-key="owner/project#7"]') && !text(query('.co-pr-confirm')).includes('#8'), 'Individual launch changed exact PR scope')
      await click(button('Cancel',query('.co-pr-confirm')))
      ensure([...query('.co-pr-list').querySelectorAll('input[type=checkbox]')].map(node=>node.checked).join(',')===before, 'Individual launch altered batch selection')
      ensure(mutationRequests().length===mutations, 'Opening or cancelling individual launch started public work')
    })
    await check('retargeting the unchanged PR never posts a launch in either review mode', async () => {
      for (const mode of ['Review only', 'Review, fix & merge']) {
        await click(query('[aria-label="Take PR 7 on with an agent"]'))
        await until(() => modeButton(mode,query('.co-pr-confirm')),'Retarget mode did not load')
        if (mode !== 'Review only') await click(modeButton(mode,query('.co-pr-confirm')))
        const launchName=mode==='Review only'?'Start private review':'Allow scoped takeover'
        await until(() => button(launchName) && !button(launchName).disabled,'Retarget preflight did not settle')
        const before=mutationRequests().filter(call=>call.url.endsWith('/review-runs')).length
        window.fixtureRetarget=true
        await click(button(launchName))
        await until(() => text(query('.co-pr-confirm')).includes('changed since this list loaded') || !query('.co-pr-confirm'),'Retarget admission did not settle')
        ensure(mutationRequests().filter(call=>call.url.endsWith('/review-runs')).length===before,'Retargeted '+mode+' posted a launch')
        ensure(text(query('.co-pr-confirm')).includes('changed since this list loaded'),'Retarget did not ask for fresh consent')
        window.fixtureRetarget=false
        await click(button('Cancel',query('.co-pr-confirm')))
      }
    })
    await check('individual PR detail leads with its Conversation description without reading diff', async () => {
      const title=document.querySelectorAll('.co-pr-open')[1]; title.focus(); await click(title)
      await until(() => text(query('.co-pr-detail')).includes('Fixture PR description 8'),'Description did not load')
      ensure(firstCheckbox.checked && secondCheckbox.checked,'Opening detail replaced selection')
      ensure(!calls.requests.some(call => call.url.includes('/files?')),'Diff loaded by default')
      ensure(detailTab('Conversation')?.getAttribute('aria-pressed')==='true' && text(detailTab('Files changed'))==='Files changed1+1−0' && detailTab('Checks'),'Detail tabs absent')
      ensure(query('.co-pr-detail').closest('.co-pr-row') && !query('.co-task-dock'),'Detail escaped its row')
      ensure(mutationRequests().length===0 && navigation.length===inventoryNavigationDepth,'Opening detail changed work or screens')
    })
    await check('last discussion page keeps Previous and restores the prior cursor', async () => {
      await until(() => button('More discussions'),'First discussion page did not load')
      await click(button('More discussions'))
      await until(() => text(query('.co-pr-detail')).includes('last.js'),'Last discussion cursor did not load')
      ensure(!button('More discussions'),'Last page offered a nonexistent next cursor')
      ensure(button('Previous discussions'),'Last page lost Previous discussions')
      await click(button('Previous discussions'))
      await until(() => text(query('.co-pr-detail')).includes('first.js') && button('More discussions'),'Previous cursor did not restore the first discussions')
      ensure(!button('Previous discussions'),'First cursor unexpectedly offered Previous')
    })
    await check('files load on demand and individual review keeps exact one-PR scope', async () => {
      await click(detailTab('Files changed'))
      await until(() => query('.co-file-disclosure'),'Files did not load')
      ensure(!query('.co-file-disclosure').open,'Patch opened by default')
      await click(query('.co-file-disclosure summary'))
      ensure(query('.co-file-disclosure').open && text(query('.co-file-disclosure')).includes('safe change'),'Patch disclosure failed')
      await click(detailTab('Conversation'))
      await until(() => text(query('.co-pr-detail')).includes('Please check this edge case'),'Conversation activity did not load')
      await click(button('Take on with agent',query('.co-pr-detail')))
      await until(() => query('.co-pr-confirm'),'Individual confirmation did not open')
      ensure(text(query('.co-pr-confirm h3'))==='Take on #8 with an agent' && query('.co-pr-confirm').closest('[data-pr-key="owner/project#8"]') && !text(query('.co-pr-confirm')).includes('#7'),'Individual scope changed')
      ensure(modeButton('Review only',query('.co-pr-confirm'))?.getAttribute('aria-pressed')==='true','Private default missing')
      ensure(modeButton('Review, fix & merge',query('.co-pr-confirm')),'Takeover option missing')
      await click(button('Cancel',query('.co-pr-confirm')))
      ensure(mutationRequests().length===0,'Changing individual scope mutated GitHub')
    })
    await check('batch assignment uses one explicit person action and preserves selected PRs', async () => {
      const scrollBefore=query('.co-page').scrollTop
      await click(query('[aria-label="Assign selected PRs to a person"]'))
      await until(() => query('[aria-label="Assign to me"]'),'People did not load')
      ensure(mutationRequests().length === 0,'Opening picker assigned prematurely')
      ensure(document.activeElement === query('.co-person-search'),'People search did not receive focus')
      ensure(query('.co-pr-assignment').getBoundingClientRect().top < innerHeight,'Assignment did not scroll inline controls into view')
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
    await check('two review modes, per-run agent, fingerprint and exact selected scope', async () => {
      await click(query('[aria-label="Take selected PRs on with agent"]'))
      await until(() => button('Start private review') && !button('Start private review').disabled,'Private confirmation did not resolve')
      const region=query('.co-pr-confirm')
      ensure(region.closest('[data-task="task:review"]') && !query('.co-task-dock'),'Review was not inline')
      ensure(text(region).includes('Contribution 7') && text(region).includes('Contribution 8'),'Selected PR titles absent')
      ensure(modeButton('Review only',region).getAttribute('aria-pressed')==='true' && modeButton('Review, fix & merge',region).getAttribute('aria-pressed')!=='true','Private default wrong')
      const autopilot=[...region.querySelectorAll('label')].find(node=>text(node).includes('Continue private review automatically'))?.querySelector('input')
      ensure(autopilot && autopilot.checked,'Review-only autopilot missing/default wrong')
      await click(autopilot); await until(() => !button('Start private review').disabled,'Autopilot change did not resolve')
      const fixtureModel = () => [...region.querySelectorAll('.co-model-row')].find(node => node.querySelector('.co-model-title')?.textContent === 'Fixture model')
      await click(region.querySelector('.co-agent-trigger'),'Agent picker trigger missing')
      await until(fixtureModel,'Model picker did not load')
      await click(fixtureModel()); await until(() => region.querySelector('[role=radio][aria-label=High]'),'Effort picker missing')
      await click(region.querySelector('[role=radio][aria-label=High]')); await until(() => !button('Start private review').disabled,'Model/effort did not resolve')
      ensure(reviewRuns.length===0,'Options counted as approval')
      await click(button('Start private review'))
      await until(() => reviewRuns.length===1 && button('Open review conversation'),'Private review did not start')
      const privateWrite=mutationRequests().at(-1)
      ensure(privateWrite.body.mode==='review' && privateWrite.body.options.autopilot===false,'Private options drifted')
      ensure(privateWrite.body.agent?.model==='fixture-model' && privateWrite.body.agent?.effort==='high','Per-run model/effort not submitted')
      ensure(privateWrite.body.preview_sha256==='f'.repeat(64) && privateWrite.body.items.length===2,'Fingerprint or scope absent')
      ensure(privateWrite.body.items[0].head_sha===HEAD && privateWrite.body.items[1].head_sha===SECOND_HEAD,'Exact heads drifted')
      await inventory(); await click(firstCheckbox); await click(query('[aria-label="Take selected PRs on with agent"]'))
      await until(() => modeButton('Review, fix & merge',query('.co-pr-confirm')),'Takeover choice missing')
      await click(modeButton('Review, fix & merge',query('.co-pr-confirm')))
      await until(() => button('Allow scoped takeover') && !button('Allow scoped takeover').disabled,'Takeover approval did not resolve')
      ensure(!text(query('.co-pr-confirm')).includes('Continue private review automatically'),'Review-only autopilot leaked into takeover')
      ensure(reviewRuns.length===1,'Mode change counted as approval')
      await click(button('Allow scoped takeover'))
      await until(() => reviewRuns.length===2,'Takeover did not start')
      const takeoverWrite=mutationRequests().at(-1)
      ensure(takeoverWrite.body.mode==='review_fix_merge' && takeoverWrite.body.confirmation_scope==='named_pr_repairs_and_reviewed_successors','Takeover continuation scope absent')
      ensure(takeoverWrite.body.options.autopilot===true && takeoverWrite.body.items.length===1 && takeoverWrite.body.items[0].number===7,'Takeover continuation or selected scope wrong')
    })
    await check('draft takeover waits for served support and freezes explicit mark-ready consent', async () => {
      await inventory(); pulls[0].isDraft=true; window.fixtureDraftSupport=false
      await refreshPulls(1,'Draft refresh did not finish')
      await until(()=>text(query('[data-pr="owner/project#7"]')).includes('Draft'),'Draft state did not refresh')
      await click(query('[aria-label="Take PR 7 on with an agent"]'))
      await until(()=>button('Start private review') && !button('Start private review').disabled,'Private draft preflight did not finish')
      ensure(modeButton('Review, fix & merge',query('.co-pr-confirm')).disabled,'Inactive backend advertised draft support')
      await click(button('Cancel',query('.co-pr-confirm')))
      window.fixtureDraftSupport=true
      await click(query('[aria-label="Take PR 7 on with an agent"]'))
      await until(()=>modeButton('Review, fix & merge',query('.co-pr-confirm')) && !modeButton('Review, fix & merge',query('.co-pr-confirm')).disabled,'Draft takeover stayed blocked with support')
      await click(modeButton('Review, fix & merge',query('.co-pr-confirm')))
      await until(()=>button('Allow scoped takeover') && !button('Allow scoped takeover').disabled,'Draft approval did not resolve')
      ensure(text(query('.co-pr-confirm')).includes('drafts marked ready') && text(query('.co-pr-confirm')).includes('independent review and required checks'),'Draft public effects were not disclosed')
      const before=reviewRuns.length
      await click(button('Allow scoped takeover'))
      await until(()=>reviewRuns.length===before+1,'Fixture draft admission did not start')
      const draftWrite=mutationRequests().at(-1)
      ensure(draftWrite.body.confirmation_scope==='named_pr_repairs_ready_and_reviewed_successors','Readiness scope not frozen')
      ensure(draftWrite.body.items.length===1 && draftWrite.body.items[0].number===7 && draftWrite.body.items[0].head_sha===HEAD,'Draft identity changed')
      await inventory(); pulls[0].isDraft=false
      await refreshPulls(1,'Draft reset refresh did not finish')
      await until(()=>!text(query('[data-pr="owner/project#7"]')).includes('Draft'),'Draft fixture did not reset')
    })
    await check('review errors preserve exact selection for explicit retry', async () => {
      const before=reviewRuns.length
      await inventory(); await click(firstCheckbox); await click(query('[aria-label="Take selected PRs on with agent"]'))
      await until(() => button('Start private review') && !button('Start private review').disabled,'Retry confirmation did not resolve')
      window.failReview=true; await click(button('Start private review'))
      await until(() => text(query('.co-pr-confirm')).includes('Fixture review error'),'No workflow error')
      ensure(firstCheckbox.checked && reviewRuns.length===before,'Failed review lost selection or started work')
      window.failReview=false; await click(button('Cancel')); await click(query('[aria-label="Clear selection"]'))
    })
    await check('explicit send joins the same public inventory without implying merge', async () => {
      await inventory(); await click(button('Contribute'))
      await until(() => button('Contribute'),'Publication confirmation missing')
      ensure(calls.publications.length===0,'Opening publication sent work')
      await click(button('Contribute'))
      await until(() => query('input[aria-label="Select owner/project #9"]'),'Published record absent')
      ensure(calls.publications.length===1 && calls.publications[0].plan.head_sha===HEAD,'Publication duplicated or lost reviewed head')
      ensure(query('.co-pr-list')===originalList,'Publication replaced inventory')
      ensure(query('input[aria-label="Select owner/project #9"]').getClientRects().length,'Published PR not selectable')
    })
    await check('full merge cycle starts once with a CAS reservation and restores its owner', async () => {
      const row=[...document.querySelectorAll('.co-work-progress-row')].find(node=>text(node).includes('Full merge cycles'))
      ensure(row,'Full merge cycle entry missing'); await click(row)
      const start=button('Start fresh full merge cycle',query('[data-task="task:cycle"]'))
      await until(() => start && !start.disabled,'Cycle start did not become available')
      start.click(); start.click()
      await until(() => calls.starts.length===1 && button('Open current conversation'),'Cycle did not start once')
      ensure(calls.starts[0].scope?.startsWith('contribute-cycle:') && calls.starts[0].draft?.includes('app:fixture'),'Cycle lost exact project scope')
      const cycleKeys=[...values.keys()].filter(key=>key.includes('cycle'))
      ensure(cycleKeys.length===1 && values.get(cycleKeys[0])?.chat_id==='prepare-1','Synced cycle owner not saved')
      await chooseProject('Other project'); ensure(!button('Open current conversation'),'Other project inherited cycle')
      await chooseProject('Fixture project')
      await until(() => text(query('.co-work-progress-row')).includes('Full merge cycles'),'Cycle row did not restore')
      await click([...document.querySelectorAll('.co-work-progress-row')].find(node=>text(node).includes('Full merge cycles')))
      await until(() => button('Open current conversation'),'Saved cycle owner unavailable')
      ensure(calls.status.includes('prepare-1') && calls.starts.length===1,'Restore restarted work')
    })
    await check('explicit PR focus resolves later-page and closed identities without making closed work selectable', async () => {
      await inventory()
      // Launches also read exact PRs (live preflight), so count only this check's reads.
      const exactReads = () => calls.requests.filter(call=>call.body?.query?.includes('ContributeExactPull')).length
      const exactBefore = exactReads(), searchesBefore = pullSearches()
      window.fixturePaging=true
      window.focusPullFixture({repo:'owner/project',number:8,nonce:'later-page'})
      await until(() => document.querySelector('[data-pr-key="owner/project#8"]')?.classList.contains('is-highlighted'),'Later-page focus did not resolve exact PR')
      ensure(document.querySelector('[data-pr-key="owner/project#8"] .co-pr-open')===document.activeElement,'Later-page focus did not receive keyboard focus')
      window.focusPullFixture({repo:'owner/project',number:11,nonce:'closed'})
      await until(() => document.querySelector('[data-pr-key="owner/project#11"]')?.classList.contains('is-highlighted'),'Closed focus did not resolve exact PR')
      const closed=document.querySelector('[data-pr-key="owner/project#11"]')
      ensure(text(closed).includes('Closed') && closed.querySelector('input[type="checkbox"]')?.disabled,'Closed PR became selectable')
      ensure(!closed.querySelector('[aria-label="Assign PR 11"]'),'Closed PR exposed assignment')
      ensure(exactReads()-exactBefore===2 && pullSearches()===searchesBefore,'Focus scanned open pages instead of exact identities')
      window.fixturePaging=false; window.focusPullFixture(null)
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
      await until(() => button('Allow review & merge') && !button('Allow review & merge').disabled, 'Review link did not reach exact approval')
      ensure(text(query('.co-selection-page')).includes('#7 Contribution 7') && !text(query('.co-selection-page')).includes('#8 Contribution 8'), 'Link did not render exact named scope')
      ensure(calls.requests.some(call => call.body?.query?.includes('ContributeReviewSelection') && call.body.query.includes('pullRequest(number:7)')), 'Link skipped live version preflight')
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
    await check('a cold repository destination opens its deduplicated local project', async () => {
      await inventory()
      const beforeColdStarts = calls.starts.length
      window.focusProjectFixture({key:'external:owner/project',repository:{nameWithOwner:'OWNER/Project'},nonce:'cold-repo-focus'})
      await until(() => text(query('.co-workspace-head h2')).includes('Fixture project'), 'Cold repository focus did not resolve local project')
      await until(() => query('[data-pr-key="owner/project#7"]'), 'Cold destination did not show its PR inventory')
      ensure(calls.starts.length === beforeColdStarts, 'Opening a cold destination started agent work')
    })
    await check('focused block hydration reads only its own record before activation', async () => {
      root.render(null); await frame(); await frame()
      values.clear()
      const exact = {...prepared, id:'focused-record'}
      values.set('contributions/focused-record.json', exact)
      let exactReads = 0, ledgerReads = 0, settingsReads = 0
      const originalVersioned = window.mobius.storage.getWithVersion
      const originalGet = window.mobius.storage.get
      const originalList = window.mobius.storage.listWithStatus
      let focusedAction = null
      let focusedMessage = null
      const focusedStates = []
      // This file:// fixture has no concrete shell origin. Capture only the
      // outbound transport boundary; production attribution checks stay real.
      const originalPost = window.parent.postMessage
      window.parent.postMessage = (message, ...args) => {
        if (message?.type === 'moebius:app-block-state' && message.sessionId === 'focused-fixture') {
          focusedAction = message.actions[0]
          focusedMessage = message
          focusedStates.push(focusedAction.status)
        }
        else originalPost.call(window.parent, message, ...args)
      }
      window.mobius.storage.getWithVersion = async (...args) => { exactReads++; return originalVersioned(...args) }
      window.mobius.storage.get = async (...args) => { settingsReads++; return originalGet(...args) }
      window.mobius.storage.listWithStatus = async () => { ledgerReads++; return {complete:true,entries:[{type:'file',name:exact.id+'.json',content:exact}]} }
      const initialRequests = calls.requests.length
      root.render(<ContributeApp appId="fixture-app" token="fixture-only" blockSession={{sessionId:'focused-fixture',actions:[{key:'chat-send:focused-record',intent:'chat-send:focused-record',label:'Contribute'}]}} />)
      await until(() => exactReads > 0, 'Focused exact read did not resolve')
      await frame(); await frame()
      await until(() => focusedAction?.status === 'Prepared', 'Focused card did not resolve its prepared status')
      ensure(!focusedAction.hidden && !focusedAction.disabled, 'Prepared card hid or disabled the activation control')
      ensure(focusedAction.badges.some(badge => badge.label === 'All clear'), 'Fresh exact review badge was lost')
      ensure(ledgerReads === 0 && settingsReads === 0 && calls.requests.length === initialRequests, 'Focused hydration started workspace, account, or settings reads')
      ensure(!query('.co-root'), 'Focused hydration mounted the workspace')
      window.fullAppFixture = true
      window.fullAppConnected = false
      window.fixtureReviewUnavailable = true
      const priorPublications = calls.publications.length
      window.dispatchEvent(new MessageEvent('message', {source:window.parent,origin:window.location.origin,
        data:{type:'moebius:app-block-action',sessionId:'focused-fixture',event:'activate',key:'chat-send:focused-record',nonce:'focused-first'}}))
      await until(() => ledgerReads > 0, 'Activation did not start the authoritative ledger')
      await until(() => focusedAction?.label === 'Retry check', 'Unavailable review did not expose retry')
      ensure(focusedAction.status === 'Check unavailable' && focusedAction.note.includes('Could not verify'), 'Standalone unavailable review lost its explanation')
      ensure(!focusedStates.slice(focusedStates.indexOf('Prepared') + 1).includes('Loading'), 'Activation remounted and reset the focused session')
      ensure(calls.publications.length === priorPublications, 'Activation published without confirmation')
      window.fixtureReviewUnavailable = false
      window.fixtureInlineReviewReady = true
      window.dispatchEvent(new MessageEvent('message', {source:window.parent,origin:window.location.origin,
        data:{type:'moebius:app-block-action',sessionId:'focused-fixture',event:'activate',key:'chat-send:focused-record',nonce:'focused-retry'}}))
      await until(() => focusedAction?.confirming, 'Retry did not recover to a fresh confirmation')
      ensure(calls.publications.length === priorPublications, 'Retry sent without frozen confirmation')
      ensure(focusedMessage.ackNonce === 'focused-retry' && focusedMessage.retain === true, 'Confirmation lost its event acknowledgement or retained owner')
      ensure(focusedAction.confirmation[0].facts.some(fact => fact.label === 'Repository' && fact.value === exact.plan.repo), 'Confirmation omitted its current repository')
      window.fixtureInlineReviewReady = false
      window.mobius.storage.getWithVersion = originalVersioned
      window.mobius.storage.get = originalGet
      window.mobius.storage.listWithStatus = originalList
      window.parent.postMessage = originalPost
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
      await until(() => query('.co-settings summary')?.getAttribute('aria-label')?.includes('reconnected-owner'), 'Foreground did not display the new account')
      const returning = calls.requests.slice(previous)
      ensure(returning.filter(call => call.url === '/api/github/status').length === 1, 'Foreground checked the account more than once')
      const overlays = returning.filter(call => call.url === '/api/github/graphql' && call.body.query.includes('resource(url:'))
      ensure(overlays.length === 1, 'Expected one foreground live-feed query, got ' + overlays.length)
      await until(() => values.get('feed-cache.json')?.records?.[0]?.status === 'merged', 'Foreground live state was not reconciled and cached')
      ensure(ledgerReads === 2, 'Foreground did not own exactly one fresh ledger scan')
      ensure(returning.every(call => call.method === 'GET' || call.url === '/api/github/graphql'), 'Foreground mutated public work')
    })
    await check('settings leads with the GitHub account then matching prompt heading and a precise destination', async () => {
      await click(query('.co-settings summary'))
      await until(()=>query('.co-prompt-settings textarea'), 'Prompt editor did not settle')
      const panel=query('.co-settings-panel'), headings=[...panel.querySelectorAll('h3')]
      ensure(headings.map(h=>text(h)).join('|')==='GitHub account|Agent prompts', 'Settings section order or headings differ')
      ensure(getComputedStyle(headings[0]).fontSize===getComputedStyle(headings[1]).fontSize, 'Settings headings use different sizes')
      ensure(button('GitHub account settings',panel) && !text(panel).includes('Manage in Settings'), 'Settings destination is ambiguous')
      await click(button('Done',panel))
    })
    await check('cold record links open before a slow ledger and source discovery, with projects navigation intact', async () => {
      root.render(null); await frame(); await frame()
      values.clear()
      window.fullAppConnected = false
      window.deferSourceDiscovery = true
      const exact = {...prepared, id:'cold-record', title:'Cold reviewed proposal',
        plan:{...prepared.plan,title:'Cold reviewed proposal',base_branch:'main'}, updated_at:'2026-10-06T12:00:00Z'}
      values.set('contributions/cold-record.json', exact)
      const originalGet = window.mobius.storage.get
      window.mobius.storage.get = async key => key === 'feed-cache.json'
        ? new Promise(resolve => { window.releaseColdCache = () => resolve({records:[{...exact,title:'Old cached title',plan:{...exact.plan,title:'Old cached title'}}]}) })
        : originalGet(key)
      let ledgerSettled = false
      window.mobius.storage.listWithStatus = async () => new Promise(resolve => {
        window.releaseColdLedger = () => { ledgerSettled = true; resolve({complete:true,entries:[
          {type:'file',name:exact.id+'.json',content:{...exact,title:'Stale scan title',plan:{...exact.plan,title:'Stale scan title'}}},
          ...Array.from({length:1900},(_,i)=>({type:'file',name:'history-'+i+'.json',content:{id:'history-'+i,type:'pr',status:'closed',repo:'owner/project',title:'History '+i}})),
        ]}) }
      })
      root.render(<ContributeApp appId="fixture-app" token="fixture-only" />)
      await until(() => window.releaseColdCache && window.releaseSourceDiscovery && window.releaseColdLedger, 'Cold reads did not start')
      const hostIntent = (intent, nonce, source = window.parent) => window.dispatchEvent(new MessageEvent('message', {
        source, origin:window.location.origin, data:{type:'moebius:app-intent',intent,nonce},
      }))
      hostIntent('review:cold-record','untrusted',null)
      await frame(); await frame()
      ensure(!query('.co-run-focus-detail'), 'A non-parent sender opened a record')
      hostIntent('review:cold-record','cold-review')
      await until(() => text(query('.co-run-focus-detail')).includes('Cold reviewed proposal'), 'Exact record stayed behind slow startup reads')
      ensure(!ledgerSettled, 'Cold focus waited for the history scan')
      ensure(query('.co-header-shell') && query('[aria-label="Back to projects"]'), 'Cold detail lost its full-app header or projects action')
      window.releaseColdCache()
      await frame(); await frame()
      ensure(text(query('.co-run-focus-detail')).includes('Cold reviewed proposal'), 'Late cache erased the exact record')
      window.deferSourceDiscovery = false
      window.releaseSourceDiscovery({apps:[{...projects[0],key:'app:cold',name:'Cold installed project',state:'aligned'}],platform:null})
      await until(() => text(query('.co-workspace-head h2')) === 'Cold installed project', 'Provisional repository did not resolve into the installed project')
      ensure(text(query('.co-run-focus-detail')).includes('Cold reviewed proposal'), 'Project reconciliation closed record detail')
      window.releaseColdLedger()
      await until(() => values.get('feed-cache.json')?.records?.some(record=>record.id==='cold-record'), 'Cold ledger did not settle')
      ensure(text(query('.co-run-focus-detail')).includes('Cold reviewed proposal'), 'Slow scan overwrote the exact read')
      const changedPhase = {...exact, updated_at:'2026-10-06T12:01:00Z', quality_review:{state:'needed'}}
      values.set('contributions/cold-record.json',changedPhase)
      window.mobius.storage.listWithStatus = async () => ({complete:true,entries:[{type:'file',name:'cold-record.json',content:changedPhase}]})
      window.postMessage({type:'moebius:frame-visibility',visible:true}, '*')
      await until(() => values.get('feed-cache.json')?.records?.[0]?.quality_review?.state === 'needed', 'Changed phase did not refresh')
      await frame(); await frame()
      ensure(text(query('.co-run-focus-detail')).includes('Cold reviewed proposal') && !text(query('.co-run-focus-detail')).includes('This contribution moved'), 'A review phase change lost the exact selected record')
      await click(query('[aria-label="Back to projects"]'))
      await until(() => text(query('.co-view-heading')).includes('Your projects'), 'Full detail could not return to all projects')
      await click([...document.querySelectorAll('.co-source-row')].find(node=>text(node.querySelector('strong'))==='Cold installed project'))
      await until(() => query('.co-workspace-head') && query('[aria-label="Back to projects"]'), 'Entering a project hid the toolbar')
      hostIntent('chat-prepared:cold-record','legacy-review')
      await until(() => text(query('.co-run-focus-detail')).includes('Cold reviewed proposal'), 'Legacy title did not open the normal record workspace')
      ensure(query('.co-header-shell') && !query('.co-inline-view'), 'Legacy title entered a headerless embedded view')
      values.set('contributions/cold-record.json',exact)
      hostIntent('chat-send:cold-record','inline-confirm')
      await until(() => query('.co-inline-confirm'), 'chat-send no longer opens its confirmation')
      ensure(!query('.co-header-shell'), 'chat-send must retain its embedded headerless layout')
      window.mobius.storage.get = originalGet
    })
    await check('reopening inline detail uses cached metadata', async () => {
      ensure(!detailReread, 'Reopen needlessly reread cached detail')
    })
    root.unmount()
    if (window.inlineCanonicalHost) checks.push(...await runInlineCanonicalFailureChecks())
    const upperChecks = await runUpperUiStatusChecks()
    checks.push(...upperChecks)
    ensure(upperChecks.every(check => check.status === 'pass'), 'Upper UI status regressions: ' + JSON.stringify(upperChecks.filter(check => check.status !== 'pass')))
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)) }, method === 'Runtime.evaluate' ? 180000 : 45000)
      pending.set(id, { resolve, reject, timer })
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  } }
}

async function main() {
  if (!frontendModules) throw new Error('MOBIUS_FRONTEND_NODE_MODULES is required')
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  const hostRoot = process.env.MOBIUS_APP_BLOCK_HOST_ROOT
  let hostLeaf = 'export const PullSnapshot = null; export const hostCSS = "";'
  if (hostRoot) {
    const source = await readFile(join(hostRoot, 'frontend/src/components/ChatView/markdown/AppBlock.jsx'), 'utf8')
    const css = await readFile(join(hostRoot, 'frontend/src/components/ChatView/markdown/AppBlock.css'), 'utf8')
    hostLeaf = "import React from 'react'; import { Branch } from '@openai/apps-sdk-ui/components/Icon';\n"
      + source.slice(source.indexOf('const STATE_NAMES'), source.indexOf('/** Reuse the opaque app host'))
      + '\nexport const hostCSS = ' + JSON.stringify(css) + ';'
  }
  const build = await rolldown({ input: ENTRY, platform: 'browser', tsconfig: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [{ name: 'workspace-browser-fixture',
      resolveId(id, importer) { if (id === '@fixture/inline-shell') return '\0inline-shell'; if (id === ENTRY) return id; if (importer === ENTRY && id.startsWith('.')) return join(root, id) },
      load(id) { if (id === '\0inline-shell') return { code: hostLeaf, moduleType: 'jsx' }; if (id === ENTRY) return { code: 'window.inlineCanonicalHost = ' + Boolean(hostRoot) + ';\n' + fixture, moduleType: 'jsx' } },
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
