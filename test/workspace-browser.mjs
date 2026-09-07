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
    const found = call.body.query.includes('repo:owner/other') ? [] : pulls
    return response({ data: { search: { nodes: found, issueCount: found.length,
      pageInfo: { hasNextPage: false, endCursor: null } } } })
  }
  if (call.url === '/api/github/contributions/fixture-app/review-runs') {
    if (call.method === 'GET') return response({ runs: reviewRuns })
    if (call.method !== 'POST') return forbidden('unexpected review method')(call.method)
    const run = { id: 'review-' + (reviewRuns.length + 1), chat_id: 'review-chat-fixture',
      mode: call.body.mode, state: 'reviewing', items: call.body.items.map(item => ({ ...item, state: 'reviewing' })) }
    reviewRuns.unshift(run)
    return response({ run })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/assignees?') && call.method === 'GET') {
    return response({ assignees: [{ login: 'owner' }, { login: 'teammate' }], can_assign: true })
  }
  if (call.url === '/api/github/contributions/fixture-app/assign-review' && call.method === 'POST') {
    const selected = pulls.find(pr => pr.number === call.body.number)
    selected.assignees.nodes.push({ login: call.body.assignee })
    return response({ ok: true })
  }
  if (call.url.startsWith('/api/github/contributions/fixture-app/source-chats?') && call.method === 'GET') return response({ chats: [] })
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
    <SourceMap projects={projects} snapshot={{ generated_at: 'fixture' }} conn={{ state: 'connected', login: 'owner' }}
      onRetry={forbidden('unexpected source refresh')}
      renderControls={project => project ? <ProjectControls appId="fixture-app" token="fixture-only" project={project}
        run={runFor(project)} mergeRun={runFor(project)} onStart={start} /> : null}
      renderActivity={(project, navigation) => project ? <ContributionRun run={runFor(project)}
        githubState="connected" publicationPreference="github" reviewStatus={{ byId: {} }}
        selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack} onSend={send}
        renderPublicWork={() => <PullRequests appId="fixture-app" token="fixture-only" project={project}
          conn={{ state: 'connected', login: 'owner' }} records={records.filter(record => record.repo === project.canonical_repo)} />}
      /> : null} />
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
  window.finishNativeSpace = error => error ? reject(new Error(error)) : resolve()
  window.workspaceNativeSpace('Space')
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
async function inventory() {
  if (query('.co-workspace.has-task')) {
    await click(query('.co-task-back'))
    await until(() => !query('.co-workspace.has-task'), 'Back did not restore project inventory')
  }
}
async function chooseProject(name) {
  await inventory()
  const rail = [...document.querySelectorAll('.co-rail-project')].find(node => text(node.querySelector('strong')) === name)
  if (rail?.getClientRects().length) { await click(rail); return }
  await click(button('All projects'))
  await until(() => query('.co-source-row'), 'Project list did not return')
  await click([...document.querySelectorAll('.co-source-row')].find(node => text(node.querySelector('strong')) === name))
}
window.runWorkspaceChecks = async () => {
  const checks = []
  async function check(name, run) { await run(); checks.push({ name, status: 'pass' }) }
  try {
    await until(() => query('.co-source-row'), 'Project list did not render')
    await check('project opens inventory and contextual task without starting work', async () => {
      await click(query('.co-source-row'))
      await until(() => document.querySelectorAll('.co-pr-row').length === 2 && !button('Prepare changes')?.disabled, 'Project did not settle')
      ensure(query('.co-workspace-inventory') && query('.co-task-outlet h3'), 'Missing inventory or task outlet')
      ensure(calls.starts.length === 0 && mutationRequests().length === 0, 'Opening project started work')
    })
    const originalInventory = query('.co-workspace-inventory'), originalList = query('.co-pr-list'), originalRow = query('.co-pr-row')
    const inventoryNavigationDepth = navigation.length
    const firstCheckbox = query('input[aria-label="Select owner/project #7"]')
    const secondCheckbox = query('input[aria-label="Select owner/project #8"]')
    function selectionStaysInInventory(focused) {
      ensure(navigation.length === inventoryNavigationDepth && !query('.co-workspace.has-task'), 'Checkbox selection opened task navigation')
      ensure(firstCheckbox.getClientRects().length && secondCheckbox.getClientRects().length, 'Batch selection hid remaining checkboxes')
      ensure(document.activeElement === focused, 'Selection stole keyboard focus')
      ensure(query('.co-workspace-inventory') === originalInventory && query('.co-pr-row') === originalRow, 'Selection remounted inventory')
      ensure(mutationRequests().length === 0, 'Selection mutated GitHub or started review')
    }
    await check('several checkbox selections and deselections keep inventory, navigation and focus in place', async () => {
      for (const [checkbox, firstSelected, secondSelected] of [
        [firstCheckbox, true, false], [secondCheckbox, true, true],
        [firstCheckbox, false, true], [firstCheckbox, true, true],
      ]) {
        checkbox.focus()
        await click(checkbox)
        ensure(firstCheckbox.checked === firstSelected && secondCheckbox.checked === secondSelected, 'Batch selection changed an unrelated PR')
        ensure(text(batchAction()).includes((Number(firstSelected) + Number(secondSelected)) + ' selected'), 'Selected count did not follow batch')
        selectionStaysInInventory(checkbox)
      }
    })
    await check('native keyboard Space selects and deselects without leaving the batch inventory', async () => {
      const keyboardEvents = []
      const capture = event => keyboardEvents.push({ code: event.code, trusted: event.isTrusted })
      secondCheckbox.addEventListener('keydown', capture)
      secondCheckbox.focus()
      for (const selected of [false, true]) {
        await nativeSpace()
        await until(() => secondCheckbox.checked === selected, 'Native Space did not toggle the focused checkbox')
        ensure(firstCheckbox.checked, 'Native Space changed another selection')
        selectionStaysInInventory(secondCheckbox)
      }
      secondCheckbox.removeEventListener('keydown', capture)
      ensure(keyboardEvents.length === 2 && keyboardEvents.every(event => event.trusted && event.code === 'Space'), 'Keyboard test did not receive native trusted Space events')
    })
    await check('Review or assign explicitly opens the selected batch without starting work', async () => {
      await click(batchAction())
      await until(() => button('Review selected'), 'Explicit batch action did not open its task')
      ensure(text(query('.co-task-outlet')).includes('Review 2 contributions'), 'Batch action dropped selected PRs')
      ensure(text(query('.co-task-outlet')).includes('Contribution 7') && text(query('.co-task-outlet')).includes('Contribution 8'), 'Batch task omitted a selected contribution')
      ensure(mutationRequests().length === 0 && calls.starts.length === 0, 'Opening batch started work')
    })
    await check('own already-assigned PR row remains reviewable without changing assignment', async () => {
      await inventory()
      await click(document.querySelectorAll('.co-pr-open')[1])
      await until(() => text(query('.co-task-outlet')).includes('Contribution 8'), 'Row did not select its PR')
      ensure(query('input[aria-label="Select owner/project #8"]').checked, 'Own assigned PR was not selected')
      ensure(!query('input[aria-label="Select owner/project #7"]').checked, 'Row selection kept an unrelated PR')
      ensure(mutationRequests().length === 0, 'Selecting assigned work mutated it')
    })
    await check('review and merge option enumerate exact versions and stay inert until confirmation', async () => {
      await click(button('Review selected'))
      await until(() => query('[aria-label="Confirm review workflow"]'), 'No exact review confirmation')
      const confirm = query('.co-pr-confirm')
      ensure(text(confirm).includes('owner/project #8') && text(confirm).includes('ccccccc → main (bbbbbbb)'), 'Confirmation omitted exact head/base')
      const merge = confirm.querySelector('input[type="checkbox"]')
      ensure(merge && !merge.checked, 'Own PR merge option missing or enabled by default')
      await click(merge)
      ensure(button('Allow review & merge') && mutationRequests().length === 0, 'Mode toggle granted authority early')
      await click(button('Allow review & merge'))
      await until(() => button('Open review conversation'), 'Review progress did not replace confirmation')
      const writes = mutationRequests()
      ensure(writes.length === 1 && writes[0].method === 'POST' && writes[0].url.endsWith('/review-runs'), 'Review invoked unexpected mutations')
      ensure(writes[0].body.mode === 'review_merge' && writes[0].body.request_id, 'Review grant missing mode/request identity')
      ensure(JSON.stringify(writes[0].body.items) === JSON.stringify([{ repo: 'owner/project', number: 8,
        head_sha: SECOND_HEAD, base_ref: 'main', base_sha: BASE }]), 'Review request changed selected version')
      ensure(query('.co-pr-list') === originalList && query('.co-workspace-inventory') === originalInventory, 'Confirmation remounted public inventory')
    })
    await check('assignment requires its own explicit confirmation and never starts another review', async () => {
      await inventory()
      await click(query('input[aria-label="Select owner/project #7"]'))
      await click(batchAction())
      await click(button('Assign to someone'))
      await until(() => button('Choose me'), 'Assignee choices did not load')
      ensure(mutationRequests().length === 1, 'Opening assignment mutated prematurely')
      await click(button('Choose me'))
      ensure(mutationRequests().length === 1, 'Choosing a person assigned prematurely')
      await click(button('Assign on GitHub'))
      await until(() => mutationRequests().length === 2 && button('Review selected'), 'Assignment did not settle')
      const assigned = mutationRequests()[1]
      ensure(assigned.method === 'POST' && assigned.url.endsWith('/assign-review') && assigned.body.number === 7 && assigned.body.expected_head_sha === HEAD && assigned.body.assignee === 'owner', 'Assignment did not pin its own exact request')
      ensure(reviewRuns.length === 1 && calls.starts.length === 0, 'Assignment started an agent or extra review')
    })
    await check('explicit send updates the record and joins the same public review inventory', async () => {
      await inventory()
      await click(button('Review and send'))
      await until(() => button('Send to GitHub'), 'Publication confirmation missing')
      ensure(calls.publications.length === 0, 'Opening publication sent work')
      await click(button('Send to GitHub'))
      await until(() => query('input[aria-label="Select owner/project #9"]'), 'Sent record never joined the public inventory')
      ensure(calls.publications.length === 1 && calls.publications[0].plan.head_sha === HEAD, 'Publication duplicated or lost reviewed head')
      ensure(query('.co-pr-list') === originalList && query('.co-workspace-inventory') === originalInventory, 'Publication replaced the project inventory')
      await until(() => button('Review public contributions'), 'Completed publication left an empty task')
      ensure(text(query('.co-task-outlet')).includes('Publication status'), 'Completed publication has no outcome')
      await click(button('Review public contributions'))
      await until(() => query('input[aria-label="Select owner/project #9"]')?.getClientRects().length,
        'Review public contributions did not return a visible PR selector')
      ensure(text(query('.co-pr-list')).includes('Reviewed local change'), 'Published work has no public review row')
      await click(query('input[aria-label="Select owner/project #9"]'))
      await click(batchAction())
      await until(() => button('Review selected') && text(query('.co-task-outlet')).includes('Reviewed local change'),
        'Published contribution did not join the review workflow')
      await inventory()
    })
    await check('preparation starts one scoped task and a different project does not inherit its progress', async () => {
      await click(button('Prepare', query('.co-local-work')))
      await until(() => button('Prepare changes') && !button('Prepare changes').disabled, 'Preparation did not become available')
      const prepareButton = button('Prepare changes')
      prepareButton.click(); prepareButton.click()
      await until(() => button('Open conversation'), 'Preparation progress did not appear')
      ensure(calls.starts.length === 1, 'Repeated click started duplicate work')
      ensure(calls.starts[0].draft.includes('app:fixture') && !calls.starts[0].draft.includes('owner/other'), 'Preparation escaped project scope')
      await chooseProject('Other project')
      await until(() => text(query('.co-workspace-title')).includes('Other project') && button('Prepare changes') && !button('Prepare changes').disabled, 'Other project did not restore independently')
      ensure(!button('Open conversation') && calls.starts.length === 1, 'Other project inherited active progress')
      await chooseProject('Fixture project')
      await until(() => button('Open conversation'), 'Original project lost its durable conversation')
      ensure(calls.status.includes('prepare-1') && calls.starts.length === 1, 'Restoring progress restarted work')
    })
    await check('host Back returns from the phone task to its inventory, then the project list', async () => {
      await inventory()
      await click(query('.co-pr-open'))
      await until(() => query('.co-workspace.has-task'), 'Task did not own navigation')
      window.mobius.nav.back()
      await until(() => query('.co-workspace') && !query('.co-workspace.has-task'), 'Task Back lost project context')
      ensure(query('.co-workspace-inventory').getClientRects().length, 'Back left the inventory hidden')
      window.mobius.nav.back()
      await until(() => !query('.co-workspace') && document.querySelectorAll('.co-source-row').length === 2, 'Project Back did not restore the project list')
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
        if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceNativeSpace') return
        void (async () => {
          let error = ''
          try {
            if (event.params.payload !== 'Space') throw new Error('Unknown native input request')
            for (const type of ['keyDown', 'keyUp']) await protocol.send('Input.dispatchKeyEvent', {
              type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32,
            }, sessionId)
          } catch (failure) { error = failure.message }
          await protocol.send('Runtime.evaluate', { expression: `window.finishNativeSpace(${JSON.stringify(error)})` }, sessionId)
        })().catch(error => inputErrors.push(error.message))
      })
      await protocol.send('Runtime.enable', {}, sessionId)
      await protocol.send('Runtime.addBinding', { name: 'workspaceNativeSpace' }, sessionId)
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
      browser.kill('SIGTERM')
      await new Promise(resolve => {
        const timer = setTimeout(() => { browser.kill('SIGKILL'); resolve() }, 3000)
        browser.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'fail', error: error.stack })); process.exitCode = 1 })
