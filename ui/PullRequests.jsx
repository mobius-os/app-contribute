import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collaborationRequest, loadReviewRuns, REVIEW_STATE_NAMES as STATE_NAMES, reviewRunTitle, liveSelection, discoverPull, discoverPulls, matchingPulls, mayAssign, mergeSelection, prKey, reviewRunRequest, assignPulls, reviewForPull, takeoverBlocker, TAKEOVER_SCOPE, DRAFT_TAKEOVER_SCOPE } from '../collaboration.js'
import { PullRequestDetail } from './PullRequestDetail.jsx'
import { Avatar, ChecksBadge, GithubLabel, PullStateIcon, REVIEW_DECISION, TimeAgo } from './GithubParts.jsx'
import { TaskPane, useProjectTask, focusActionRegion } from './TaskPane.jsx'
import { Icon } from './Icons.jsx'
import { openAgentConversation } from './BatchAction.jsx'
import { pullConversations, recordsForPull } from '../chat-blocks.js'
import { ReviewPromptPreview, ResolvedPrompt } from './ReviewPromptSettings.jsx'
import { MarkdownView } from './MarkdownView.jsx'
import { AgentModelSettings } from './AgentModelSettings.jsx'

const FILTERS = [['all', 'All'], ['unassigned', 'Unassigned'], ['assigned', 'Assigned'], ['authored', 'Mine']]
export const isOpenPull = pr => !pr?.state || pr.state === 'OPEN'

// GitHub-style list header: the count when nothing is selected, bulk actions
// once something is. Selection never moves focus or interrupts browsing.
function SelectionTray({ selection, busy, onClear, onReview, onAssign, visible, shown = visible.length, loading = false, onSelectVisible }) {
  const selected = selection.length
  const allVisible = visible.length > 0 && visible.every(pr => selection.some(item => prKey(item) === prKey(pr)))
  return <div className="co-pr-box-head" role="group" aria-label="Pull request actions">
    <label className="co-pr-select"><input type="checkbox" checked={allVisible} onChange={onSelectVisible} aria-label="Select all visible pull requests" /></label>
    <strong className="co-pr-box-count">{selected ? `${selected} selected` : <><Icon name="pull" size={16} />{loading && !shown ? 'Open pull requests' : `${shown} open`}</>}</strong>
    {selected ? <div className="co-pr-box-actions">
      <button className="co-btn" disabled={busy || selected > 20 || !selection.every(pr => mayAssign(pr.repository.viewerPermission))} onClick={onAssign} aria-label="Assign selected PRs to a person"><Icon name="person" size={16} /><span>Assign</span></button>
      <button className="co-btn co-btn-primary" disabled={selected > 20 || busy} onClick={() => onReview(selection, 'review')} aria-label="Take selected PRs on with agent"><Icon name="prepare" size={16} /><span>Take on with agent</span></button>
      <button className="co-quiet-action" aria-label="Clear selection" onClick={onClear}><Icon name="close" size={16} /></button>
    </div> : null}
    {selected > 20 ? <p role="status">Choose up to 20 PRs per run.</p> : null}
  </div>
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
    {outcomes.filter(result => !result.ok).map(result => <p key={result.key} role="alert" className="co-run-error">{result.key}: {result.error}</p>)}
    {outcomes.some(result => result.ok) ? <p role="status">{outcomes.filter(result => result.ok).length} assigned. Only remaining PRs will be retried.</p> : null}
    {error ? <div className="co-alert" role="alert"><p className="co-alert-text">{error}</p><button className="co-btn" disabled={busy} onClick={() => load()}>Retry</button></div> : null}
  </div>
}

// A saved (frozen) selection keeps its own scope; only fresh launches consult
// the served capability. Unresolved capabilities are a pending check.
export function draftCapabilityBlocker({ drafts, capabilities, saved, allowDraft }) {
  if (!drafts || allowDraft || saved) return ''
  if (!capabilities) return 'Checking draft support…'
  return 'Draft takeover needs the Möbius update to be activated.'
}

