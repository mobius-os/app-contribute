// Native-browser regressions for read-only focus and execution projections.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PullRequests } from '../ui/PullRequests.jsx'
import { InlinePullView } from '../ui/InlinePullView.jsx'
import { TaskContext } from '../ui/TaskPane.jsx'

export async function runUpperUiStatusChecks() {
  const originalFetch = window.fetch
  const host = document.createElement('div')
  host.className = 'co-root co-page co-workspace'
  document.body.append(host)
  const root = createRoot(host), checks = [], calls = []
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const ensure = (ok, message) => { if (!ok) throw Error(message) }
  const until = async predicate => {
    const end = Date.now() + 5000
    while (!predicate()) { if (Date.now() > end) throw Error('Timeout: ' + host.innerText); await frame() }
    await frame()
  }
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  const pull = (number = 7, extra = {}) => ({ number, title: 'Initial title', state: 'OPEN', isDraft: false,
    headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRef: { target: { oid: 'b'.repeat(40) } },
    baseRefName: 'main', repository: { nameWithOwner: 'team/repo', viewerPermission: 'WRITE' },
    author: { login: 'fixture' }, assignees: { nodes: [] }, comments: { totalCount: 0 }, labels: { nodes: [] }, ...extra })
  const page = pulls => ({ data: { search: { nodes: pulls, issueCount: pulls.length, pageInfo: { hasNextPage: false, endCursor: null } } } })
  const exact = pr => ({ data: { repository: { pullRequest: pr } } })
  const response = value => new Response(JSON.stringify(value))
  let search = async () => page([pull()]), focus = async () => exact(pull()), runs = []
  window.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method: init.method || 'GET', body })
    if (String(url).endsWith('/review-runs') && !init.body) return response({ runs })
    // Observation only reconciles saved receipts; no Stop, resume or public action.
    if (String(url).endsWith('/observe')) return response({ runs })
    if (String(url) === '/api/github/graphql' && !/mutation\b/i.test(body?.query || '')) {
      if (body.query.includes('ContributeExactPull')) return response(await focus(body.query))
      if (body.query.includes('ContributePullRequests')) return response(await search(body.query))
    }
    throw Error('Forbidden upper UI fixture transport: ' + url)
  }
  let refresh, setFocus, setProject, setTask
  const project = { key: 'fixture', canonical_repo: 'team/repo', name: 'Fixture', kind: 'external' }
  function App() {
    const [refreshKey, changeRefresh] = useState(0), [focusPull, changeFocus] = useState({ repo: 'team/repo', number: 7, nonce: 'initial' })
    const [currentProject, changeProject] = useState(project), [activeId, changeTask] = useState('')
    refresh = () => changeRefresh(value => value + 1); setFocus = changeFocus; setProject = changeProject; setTask = changeTask
    const task = { activeId, setPublicKeys() {}, open: changeTask, close: () => changeTask('') }
    return <TaskContext.Provider value={task}><PullRequests key={currentProject.key} appId="fixture" token="mock"
      project={currentProject} conn={{ state: 'connected', login: 'fixture' }} focusPull={focusPull} refreshKey={refreshKey} /></TaskContext.Provider>
  }
  const row = number => host.querySelector(`[data-pr-key="team/repo#${number}"]`)
  const title = number => row(number)?.querySelector('.co-pr-title')?.textContent
  const select = number => row(number).querySelector('input').click()
  const runCheck = async (name, test) => {
    try { await test(); checks.push({ name, status: 'pass' }) }
    catch (error) { checks.push({ name, status: 'fail', error: error.stack }) }
  }
  try {
    await runCheck('canonical focus refresh updates title and selected version; failed and delayed reads do not replace it', async () => {
      root.render(<App />)
      await until(() => title(7) === 'Initial title' && calls.some(call => call.body?.query?.includes('ContributeExactPull')))
      select(7); await until(() => row(7).querySelector('input').checked)
      const next = pull(7, { title: 'Current canonical title', headRefOid: 'c'.repeat(40) })
      runs = [{ id: 'current-head', state: 'complete', mode: 'review', items: [{ repo: 'team/repo', number: 7, head_sha: next.headRefOid, base_ref: 'main', base_sha: next.baseRef.target.oid, state: 'all_clear' }] }]
      search = async () => page([next]); refresh()
      await until(() => title(7) === next.title)
      ensure(!row(7).querySelector('input').checked, 'Changed head retained old selection')
      ensure(row(7).querySelector('.co-pr-agent-state')?.textContent.includes('Review clear'), 'Run matching did not receive the refreshed head')
      ensure(host.innerText.includes('Select its current version again'), 'Head drift was not explained')
      // Selection is restored only by choosing the current row again.
      select(7); await frame()
      search = async () => { throw Error('fixture refresh unavailable') }; refresh()
      await until(() => host.querySelector('.co-alert[role=alert]'))
      ensure(title(7) === next.title && row(7).querySelector('input').checked, 'Failed refresh lost canonical data or selection')
      const delayed = deferred(); search = () => delayed.promise; refresh(); await frame()
      const newest = pull(7, { title: 'Newest canonical title', headRefOid: 'd'.repeat(40) })
      search = async () => page([newest]); refresh(); await until(() => title(7) === newest.title)
      delayed.resolve(page([pull(7, { title: 'Late stale refresh' })])); await frame()
      ensure(title(7) === newest.title, 'Late discovery response won over the latest refresh')
      ensure(!row(7).querySelector('input').checked, 'Latest drift retained selection')
      select(7); await frame()
      search = async () => page([{ ...newest, title: 'Title-only refresh' }]); refresh()
      await until(() => title(7) === 'Title-only refresh')
      ensure(row(7).querySelector('input').checked, 'Title-only refresh discarded unchanged selected version')
    })
    await runCheck('missing first-page focus remains available; nonce and project changes reject stale exact reads', async () => {
      // Remount to give this failure-path test independent data and selection.
      root.render(null); await frame()
      search = async () => page([]); focus = async () => exact(pull())
      root.render(<App />); await until(() => title(7) === 'Initial title')
      ensure(row(7).classList.contains('is-highlighted'), 'Exact missing-page fallback was not highlighted')
      const old = deferred(); focus = () => old.promise
      setFocus({ repo: 'team/repo', number: 7, nonce: 'old' }); await frame()
      focus = async () => exact(pull(7, { title: 'New nonce focus' }))
      setFocus({ repo: 'team/repo', number: 7, nonce: 'new' }); await until(() => title(7) === 'New nonce focus')
      old.resolve(exact(pull(7, { title: 'Late old nonce' }))); await frame()
      ensure(title(7) === 'New nonce focus', 'Old nonce replaced focus')
      const delayed = deferred(); focus = () => delayed.promise
      setFocus({ repo: 'team/repo', number: 7, nonce: 'project-leaving' }); await frame()
      setProject({ ...project, key: 'other', canonical_repo: 'team/other' }); await frame()
      delayed.resolve(exact(pull(7, { title: 'Wrong project focus' }))); await frame()
      ensure(!row(7), 'Exact focus leaked into another project')
    })
    await runCheck('canonical inventory order is stable when focus names a later row', async () => {
      root.render(null); await frame(); runs = []
      search = async () => page([pull(), pull(8, { title: 'Second row' })])
      focus = async () => exact(pull())
      root.render(<App />); await until(() => row(8))
      focus = async () => exact(pull(8, { title: 'Exact second-row snapshot' }))
      setFocus({ repo: 'team/repo', number: 8, nonce: 'second-row' }); await frame()
      ensure([...host.querySelectorAll('[data-pr-key]')].map(node => node.dataset.prKey).join('|') === 'team/repo#7|team/repo#8', 'Focus reordered the canonical list')
      ensure(title(8) === 'Second row', 'Focus replaced the canonical second row')
    })
    await runCheck('late initial focus cannot override an already refreshed canonical row', async () => {
      root.render(null); await frame()
      const delayed = deferred(); focus = () => delayed.promise
      search = async () => page([pull()]); root.render(<App />); await until(() => row(7))
      const current = pull(7, { title: 'Refreshed before exact', headRefOid: 'e'.repeat(40) })
      search = async () => page([current]); refresh(); await until(() => title(7) === current.title)
      delayed.resolve(exact(pull())); await frame()
      ensure(title(7) === current.title, 'Late focus snapshot replaced canonical row')
    })
    for (const execution_state of ['stopped', 'failed', 'interrupted', 'awaiting_owner']) {
      await runCheck('inline and project preserve saved item facts with execution ' + execution_state, async () => {
        root.render(null); await frame(); search = async () => page([pull()]); focus = async () => exact(pull())
        const label = { stopped: 'Stopped', failed: 'Failed', interrupted: 'Interrupted', awaiting_owner: 'Waiting for your answer' }[execution_state]
        const states = ['reviewing', 'repairing', 'merging', 'all_clear', 'merged', 'queued', 'complete']
        const run = { id: execution_state, mode: 'review_fix_merge', state: 'reviewing', execution_state, chat_id: 'fixture-chat',
          items: states.map((state, index) => ({ repo: 'team/repo', number: index + 7, state, head_sha: 'a'.repeat(40), base_ref: 'main', base_sha: 'b'.repeat(40), summary: 'Saved evidence for ' + state, tests: 'Saved test evidence' })) }
        runs = [run]
        root.render(<InlinePullView appId="fixture" token="mock" records={[]} target={{ kind: 'run', id: run.id, embedded: true }} />)
        await until(() => host.innerText.includes('Open owning conversation'))
        ensure(host.querySelector('h2 + p')?.textContent === label, 'Inline aggregate ignored ' + execution_state)
        const items = [...host.querySelectorAll('article strong')].map(node => node.textContent.split(' · ').at(-1))
        const expected = ['stopped', 'failed', 'interrupted'].includes(execution_state)
          ? ['Not finished', 'Not finished', 'Not finished', 'Review clear', 'Merged', 'In merge queue', 'Complete']
          : ['Reviewing', 'Fixing review findings', 'Merging', 'Review clear', 'Merged', 'In merge queue', 'Complete']
        ensure(states.every(state => host.innerText.includes('Saved evidence for ' + state)) && host.innerText.includes('Saved test evidence'), 'Inline discarded saved findings or tests')
        ensure(items.join('|') === expected.join('|'), 'Inline item facts differ for ' + execution_state + ': ' + items)
        root.render(<App />); await until(() => setTask && host.querySelector('.co-pr-box'))
        ensure(row(7).querySelector('.co-pr-agent-state')?.textContent.includes(execution_state === 'awaiting_owner' ? 'Needs you' : 'Run stopped'), 'Project row ignored execution ' + execution_state)
        setTask('task:run:' + run.id); await until(() => host.querySelector('.co-task-content h3'))
        const pane = host.querySelector('.co-task-content')
        ensure(pane.querySelector('h3 + p')?.textContent === label, 'Project aggregate differs for ' + execution_state)
        const projectItems = [...pane.querySelectorAll('.co-task-pulls strong')].map(node => node.textContent.split(' · ').at(-1))
        ensure(states.every(state => pane.innerText.includes('Saved evidence for ' + state)), 'Project discarded saved findings')
        ensure(projectItems.join('|') === expected.join('|'), 'Project item facts differ for ' + execution_state)
        root.render(null); await frame()
      })
    }
    await runCheck('upper UI reads attempt no public or execution transport', async () => {
      ensure(calls.every(call => call.method === 'GET' || call.url.endsWith('/observe') || (call.url === '/api/github/graphql' && !/mutation\b/i.test(call.body?.query || ''))), 'Mutating transport attempted')
    })
    return checks
  } finally { root.unmount(); host.remove(); window.fetch = originalFetch }
}
