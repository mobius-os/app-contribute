// Native-browser regressions for focus, execution and mocked assignment acknowledgements.
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
  let search = async () => page([pull()]), focus = async () => exact(pull()), runs = [], assignmentResponse = async () => ({ ok: true })
  window.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url: String(url), method: init.method || 'GET', body })
    if (String(url).includes('/assignees?')) return response({ assignees: [{ login: 'fixture' }, { login: 'peer' }], can_assign: true })
    // A narrow local acknowledgement mock, never a real GitHub write.
    if (String(url).endsWith('/assign-review') && init.method === 'POST') return response(await assignmentResponse(body))
    if (String(url).endsWith('/review-runs') && !init.body) return response({ runs })
    // Observation only reconciles saved receipts; no Stop, resume or public action.
    if (String(url).endsWith('/observe')) return response({ runs })
    if (String(url) === '/api/github/graphql' && !/mutation\b/i.test(body?.query || '')) {
      if (body.query.includes('ContributeExactPull')) return response(await focus(body.query))
      if (body.query.includes('ContributePullRequests')) return response(await search(body.query))
    }
    throw Error('Forbidden upper UI fixture transport: ' + url)
  }
  let refresh, setFocus, setProject, setTask, setConnection, changeSignals = 0
  const project = { key: 'fixture', canonical_repo: 'team/repo', name: 'Fixture', kind: 'external' }
  function App() {
    const [refreshKey, changeRefresh] = useState(0), [focusPull, changeFocus] = useState({ repo: 'team/repo', number: 7, nonce: 'initial' })
    const [currentProject, changeProject] = useState(project), [activeId, changeTask] = useState('')
    const [conn, changeConnection] = useState({ state: 'connected', login: 'fixture' })
    setConnection = changeConnection
    refresh = () => changeRefresh(value => value + 1); setFocus = changeFocus; setProject = changeProject; setTask = changeTask
    const task = { activeId, setPublicKeys() {}, open: changeTask, close: () => changeTask('') }
    return <TaskContext.Provider value={task}><PullRequests key={currentProject.key} appId="fixture" token="mock"
      project={currentProject} conn={conn} focusPull={focusPull} refreshKey={refreshKey} onChanged={() => { changeSignals += 1 }} /></TaskContext.Provider>
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
      ensure(title(8) === 'Exact second-row snapshot', 'New exact observation did not replace the older row value')
    })
    await runCheck('new explicit observations supersede settled inventory without transferring selection or frozen confirmation', async () => {
      root.render(null); await frame(); runs = []
      const initial = pull(), second = pull(8, { title: 'Listed second open' })
      search = async () => page([initial, second]); focus = async () => exact(initial)
      root.render(<App />); await until(() => row(8)); select(7); await frame()
      host.querySelector('[aria-label="Take selected PRs on with agent"]').click(); await until(() => host.querySelector('.co-pr-confirm-list'))
      const current = pull(7, { title: 'Explicit current head and base branch', headRefOid: 'e'.repeat(40), baseRefName: 'release' })
      focus = async () => exact(current); setFocus({ repo: 'team/repo', number: 7, nonce: 'explicit-current' }); await frame(); await frame()
      ensure(title(7) === current.title, 'New exact navigation lost to old inventory')
      ensure(!row(7).querySelector('input').checked, 'Exact head/base drift transferred selection')
      ensure(host.querySelector('.co-pr-confirm-list').textContent.includes(initial.title) && !host.querySelector('.co-pr-confirm-list').textContent.includes(current.title), 'Exact navigation transferred frozen confirmation')
      setTask(''); await frame(); select(8); await frame()
      focus = async () => exact({ ...second, title: 'Explicit second closed', state: 'CLOSED' })
      setFocus({ repo: 'team/repo', number: 8, nonce: 'explicit-closed' }); await frame(); await frame()
      ensure(title(8) === 'Explicit second closed', 'Closed exact navigation lost to old inventory')
      ensure(row(8).querySelector('input').disabled && !row(8).querySelector('input').checked, 'Closed exact remained selectable/selected')
    })
    await runCheck('explicit navigation to an already listed closed PR invalidates selected open evidence', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull(), pull(8, { title: 'Listed open second' })]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(8)); select(8); await frame()
      focus = async () => exact(pull(8, { title: 'Explicit now closed second', state: 'CLOSED' }))
      setFocus({ repo: 'team/repo', number: 8, nonce: 'listed-now-closed' }); await frame(); await frame()
      ensure(title(8) === 'Explicit now closed second', 'New exact closed state lost to old open inventory')
      ensure(row(8).querySelector('input').disabled && !row(8).querySelector('input').checked, 'Closed exact retained selected open evidence')
    })
    await runCheck('list and exact use issuance order in both completion orders', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      for (const exactFirst of [true, false]) {
        const inventoryRead = deferred(), exactRead = deferred()
        search = () => inventoryRead.promise; refresh(); await frame()
        focus = () => exactRead.promise; setFocus({ repo: 'team/repo', number: 7, nonce: 'newer-exact-' + exactFirst }); await frame()
        const newer = pull(7, { title: 'New exact wins ' + exactFirst, headRefOid: 'e'.repeat(40) })
        if (exactFirst) { exactRead.resolve(exact(newer)); await until(() => title(7) === newer.title) }
        inventoryRead.resolve(page([pull(7, { title: 'Older inventory ' + exactFirst })])); await frame(); await frame()
        if (!exactFirst) { exactRead.resolve(exact(newer)); await until(() => title(7) === newer.title) }
        ensure(title(7) === newer.title, 'Older list beat a newer successful exact read')
      }
      for (const listFirst of [true, false]) {
        const exactRead = deferred(), inventoryRead = deferred()
        focus = () => exactRead.promise; setFocus({ repo: 'team/repo', number: 7, nonce: 'older-exact-' + listFirst }); await frame()
        search = () => inventoryRead.promise; refresh(); await frame()
        const newer = pull(7, { title: 'New inventory wins ' + listFirst, headRefOid: 'f'.repeat(40) })
        if (!listFirst) { exactRead.resolve(exact(pull(7, { title: 'Older exact before inventory' }))); await frame(); await frame() }
        inventoryRead.resolve(page([newer])); await until(() => title(7) === newer.title)
        if (listFirst) { exactRead.resolve(exact(pull(7, { title: 'Older exact after inventory' }))); await frame(); await frame() }
        ensure(title(7) === newer.title, 'Older exact beat a newer successful list read')
      }
    })
    await runCheck('exact version drift checks latest selected state and each head/base/state boundary', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull(), pull(8, { title: 'Other selection' })]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(8))
      let current = pull()
      for (const [field, value] of [['headRefOid', 'e'.repeat(40)], ['baseRefOid', 'f'.repeat(40)], ['baseRefName', 'release'], ['state', 'CLOSED']]) {
        const pending = deferred(); focus = () => pending.promise
        setFocus({ repo: 'team/repo', number: 7, nonce: 'boundary-' + field }); await frame()
        // Select AFTER the exact read starts. Its captured selection must not win.
        select(7); if (!row(8).querySelector('input').checked) select(8); await frame()
        current = { ...current, [field]: value, title: 'Changed ' + field }
        pending.resolve(exact(current)); await until(() => title(7) === current.title)
        ensure(!row(7).querySelector('input').checked, 'Latest selection survived ' + field + ' drift')
        ensure(row(8).querySelector('input').checked, 'Unrelated latest selection was removed')
      }
      ensure(row(7).querySelector('input').disabled, 'Latest closed observation remained selectable')
    })
    await runCheck('failed explicit exact preserves the latest inventory snapshot and truthful error without stale failures', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7)); select(7); await frame()
      focus = async () => { throw Error('explicit read unavailable') }
      setFocus({ repo: 'team/repo', number: 7, nonce: 'explicit-failed' }); await until(() => host.querySelector('.co-pr-note[role=alert]'))
      ensure(title(7) === 'Initial title' && row(7).querySelector('input').checked, 'Failed explicit read erased previous selected snapshot')
      ensure(host.innerText.includes('Showing the previous snapshot'), 'Failed explicit read concealed previous snapshot')
      const old = deferred(); focus = () => old.promise
      setFocus({ repo: 'team/repo', number: 7, nonce: 'older-explicit-failure' }); await frame()
      search = async () => page([pull(7, { title: 'Inventory after exact failure', headRefOid: 'e'.repeat(40) })]); refresh()
      await until(() => title(7) === 'Inventory after exact failure')
      old.reject(Error('obsolete exact failure')); await frame(); await frame()
      ensure(!host.querySelector('.co-pr-note[role=alert]'), 'Older exact failure polluted newer inventory')
    })
    await runCheck('old missing inventory cannot reread over a newer explicit observation', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      const pending = deferred(); search = () => pending.promise; refresh(); await frame()
      focus = async () => exact(pull(7, { title: 'Explicit closed after pending inventory', state: 'CLOSED' }))
      setFocus({ repo: 'team/repo', number: 7, nonce: 'newer-than-missing-list' }); await until(() => title(7) === 'Explicit closed after pending inventory')
      const exactCalls = calls.filter(call => call.body?.query?.includes('ContributeExactPull')).length
      pending.resolve(page([])); await frame(); await frame()
      ensure(title(7) === 'Explicit closed after pending inventory', 'Missing older inventory erased newer exact')
      ensure(calls.filter(call => call.body?.query?.includes('ContributeExactPull')).length === exactCalls, 'Older inventory launched a redundant exact observation over newer navigation')
    })
    await runCheck('pending inventory is canceled across connection and project changes', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      const disconnected = deferred(); search = () => disconnected.promise; refresh(); await frame()
      setConnection({ state: 'disconnected' }); await frame()
      search = async () => page([pull(7, { title: 'Reconnected inventory' })]); focus = async () => exact(pull(7, { title: 'Reconnected inventory' }))
      setConnection({ state: 'connected', login: 'fixture' }); await until(() => title(7) === 'Reconnected inventory')
      disconnected.reject(Error('old connection inventory failure')); await frame(); await frame()
      ensure(!host.querySelector('.co-alert[role=alert]'), 'Old connection inventory failure appeared')
      const leaving = deferred(); search = () => leaving.promise; refresh(); await frame()
      search = async () => page([]); setProject({ ...project, key: 'other', canonical_repo: 'team/other' }); await frame()
      leaving.resolve(page([pull(7, { title: 'Old project inventory' })])); await frame(); await frame()
      ensure(!row(7), 'Old inventory crossed project')
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
    await runCheck('closed focused identity absent from open inventory refreshes title head base and state', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([])
      let exactPr = pull(7, { title: 'Closed initial snapshot', state: 'CLOSED' })
      focus = async () => exact(exactPr); root.render(<App />)
      await until(() => title(7) === exactPr.title)
      ensure(row(7).querySelector('input').disabled, 'Closed focus became selectable')
      exactPr = pull(7, { title: 'Merged current snapshot', state: 'MERGED', headRefOid: 'f'.repeat(40), baseRefOid: 'e'.repeat(40), baseRef: { target: { oid: 'e'.repeat(40) } } })
      runs = [{ id: 'refreshed-closed', state: 'complete', mode: 'review', items: [{ repo: 'team/repo', number: 7, head_sha: exactPr.headRefOid, base_ref: 'main', base_sha: exactPr.baseRef.target.oid, state: 'all_clear' }] }]
      refresh(); await until(() => title(7) === exactPr.title)
      ensure(row(7).innerText.includes('Merged') && row(7).querySelector('input').disabled, 'Refreshed closed focus state is not current')
      ensure(row(7).querySelector('.co-pr-agent-state')?.textContent.includes('Review clear'), 'Exact refresh did not propagate current head/base')
      ensure(!row(7).innerText.includes('older main'), 'Exact refresh retained the prior target base')
      row(7).querySelector('.co-pr-open').click(); await until(() => host.querySelector('.co-gh-pr-title'))
      ensure(host.querySelector('.co-gh-pr-title').textContent.includes(exactPr.title), 'Detail retained the old focused title')
      ensure(!host.querySelector('.co-pr-detail-actions .co-btn-primary'), 'Refreshed merged focus gained review controls')
    })
    await runCheck('missing-page exact refresh revalidates selection and rejects late successful and failed reads', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([])
      let exactPr = pull(7, { title: 'Later-page initial' })
      focus = async () => exact(exactPr); root.render(<App />); await until(() => title(7) === exactPr.title)
      select(7); await frame(); refresh(); await frame(); await frame()
      ensure(row(7).querySelector('input').checked, 'Unchanged exact absent-page refresh lost selected version')
      host.querySelector('[aria-label="Take selected PRs on with agent"]').click(); await until(() => host.querySelector('.co-pr-confirm-list'))
      exactPr = pull(7, { title: 'Later-page changed version', headRefOid: 'c'.repeat(40), baseRefOid: 'd'.repeat(40), baseRef: { target: { oid: 'd'.repeat(40) } } })
      refresh(); await until(() => title(7) === exactPr.title)
      ensure(!row(7).querySelector('input').checked && host.innerText.includes('Select its current version again'), 'Changed absent-page exact identity retained selection')
      ensure(host.querySelector('.co-pr-confirm-list').textContent.includes('Later-page initial') && !host.querySelector('.co-pr-confirm-list').textContent.includes(exactPr.title), 'Refresh silently transferred the previous frozen confirmation to a new version')
      setTask(''); await frame()
      const old = deferred(); let oldStarted = false; focus = () => { oldStarted = true; return old.promise }; refresh(); await until(() => oldStarted)
      exactPr = pull(7, { title: 'Latest exact version', headRefOid: 'e'.repeat(40) })
      focus = async () => exact(exactPr); refresh(); await until(() => title(7) === exactPr.title)
      old.resolve(exact(pull(7, { title: 'Out-of-order exact snapshot' }))); await frame()
      ensure(title(7) === exactPr.title, 'Old exact refresh won')
      const oldFailure = deferred(); let failureStarted = false; focus = () => { failureStarted = true; return oldFailure.promise }; refresh(); await until(() => failureStarted)
      exactPr = { ...exactPr, title: 'Latest after old failure' }; focus = async () => exact(exactPr)
      refresh(); await until(() => title(7) === exactPr.title)
      oldFailure.reject(Error('late exact failure')); await frame()
      ensure(!host.querySelector('.co-pr-note[role=alert]'), 'Stale exact failure polluted latest focus')
      select(7); await frame()
      focus = async () => { throw Error('latest exact unavailable') }; refresh()
      await until(() => host.querySelector('.co-pr-note[role=alert]'))
      ensure(title(7) === exactPr.title, 'Failed exact refresh erased previous snapshot')
      ensure(host.innerText.includes('previous snapshot'), 'Retained old focus was not disclosed as a previous snapshot')
      ensure(row(7).querySelector('input').checked, 'Failed exact read lost prior selected version')
      exactPr = { ...exactPr, title: 'Focused now closed', state: 'CLOSED' }; focus = async () => exact(exactPr)
      refresh(); await until(() => title(7) === exactPr.title)
      ensure(row(7).querySelector('input').disabled && !row(7).querySelector('input').checked, 'Closed exact state silently retained selection')
      ensure(!host.querySelector('.co-pr-note[role=alert]'), 'Successful exact refresh retained stale failure')
    })
    await runCheck('new canonical inventory rejects an older missing-page exact response', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      const old = deferred(); let oldStarted = false; focus = () => { oldStarted = true; return old.promise }; refresh(); await until(() => oldStarted)
      const canonical = pull(7, { title: 'Canonical after pending exact', headRefOid: 'f'.repeat(40) })
      search = async () => page([canonical]); refresh(); await until(() => title(7) === canonical.title)
      old.reject(Error('stale absent exact failed')); await frame()
      ensure(title(7) === canonical.title && !host.querySelector('.co-pr-note[role=alert]'), 'Old exact response overrode newer canonical inventory')
      search = async () => page([]); focus = async () => { throw Error('exact after canonical unavailable') }; refresh()
      await until(() => host.querySelector('.co-pr-note[role=alert]'))
      ensure(title(7) === canonical.title, 'Failed exact refresh resurrected an older snapshot than the last canonical row')
      search = async () => page([canonical]); refresh(); await frame()
      await until(() => !host.querySelector('.co-pr-note[role=alert]'))
    })
    await runCheck('later-page canonical discovery invalidates focus selection and remains the failed-refresh snapshot', async () => {
      root.render(null); await frame(); runs = []; focus = async () => exact(pull())
      const canonical = pull(7, { title: 'Later-page canonical version', headRefOid: 'e'.repeat(40) })
      search = async query => query.includes('after:"later"') ? page([canonical])
        : { data: { search: { nodes: [], issueCount: 1, pageInfo: { hasNextPage: true, endCursor: 'later' } } } }
      root.render(<App />); await until(() => row(7))
      select(7); await frame()
      const more = [...host.querySelectorAll('button')].find(node => node.textContent === 'Load more PRs')
      more.click()
      await until(() => title(7) === canonical.title)
      ensure(!row(7).querySelector('input').checked && host.innerText.includes('Select its current version again'), 'New canonical later-page head silently transferred focus selection')
      search = async () => page([]); focus = async () => { throw Error('exact after later page unavailable') }; refresh()
      await until(() => host.querySelector('.co-pr-note[role=alert]'))
      ensure(title(7) === canonical.title, 'Failed exact refresh resurrected pre-pagination focus snapshot')
    })
    await runCheck('pending exact refresh is canceled by nonce connection and project changes', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      const oldNonce = deferred(); let nonceStarted = false; focus = () => { nonceStarted = true; return oldNonce.promise }; refresh(); await until(() => nonceStarted)
      focus = async () => exact(pull(7, { title: 'New target nonce' }))
      setFocus({ repo: 'team/repo', number: 7, nonce: 'after-refresh' }); await until(() => title(7) === 'New target nonce')
      oldNonce.resolve(exact(pull(7, { title: 'Old refresh nonce' }))); await frame()
      ensure(title(7) === 'New target nonce', 'Old exact refresh crossed nonce')
      const disconnected = deferred(); let connectionStarted = false; focus = () => { connectionStarted = true; return disconnected.promise }; refresh(); await until(() => connectionStarted)
      setConnection({ state: 'disconnected' }); await frame()
      focus = async () => exact(pull(7, { title: 'Reconnected exact' }))
      setConnection({ state: 'connected', login: 'fixture' }); await until(() => title(7) === 'Reconnected exact')
      disconnected.reject(Error('old connection failure')); await frame()
      ensure(!host.querySelector('.co-pr-note[role=alert]'), 'Old exact refresh crossed connection')
      const leaving = deferred(); let projectStarted = false; focus = () => { projectStarted = true; return leaving.promise }; refresh(); await until(() => projectStarted)
      setProject({ ...project, key: 'other', canonical_repo: 'team/other' }); await frame()
      leaving.resolve(exact(pull(7, { title: 'Old project refresh' }))); await frame()
      ensure(!row(7), 'Old exact refresh crossed project')
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
    const assigned = (number, login = 'fixture') => [...(row(number)?.querySelectorAll('.co-pr-aside [title]') || [])].some(node => node.title.split(', ').includes(login))
    const beginAssignment = async (number, pending, login = 'fixture') => {
      let started = false
      assignmentResponse = body => { ensure(body.number === number && body.assignee === login, 'Assignment escaped its frozen scope'); started = true; return pending.promise }
      row(number).querySelector('.co-pr-assign').click()
      await until(() => host.querySelector('[aria-label="Assign to me"]'))
      host.querySelector(`[aria-label="${login === 'fixture' ? 'Assign to me' : 'Assign to ' + login}"]`).click()
      await until(() => started)
    }
    for (const reader of ['exact', 'inventory']) for (const readFirst of [false, true]) for (const readBeforeAssignment of [false, true]) {
      await runCheck(`assignment metadata preserves ${reader} authority and acknowledged assignees; readFirst=${readFirst}, readIssuedFirst=${readBeforeAssignment}`, async () => {
        root.render(null); await frame(); runs = []
        const initial = pull(), other = pull(8, { title: 'Unchanged peer' })
        search = async () => page([initial, other]); focus = async () => exact(initial)
        root.render(<App />); await until(() => row(8)); select(7); select(8); await frame()
        host.querySelector('[aria-label="Take selected PRs on with agent"]').click(); await until(() => host.querySelector('.co-pr-confirm-list'))
        const assignment = deferred(), read = deferred()
        let readStarted = false
        const beginRead = async () => {
          if (reader === 'exact') { focus = () => { readStarted = true; return read.promise }; setFocus({ repo: 'team/repo', number: 7, nonce: 'assignment-' + readFirst }) }
          else { search = () => { readStarted = true; return read.promise }; refresh() }
          await until(() => readStarted)
        }
        if (readBeforeAssignment) await beginRead()
        await beginAssignment(7, assignment)
        if (!readBeforeAssignment) await beginRead()
        const current = pull(7, { title: 'Current ' + reader + ' after assignment', headRefOid: '9'.repeat(40), baseRefOid: '8'.repeat(40), baseRefName: 'release', state: 'CLOSED' })
        if (readFirst) { read.resolve(reader === 'exact' ? exact(current) : page([current, other])); await until(() => title(7) === current.title) }
        assignment.resolve({ ok: true }); await until(() => !host.querySelector('.co-pr-assignment'))
        ensure(assigned(7), 'Successful assignment acknowledgement was not rendered')
        if (!readFirst) { read.resolve(reader === 'exact' ? exact(current) : page([current, other])); await frame(); await frame() }
        ensure(title(7) === current.title, 'Assignment vetoed fresh title/head/base/state')
        ensure(row(7).querySelector('input').disabled && !row(7).querySelector('input').checked, 'Assignment vetoed closed/version invalidation')
        ensure(row(8).querySelector('input').checked, 'Assignment removed unrelated selection')
        ensure(assigned(7), 'Held read erased acknowledged assignee metadata')
        // Choosing Assign deliberately leaves the earlier review workflow; an
        // acknowledgement must not recreate or transfer its frozen consent.
        setTask('task:review'); await frame()
        ensure(!host.querySelector('.co-pr-confirm-list') && host.innerText.includes('This selection has finished'), 'Assignment/read recreated or transferred frozen confirmation')
      })
    }
    await runCheck('failed exact after assignment discloses prior snapshot without losing selected metadata', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7)); select(7); await frame()
      const assignment = deferred(), read = deferred(); await beginAssignment(7, assignment)
      let started = false; focus = () => { started = true; return read.promise }
      setFocus({ repo: 'team/repo', number: 7, nonce: 'assignment-failure' }); await until(() => started)
      assignment.resolve({ ok: true }); await until(() => !host.querySelector('.co-pr-assignment'))
      read.reject(Error('Exact read unavailable after assignment')); await frame(); await frame()
      ensure(host.querySelector('.co-pr-note[role=alert]')?.textContent.includes('Showing the previous snapshot'), 'Assignment suppressed failed exact disclosure')
      ensure(title(7) === 'Initial title' && assigned(7) && row(7).querySelector('input').checked, 'Failed read erased prior selected snapshot/assignee')
    })
    await runCheck('metadata-only success keeps code selection and later authoritative reads reconcile assignees', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7)); select(7); await frame()
      const assignment = deferred(); await beginAssignment(7, assignment)
      assignment.resolve({ ok: true }); await until(() => assigned(7))
      ensure(title(7) === 'Initial title' && row(7).querySelector('input').checked, 'Metadata-only write changed selected code')
      const later = pull(7, { title: 'Later canonical assignees', assignees: { nodes: [{ login: 'peer' }] } })
      focus = async () => exact(later); setFocus({ repo: 'team/repo', number: 7, nonce: 'after-assignment-read' }); await until(() => title(7) === later.title)
      ensure(!assigned(7) && assigned(7, 'peer'), 'Old acknowledgement permanently overlaid a read issued afterwards')
      ensure(row(7).querySelector('input').checked, 'Assignee/title-only read lost unchanged selection')
    })
    await runCheck('assignee receipts are reconciled individually by reads issued between acknowledgements', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(7))
      const first = deferred(); await beginAssignment(7, first); first.resolve({ ok: true }); await until(() => assigned(7))
      const read = deferred(); let started = false; focus = () => { started = true; return read.promise }
      setFocus({ repo: 'team/repo', number: 7, nonce: 'between-acknowledgements' }); await until(() => started)
      const second = deferred(); await beginAssignment(7, second, 'peer'); second.resolve({ ok: true }); await until(() => assigned(7, 'peer'))
      read.resolve(exact(pull(7, { title: 'Read between acknowledgements' }))); await until(() => title(7) === 'Read between acknowledgements')
      ensure(!assigned(7) && assigned(7, 'peer'), 'Read permanently retained an earlier receipt or erased its later acknowledgement')
    })
    await runCheck('assignment cannot revive older nonce reads or move metadata to a different identity', async () => {
      root.render(null); await frame(); runs = []; search = async () => page([pull(), pull(8, { title: 'Other identity' })]); focus = async () => exact(pull())
      root.render(<App />); await until(() => row(8))
      const assignment = deferred(), old = deferred(); await beginAssignment(7, assignment)
      let started = false; focus = () => { started = true; return old.promise }
      setFocus({ repo: 'team/repo', number: 7, nonce: 'old-assignment-nonce' }); await until(() => started)
      focus = async () => exact(pull(8, { title: 'Current second identity', state: 'CLOSED' }))
      setFocus({ repo: 'team/repo', number: 8, nonce: 'current-assignment-nonce' }); await until(() => title(8) === 'Current second identity')
      assignment.resolve({ ok: true }); await until(() => !host.querySelector('.co-pr-assignment'))
      old.reject(Error('Old nonce failed after assignment')); await frame(); await frame()
      ensure(title(8) === 'Current second identity' && !assigned(8), 'Assignment metadata changed another focused PR')
      ensure(title(7) === 'Initial title' && assigned(7), 'Assignment lost its own identity metadata')
      ensure(!host.querySelector('.co-pr-note[role=alert]'), 'Assignment revived an obsolete nonce error')
    })
    for (const scope of ['connection', 'project', 'unmount']) {
      await runCheck('late assignment acknowledgement cannot cross ' + scope, async () => {
        root.render(null); await frame(); runs = []; search = async () => page([pull()]); focus = async () => exact(pull())
        root.render(<App />); await until(() => row(7))
        const assignment = deferred(); await beginAssignment(7, assignment); const before = changeSignals
        if (scope === 'project') {
          search = async () => page([]); setProject({ ...project, key: 'other', canonical_repo: 'team/other' }); await frame()
        } else {
          const next = pull(7, { title: 'Fresh after ' + scope }); search = async () => page([next]); focus = async () => exact(next)
          if (scope === 'connection') { setConnection({ state: 'disconnected' }); await frame(); setConnection({ state: 'connected', login: 'fixture' }) }
          else { root.render(null); await frame(); root.render(<App />) }
          await until(() => title(7) === next.title)
        }
        assignment.resolve({ ok: true }); await frame(); await frame(); await frame()
        ensure(changeSignals === before, 'Unmounted assignment callback emitted a new project change')
        if (scope === 'project') ensure(!row(7), 'Assignment leaked into another project')
        else ensure(!assigned(7) && title(7) === 'Fresh after ' + scope, 'Old acknowledgement changed the new connection/mount')
      })
    }
    await runCheck('upper UI attempts only reads or locally mocked scoped assignment acknowledgements', async () => {
      ensure(calls.every(call => call.method === 'GET' || call.url.endsWith('/observe') || (call.url.endsWith('/assign-review') && call.method === 'POST' && call.body?.repo === 'team/repo' && [7, 8].includes(call.body?.number) && ['fixture', 'peer'].includes(call.body?.assignee) && /^[a-f0-9]{40}$/.test(call.body?.expected_head_sha || '')) || (call.url === '/api/github/graphql' && !/mutation\b/i.test(call.body?.query || ''))), 'Mutating transport attempted')
    })
    return checks
  } finally { root.unmount(); host.remove(); window.fetch = originalFetch }
}