export function ReviewConfirmation({ choice, busy, disabled, error, onConfirm, onCancel, onModeChange, appId, token, onResolved, onOptionsChange, onAgentChange }) {
  const confirmation = useRef(null)
  const [promptOptions,setPromptOptions] = useState(null)
  // null until the server preset resolves: loading is not the same as an
  // inactive capability, so the launch must not claim an update is missing.
  const [capabilities,setCapabilities] = useState(null)
  // The preview resolves what "default" means right now (owner background
  // agent setting and its quota fallback); keep that answer for the picker.
  const [defaultChoice,setDefaultChoice] = useState(null)
  const resolve = useCallback(value => {
    setPromptOptions(value?.options || null); setCapabilities(value ? (value.capabilities || {}) : null)
    if (value && !value.agent) setDefaultChoice(value.preview?.options?.choice || null)
    onResolved?.(value)
  },[onResolved])
  useEffect(() => {
    if (choice) {
      focusActionRegion(confirmation.current)
    }
  }, [choice])
  if (!choice) return null
  const takeover = choice.mode === 'review_fix_merge'
  const merge = takeover || choice.mode === 'review_merge'
  const drafts = choice.pulls.some(pr => pr.isDraft)
  const draftScope = choice.confirmation_scope === DRAFT_TAKEOVER_SCOPE
  const allowDraft = capabilities?.draft_takeover === true && (!choice.preview_sha256 || draftScope)
  // Rights do not depend on the capability read, so they explain first.
  const blocker = takeoverBlocker(choice.pulls, { allowDraft: true })
    || draftCapabilityBlocker({ drafts, capabilities, saved: !!choice.preview_sha256, allowDraft })
    || takeoverBlocker(choice.pulls, { allowDraft })
  const takeoverAvailable = !blocker
  // Posting makes Review only public, so its labels must stop saying private.
  const posting = choice.mode === 'review' && (choice.options?.post_review ?? promptOptions?.post_review) === true
  return <section ref={confirmation} tabIndex={-1} className="co-pr-confirm" aria-label="Confirm review workflow">

    <h3>{choice.pulls.length === 1 ? `Take on #${choice.pulls[0].number} with an agent` : `Take on ${choice.pulls.length} PRs with an agent`}</h3>
    <div className="co-pr-modes" role="group" aria-label="Agent workflow">
      <div className="co-pr-mode-group"><button type="button" className="co-pr-mode" aria-pressed={!merge} disabled={busy} onClick={() => onModeChange?.('review')}><strong>Review only</strong><small>{posting ? 'Findings posted on GitHub. No code changes.' : 'Private findings, no public changes.'}</small></button>
        {choice.mode === 'review' && onOptionsChange ? <label className="co-workflow-option"><input type="checkbox" checked={(promptOptions?.autopilot ?? choice.options?.autopilot) === true} disabled={busy || !promptOptions} onChange={event => onOptionsChange({ ...promptOptions, ...choice.options, autopilot:event.target.checked })} /> Continue private review automatically</label> : null}
        {choice.mode === 'review' && onOptionsChange && capabilities?.post_review === true ? <label className="co-workflow-option"><input type="checkbox" checked={(choice.options?.post_review ?? promptOptions?.post_review) === true} disabled={busy || !promptOptions} onChange={event => onOptionsChange({ ...promptOptions, ...choice.options, post_review:event.target.checked })} /><span>Post the review on GitHub<small>Adds one comment review with the verdict and findings. Never approves or requests changes.</small></span></label> : null}</div>
      {onModeChange ? <div className="co-pr-mode-group"><button type="button" className="co-pr-mode" aria-pressed={takeover} disabled={busy || !takeoverAvailable} onClick={() => onModeChange('review_fix_merge')}><strong>Review, fix &amp; merge</strong><small>{blocker || (drafts ? 'Reviews and fixes drafts, then marks ready and merges.' : 'Continues through scoped fixes and fresh review.')}</small></button></div> : null}
    </div>
    {!choice.anchor ? <ul className="co-pr-confirm-list">{choice.pulls.map(pr => <li key={prKey(pr)}><strong>#{pr.number} {pr.title}</strong><span>{pr.repository.nameWithOwner}</span></li>)}</ul> : null}
    {takeover ? <p>Public effects: scoped fixes may be pushed{draftScope ? ', drafts marked ready' : ''}, then these PRs merged or queued after independent review and required checks. {draftScope ? 'Marking ready may notify reviewers. ' : ''}No public comments or unrelated edits. Stop prevents new actions; one already underway may finish.</p> : merge ? <p>Public effect: these PRs may be merged or queued after review and required checks. No branch edits or public comments.</p> : posting ? <p>Public effect: one comment review with the verdict and findings is posted on {choice.pulls.length === 1 ? 'this PR' : 'each PR'} from your connected GitHub account. It never approves, requests changes, edits code or merges.</p> : null}
    {onAgentChange ? <AgentModelSettings token={token} choice={choice.agent} defaultChoice={defaultChoice} defaultHint="Your background agent setting" onChange={next => { onAgentChange(next); return true }} /> : null}
    {appId && token ? <ReviewPromptPreview token={token} appId={appId} choice={choice} onResolved={resolve} /> : null}
    <div className="co-board-actions">
      <button className="co-btn co-btn-primary" disabled={busy || disabled || (takeover && !takeoverAvailable)} onClick={onConfirm}>{busy ? 'Starting…' : takeover ? 'Allow scoped takeover' : merge ? 'Allow review & merge' : posting ? 'Review and post on GitHub' : 'Start private review'}</button>
      <button className="co-btn" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    {error ? <p className="co-run-error" role="alert">{error}</p> : null}
  </section>
}

export function PullRequests({ appId, token, project, conn, onChanged, records = [], onRecord, refreshKey, focusPull }) {
  const repo = project?.canonical_repo || ''
  const task = useProjectTask()
  const [data, setData] = useState({ pulls: [], loading: true, error: '' })
  const [runs, setRuns] = useState([])
  const [runError, setRunError] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchField = useRef(null)
  useEffect(() => { if (searchOpen) searchField.current?.focus() }, [searchOpen])
  const [opened, setOpened] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [selectionNotice, setSelectionNotice] = useState('')
  const [focusedPr, setFocusedPr] = useState(null)
  const [focusError, setFocusError] = useState('')
  const focusRequest = useRef(0)
  const focusDone = useRef('')
  const listRef = useRef(null)
  const allPulls = useMemo(() => focusedPr ? mergeSelection(data.pulls, [focusedPr]) : data.pulls, [focusedPr, data.pulls])
  const currentSelection = useRef({ selected, pulls: allPulls })
  currentSelection.current = { selected, pulls: allPulls }
  const [assigning, setAssigning] = useState(null)
  const [choice, setChoice] = useState(null)
  const [resolved, setResolved] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const detailSnapshots = useRef(new Map())
  const [detailRevision, setDetailRevision] = useState(0)
  function detailSnapshot(pr) {
    const key = `${prKey(pr)}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
    if (!detailSnapshots.current.has(key)) detailSnapshots.current.set(key, { entries:{}, stale:false })
    return detailSnapshots.current.get(key)
  }
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
      if (!cursor) { detailSnapshots.current.clear(); setDetailRevision(value => value + 1) }
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
      const show = next => { if (alive.current) { setRuns(next.runs || []); setRunError('') } }
      show(await loadReviewRuns(token, appId, { onList: show }))
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
  }, [conn.state, publicRevision, refreshKey, load, loadRuns])
  const focusKey = focusPull?.repo && focusPull?.number ? `${focusPull.repo.toLowerCase()}#${focusPull.number}` : ''
  const focusId = `${focusKey}:${focusPull?.nonce || ''}`
  useEffect(() => {
    const id = ++focusRequest.current
    setFocusedPr(null); setFocusError(''); focusDone.current = ''
    if (!focusKey || conn.state !== 'connected' || focusPull.repo.toLowerCase() !== repo.toLowerCase()) return
    setFilter('all'); setQuery('')
    void discoverPull(token, focusPull.repo, focusPull.number).then(pr => {
      if (id === focusRequest.current && alive.current) setFocusedPr(pr)
    }).catch(error => {
      if (id === focusRequest.current && alive.current) setFocusError(error.message)
    })
    return () => { focusRequest.current += 1 }
  }, [token, conn.state, repo, focusKey, focusPull?.nonce])
  useEffect(() => {
    if (!focusKey || focusDone.current === focusId) return
    const row = [...(listRef.current?.querySelectorAll('[data-pr-key]') || [])].find(item => item.dataset.prKey === focusKey)
    if (!row) return
    focusDone.current = focusId
    row.scrollIntoView({ block:'center', behavior:'instant' })
    row.querySelector('.co-pr-open')?.focus({ preventScroll:true })
  }, [focusId, focusKey, allPulls, filter, query])
  useEffect(() => {
    task?.setPublicKeys(new Set(allPulls.map(prKey)))
    return () => task?.setPublicKeys(new Set())
  }, [allPulls, task?.setPublicKeys])
  if (conn.state !== 'connected' || !project || !repo) return null
  const visible = matchingPulls(allPulls, filter, conn.login).filter(pr => !query.trim() || `${pr.number} ${pr.title} ${pr.author?.login || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
  const selectableVisible = visible.filter(isOpenPull)
  const selection = allPulls.filter(pr => isOpenPull(pr) && selected.has(prKey(pr)))
  const relevantRuns = runs.filter(run => !repo || run.items?.some(item => item.repo.toLowerCase() === repo.toLowerCase()))
  const statusFor = pr => reviewForPull(relevantRuns, pr)
  const detailPr = allPulls.find(pr => prKey(pr) === opened)
  function inspect(pr) { setOpened(prKey(pr)); task?.open('task:detail') }
  // A launch or assignment opened from one PR stays beside that PR; a batch
  // opens under the list header. `anchor` is only placement, never scope.
  function choose(pulls, mode, anchor = '') {
    setResolved(null)
    task?.open('task:review')
    setAssigning(null)
    setChoice({ pulls: pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), mode, anchor, ...(mode === 'review_fix_merge' ? {confirmation_scope:pulls.some(pr => pr.isDraft) ? DRAFT_TAKEOVER_SCOPE : TAKEOVER_SCOPE} : {}), request_id: crypto.randomUUID() })
    setError('')
  }
  async function start() {
    setBusy(true); setError('')
    try {
      if (!resolved) throw new Error('The selected workflow is still being checked. Try again shortly.')
      const pulls = await liveSelection(token, choice.pulls)
      const result = await collaborationRequest(token, appId, 'review-runs', reviewRunRequest({ ...choice, pulls, options:resolved.options, agent:resolved.agent, preview_sha256:resolved.preview.preview_sha256 }))
      setRuns(old => [result.run, ...old.filter(run => run.id !== result.run.id)])
      setChoice(null); setSelected(new Set())
      task?.open(`task:run:${result.run.id}`)
    } catch (error) {
      setError(error.message)
      if (error.code === 'changed') void load()
    }
    finally { setBusy(false) }
  }
  async function stopRun(run) {
    if (busy) return
    setBusy(true); setRunError('')
    try {
      const result=await collaborationRequest(token,appId,`review-runs/${encodeURIComponent(run.id)}/stop`,{})
      setRuns(old=>old.map(item=>item.id===run.id ? result.run : item))
    } catch(error) {setRunError(error.message)}
    finally {setBusy(false)}
  }
  function toggle(pr) {
    setSelected(old => { const next = new Set(old); const key = prKey(pr); next.has(key) ? next.delete(key) : next.add(key); return next })
  }
  function assignSelection(pulls = selection, anchor = '') {
    setChoice(null)
    setAssigning(Object.assign(pulls.map(pr => ({ ...pr, repository: { ...pr.repository } })), { anchor }))
    task?.open('task:assign')
  }
  // A run opens beside its PR when it covers one; batches open under the header.
  const runAnchor = run => run.items?.length === 1 ? `${run.items[0].repo.toLowerCase()}#${run.items[0].number}` : ''
  // A stopped or failed run can be started again on the PRs' current versions;
  // the new launch is a fresh consent with its own model choice.
  const retryPulls = run => (run.items || []).map(item => allPulls.find(pr => prKey(pr) === `${item.repo.toLowerCase()}#${item.number}`)).filter(pr => pr && isOpenPull(pr))
  const canRetry = run => run.state !== 'complete' && ['stopped', 'failed', 'interrupted'].includes(run.execution_state) && retryPulls(run).length > 0
  const runPane = run => <TaskPane key={run.id} dock={false} id={`task:run:${run.id}`}>
      <Icon name="review" size={23} /><h3>{reviewRunTitle(run)}</h3>
      <p>{STATE_NAMES[run.execution_state] || STATE_NAMES[run.state] || run.state}</p>{run.summary ? <p>{run.summary}</p> : null}<details className="co-task-details"><summary>Instructions used by this run</summary>{run.options ? <ResolvedPrompt snapshot={run.options} /> : <p>This older run did not save a prompt snapshot.</p>}</details>
      <div className="co-task-pulls">{run.items?.map(item => <div key={`${item.repo}:${item.number}`}><strong>#{item.number} · {['stopped', 'failed', 'interrupted'].includes(run.execution_state) && !['all_clear', 'merged', 'queued', 'complete'].includes(item.state) ? 'Not finished' : STATE_NAMES[item.state] || item.state}</strong>{item.summary ? <MarkdownView markdown={item.summary} /> : <p>The agent’s findings will appear here.</p>}{item.public_review?.state === 'posted' && item.public_review.url ? <a href={item.public_review.url} target="_blank" rel="noopener noreferrer">View the posted review on GitHub</a> : item.public_review?.state === 'posting' ? <p className="co-task-footnote">Posting the review on GitHub…</p> : item.public_review?.summary ? <p className="co-task-footnote">{item.public_review.summary}</p> : null}</div>)}</div>
      {run.chat_id ? <button className="co-btn co-btn-primary co-task-primary" onClick={() => openAgentConversation(run.chat_id)}>{run.execution_state === 'awaiting_owner' || run.items?.some(item => ['needs_you', 'failed'].includes(item.state)) ? 'Answer in review conversation' : 'Open review conversation'}</button> : null}
      {run.can_stop && run.state !== 'complete' && !['stopped','failed','interrupted'].includes(run.execution_state) ? <><button className="co-quiet-action" disabled={busy} onClick={()=>stopRun(run)}>Stop workflow</button><p className="co-task-footnote">Stop prevents future actions. An already-started public action may finish; its outcome stays visible.</p></> : null}
      {canRetry(run) ? <><button className="co-btn co-task-secondary" disabled={busy} onClick={() => choose(retryPulls(run), run.mode === 'review_merge' ? 'review' : run.mode, runAnchor(run))}>Start again</button><p className="co-task-footnote">Starts a new run on the current versions. You can pick another model.</p></> : null}
      {!run.can_stop && run.state !== 'complete' && run.chat_id && !canRetry(run) ? <p className="co-task-footnote">Use Stop in the owning conversation to stop this workflow.</p> : null}
      {runError ? <p role="alert">{runError}</p> : null}
      {run.items?.some(item => item.state === 'merged') && project.available && project.kind !== 'external' ? <button className="co-btn co-task-secondary" onClick={() => task?.open('task:update')}>Pull updates</button> : null}
      {run.items?.some(item => item.state === 'queued') ? <p>In the merge queue, not merged yet. Contribute checks GitHub and shows when it lands.</p> : null}
    </TaskPane>
  const reviewPane = <TaskPane id="task:review" dock={false}><ReviewConfirmation appId={appId} token={token} onResolved={setResolved} disabled={!resolved} onOptionsChange={options => { setResolved(null); setChoice(old => ({ ...old, options, request_id:crypto.randomUUID() })) }} onAgentChange={agent => { setResolved(null); setChoice(old => ({ ...old, agent, request_id:crypto.randomUUID() })) }} choice={choice} busy={busy} error={error} onConfirm={start} onCancel={() => { setChoice(null); task?.close() }} onModeChange={mode => { setError(''); setResolved(null); setChoice(old => ({ ...old, mode, confirmation_scope:mode === 'review_fix_merge' ? (old.pulls.some(pr => pr.isDraft) ? DRAFT_TAKEOVER_SCOPE : TAKEOVER_SCOPE) : undefined, request_id: crypto.randomUUID() })) }} />{!choice ? <p>This selection has finished. Choose the current PRs to start another review.</p> : null}</TaskPane>
  const assignPane = <TaskPane id="task:assign" dock={false}>{assigning ? <AssigneePicker key={assigning.map(prKey).join(',')} pulls={assigning} appId={appId} token={token} ownLogin={conn.login} onCancel={() => { setAssigning(null); task?.close() }} onAssigned={(login, keys) => {
      setData(old => ({ ...old, pulls: old.pulls.map(item => keys.includes(prKey(item)) ? { ...item, assignees: { nodes: [...new Map([...(item.assignees?.nodes || []), { login }].map(user => [user.login.toLowerCase(), user])).values()] } } : item) }))
      void onChanged?.()
    }} /> : null}</TaskPane>
  const visibleKeys = new Set(visible.map(prKey))
  const reviewAnchor = choice?.anchor && visibleKeys.has(choice.anchor) ? choice.anchor : ''
  const assignAnchor = assigning?.anchor && visibleKeys.has(assigning.anchor) ? assigning.anchor : ''
  return <section className="co-public-work" aria-label="Pull requests">
    <div className={'co-pr-list-controls' + (searchOpen ? ' is-searching' : '')}>
      <label className="co-pr-search"><Icon name="search" size={16} /><input ref={searchField} type="search" aria-label="Find a pull request" placeholder="Search pull requests" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button type="button" className="co-pr-search-toggle" aria-label={query ? `Search PRs: ${query}` : 'Search pull requests'} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}><Icon name="search" size={18} /></button>
      <div className="co-pr-filters" role="group" aria-label="Filter pull requests">{FILTERS.map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    </div>
    {selectionNotice ? <p className="co-pr-note" role="status">{selectionNotice}</p> : null}
    {focusError ? <p className="co-pr-note" role="alert">Could not find that pull request: {focusError}</p> : null}
    {runError ? <p className="co-pr-note" role="status">Agent progress unavailable: {runError}</p> : null}
    {data.error ? <div className="co-alert" role="alert"><strong>Couldn’t load pull requests</strong><p className="co-alert-text">{data.error}</p><button className="co-btn" disabled={data.loading} onClick={() => { void load(); void loadRuns() }}>Try again</button></div> : null}
    <div className="co-pr-box">
    <SelectionTray selection={selection} visible={selectableVisible} shown={data.hasNextPage ? data.total || visible.length : visible.length} loading={data.loading} busy={busy} onClear={() => setSelected(new Set())} onSelectVisible={() => setSelected(old => { const next = new Set(old); const all = selectableVisible.every(pr => next.has(prKey(pr))); selectableVisible.forEach(pr => all ? next.delete(prKey(pr)) : next.add(prKey(pr))); return next })} onReview={choose} onAssign={() => assignSelection()} />
    {!reviewAnchor ? reviewPane : null}
    {!assignAnchor ? assignPane : null}
    {relevantRuns.filter(run => !visibleKeys.has(runAnchor(run))).map(runPane)}
    {data.loading && !allPulls.length ? <p className="co-pr-empty" role="status">Loading pull requests…</p> : null}
    {!data.loading && !data.error && !visible.length ? <div className="co-pr-empty"><strong>No {filter === 'unassigned' ? 'unassigned ' : filter === 'assigned' ? 'assigned ' : ''}pull requests{query ? ' match' : ''}</strong><p>{data.hasNextPage ? 'Load more to search the remaining results.' : filter === 'all' ? 'When work is shared on GitHub, it appears here.' : 'Try All to see the project’s other pull requests.'}</p></div> : null}
    <div className="co-pr-list" ref={listRef}>{visible.map(pr => {
      const key = prKey(pr)
      const status = statusFor(pr)
      // A run whose conversation stopped or failed is not still reviewing.
      const halted = !!status && ['stopped', 'failed', 'interrupted'].includes(status.run.execution_state) && !['all_clear', 'merged', 'queued', 'complete'].includes(status.item.state)
      const waiting = status?.run.execution_state === 'awaiting_owner' && !['all_clear', 'merged', 'queued', 'complete'].includes(status.item.state)
      const attention = halted || waiting || (status?.run.chat_id && ['needs_you', 'failed', 'merge_unknown', 'ready_unknown'].includes(status.item.state))
      const assignees = pr.assignees?.nodes || []
      const comments = pr.comments?.totalCount || 0
      return <article className={'co-pr-row' + (selected.has(key) ? ' is-selected' : '') + (focusKey === key ? ' is-highlighted' : '')} key={key} data-pr={key} data-pr-key={key}>
        <label className="co-pr-select"><input type="checkbox" checked={isOpenPull(pr) && selected.has(key)} disabled={!isOpenPull(pr)} onChange={() => toggle(pr)} aria-label={`Select ${pr.repository.nameWithOwner} #${pr.number}`} /></label>
        <PullStateIcon pr={pr} />
        <div className="co-pr-content">
          <button className="co-pr-open" aria-expanded={task?.activeId === 'task:detail' && opened === key} onClick={() => {
            if (window.getSelection?.()?.toString().trim()) return
            inspect(pr)
          }}>
            <span className="co-pr-title">{pr.title}</span>
            {pr.labels?.nodes?.map(label => <GithubLabel key={label.name} name={label.name} color={label.color} />)}
          </button>
          <div className="co-pr-meta">
            <span>#{pr.number} · {pr.author?.login || 'Contributor'} <TimeAgo prefix="opened " value={pr.createdAt} /></span>
            {pr.isDraft ? <span>Draft</span> : null}
            {REVIEW_DECISION[pr.reviewDecision] && pr.reviewDecision !== 'REVIEW_REQUIRED' ? <span>{REVIEW_DECISION[pr.reviewDecision]}</span> : null}
            <ChecksBadge pr={pr} />
            {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
            {status ? <button className={'co-pr-agent-state' + (attention ? ' needs-you' : '')} onClick={() => task?.open(`task:run:${status.run.id}`)}><Icon name="prepare" size={13} />{halted ? 'Run stopped' : attention ? (['merge_unknown','ready_unknown'].includes(status.item.state) ? 'Check outcome' : 'Needs you') : status.item.state === 'all_clear' && !status.exactBase ? `Reviewed on an older ${pr.baseRefName}` : (STATE_NAMES[status.item.state] || status.item.state)}</button> : null}
          </div>
        </div>
        <div className="co-pr-aside">
          {comments ? <span className="co-pr-comments" title={`${comments} ${comments === 1 ? 'comment' : 'comments'}`}><Icon name="comment" size={16} />{comments}</span> : null}
          {isOpenPull(pr) && mayAssign(pr.repository.viewerPermission)
            ? <button className="co-pr-assign" onClick={() => assignSelection([pr], key)} aria-label={assignees.length ? `Assigned to ${assignees.map(user => user.login).join(', ')}. Change assignment for PR ${pr.number}` : `Assign PR ${pr.number}`} title={assignees.length ? assignees.map(user => user.login).join(', ') : 'Assign'}>{assignees.length ? <span className="co-gh-avatars">{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : <Icon name="person" size={16} />}</button>
            : assignees.length ? <span className="co-gh-avatars" title={assignees.map(user => user.login).join(', ')}>{assignees.slice(0, 3).map(user => <Avatar key={user.login} login={user.login} />)}</span> : null}
          {isOpenPull(pr) ? <button type="button" className="co-pr-agent-action" disabled={busy} onClick={() => choose([pr], 'review', key)} aria-label={`Take PR ${pr.number} on with an agent`} title="Take on with agent"><Icon name="prepare" size={16} /></button> : null}
        </div>
        {reviewAnchor === key ? reviewPane : null}
        {assignAnchor === key ? assignPane : null}
        {relevantRuns.filter(run => runAnchor(run) === key).map(runPane)}
        {opened === key ? <TaskPane id="task:detail" dock={false}>{detailPr ? <PullRequestDetail key={`${prKey(detailPr)}:${detailPr.headRefOid}:${detailPr.baseRefOid}:${detailRevision}`} cacheStore={detailSnapshot(detailPr)} pr={detailPr} token={token} onReview={mode => choose([detailPr], mode, key)} onAssign={() => assignSelection([detailPr], key)} onRefresh={() => load()} canAssign={isOpenPull(detailPr) && mayAssign(detailPr.repository.viewerPermission)} readOnly={!isOpenPull(detailPr)} status={statusFor(detailPr)} onProgress={() => task?.open(`task:run:${statusFor(detailPr)?.run.id}`)} record={recordsForPull(records, detailPr)[0]} provenance={pullConversations(records, relevantRuns, detailPr)} onRecord={onRecord} /> : <p>This pull request is no longer in the current list. Refresh to see its latest status.</p>}</TaskPane> : null}
      </article>
    })}</div>
    </div>
    {data.hasNextPage ? <button className="co-btn" disabled={data.loading} onClick={() => load(data.endCursor)}>Load more PRs</button> : null}


  </section>
}
