import { useEffect, useMemo, useRef, useState } from 'react'
import { qualityReviewFor, reviewStateFor } from '../review.js'
import { attemptTarget, createInlineSession, publicationContextMatches, settled } from '../inline-session.js'
import { loadFreshContributionRecord } from '../storage.js'
import { publicationStackUnit, stackPublicationRecords, stackReadiness } from '../stack.js'
import { ContributionCard, RepoLink } from './ContributionCard.jsx'
import { Icon } from './Icons.jsx'

// One prepared contribution shown inside a chat transcript block. The block
// names only the ledger record; the view reads that exact record at once (a
// freshly prepared record is usually not in the cached feed, and the full
// ledger scan can take a while) and otherwise follows the live ledger. Send
// uses the same guarded handlers as the main queue, so a transcript view never
// sends a version the owner has not seen.
export function newerRecord(left, right) {
  if (!left || !right) return left || right || null
  const stamp = rec => String(rec.updated_at || rec.created_at || '')
  return stamp(right) > stamp(left) ? right : left
}

// Click-open and passive blocks share one outcome owner. This adapter only
// connects ordinary clicks/rendering to that session; it saves no approval,
// emits no host event, and cannot expand a host capability or retry Send.
function useFallbackPublication(ids, records, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh, ledger = records) {
  const key = ids.join(',')
  const session = useRef(null), latest = useRef(null), published = useRef(null)
  const [state, setState] = useState(null), [snapshots, setSnapshots] = useState({})
  latest.current = { records, ledger, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh }
  useEffect(() => {
    const initial = latest.current
    const members = [...new Set(ids.flatMap(id => {
      const record = initial.records.find(rec => rec.id === id)
      return record ? (publicationStackUnit(record, initial.records)?.records || [record]).map(rec => rec.id) : [id]
    }))]
    const actions = members.map(id => ({ key: `chat-send:${id}`, label: 'Contribute' }))
    if (ids.length) actions.push({ key: `chat-send-batch:${key}`, label: 'Contribute all' })
    const next = createInlineSession({ sessionId: `fallback:${key}`, actions,
      publish: value => { published.current = value; setState(value) },
      loadExact: loadFreshContributionRecord,
      send: record => { remember([record]); return latest.current.onSend(record) },
      sendStack: chain => { remember(chain); return latest.current.onSendStack(chain) },
      refresh: () => latest.current.onRefresh?.(),
    })
    session.current = next; published.current = null; setState(null); setSnapshots({})
    next.updateLedger(initial.ledger, initial.ledgerReady, initial.reviewStatus)
    void next.hydrate()
    return () => { next.dispose(); if (session.current === next) session.current = null }
  }, [key])
  useEffect(() => {
    session.current?.updateLedger(ledger, ledgerReady, reviewStatus)
    void session.current?.hydrate()
  }, [ledger, ledgerReady, reviewStatus])
  function remember(copied) {
    setSnapshots(previous => ({ ...previous, ...Object.fromEntries(copied.map(record => [record.id, structuredClone(record)])) }))
  }
  const action = id => state && { ...session.current?.readAction(id), readyToFreeze: session.current?.canFreeze(`chat-send:${id}`) }
  const batchAction = state?.actions.find(item => item.key === `chat-send-batch:${key}`)
  const batch = batchAction && { ...batchAction, readyToFreeze: session.current?.canFreeze(batchAction.key) }
  async function contribute(actionKey) {
    const current = published.current?.actions.find(item => item.key === actionKey)
    if (!session.current || !current || current.disabled || !session.current.canFreeze(actionKey)) return { pending: true }
    // Copy the visible target before activation/hash awaits. It is only local
    // presentation history; the session separately owns frozen approval/proof.
    const addressed = actionKey.startsWith('chat-send-batch:') ? ids : [actionKey.slice('chat-send:'.length)]
    const copied = [...new Map(addressed.flatMap(id => {
      const record = displayRecords.find(rec => rec.id === id)
      return record ? publicationStackUnit(record, displayRecords)?.records || [record] : []
    }).map(record => [record.id, record])).values()]
    const context = [...new Map(addressed.flatMap(id => session.current.readUnit(id).records).map(record => [record.id, record])).values()]
    if (!publicationContextMatches(copied, context)) return { pending: true }
    session.current.activate(actionKey)
    if (!published.current?.actions.find(item => item.key === actionKey)?.confirming) {
      session.current.cancel(actionKey) // no latent consent after a read-only activation
      return { pending: true }
    }
    remember(copied)
    await session.current.confirm(actionKey)
    return { pending: true }
  }
  const projected = new Map(records.map(record => [record.id, record]))
  if (state) for (const id of ids) for (const record of session.current?.readUnit(id).records || []) projected.set(record.id, record)
  const displayRecords = [...projected.values()].map(record => {
    const before = snapshots[record.id]
    if (!before) return record
    const receipt = action(record.id)?.links.some(link => link.url === settled(record)?.url)
    // Unattributed public data cannot leak through a generic card's own links.
    return receipt || record.status === 'prepared' && attemptTarget(before) === attemptTarget(record) ? record : before
  })
  for (const before of Object.values(snapshots)) if (!displayRecords.some(record => record.id === before.id)) displayRecords.push(before)
  return { records: displayRecords, action, batch, attempted: snapshots,
    send: id => contribute(`chat-send:${id}`), sendAll: () => contribute(`chat-send-batch:${key}`),
    async refresh() { await onRefresh?.(); await session.current?.hydrate() } }
}
function FallbackResult({ action }) {
  if (!action) return null
  return <p role="status" className="co-review-note">{action.status}{action.note ? ` · ${action.note}` : ''}
    {action.links.map(link => <a key={link.url} className="co-repo-link" href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</p>
}

// The same conditions the queue's Send button checks: a reviewed, current,
// still-private pull request with no unresolved send failure.
export function sendBlocker(record, reviewState) {
  if (!record) return 'This contribution is not available.'
  if (record.status !== 'prepared') return 'Already sent.'
  if (!['pr', 'pr_update'].includes(record.plan?.action)) return 'Only pull requests can be sent from here.'
  if (reviewState?.state === 'needs_refresh' || record.needs_attention === true) return 'The staged source changed after review. Ask the agent in this chat to refresh it.'
  if (String(record.last_submit_error || '').trim()) return 'The last send attempt failed. Open Contribute to see why.'
  if (qualityReviewFor(record).state !== 'all_clear') return 'This version still needs a review before it can be sent.'
  if (reviewState?.state !== 'ready') return 'This contribution still needs a current source check in Contribute.'
  return ''
}

// "All clear" is the private review verdict, not CI. Say what it covers and
// show the reviewer's own note on what it checked.
export function ReviewNote({ records }) {
  const notes = records.map(record => qualityReviewFor(record)).filter(review => review.state === 'all_clear' && review.summary)
  return <details className="co-inline-review-note">
    <summary>What “All clear” means</summary>
    <p>An agent privately reviewed this exact version: it read the whole change for correctness, simplicity, tests, security and privacy, fixed what it found, and ran the project's checks in a separate copy. It is not GitHub CI. The project's own checks run on GitHub after you contribute, and nothing merges until they pass and you approve it.</p>
    {notes.map((review, index) => <p key={index}><b>Reviewer note:</b> {review.summary}</p>)}
  </details>
}

function SendConfirm({ record, reviewState, onSend, onClose, disabled = false, busy = false }) {
  const blocker = sendBlocker(record, reviewState)
  const repo = record.plan?.repo || record.repo || ''
  const updating = record.plan?.action === 'pr_update'
  if (blocker) return <div className="co-inline-confirm is-blocked" role="status"><strong>{blocker}</strong>
    {record.status !== 'prepared' && record.url ? <a className="co-repo-link" href={record.url} target="_blank" rel="noopener noreferrer">View it on GitHub</a> : null}</div>
  return <div className="co-inline-confirm" role="group" aria-label="Confirm send">
    <div>
      <strong>{updating ? 'Update this pull request on ' : 'Contribute this pull request to '}<RepoLink repo={repo} number={updating ? record.number : undefined} />?</strong>
      <span>{updating ? 'Pushes the reviewed change to the existing PR from your GitHub account.' : 'Opens it publicly from your GitHub account. Nothing merges.'} The exact reviewed change is below.</span>
    </div>
    <div className="co-inline-confirm-actions">
      <button type="button" className="co-btn" disabled={busy} onClick={onClose}>Not now</button>
      <button type="button" className="co-btn co-btn-primary" disabled={busy || disabled} aria-busy={busy} onClick={() => onSend(record)}>{busy ? 'Sending…' : updating ? 'Contribute update' : 'Contribute'}</button>
    </div>
    <ReviewNote records={[record]} />
  </div>
}

function StackSend({ unit, ledgerReady, reviewStatus, onSendStack, disabled = false, busy = false }) {
  const readiness = stackReadiness(unit)
  const phase = stackPublicationRecords(unit)
  // Linked layers come from the full ledger; until it arrives a chain only
  // looks incomplete.
  if (!ledgerReady && readiness.code === 'incomplete') return <p role="status" className="co-review-note">Loading the linked changes…</p>
  if (!readiness.ok) return readiness.code === 'settled' ? null : <p className="co-review-note">{readiness.message}</p>
  const blocked = phase.map(record => sendBlocker(record, reviewStateFor(record, reviewStatus))).find(Boolean)
  if (blocked) return <p className="co-review-note" role="status">{blocked}</p>
  const label = readiness.updating ? `Contribute ${phase.length} ${phase.length === 1 ? 'update' : 'updates'}` : `Contribute ${phase.length} linked ${phase.length === 1 ? 'PR' : 'PRs'}`
  return <div className="co-review-actions" role="group" aria-label="Linked contribution actions">
    <button type="button" className="co-icon-btn co-send-btn is-primary" disabled={busy || disabled} aria-busy={busy} onClick={() => onSendStack(unit.records)}>
      <Icon name="send" /><span>{busy ? 'Sending…' : label}</span>
    </button>
  </div>
}

export function InlinePreparedView({ target, appId, records, ledgerReady, reviewStatus, onSend, onSendStack, onDismiss, loadDiff, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false)
  const [confirming, setConfirming] = useState(Boolean(target.confirm))
  useEffect(() => { setConfirming(Boolean(target.confirm)) }, [target.id, target.confirm])
  const [exact, setExact] = useState({ id: '', record: null, read: false })
  useEffect(() => {
    let alive = true
    setExact({ id: target.id, record: null, read: false })
    loadFreshContributionRecord(target.id).catch(() => null)
      .then(fresh => { if (alive) setExact({ id: target.id, record: fresh || null, read: true }) })
    return () => { alive = false }
  }, [target.id])
  const exactRecord = exact.id === target.id ? exact.record : null
  const loaded = newerRecord(records.find(item => item.id === target.id), exactRecord)
  const observed = useMemo(() => loaded ? [loaded, ...records.filter(item => item.id !== loaded.id)] : records, [loaded, records])
  const publication = useFallbackPublication([target.id], observed, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh, records)
  const record = publication.records.find(item => item.id === target.id)
  const action = publication.action(target.id)
  const attempted = Boolean(publication.attempted[target.id])
  const locked = attempted && action?.disabled
  const missing = !record && ledgerReady && exact.id === target.id && exact.read
  const unit = record ? publicationStackUnit(record, publication.records) : null
  function openFullView() {
    window.parent.postMessage({ type: 'moebius:open-app', appId, intent: `review:${target.id}` }, '*')
  }
  async function refresh() {
    setRefreshing(true)
    try { await publication.refresh() } finally { setRefreshing(false) }
  }
  return <section className="co-projects-view co-workspace co-inline-view is-embedded" aria-label="Prepared contribution" aria-busy={!action || action.busy}>
    <style>{`.co-inline-confirm { display:grid; gap:12px; margin:0 0 14px; padding:14px 16px; border:1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); } .co-inline-confirm > div:first-child { display:grid; gap:4px; } .co-inline-confirm strong { font-size:16px; } .co-inline-confirm span { color:var(--muted); font-size:14px; } .co-inline-confirm.is-blocked { border-color:var(--border); background:var(--surface-2, var(--surface)); } .co-inline-confirm-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; } .co-inline-review-note summary { cursor:pointer; color:var(--muted); font-size:14px; } .co-inline-review-note p { margin:8px 0 0; font-size:14px; line-height:1.5; color:var(--text); } .co-workspace.co-inline-view.is-embedded { padding:16px 20px 40px; } .co-inline-view > .co-board-actions { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; } .co-inline-stack > h2 { font-size:18px; margin:4px 0 12px; } .co-inline-stack .co-card + .co-card { margin-top:12px; }`}</style>
    <div className="co-board-actions">
      <button className="co-quiet-action" onClick={openFullView}>Open in Contribute <Icon name="right" /></button>
      <button className="co-quiet-action" disabled={refreshing} onClick={refresh}><Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {!record && !missing ? <p role="status">Reading this contribution…</p> : null}
    {missing ? <p role="alert">This contribution is no longer in Contribute. It may have been dismissed or replaced.</p> : null}
    {record && unit ? <div className="co-inline-stack">
      <h2>{unit.name} · {unit.records.length} linked {unit.records.length === 1 ? 'change' : 'changes'}</h2>
      {confirming && !locked ? <div className="co-inline-confirm" role="group" aria-label="Confirm send">
        <div><strong>Contribute this linked chain to <RepoLink repo={unit.records[0]?.plan?.repo || unit.records[0]?.repo} />?</strong>
          <span>Opens each layer publicly from your GitHub account, parent first. Nothing merges. Every reviewed change is below.</span></div>
        <div className="co-inline-confirm-actions"><button type="button" className="co-btn" onClick={() => setConfirming(false)}>Not now</button>
          <StackSend unit={unit} ledgerReady={ledgerReady} reviewStatus={reviewStatus} onSendStack={() => publication.send(target.id)} busy={Boolean(action?.busy)} disabled={!action?.readyToFreeze} /></div>
        <ReviewNote records={unit.records.filter(member => member.status === 'prepared')} />
      </div> : null}
      {unit.records.map(member => <ContributionCard key={member.id} rec={member} reviewState={reviewStateFor(member, reviewStatus)}
        loadDiff={loadDiff} initialExpanded={member.id === record.id} showDecision={false} />)}
      {confirming || locked ? null : <StackSend unit={unit} ledgerReady={ledgerReady} reviewStatus={reviewStatus} onSendStack={() => publication.send(target.id)} busy={Boolean(action?.busy)} disabled={!action?.readyToFreeze} />}
    </div> : null}
    {attempted ? <FallbackResult action={action} /> : record && !action?.readyToFreeze && !settled(record) ? <p role="status" className="co-review-note">{action?.note || 'Checking this contribution before you can contribute.'}</p> : null}
    {record && !unit && confirming && !locked ? <SendConfirm record={record} reviewState={reviewStateFor(record, reviewStatus)} busy={Boolean(action?.busy)} disabled={!action?.readyToFreeze} onSend={() => publication.send(target.id)} onClose={() => setConfirming(false)} /> : null}
    {/* No source-chat button here: the reader is already in a chat. While the
        confirmation is open it is the only Send, so the card shows none. */}
    {record && !unit ? <ContributionCard rec={record} reviewState={reviewStateFor(record, reviewStatus)}
      onSend={confirming || locked || !action?.readyToFreeze || reviewStateFor(record, reviewStatus)?.state !== 'ready' ? undefined : () => publication.send(target.id)} onDismiss={onDismiss} loadDiff={loadDiff} initialExpanded /> : null}
  </section>
}

// Whether one batch entry can be sent now: the same rules as its own Send
// (a stack also needs every layer of its current phase reviewed).
export function batchItemBlocker(item, reviewStatus, ledgerReady) {
  if (!item.record) return item.read ? 'This contribution is no longer in Contribute.' : 'Reading this contribution…'
  if (!item.unit) return sendBlocker(item.record, reviewStateFor(item.record, reviewStatus))
  const readiness = stackReadiness(item.unit)
  if (!readiness.ok) return !ledgerReady && readiness.code === 'incomplete' ? 'Loading the linked changes…' : readiness.message
  const unreviewed = stackPublicationRecords(item.unit).find(layer => sendBlocker(layer, reviewStateFor(layer, reviewStatus)))
  return unreviewed ? sendBlocker(unreviewed, reviewStateFor(unreviewed, reviewStatus)) : ''
}

/** Several prepared contributions confirmed and sent together, in order. */
export function InlineBatchView({ target, records, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh }) {
  const ids = target.ids || []
  const key = ids.join(',')
  const [exact, setExact] = useState({ key: '', byId: {} })

  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    let alive = true
    setExact({ key, byId: {} })
    for (const id of ids) {
      loadFreshContributionRecord(id).catch(() => null).then(fresh => {
        if (alive) setExact(current => current.key === key ? { key, byId: { ...current.byId, [id]: { record: fresh || null } } } : current)
      })
    }
    return () => { alive = false }
  }, [key])
  const observed = useMemo(() => [...records.map(record => newerRecord(record, exact.key === key ? exact.byId[record.id]?.record : null)),
    ...Object.values(exact.key === key ? exact.byId : {}).map(value => value.record).filter(record => record && !records.some(item => item.id === record.id))], [records, exact, key])
  const publication = useFallbackPublication(ids, observed, ledgerReady, reviewStatus, onSend, onSendStack, onRefresh, records)
  const currentRecords = publication.records
  const busy = Boolean(publication.batch?.busy)
  const items = ids.map(id => {
    const read = exact.key === key && Boolean(exact.byId[id])
    const record = currentRecords.find(item => item.id === id)
    const unit = record ? publicationStackUnit(record, [record, ...currentRecords.filter(item => item.id !== record.id)]) : null
    const item = { id, read: read && ledgerReady, record, unit }
    const phase = unit ? stackPublicationRecords(unit) : record?.status === 'prepared' ? [record] : []
    const unitKey = unit ? `stack:${unit.id}` : `record:${id}`
    return { ...item, phase, unitKey,
      blocker: batchItemBlocker(item, reviewStatus, ledgerReady) }
  })
  // One stack is one publication unit, even if the block names two layers.
  // A later phase gets a fresh key and therefore needs a fresh confirmation.
  const ready = [...new Map(items.filter(item => !item.blocker && item.phase.length && (publication.action(item.id)?.readyToFreeze))
    .map(item => [item.unitKey, item])).values()]
  const loading = items.some(item => (!item.record && !item.read)
    || (item.unit && !ledgerReady && stackReadiness(item.unit).code === 'incomplete'))
  const checking = !Object.keys(publication.attempted).length && items.some(item => !item.blocker && item.phase.length && !publication.action(item.id)?.readyToFreeze)
  async function sendAll() { await publication.sendAll() }
  async function refresh() {
    setRefreshing(true)
    try { await publication.refresh() } finally { setRefreshing(false) }
  }
  const status = item => {
    const action = publication.action(item.id)
    const members = item.unit?.records || (item.record ? [item.record] : [])
    const links = [...new Map(members.flatMap(member => publication.action(member.id)?.links || (!action ? [settled(member)].filter(Boolean) : [])).map(link => [link.url, link])).values()]
    const linkView = links.map(link => <a key={link.url} className="co-repo-link" href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>)
    const attempted = Boolean(publication.attempted[item.id])
    if (action && attempted) return <span className={`co-batch-status ${action.busy ? 'is-busy' : action.status === 'Needs attention' ? 'is-failed' : ''}`}>
      {action.busy ? 'Sending…' : action.status === 'Checking result' ? 'Checking result…' : ['Open','Draft','Closed','Merged','Sent'].includes(action.status) ? 'Sent' : action.note || action.status} {linkView}</span>
    if (item.record && item.record.status !== 'prepared') return <span className="co-batch-status">{links.length ? <>Already sent {linkView}</> : item.record.status === 'abandoned' ? 'Dismissed' : 'Not ready'}</span>
    if (!action?.readyToFreeze && !item.blocker) return <span className="co-batch-status">{action?.note || 'Checking contribution…'}</span>
    return item.blocker ? <span className="co-batch-status">{item.blocker} {linkView}</span> : <span className="co-batch-status is-ready">Ready {linkView}</span>
  }
  const finished = Object.keys(publication.attempted).length > 0 && !busy
  return <section className="co-projects-view co-workspace co-inline-view is-embedded" aria-label="Contribute several">
    <style>{`.co-workspace.co-inline-view.is-embedded { padding:16px 20px 40px; } .co-inline-confirm { display:grid; gap:12px; margin:0 0 14px; padding:14px 16px; border:1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); } .co-inline-confirm > div:first-child { display:grid; gap:4px; } .co-inline-confirm strong { font-size:16px; } .co-inline-confirm > div:first-child > span { color:var(--muted); font-size:14px; } .co-inline-confirm-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; } .co-inline-review-note summary { cursor:pointer; color:var(--muted); font-size:14px; } .co-inline-review-note p { margin:8px 0 0; font-size:14px; line-height:1.5; } .co-batch-list { list-style:none; margin:0; padding:0; border:1px solid var(--border); border-radius:10px; } .co-batch-list > li { display:grid; gap:2px; padding:10px 12px; } .co-batch-list > li + li { border-top:1px solid var(--border); } .co-batch-list b { font-weight:600; overflow-wrap:anywhere; } .co-batch-meta { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:13px; color:var(--muted); } .co-batch-status.is-ready, .co-batch-status.is-sent { color:var(--green, #3fb950); font-weight:600; } .co-batch-status.is-failed { color:var(--danger, #f85149); } .co-batch-status.is-busy { color:var(--text); }`}</style>
    <div className="co-board-actions"><button className="co-quiet-action" disabled={refreshing || busy} onClick={refresh}><Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
    <div className="co-inline-confirm" role="group" aria-label="Confirm contributing several">
      <div>
        <strong>{finished ? 'Contribution results' : checking ? 'Checking contributions…' : `Contribute ${ready.length} of ${items.length}?`}</strong>
        <span>Each one opens publicly from your GitHub account, all at once; a linked chain opens parent first. Nothing merges. Anything not ready is skipped and says why.</span>
      </div>
      <ul className="co-batch-list">
        {items.map(item => {
          const repo = item.record?.plan?.repo || item.record?.repo
          return <li key={item.id}>
            <b>{item.record ? (item.record.plan?.title || item.record.title || 'Prepared contribution') : 'Contribution'}</b>
            <div className="co-batch-meta">
              {repo ? <RepoLink repo={repo} /> : null}
              {item.unit ? <span>{item.unit.records.length} linked PRs</span> : null}
              {status(item)}
            </div>
          </li>
        })}
      </ul>
      <div className="co-inline-confirm-actions">
        <button type="button" className="co-btn co-btn-primary" disabled={busy || loading || ready.length === 0 || !publication.batch?.readyToFreeze} aria-busy={busy} onClick={sendAll}>
          {busy ? 'Contributing…' : loading || checking ? 'Checking…' : `Contribute all ${ready.length}`}
        </button>
      </div>
      <ReviewNote records={items.flatMap(item => item.unit ? stackPublicationRecords(item.unit) : item.record ? [item.record] : [])} />
    </div>
  </section>
}
