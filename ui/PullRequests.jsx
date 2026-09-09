import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { collaborationRequest, discoverPulls, matchingPulls, mayAssign, mayMerge, mergeSelection, prKey, reviewRunRequest, assignPulls, reviewForPull } from '../collaboration.js'
import { PullRequestDetail, DateLabel } from './PullRequestDetail.jsx'
import { TaskPane, useProjectTask, focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { openAgentConversation } from './BatchAction.jsx'

const FILTERS = [['all', 'All'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned to me'], ['authored', 'My PRs']]
const STATE_NAMES = { reviewing: 'Reviewing', pending: 'Waiting to review', all_clear: 'Review clear', needs_you: 'Needs you', merged: 'Merged', queued: 'In merge queue', failed: 'Needs you', starting: 'Starting', merging: 'Merging', merge_unknown: 'Outcome needs checking', complete: 'Complete', stopped: 'Stopped', paused: 'Paused' }

// A non-modal shelf: selection never moves focus or interrupts browsing.
function SelectionTray({ selection, busy, onClear, onRemove, onInspect, onReview, onAssign, hidden }) {
  const [expanded, setExpanded] = useState(false)
  const tray = useRef(null)
  useLayoutEffect(() => {
    const node = tray.current
    if (!node || hidden) return
    const root = node.closest('.co-root')
    const measure = () => root?.style.setProperty('--co-selection-height', `${node.getBoundingClientRect().height + 32}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(node); measure()
    return () => { observer.disconnect(); root?.style.removeProperty('--co-selection-height') }
  }, [hidden])
  return <section hidden={hidden} ref={tray} className={'co-pr-selection' + (expanded ? ' is-expanded' : '')} aria-label="Selected contributions">
    <div className="co-selection-heading">
      <button className="co-selection-toggle" aria-expanded={expanded} aria-controls="co-selected-cards" onClick={() => setExpanded(value => !value)}><span className="co-selection-stack" aria-hidden="true"><Icon name="check" size={18} /></span><strong>{selection.length} selected</strong><Icon name="chevron" size={16} /></button>
      <div className="co-selection-actions">
        {selection.every(pr => mayAssign(pr.repository.viewerPermission)) ? <button className="co-btn" disabled={busy || selection.length > 20} onClick={onAssign}>Assign…</button> : null}
        <button className="co-btn co-btn-primary" disabled={selection.length > 20 || busy} onClick={() => onReview(selection, 'review')}><Icon name="prepare" size={18} />Review {selection.length}</button>
      </div>
      <button className="co-quiet-action" aria-label="Clear selection" onClick={onClear}><Icon name="close" size={18} /></button>
    </div>
    <div id="co-selected-cards" className="co-selected-cards">{selection.map(pr => <div className="co-selected-card" key={prKey(pr)}>
      <button className="co-selected-open" onClick={() => onInspect(pr)} title={pr.title}><span>#{pr.number}</span><strong>{pr.title}</strong></button>
      <button className="co-selected-remove" aria-label={`Remove PR ${pr.number} from selection`} onClick={() => onRemove(pr)}><Icon name="close" size={16} /></button>
    </div>)}</div>
    {selection.length > 20 ? <p role="status">Choose up to 20 PRs per run.</p> : null}
  </section>
}

function AssigneePicker({ pulls, token, appId, ownLogin, onAssigned, onCancel }) {
  const picker = useRef(null)
  useEffect(() => {
    focusActionRegion(picker.current, picker.current?.querySelector('input[type=search]'))
  }, [])
  const pr = pulls[0]
  const [outcomes, setOutcomes] = useState([])
  const pending = pulls.filter(item => !outcomes.some(result => result.ok && result.key === prKey(item)))
  const [people, setPeople] = useState({ assignees: [], loading: true })
  const [query, setQuery] = useState('')
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
  async function assign(login) {
    if (busy) return
    setBusy(true); setError('')
    try {
      const results = await assignPulls(token, appId, pending, login)
      setOutcomes(old => [...old.filter(item => !results.some(result => result.key === item.key)), ...results])
      onAssigned(login, results.filter(result => result.ok).map(result => result.key))
      if (results.every(result => result.ok)) onCancel()
    } finally { setBusy(false) }
  }

  const matching = people.assignees.filter(person => [person.login, person.name].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())))
  const own = people.assignees.find(person => person.login.toLowerCase() === ownLogin?.toLowerCase())
  return <div ref={picker} tabIndex={-1} className="co-pr-assignment" role="region" aria-label="Assign selected PRs">
    <h3>Assign {pulls.length === 1 ? `#${pr.number}` : `${pulls.length} PRs`}</h3>
    <p>Choose a person to assign {pulls.map(item => `#${item.number}`).join(', ')} on GitHub. This doesn’t start a review.</p>
    <input type="search" className="co-person-search" aria-label="Find a person" placeholder="Find a person…" value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
    {people.loading ? <p role="status">Loading people…</p> : null}
    <div className="co-person-list">
      {own && !query ? <button className="co-person-option" aria-label="Assign to me" disabled={busy || !people.can_assign} onClick={() => assign(own.login)}><b className="co-avatar">{own.login[0].toUpperCase()}</b>Assign to me<span>{own.login}</span></button> : null}
      {matching.filter(person => query || person.login !== own?.login).map(person => <button className="co-person-option" key={person.login} disabled={busy || !people.can_assign} onClick={() => assign(person.login)} aria-label={`Assign to ${person.login}`}><b className="co-avatar">{person.login[0].toUpperCase()}</b>{person.name || person.login}{person.name ? <span>{person.login}</span> : null}</button>)}
    </div>
    {!people.loading && !matching.length ? <p>No matching people in the loaded results.</p> : null}
    {busy ? <p role="status">Assigning…</p> : null}
    {people.next_page ? <button className="co-btn" disabled={busy || people.loading} onClick={() => load(people.next_page)}>Load more people</button> : null}
    <button className="co-quiet-action" disabled={busy} onClick={onCancel}>Cancel</button>
    {people.can_manage_access && people.access_url ? <a className="co-quiet-action" href={people.access_url} target="_blank" rel="noopener noreferrer">Manage access on GitHub</a> : null}
    {outcomes.filter(result => !result.ok).map(result => <p key={result.key} role="alert" className="co-run-error">{result.key}: {result.error}</p>)}
    {outcomes.some(result => result.ok) ? <p role="status">{outcomes.filter(result => result.ok).length} assigned. Only remaining PRs will be retried.</p> : null}
    {error ? <p role="alert" className="co-run-error">{error} <button className="co-btn" disabled={busy} onClick={() => load()}>Retry</button></p> : null}
  </div>
}

export function ReviewConfirmation({ choice, busy, disabled, error, onConfirm, onCancel, onModeChange }) {
  const confirmation = useRef(null)
  useEffect(() => {
    if (choice) {
      focusActionRegion(confirmation.current)
    }
  }, [choice])
  if (!choice) return null
  const merge = choice.mode === 'review_merge'
  return <section ref={confirmation} tabIndex={-1} className="co-pr-confirm" aria-label="Confirm review workflow">

    <h3>{merge ? 'Review & merge if safe' : 'Review privately'}</h3>
    <p>{merge
      ? 'Allow the agent to merge or queue these exact versions after a thorough review and required checks. Changed versions and questions come back to you. No branch edits or public review comments.'
      : 'Review privately, in parallel where independent. Nothing is posted or merged.'}</p>
    <ul>{choice.pulls.map(pr => <li key={prKey(pr)}><strong>{pr.title}</strong><span>{pr.repository.nameWithOwner} #{pr.number}</span></li>)}</ul>
    <details className="co-task-details"><summary>Exact versions covered by this approval</summary>{choice.pulls.map(pr => <p key={prKey(pr)}>#{pr.number}: version <code>{pr.headRefOid.slice(0, 7)} → {pr.baseRefName} ({pr.baseRefOid?.slice(0, 7)})</code></p>)}<p>Changed versions require a fresh approval.</p></details>
    {onModeChange && choice.pulls.every(pr => mayMerge(pr.repository.viewerPermission) && !pr.isDraft) ? <label className="co-workflow-option"><input type="checkbox" checked={merge} disabled={busy} onChange={event => onModeChange(event.target.checked ? 'review_merge' : 'review')} /> Merge when safe</label> : null}
    <div className="co-board-actions">
      <button className="co-btn co-btn-primary" disabled={busy || disabled} onClick={onConfirm}>{busy ? 'Starting…' : merge ? 'Allow review & merge' : 'Start private review'}</button>
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
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [selectionNotice, setSelectionNotice] = useState('')
  const currentSelection = useRef({ selected, pulls: data.pulls })
  currentSelection.current = { selected, pulls: data.pulls }
  const [showCounts, setShowCounts] = useState(false)
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
      let next = await discoverPulls(token, repo, cursor)
      // A first-page refresh must not discard selections from later pages.
      while (!cursor && next.hasNextPage && [...currentSelection.current.selected].some(key => !next.pulls.some(pr => prKey(pr) === key))) {
        if (id !== request.current || !alive.current) return
        const page = await discoverPulls(token, repo, next.endCursor)
        next = { ...page, pulls: mergeSelection(next.pulls, page.pulls) }
      }
      if (id !== request.current || !alive.current) return
      setData(old => ({ ...next, pulls: cursor ? mergeSelection(old.pulls, next.pulls) : next.pulls, loading: false, error: '' }))
      if (!cursor) {
        const previous = currentSelection.current
        const retained = new Set([...previous.selected].filter(key => {
          const before = previous.pulls.find(pr => prKey(pr) === key)
          const after = next.pulls.find(pr => prKey(pr) === key)
          return before && after && ['headRefOid', 'baseRefOid', 'baseRefName'].every(field => before[field] === after[field])
        }))
        const removed = [...previous.selected].filter(key => !retained.has(key))
        setSelected(retained)
        setSelectionNotice(removed.length ? `Selection updated: ${removed.join(', ')} changed or is no longer open. Select its current version again if needed.` : '')
      }
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
  const visible = matchingPulls(data.pulls, filter, conn.login).filter(pr => !query.trim() || `${pr.number} ${pr.title} ${pr.author?.login || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selection = data.pulls.filter(pr => selected.has(prKey(pr)))
  const relevantRuns = runs.filter(run => !repo || run.items?.some(item => item.repo.toLowerCase() === repo.toLowerCase()))
  const statusFor = pr => reviewForPull(relevantRuns, pr)
  const detailPr = data.pulls.find(pr => prKey(pr) === opened)
  function inspect(pr) { setOpened(prKey(pr)); task?.open('task:detail') }
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
  function assignSelection(pulls = selection) {
    setChoice(null)
    setAssigning(pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })))
    task?.open('task:assign')
  }
  return <section className="co-public-work" aria-label="Pull requests">
    <header><h3>Contributions</h3><span>{data.loading ? 'Checking…' : `${data.total || 0} open PRs`}</span>
      <button className="co-quiet-action" aria-label="Refresh pull requests" disabled={data.loading} onClick={() => { void load(); void loadRuns() }}><Icon name="refresh" size={18} /></button>
    </header>
    <div className="co-pr-list-controls">
      <div className="co-pr-filters" aria-label="Filter pull requests">{FILTERS.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <details className="co-display"><summary><Icon name="settings" size={16} /> Display</summary><label><input type="checkbox" checked={showCounts} onChange={event => setShowCounts(event.target.checked)} /> Show change totals</label></details>
      <label className="co-pr-search"><Icon name="search" size={18} /><input type="search" aria-label="Find a pull request" placeholder="Search contributions…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    </div>
    {selection.length ? <SelectionTray selection={selection} busy={busy} hidden={!!task?.activeId?.startsWith('task:')} onClear={() => setSelected(new Set())} onRemove={toggle} onReview={choose} onAssign={() => assignSelection()} onInspect={inspect} /> : null}
    <TaskPane id="task:detail">{detailPr ? <><h3>{detailPr.title}</h3><div className="co-detail-stats"><span>#{detailPr.number} · {detailPr.author?.login || 'Contributor'}</span>{Number.isInteger(detailPr.changedFiles) ? <span>{detailPr.changedFiles} files · +{detailPr.additions} −{detailPr.deletions}</span> : null}</div><PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}`} pr={detailPr} token={token} onReview={mode => choose([detailPr], mode)} onAssign={() => assignSelection([detailPr])} onRefresh={() => load()} canMerge={mayMerge(detailPr.repository.viewerPermission) && !detailPr.isDraft} canAssign={mayAssign(detailPr.repository.viewerPermission)} status={statusFor(detailPr)} onProgress={() => task?.open(`task:run:${statusFor(detailPr)?.run.id}`)} record={records.find(record => record.number === detailPr.number)} onRecord={onRecord} /></> : <p>This contribution is no longer in the current list. Refresh to see its latest status.</p>}</TaskPane>
    <TaskPane id="task:review" dock><ReviewConfirmation choice={choice} busy={busy} error={error} onConfirm={start} onCancel={() => { setChoice(null); task?.close() }} onModeChange={mode => { setError(''); setChoice(old => ({ ...old, mode, request_id: crypto.randomUUID() })) }} />{!choice ? <p>This selection has finished. Choose the current PRs to start another review.</p> : null}</TaskPane>
    <TaskPane id="task:assign" dock>{assigning ? <AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onCancel={() => { setAssigning(null); task?.close() }} onAssigned={(login, keys) => {
      setData(old => ({ ...old, pulls: old.pulls.map(item => keys.includes(prKey(item)) ? { ...item, assignees: { nodes: [...new Map([...(item.assignees?.nodes || []), { login }].map(user => [user.login.toLowerCase(), user])).values()] } } : item) }))
      void onChanged?.()
    }} /> : null}</TaskPane>
    {selectionNotice ? <p className="co-pr-note" role="status">{selectionNotice}</p> : null}
    {runError ? <p className="co-pr-note" role="status">Review progress unavailable: {runError}</p> : null}
    {data.error ? <p className="co-run-error" role="alert">{data.error} Use Refresh to try again.</p> : null}
    {!data.loading && !data.error && !visible.length ? <div className="co-work-empty"><strong>No {filter === 'unassigned' ? 'unassigned ' : ''}pull requests here</strong><p>{data.hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here for review.' : 'Try All to see the project’s other contributions.'}</p></div> : null}
    <div className="co-pr-list">{visible.map(pr => {
      const status = statusFor(pr)
      const mine = pr.author?.login?.toLowerCase() === conn.login?.toLowerCase()
      return <article className={'co-pr-row' + (selected.has(prKey(pr)) ? ' is-selected' : '')} key={prKey(pr)} data-pr={prKey(pr)}>
        <label className="co-pr-select"><input type="checkbox" checked={selected.has(prKey(pr))} onChange={() => toggle(pr)} aria-label={`Select ${pr.repository.nameWithOwner} #${pr.number}`} /></label>
        <div className="co-pr-content">
          <button className="co-pr-open" aria-expanded={task?.activeId === 'task:detail' && opened === prKey(pr)} onClick={() => inspect(pr)}>
            <strong className="co-pr-title">{pr.title}</strong>
            <span className="co-pr-meta"><span>#{pr.number} · {mine ? 'You' : pr.author?.login || 'Contributor'}</span><DateLabel value={pr.updatedAt} />{showCounts && Number.isInteger(pr.changedFiles) ? <span>{pr.changedFiles} files · +{pr.additions} −{pr.deletions}</span> : null}</span>
          </button>
        </div>
        <div className="co-pr-side"><span className="co-work-state">{status ? STATE_NAMES[status.item.state] || status.item.state : pr.isDraft ? 'Draft' : 'Ready for review'}</span>
          {mayAssign(pr.repository.viewerPermission) ? <button className="co-quiet-action" onClick={() => assignSelection([pr])} aria-label={`Assign PR ${pr.number}`}>{pr.assignees?.nodes?.length ? pr.assignees.nodes.map(user => user.login.toLowerCase() === conn.login?.toLowerCase() ? 'You' : user.login).join(', ') : <Icon name="person" size={18} />}</button> : <span className="co-pr-meta">{pr.assignees?.nodes?.map(user => user.login).join(', ') || 'Unassigned'}</span>}
          {status?.run.chat_id && ['needs_you', 'failed', 'merge_unknown'].includes(status.item.state) ? <button className="co-quiet-action" onClick={() => task?.open(`task:run:${status.run.id}`)}>Needs you</button> : null}
        </div>

      </article>
    })}</div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}
    {relevantRuns.length ? <details className="co-pr-runs"><summary>Review conversations</summary>{relevantRuns.map(run => <button className="co-review-run-row" key={run.id} onClick={() => task?.open(`task:run:${run.id}`)}>
      <span>{run.mode === 'review_merge' ? 'Review & merge' : 'Private review'} · {run.items?.length || 0} PRs</span><span>{STATE_NAMES[run.state] || run.state}</span><Icon name="right" size={16} />
    </button>)}</details> : null}

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
