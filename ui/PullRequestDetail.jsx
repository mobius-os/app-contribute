import { useEffect, useState } from 'react'
import { loadPullActivity, loadPullChecks, loadPullDescription, loadPullFiles, loadPullRelated, loadPullThreads, pullFileDiff, safeDetailLink } from '../pull-details.js'
import { MarkdownView } from './MarkdownView.jsx'
import DiffView from './diff/DiffView.jsx'
import { Icon } from './Icons.jsx'
import { ChecksBadge, GithubLabel, PullStateBadge, REVIEW_DECISION } from './GithubParts.jsx'
import { checkSummary } from '../collaboration.js'

export function DateLabel({ value, prefix = '' }) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return <time dateTime={value} title={new Date(value).toLocaleString(undefined, { hourCycle: 'h23' })}>{prefix}{new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time>
}
function DetailLink({ href, children }) {
  const safe = safeDetailLink(href)
  return safe ? <a className="co-quiet-action" href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
}
function threadLocation(thread) {
  const side = thread.diffSide === 'LEFT' ? 'old' : thread.diffSide === 'RIGHT' ? 'new' : 'unknown-side'
  if (thread.subjectType === 'FILE') return 'file discussion'
  if (Number.isInteger(thread.line)) {
    const range = Number.isInteger(thread.startLine) && thread.startLine !== thread.line
    if (range && thread.startDiffSide && thread.startDiffSide !== thread.diffSide) return `${thread.startDiffSide === 'LEFT' ? 'old' : 'new'} line ${thread.startLine} → ${side} line ${thread.line}`
    return `${side} line ${range ? `${thread.startLine}–` : ''}${thread.line}`
  }
  if (Number.isInteger(thread.originalLine)) return `original line ${thread.originalStartLine && thread.originalStartLine !== thread.originalLine ? `${thread.originalStartLine}–` : ''}${thread.originalLine}`
  return 'line unavailable'
}
function ReadErrors({ errors, onRetry }) {
  return errors?.map(message => <p key={message} role="alert">{message} <button className="co-btn" onClick={onRetry}>Retry</button></p>)
}
export function PullFileTotals({ totals, label = 'Total change' }) {
  if (!totals || Object.values(totals).every(value => value === null)) return null
  return <p className="co-detail-stats" aria-label={label}><span>{label}</span>{totals.files !== null ? <span>{totals.files} {totals.files === 1 ? 'file' : 'files'}</span> : null}{totals.additions !== null ? <span className="co-file-add">+{totals.additions} lines</span> : null}{totals.deletions !== null ? <span className="co-file-del">−{totals.deletions} lines</span> : null}</p>
}
export function PullFiles({ data }) {
  const totals = data?.totals
  return <>
    {Number.isInteger(totals?.files) ? <p className="co-pr-note">Showing {totals.files} changed {totals.files === 1 ? 'file' : 'files'}{Number.isInteger(totals.additions) ? ` with ${totals.additions} additions and ${totals.deletions ?? 0} deletions` : ''}{data?.page > 1 ? ` · page ${data.page}` : ''}. GitHub may omit or shorten large patches.</p> : null}
    {(data?.files || []).map(file => <details key={file.filename} className="co-file-disclosure"><summary>{file.filename} <span className="co-detail-stats">{file.status} · +{file.additions} −{file.deletions}</span></summary>{file.previous_filename ? <p>Previously {file.previous_filename}</p> : null}{file.patch ? <DiffView file={pullFileDiff(file)} /> : <p>No text patch is available for this file; it may be binary or too large.</p>}</details>)}
    {!data?.files?.length ? <p>No changed files returned on this page.</p> : null}
    {data?.capped ? <p>GitHub’s 3,000-file limit has been reached. More files may be omitted; use the review conversation for the full source.</p> : null}
  </>
}
export function PullChecks({ data }) {
  return <>
    <p className="co-pr-note">Reported by GitHub for this version{data?.page > 1 ? ` · page ${data.page}` : ''}. Checks are not an all-clear review.</p>
    {data?.groups?.map(group => <section key={group.name} aria-label={group.name}>
      <h4>{group.name}{group.total !== null ? ` · ${group.total}` : ''}</h4>
      {group.hasMore ? <p className="co-pr-note">More results remain on GitHub.</p> : null}
      {group.items.map(item => <article className="co-activity-item" key={item.id}>
        <header style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', overflowWrap: 'anywhere' }}><strong>{item.name || item.context || 'Unnamed check'}</strong><span>{(item.conclusion || item.status || item.state || 'unknown').replaceAll('_', ' ')}</span><DateLabel value={item.completed_at || item.updated_at || item.started_at || item.created_at} /></header>
        {item.output?.title || item.description ? <p>{item.output?.title || item.description}</p> : null}
        {item.details_url || item.target_url || item.html_url ? <DetailLink href={item.details_url || item.target_url || item.html_url}>View result</DetailLink> : null}
      </article>)}
      {!group.items.length ? <p>No {group.name.toLowerCase()} returned on this page.</p> : null}
    </section>)}
    {data?.capped ? <p>Only the first 100 result pages are available here. More results remain on GitHub.</p> : null}
  </>
}
export function PullRelated({ data }) {
  if (!data?.items?.length) return null
  return <section aria-label="Related issues and pull requests"><h4>Related issues & PRs</h4>
    {data?.items?.map(item => <p key={item.url} style={{ overflowWrap: 'anywhere' }}><span className="co-pr-note">{item.relationships.join(' · ')} · </span><DetailLink href={item.url}>{item.__typename === 'PullRequest' ? 'PR' : 'Issue'} {item.repository?.nameWithOwner}#{item.number} · {item.title}</DetailLink></p>)}
    {data?.truncated ? <p>Showing the first 50 closing issues and first 50 cross-reference events. More references remain on GitHub.</p> : null}
  </section>
}
export function PullThreads({ data }) {
  if (!data?.threads?.length) return null
  return <section aria-label="Inline review discussions"><h4>Inline discussions</h4>
    {data?.threads?.map(thread => <article className="co-activity-item" key={thread.id}>
      <header style={{ overflowWrap: 'anywhere' }}><strong>{thread.path || 'File not provided'}</strong> · {threadLocation(thread)} · {thread.isResolved === true ? 'Resolved' : thread.isResolved === false ? 'Unresolved' : 'Resolution unknown'}{thread.isOutdated ? ' · Outdated location' : ''}</header>
      {thread.comments?.nodes?.filter(Boolean).map(comment => <div key={comment.id} style={{ padding: '12px 0' }}><div className="co-detail-stats"><span>{comment.author?.login || 'Contributor'}</span><DateLabel value={comment.createdAt} /><DetailLink href={comment.url}>View comment</DetailLink></div><MarkdownView markdown={comment.body || 'No written comment.'} /></div>)}
      {thread.comments?.pageInfo?.hasNextPage ? <p className="co-pr-note">First 50 of {thread.comments.totalCount} comments shown in this thread. More replies remain on GitHub.</p> : null}
      {!thread.comments ? <p role="alert">Thread comments are unavailable.</p> : null}
    </article>)}
  </section>
}
// Key the complete local cache to the exact selected identity. Equal SHAs in
// different PRs must not reuse descriptions, pages, or stale-state decisions.
export function PullRequestDetail(props) {
  const pr = props.pr
  const identity = `${pr.repository?.nameWithOwner}#${pr.number}:${pr.headRefOid}:${pr.baseRefOid}:${pr.baseRefName}`
  return <PullRequestDetailView key={identity} {...props} />
}
function PullRequestDetailView({ cacheStore, pr, token, onReview, onAssign, onRefresh, canAssign, status, onProgress, onRecord, record, readOnly = false, provenance = [] }) {
  const [tab, setTab] = useState('conversation')
  const [cache, setCache] = useState(() => cacheStore?.entries || {})
  const [page, setPage] = useState({ files: 1, checks: 1, conversation: 1 })
  const [threadCursors, setThreadCursors] = useState([null])
  const [retry, setRetry] = useState(0)
  const [versionStale, setVersionStale] = useState(cacheStore?.stale === true)
  useEffect(() => {
    if (!cacheStore) return
    // Incomplete reads are aborted on close and must be retried, not cached
    // as a permanent loader. This snapshot belongs to the project/PR version.
    cacheStore.entries = Object.fromEntries(Object.entries(cache).filter(([,value]) => !value.loading))
    cacheStore.stale = versionStale
  }, [cache, cacheStore, versionStale])
  const threadCursor = threadCursors[threadCursors.length - 1]
  const number = page[tab] || 1
  // Conversation is GitHub's first tab: the description plus its comments,
  // reviews, inline discussions and links. Each is an independent read so one
  // failure never blanks the others.
  const keys = tab === 'conversation'
    ? { description: 'description:1', activity: `activity:${number}`, threads: `threads:${threadCursor || ''}`, related: 'related' }
    : tab === 'commits' ? {} : { view: `${tab}:${number}` }
  const keySignature = Object.values(keys).join('|')
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const started = []
    function read(key, loader) {
      if (cache[key]) return
      started.push(key)
      setCache(old => ({ ...old, [key]: { loading: true } }))
      loader().then(data => {
        if (current) setCache(old => ({ ...old, [key]: { data, loading: false } }))
      }).catch(error => {
        if (current) {
          if (error.code === 'stale') setVersionStale(true)
          setCache(old => ({ ...old, [key]: { loading: false, error: error.message, stale: error.code === 'stale' } }))
        }
      })
    }
    if (tab === 'conversation') {
      read(keys.description, () => loadPullDescription(token, pr, controller.signal))
      read(keys.activity, () => loadPullActivity(token, pr, number, controller.signal))
      read(keys.threads, () => loadPullThreads(token, pr, threadCursor, controller.signal))
      read(keys.related, () => loadPullRelated(token, pr, controller.signal))
    } else if (tab !== 'commits') {
      read(keys.view, () => tab === 'files' ? loadPullFiles(token, pr, number, controller.signal) : loadPullChecks(token, pr, number, controller.signal))
    }
    return () => {
      current = false; controller.abort()
      setCache(old => {
        const next = { ...old }
        for (const key of started) if (next[key]?.loading) delete next[key]
        return next
      })
    }
  }, [keySignature, retry, token, pr.number, pr.repository?.nameWithOwner, pr.headRefOid, pr.baseRefOid, pr.baseRefName])
  const entry = key => cache[key] || { loading: true }
  const stale = versionStale || Object.values(cache).some(value => value.stale)
  const tryAgain = () => {
    const mine = new Set(Object.values(keys))
    setCache(old => Object.fromEntries(Object.entries(old).filter(([key, value]) => !mine.has(key) || (!value.error && !value.data?.errors?.length))))
    setRetry(value => value + 1)
  }
  const retryRelated = () => {
    setCache(old => { const next = { ...old }; delete next[keys.related]; return next })
    setRetry(value => value + 1)
  }
  function readState(value, label, onRetry = tryAgain) {
    return <>{value.loading ? <p className="co-pr-note" role="status">Loading {label}…</p> : null}{value.error ? <div role="alert"><p>{value.error}</p><button className="co-btn" onClick={value.stale ? onRefresh : onRetry}>{value.stale ? 'Refresh PR list' : 'Try again'}</button></div> : null}<ReadErrors errors={value.data?.errors} onRetry={onRetry} /></>
  }
  const ready = value => !value.loading && !value.error && !stale
  const description = entry(keys.description || '')
  const activity = entry(keys.activity || '')
  const threads = entry(keys.threads || '')
  const related = entry(keys.related || '')
  const view = entry(keys.view || '')
  const pager = (current, hasMore, unknown, set) => current > 1 || hasMore ? <div className="co-board-actions">
    {current > 1 ? <button className="co-btn" onClick={() => set(current - 1)}>Previous page</button> : null}
    {hasMore ? <button className="co-btn" onClick={() => set(current + 1)}>{unknown ? 'Check next page' : 'Next page'}</button> : null}
  </div> : null
  const labels = pr.labels?.nodes || []
  const tabs = [['conversation', 'Conversation'], ['commits', 'Commits'], ['files', 'Files changed'], ['checks', 'Checks']]
  const repoName = pr.repository?.nameWithOwner
  const repoUrl = /^[\w.-]+\/[\w.-]+$/.test(repoName || '') ? `https://github.com/${repoName}` : null
  const comments = pr.comments?.totalCount
  const reviews = pr.reviews?.totalCount
  const conversationCount = Number.isInteger(comments) && comments >= 0 && Number.isInteger(reviews) && reviews >= 0 ? comments + reviews : null
  const commitCount = pr.commits?.totalCount
  return <div className="co-pr-detail" aria-label={`Details for PR ${pr.number}`}>
    <header className="co-gh-pr-head">
      <h3 className="co-gh-pr-title">{pr.title} <span>#{pr.number}</span></h3>
      <div className="co-gh-pr-sub"><PullStateBadge pr={pr} /><span><b>{pr.author?.login || 'Someone'}</b> wants to merge {pr.headRefName ? <code>{pr.headRefName}</code> : 'a branch'} into <code>{pr.baseRefName || 'unknown base'}</code></span></div>
      {repoName ? <p className="co-gh-pr-repo">Repository: {repoUrl ? <a className="co-repo-link" href={repoUrl} target="_blank" rel="noopener noreferrer">{repoName}</a> : repoName}</p> : null}
      {labels.length ? <div className="co-gh-labels">{labels.map(label => <GithubLabel key={label.name} name={label.name} color={label.color} />)}</div> : null}
    </header>
    <div className="co-pr-detail-actions">
      {!readOnly ? <button className="co-btn co-btn-primary" disabled={stale} onClick={() => onReview?.('review')}><Icon name="prepare" /> Take on with agent</button> : null}
      {!readOnly && canAssign ? <button className="co-btn" disabled={stale} onClick={onAssign}><Icon name="person" /> Assign</button> : null}
      {!readOnly && status ? <button className="co-btn" onClick={onProgress}>Agent progress</button> : null}
      <DetailLink href={pr.url}>Open on GitHub</DetailLink>
    </div>
    {provenance.length ? <p className="co-gh-provenance"><Icon name="feedback" size={16} /><span>From</span>{provenance.map(link => <button className="co-gh-chat-link" key={`${link.chat_id}:${link.role}`} onClick={() => window.parent.postMessage({type:'moebius:open-chat',chatId:link.chat_id},'*')} title={link.role === 'source' ? 'Created or modified this PR' : link.role === 'fix' ? 'Fixed this PR' : 'Reviewed this PR'}>{link.title}</button>)}</p> : null}
    <div className="co-gh-review-status" aria-label="GitHub checks and review status"><div><strong>Checks</strong>{checkSummary(pr)?.total ? <ChecksBadge pr={pr} /> : <span>Not available</span>}</div><div><strong>Review</strong><span>{REVIEW_DECISION[pr.reviewDecision] || 'Status unavailable'}</span></div><p>GitHub checks are not an all-clear private review.</p></div>
    <nav className="co-detail-tabs" aria-label="Pull request details">{tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}
      {key === 'conversation' && conversationCount !== null ? <span className="co-tab-count" title={`${comments} comments and ${reviews} reviews`}>{conversationCount}</span> : null}
      {key === 'commits' && Number.isInteger(commitCount) && commitCount >= 0 ? <span className="co-tab-count">{commitCount}</span> : null}
      {key === 'files' && Number.isInteger(pr.changedFiles) ? <><span className="co-tab-count">{pr.changedFiles}</span><span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span></> : null}
      {key === 'checks' ? <ChecksBadge pr={pr} /> : null}</button>)}</nav>
    <div className="co-pr-detail-body" role="region" aria-label="Pull request context">
    {stale ? <p role="alert">This PR changed since the list was loaded. <button className="co-btn" onClick={onRefresh}>Refresh PR list</button></p> : null}
    {tab === 'conversation' ? <>
      {readState(description, 'description')}
      {ready(description) ? <article className="co-gh-comment"><header><b>{description.data?.user?.login || pr.author?.login}</b> <DateLabel prefix="opened " value={pr.createdAt} /></header><MarkdownView markdown={description.data?.body || '_No description provided._'} /></article> : null}
      {ready(activity) ? activity.data?.items?.map(item => <article className="co-gh-comment" key={`${item.kind}:${item.id}`}><header><b>{item.user?.login || 'Contributor'}</b> {item.kind === 'review' ? (item.state || 'reviewed').toLowerCase().replaceAll('_', ' ') : 'commented'} <DateLabel value={item.date} />{item.html_url ? <DetailLink href={item.html_url}>View</DetailLink> : null}</header>{item.body ? <MarkdownView markdown={item.body} /> : null}</article>) : null}
      {readState(activity, 'comments')}
      {ready(activity) ? pager(number, activity.data?.hasMore, false, value => setPage(old => ({ ...old, conversation: value }))) : null}
      {readState(threads, 'inline discussions')}
      {ready(threads) ? <><PullThreads data={threads.data} />{threadCursors.length > 1 || threads.data?.hasMore ? <div className="co-board-actions">{threadCursors.length > 1 ? <button className="co-btn" onClick={() => setThreadCursors(old => old.slice(0, -1))}>Previous discussions</button> : null}{threads.data.hasMore && threads.data.nextCursor ? <button className="co-btn" onClick={() => setThreadCursors(old => [...old, threads.data.nextCursor])}>More discussions</button> : null}</div> : null}</> : null}
      {readState(related, 'related issues', retryRelated)}
      {ready(related) ? <PullRelated data={related.data} /> : null}
      <p className="co-gh-merge-state">{[REVIEW_DECISION[pr.reviewDecision], pr.mergeable === 'CONFLICTING' ? 'Has merge conflicts' : pr.mergeable === 'MERGEABLE' ? 'No conflicts with base branch' : null].filter(Boolean).join(' · ')}</p>
      {record && onRecord ? <button className="co-quiet-action" onClick={() => onRecord(record)}>Local preparation &amp; source conversation</button> : null}
    </> : null}
    {tab === 'commits' ? <p className="co-pr-note">Commit history is unavailable here. {safeDetailLink(pr.url) ? <DetailLink href={pr.url}>View PR on GitHub</DetailLink> : null}</p> : null}
    {tab === 'files' || tab === 'checks' ? readState(view, tab === 'files' ? 'files' : 'checks') : null}
    {tab === 'files' && ready(view) ? <PullFiles data={view.data} /> : null}
    {tab === 'checks' && ready(view) ? <PullChecks data={view.data} /> : null}
    {(tab === 'files' || tab === 'checks') && ready(view) ? pager(number, view.data?.hasMore, view.data?.paginationUnknown, value => setPage(old => ({ ...old, [tab]: value }))) : null}
    {tab === 'checks' && !view.loading ? <button className="co-quiet-action" onClick={() => { setCache(old => { const next = { ...old }; delete next[keys.view]; return next }); setRetry(value => value + 1) }}>Refresh checks</button> : null}
    </div>
  </div>
}
