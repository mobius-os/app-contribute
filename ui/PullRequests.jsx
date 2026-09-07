import { useCallback, useEffect, useRef, useState } from 'react'
import { collaborationRequest, discoverPulls, matchingPulls, mayAssign, mayMerge, mergeSelection, prKey, reviewRunRequest, assignPulls, reviewForPull } from '../collaboration.js'
import { TaskPane, useProjectTask } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { openAgentConversation } from './BatchAction.jsx'

const FILTERS = [['all', 'All'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned to me'], ['authored', 'My PRs']]
const STATE_NAMES = { reviewing: 'Reviewing', pending: 'Waiting to review', all_clear: 'Review clear', needs_you: 'Needs you', merged: 'Merged', queued: 'In merge queue', failed: 'Needs you', starting: 'Starting', merging: 'Merging', merge_unknown: 'Outcome needs checking', complete: 'Complete', stopped: 'Stopped', paused: 'Paused' }

function AssigneePicker({ pulls, token, appId, ownLogin, onAssigned, onCancel }) {
  const picker = useRef(null)
  useEffect(() => {
    picker.current?.focus({ preventScroll: true })
    picker.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [])
  const pr = pulls[0]
  const [outcomes, setOutcomes] = useState([])
  const pending = pulls.filter(item => !outcomes.some(result => result.ok && result.key === prKey(item)))
  const [people, setPeople] = useState({ assignees: [], loading: true })
  const [login, setLogin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load(page = 1) {
    setError('')
    try {
      const next = await collaborationRequest(token, appId, `assignees?repo=${encodeURIComponent(pr.repository.nameWithOwner)}&page=${page}`)
      setPeople(old => ({ ...next, loading: false, assignees: page === 1 ? next.assignees : [...old.assignees, ...next.assignees] }))
    } catch (error) { setError(error.message); setPeople(old => ({ ...old, loading: false })) }
  }
  useEffect(() => { void load() }, [])
  async function assign() {
    setBusy(true); setError('')
    try {
      const results = await assignPulls(token, appId, pending, login)
      setOutcomes(old => [...old.filter(item => !results.some(result => result.key === item.key)), ...results])
      onAssigned(login, results.filter(result => result.ok).map(result => result.key))
      if (results.every(result => result.ok)) onCancel()
    } finally { setBusy(false) }
  }

  return <div ref={picker} tabIndex={-1} className="co-pr-assignment" role="region" aria-label="Assign selected PRs">
    <p>Assign {pulls.map(item => `#${item.number}`).join(", ")}</p>
    <label>Person
      <select value={login} onChange={event => setLogin(event.target.value)} disabled={busy || people.loading}>
        <option value="">{people.loading ? 'Loading people…' : 'Choose a person'}</option>
        {people.assignees.map(person => <option key={person.login} value={person.login}>{person.login}</option>)}
      </select>
    </label>
    {people.assignees.some(person => person.login.toLowerCase() === ownLogin?.toLowerCase()) ? <button className="co-btn" disabled={busy} onClick={() => setLogin(ownLogin)}>Choose me</button> : null}
    {people.next_page ? <button className="co-btn" disabled={busy} onClick={() => load(people.next_page)}>More people</button> : null}
    <button className="co-btn co-btn-primary" disabled={busy || !login || !people.can_assign} onClick={assign}>{busy ? 'Assigning…' : 'Assign on GitHub'}</button>
    <button className="co-btn" disabled={busy} onClick={onCancel}>Cancel</button>
    {people.can_manage_access && people.access_url ? <a className="co-pr-link" href={people.access_url} target="_blank" rel="noopener noreferrer">Manage repository access on GitHub</a> : null}
    {outcomes.filter(result => !result.ok).map(result => <p key={result.key} role="alert" className="co-run-error">{result.key}: {result.error}</p>)}
    {outcomes.some(result => result.ok) ? <p role="status">{outcomes.filter(result => result.ok).length} assigned. Only remaining PRs will be retried.</p> : null}
    {error ? <p role="alert" className="co-run-error">{error} <button className="co-btn" disabled={busy} onClick={() => load()}>Retry</button></p> : null}
  </div>
}

export function ReviewConfirmation({ choice, busy, error, onConfirm, onCancel, onModeChange }) {
  const confirmation = useRef(null)
  useEffect(() => {
    if (choice) {
      confirmation.current?.focus({ preventScroll: true })
      confirmation.current?.scrollIntoView({ block: 'center', behavior: 'instant' })
    }
  }, [choice])
  if (!choice) return null
  const merge = choice.mode === 'review_merge'
  return <section ref={confirmation} tabIndex={-1} className="co-pr-confirm" aria-label="Confirm review workflow">

    <h3>{merge ? 'Review & merge if safe' : 'Review selected PRs'}</h3>
    <p>{merge
      ? 'Allow the agent to merge or queue these exact versions after a thorough review and required checks. Changed versions and questions come back to you. No branch edits or public review comments.'
      : 'Review privately, in parallel where independent. Nothing is posted or merged.'}</p>
    <ul>{choice.pulls.map(pr => <li key={prKey(pr)}><strong>{pr.title}</strong><span>{pr.repository.nameWithOwner} #{pr.number} · version {pr.headRefOid.slice(0, 7)} → {pr.baseRefName} ({pr.baseRefOid?.slice(0, 7)})</span></li>)}</ul>
    {onModeChange && choice.pulls.every(pr => mayMerge(pr.repository.viewerPermission) && !pr.isDraft) ? <label className="co-workflow-option"><input type="checkbox" checked={merge} disabled={busy} onChange={event => onModeChange(event.target.checked ? 'review_merge' : 'review')} /> Merge when safe</label> : null}
    <div className="co-board-actions">
      <button className="co-btn co-btn-primary" disabled={busy} onClick={onConfirm}>{busy ? 'Starting…' : merge ? 'Allow review & merge' : 'Start review'}</button>
      <button className="co-btn" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    {error ? <p className="co-run-error" role="alert">{error}</p> : null}
  </section>
}

export function PullRequests({ appId, token, project, conn, onChanged, records = [], onRecord }) {
  const repo = project?.canonical_repo || ''
  const task = useProjectTask()
  const [data, setData] = useState({ pulls: [], loading: true, error: '' })
  const [runs, setRuns] = useState([])
  const [runError, setRunError] = useState('')
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [assigning, setAssigning] = useState(null)
  const [choice, setChoice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current += 1 } }, [])
  const load = useCallback(async (cursor = null) => {
    const id = ++request.current
    setData(old => ({ ...old, loading: true, error: '' }))
    try {
      const next = await discoverPulls(token, repo, cursor)
      if (id !== request.current || !alive.current) return
      setData(old => ({ ...next, pulls: cursor ? mergeSelection(old.pulls, next.pulls) : next.pulls, loading: false, error: '' }))
      if (!cursor) setSelected(new Set())
    } catch (error) {
      if (id === request.current && alive.current) setData(old => ({ ...old, loading: false, error: error.message }))
    }
  }, [token, repo])
  const loadRuns = useCallback(async () => {
    try {
      const next = await collaborationRequest(token, appId, 'review-runs')
      if (alive.current) { setRuns(next.runs || []); setRunError('') }
    } catch (error) { if (alive.current) setRunError(error.message) }
  }, [token, appId])
  const publicRevision = records.filter(record => record.url).map(record => `${record.id}:${record.status}:${record.number}:${record.last_updated_pr_at || ''}`).sort().join('|')
  useEffect(() => {
    if (conn.state !== 'connected') return
    void load(); void loadRuns()
    const refresh = () => { if (!document.hidden) void loadRuns() }
    const timer = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [conn.state, publicRevision, load, loadRuns])
  useEffect(() => {
    task?.setPublicKeys(new Set(data.pulls.map(prKey)))
    return () => task?.setPublicKeys(new Set())
  }, [data.pulls, task?.setPublicKeys])
  if (conn.state !== 'connected' || !project || !repo) return null
  const visible = matchingPulls(data.pulls, filter, conn.login)
  const selection = data.pulls.filter(pr => selected.has(prKey(pr)))
  const relevantRuns = runs.filter(run => !repo || run.items?.some(item => item.repo.toLowerCase() === repo.toLowerCase()))
  const statusFor = pr => reviewForPull(relevantRuns, pr)
  function choose(pulls, mode) {
    task?.open('task:review')
    setAssigning(null)
    setChoice({ pulls: pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), mode, request_id: crypto.randomUUID() })
    setError('')
  }
  async function start() {
    setBusy(true); setError('')
    try {
      const result = await collaborationRequest(token, appId, 'review-runs', reviewRunRequest(choice))
      setRuns(old => [result.run, ...old.filter(run => run.id !== result.run.id)])
      setChoice(null); setSelected(new Set())
      task?.open(`task:run:${result.run.id}`)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  function toggle(pr) {
    setSelected(old => { const next = new Set(old); const key = prKey(pr); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function assignSelection() {
    setChoice(null)
    setAssigning(selection.map(pr => ({ ...pr, repository: { ...pr.repository } })))
    task?.open('task:assign')
  }
  return <section className="co-public-work" aria-label="Pull requests">
    <header><h3>Contributions</h3><span>{data.loading ? 'Checking…' : `${data.total || 0} open PRs`}</span>
      <button className="co-quiet-action" aria-label="Refresh pull requests" disabled={data.loading} onClick={() => { void load(); void loadRuns() }}><Icon name="refresh" size={18} /></button>
    </header>
    <div className="co-pr-filters" aria-label="Pull request views">{FILTERS.map(([key, label]) =>
      <button key={key} className="co-quiet-action" aria-pressed={filter === key} onClick={() => { setFilter(key); setSelected(new Set()) }}>{label}</button>)}</div>
    {selection.length ? <button className="co-work-progress-row" onClick={() => task?.open('task:pulls')}><strong>{selection.length} selected</strong><span>Review or assign</span><Icon name="right" size={16} /></button> : null}
    {runError ? <p className="co-pr-note" role="status">Review progress unavailable: {runError}</p> : null}
    {data.error ? <p className="co-run-error" role="alert">{data.error} Use Refresh to try again.</p> : null}
    {!data.loading && !data.error && !visible.length ? <div className="co-work-empty"><strong>No {filter === 'unassigned' ? 'unassigned ' : ''}pull requests here</strong><p>{data.hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here for review.' : 'Try All to see the project’s other contributions.'}</p></div> : null}
    <div className="co-pr-list">{visible.map(pr => {
      const status = statusFor(pr)
      const mine = pr.author?.login?.toLowerCase() === conn.login?.toLowerCase()
      return <article className={'co-pr-row' + (selected.has(prKey(pr)) ? ' is-selected' : '')} key={prKey(pr)}>
        <label className="co-pr-select"><input type="checkbox" checked={selected.has(prKey(pr))} onChange={() => toggle(pr)} aria-label={`Select ${pr.repository.nameWithOwner} #${pr.number}`} /></label>
        <div className="co-pr-content">
          <button className="co-pr-open" onClick={() => { setSelected(new Set([prKey(pr)])); task?.open('task:pulls') }}>
            <strong className="co-pr-title">{records.find(record => record.number === pr.number)?.summary || pr.title}</strong>
            <span className="co-pr-meta">#{pr.number} · {mine ? 'Your PR' : pr.author?.login || 'Contributor'} · {pr.assignees?.nodes?.length ? pr.assignees.nodes.map(user => user.login.toLowerCase() === conn.login?.toLowerCase() ? 'You' : user.login).join(', ') : 'Unassigned'}</span>
            <span className="co-work-state">{status ? STATE_NAMES[status.item.state] || status.item.state : pr.isDraft ? 'Draft' : 'Ready for review'}</span>
          </button>
          {status?.run.chat_id ? <button className="co-quiet-action" onClick={() => task?.open(`task:run:${status.run.id}`)}>{['needs_you', 'failed'].includes(status.item.state) ? 'Answer question' : 'Review progress'}</button> : null}
        </div>
      </article>
    })}</div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}
    {relevantRuns.length ? <details className="co-pr-runs"><summary>Review conversations</summary>{relevantRuns.map(run => <button className="co-review-run-row" key={run.id} onClick={() => task?.open(`task:run:${run.id}`)}>
      <span>{run.mode === 'review_merge' ? 'Review & merge' : 'Private review'} · {run.items?.length || 0} PRs</span><span>{STATE_NAMES[run.state] || run.state}</span><Icon name="right" size={16} />
    </button>)}</details> : null}

    <TaskPane id="task:pulls">
      <Icon name="review" size={23} /><h3>{selection.length ? `Review ${selection.length === 1 ? 'this contribution' : `${selection.length} contributions`}` : 'Review contributions'}</h3>
      <p>{selection.length ? 'A thorough private review. Independent changes can be reviewed in parallel.' : 'Select a pull request, or several, to review their changes together.'}</p>
      <div className="co-task-pulls">{selection.map(pr => <div key={prKey(pr)}><strong>{pr.title}</strong><a href={pr.url} target="_blank" rel="noopener noreferrer">#{pr.number} · View on GitHub</a></div>)}</div>
      {selection.length ? <>
        <button className="co-btn co-btn-primary co-task-primary" disabled={selection.length > 20 || busy} onClick={() => choose(selection, 'review')}>Review selected</button>
        {selection.every(pr => mayAssign(pr.repository.viewerPermission)) ? <button className="co-btn co-task-secondary" disabled={busy || selection.length > 20} onClick={assignSelection}>Assign to someone</button> : null}
        <button className="co-quiet-action" onClick={() => { setSelected(new Set()); task?.close() }}>Clear selection</button>
        {selection.length > 20 ? <p>Choose up to 20 PRs per run.</p> : null}
        {selection.every(pr => mayMerge(pr.repository.viewerPermission) && !pr.isDraft) ? <p className="co-task-footnote">You can allow merging on the next step, for the exact versions you choose.</p> : <p className="co-task-footnote">Private review doesn’t change GitHub or grant merge access.</p>}
      </> : null}
      {selection.length === 1 ? <details className="co-task-details"><summary>Versions & history</summary><code>{selection[0].headRefOid} → {selection[0].baseRefName} ({selection[0].baseRefOid})</code>
        {records.filter(record => record.number === selection[0].number).map(record => <button key={record.id} className="co-quiet-action" onClick={() => onRecord?.(record)}>Changes & history</button>)}
      </details> : null}
    </TaskPane>
    <TaskPane id="task:review"><ReviewConfirmation choice={choice} busy={busy} error={error} onConfirm={start} onCancel={() => { setChoice(null); task?.open('task:pulls') }} onModeChange={mode => { setError(''); setChoice(old => ({ ...old, mode, request_id: crypto.randomUUID() })) }} />{!choice ? <p>This selection has finished. Choose the current PRs to start another review.</p> : null}</TaskPane>
    <TaskPane id="task:assign">{assigning ? <><h3>Assign responsibility</h3><p>Assignment is shared on GitHub so the person sees it in their Contribute app. It doesn’t start a review.</p><AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onCancel={() => { setAssigning(null); task?.open('task:pulls') }} onAssigned={(login, keys) => {
      setData(old => ({ ...old, pulls: old.pulls.map(item => keys.includes(prKey(item)) ? { ...item, assignees: { nodes: [...new Map([...(item.assignees?.nodes || []), { login }].map(user => [user.login, user])).values()] } } : item) }))
      void onChanged?.()
    }} /></> : <p>Choose contributions to assign.</p>}</TaskPane>
    {relevantRuns.map(run => <TaskPane key={run.id} id={`task:run:${run.id}`}>
      <Icon name="review" size={23} /><h3>{run.mode === 'review_merge' ? 'Review & merge' : 'Private review'}</h3>
      <p>{STATE_NAMES[run.state] || run.state}</p>
      <div className="co-task-pulls">{run.items?.map(item => <div key={`${item.repo}:${item.number}`}><strong>#{item.number} · {STATE_NAMES[item.state] || item.state}</strong><p>{item.summary || 'The agent’s findings will appear here.'}</p></div>)}</div>
      {run.chat_id ? <button className="co-btn co-btn-primary co-task-primary" onClick={() => openAgentConversation(run.chat_id)}>{run.items?.some(item => ['needs_you', 'failed'].includes(item.state)) ? 'Answer in review conversation' : 'Open review conversation'}</button> : null}
      {run.items?.some(item => item.state === 'merged') && project.available && project.kind !== 'external' ? <button className="co-btn co-task-secondary" onClick={() => task?.open('task:update')}>Bring accepted changes here</button> : null}
      {run.items?.some(item => item.state === 'queued') ? <p>In the merge queue is not yet merged. The review conversation follows its outcome.</p> : null}
    </TaskPane>)}
  </section>
}
