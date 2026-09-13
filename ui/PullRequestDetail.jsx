import { useEffect, useState } from 'react'
import { loadPullActivity, loadPullDescription, loadPullFiles } from '../pull-details.js'
import { MarkdownView } from './MarkdownView.jsx'

export function DateLabel({ value, prefix = '' }) {
  if (!value || !Number.isFinite(Date.parse(value))) return null
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{prefix}{new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</time>
}
export function PullRequestDetail({ pr, token, onReview, onAssign, onRefresh, canMerge, canAssign, status, onProgress, onRecord, record }) {
  const [tab, setTab] = useState('description')
  const [cache, setCache] = useState({})
  const [page, setPage] = useState({ files: 1, activity: 1 })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const number = page[tab] || 1
    setCache(old => ({ ...old, [tab]: { ...old[tab], loading: true, error: '' } }))
    const loader = tab === 'description' ? () => loadPullDescription(token, pr, controller.signal)
      : tab === 'files' ? () => loadPullFiles(token, pr, number, controller.signal)
        : () => loadPullActivity(token, pr, number, controller.signal)
    loader().then(data => {
      if (!current) return
      setCache(old => ({ ...old, [tab]: { data, loading: false, error: '' } }))
    }).catch(error => {
      if (current) setCache(old => ({ ...old, [tab]: { loading: false, error: error.message, stale: error.code === 'stale' } }))
    })
    return () => { current = false; controller.abort() }
  }, [tab, page.files, page.activity, retry, token, pr.headRefOid, pr.baseRefOid, pr.baseRefName])
  const view = cache[tab] || { loading: true }
  const detail = cache.description?.data
  const stale = Object.values(cache).some(value => value.stale)
  return <div className="co-pr-detail" aria-label={`Details for PR ${pr.number}`}>
    <nav className="co-detail-tabs" aria-label="Contribution details">{[['description', 'Description'], ['files', 'Files'], ['activity', 'Activity']].map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}{key === 'files' && Number.isInteger(pr.changedFiles) ? ` ${pr.changedFiles}` : ''}</button>)}</nav>
    <div className="co-detail-stats"><DateLabel prefix="Opened " value={pr.createdAt} /><DateLabel prefix="Updated " value={pr.updatedAt} /><span>{pr.reviewDecision === 'APPROVED' ? 'GitHub review approved' : pr.reviewDecision === 'CHANGES_REQUESTED' ? 'Changes requested' : 'GitHub review pending'}</span><span>{pr.mergeable === 'CONFLICTING' ? 'Has merge conflicts' : pr.mergeable === 'MERGEABLE' ? 'No merge conflicts reported' : 'Mergeability not yet known'}</span></div>
    {view.loading ? <p role="status">Loading {tab}…</p> : null}
    {view.error ? <div role="alert"><p>{view.error}</p><button className="co-btn" onClick={view.stale ? onRefresh : () => setRetry(value => value + 1)}>{view.stale ? 'Refresh PR list' : 'Try again'}</button></div> : null}
    {!view.loading && !view.error && tab === 'description' ? <><MarkdownView markdown={detail?.body || 'No description was provided.'} />
      {detail?.labels?.length ? <p className="co-detail-stats">{detail.labels.map(label => <span key={label.name}>{label.name}</span>)}</p> : null}
      <details className="co-task-details"><summary>Technical details</summary><p>Head <code>{pr.headRefOid}</code><br />Base <code>{pr.baseRefName} · {pr.baseRefOid}</code></p></details>
    </> : null}
    {!view.loading && !view.error && tab === 'files' ? <>
      {(view.data?.files || []).map(file => <details key={file.filename} className="co-file-disclosure"><summary>{file.filename} <span className="co-detail-stats">{file.status} · +{file.additions} −{file.deletions}</span></summary>{file.previous_filename ? <p>Previously {file.previous_filename}</p> : null}{file.patch ? <pre><code>{file.patch}</code></pre> : <p>No text patch is available for this file; it may be binary or too large.</p>}</details>)}
      {!view.data?.files?.length ? <p>No changed files returned.</p> : null}
      <p className="co-pr-note">GitHub may omit or shorten large patches. A displayed patch is not proof that the complete change has been reviewed.</p>
      {view.data?.capped ? <p>GitHub’s 3,000-file limit has been reached. Use the review conversation for the full source.</p> : null}
    </> : null}
    {!view.loading && tab === 'activity' ? <>
      {view.data?.errors?.map(message => <p key={message} role="alert">{message} <button className="co-btn" onClick={() => setRetry(value => value + 1)}>Retry</button></p>)}
      {view.data?.items?.map(item => <article className="co-activity-item" key={`${item.kind}:${item.id}`}><header>{item.user?.login || 'Contributor'} · {item.kind === 'review' ? (item.state || 'Reviewed').toLowerCase().replaceAll('_', ' ') : 'commented'} · <DateLabel value={item.date} /></header><MarkdownView markdown={item.body || 'No written comment.'} /></article>)}
      {!view.data?.items?.length && !view.error ? <p>No review comments on this page.</p> : null}
      <p className="co-pr-note">Conversation comments and reviews. Commit and queue events remain in the review conversation or on GitHub.</p>
      {record ? <button className="co-quiet-action" onClick={() => onRecord?.(record)}>Local preparation & source conversation</button> : null}
    </> : null}
    {tab !== 'description' && !view.loading ? <div className="co-board-actions">{page[tab] > 1 ? <button className="co-btn" onClick={() => setPage(old => ({ ...old, [tab]: old[tab] - 1 }))}>Previous page</button> : null}{view.data?.hasMore ? <button className="co-btn" onClick={() => setPage(old => ({ ...old, [tab]: old[tab] + 1 }))}>Next page</button> : null}</div> : null}
    <div className="co-board-actions"><button className="co-btn co-btn-primary" disabled={stale} onClick={() => onReview('review')}>Review this PR</button>{canMerge ? <button className="co-btn" disabled={stale} onClick={() => onReview('review_merge')}>Review & merge</button> : null}{canAssign ? <button className="co-btn" disabled={stale} onClick={onAssign}>Assign</button> : null}{status ? <button className="co-btn" onClick={onProgress}>Review progress</button> : null}<a className="co-quiet-action" href={pr.url} target="_blank" rel="noopener noreferrer">Open on GitHub</a></div>
  </div>
}
