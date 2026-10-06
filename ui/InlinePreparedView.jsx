import { useEffect, useState } from 'react'
import { qualityReviewFor, reviewStateFor } from '../review.js'
import { loadFreshContributionRecord } from '../storage.js'
import { sortStackRecords, stackMeta, stackPublicationRecords, stackReadiness } from '../stack.js'
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

export function preparedStackUnit(record, records) {
  const meta = stackMeta(record)
  if (!meta) return null
  const members = sortStackRecords((records || []).filter(item => stackMeta(item)?.id === meta.id))
  return { type: 'stack', id: meta.id, name: meta.name, total: meta.total, records: members }
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

function SendConfirm({ record, reviewState, onSend, onClose }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const blocker = sendBlocker(record, reviewState)
  const repo = record.plan?.repo || record.repo || ''
  const updating = record.plan?.action === 'pr_update'
  async function send() {
    setBusy(true); setNote('')
    try {
      const outcome = (await onSend(record)) || {}
      if (!outcome.ok && !outcome.pending && !outcome.alreadyHandled) setNote(outcome.error || 'Could not send this pull request. Refresh before trying again.')
    } catch { setNote('The result could not be confirmed. Refresh before trying again.') }
    finally { setBusy(false) }
  }
  if (blocker) return <div className="co-inline-confirm is-blocked" role="status"><strong>{blocker}</strong>
    {record.status !== 'prepared' && record.url ? <a className="co-repo-link" href={record.url} target="_blank" rel="noopener noreferrer">View it on GitHub</a> : null}</div>
  return <div className="co-inline-confirm" role="group" aria-label="Confirm send">
    <div>
      <strong>{updating ? 'Update this pull request on ' : 'Contribute this pull request to '}<RepoLink repo={repo} number={updating ? record.number : undefined} />?</strong>
      <span>{updating ? 'Pushes the reviewed change to the existing PR from your GitHub account.' : 'Opens it publicly from your GitHub account. Nothing merges.'} The exact reviewed change is below.</span>
    </div>
    <div className="co-inline-confirm-actions">
      <button type="button" className="co-btn" disabled={busy} onClick={onClose}>Not now</button>
      <button type="button" className="co-btn co-btn-primary" disabled={busy} aria-busy={busy} onClick={send}>{busy ? 'Sending…' : updating ? 'Contribute update' : 'Contribute'}</button>
    </div>
    <ReviewNote records={[record]} />
    {note ? <p role="alert" className="co-review-note">{note}</p> : null}
  </div>
}

function StackSend({ unit, ledgerReady, onSendStack }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const readiness = stackReadiness(unit)
  const phase = stackPublicationRecords(unit)
  // Linked layers come from the full ledger; until it arrives a chain only
  // looks incomplete.
  if (!ledgerReady && readiness.code === 'incomplete') return <p role="status" className="co-review-note">Loading the linked changes…</p>
  if (!readiness.ok) return readiness.code === 'settled' ? null : <p className="co-review-note">{readiness.message}</p>
  const label = readiness.updating ? `Contribute ${phase.length} ${phase.length === 1 ? 'update' : 'updates'}` : `Contribute ${phase.length} linked ${phase.length === 1 ? 'PR' : 'PRs'}`
  async function send() {
    setBusy(true); setNote('')
    try {
      const outcome = (await onSendStack(unit.records)) || {}
      if (!outcome.ok && !outcome.pending && !outcome.alreadyHandled) setNote(outcome.error || 'Could not send this chain. Refresh before trying again.')
    } catch { setNote('The result could not be confirmed. Refresh before trying again.') }
    finally { setBusy(false) }
  }
  return <div className="co-review-actions" role="group" aria-label="Linked contribution actions">
    <button type="button" className="co-icon-btn co-send-btn is-primary" disabled={busy} aria-busy={busy} onClick={send}>
      <Icon name="send" /><span>{busy ? 'Sending…' : label}</span>
    </button>
    {note ? <p role="status" className="co-review-note">{note}</p> : null}
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
  const record = newerRecord(records.find(item => item.id === target.id), exactRecord)
  const missing = !record && ledgerReady && exact.id === target.id && exact.read
  const unit = record ? preparedStackUnit(record, [record, ...records.filter(item => item.id !== record.id)]) : null
  function openFullView() {
    window.parent.postMessage({ type: 'moebius:open-app', appId, intent: `review:${target.id}` }, '*')
  }
  async function refresh() {
    setRefreshing(true)
    try { await onRefresh?.() } finally { setRefreshing(false) }
  }
  return <section className="co-projects-view co-workspace co-inline-view is-embedded" aria-label="Prepared contribution">
    <style>{`.co-inline-confirm { display:grid; gap:12px; margin:0 0 14px; padding:14px 16px; border:1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); } .co-inline-confirm > div:first-child { display:grid; gap:4px; } .co-inline-confirm strong { font-size:16px; } .co-inline-confirm span { color:var(--muted); font-size:14px; } .co-inline-confirm.is-blocked { border-color:var(--border); background:var(--surface-2, var(--surface)); } .co-inline-confirm-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; } .co-inline-review-note summary { cursor:pointer; color:var(--muted); font-size:14px; } .co-inline-review-note p { margin:8px 0 0; font-size:14px; line-height:1.5; color:var(--text); } .co-workspace.co-inline-view.is-embedded { padding:16px 20px 40px; } .co-inline-view > .co-board-actions { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; } .co-inline-stack > h2 { font-size:18px; margin:4px 0 12px; } .co-inline-stack .co-card + .co-card { margin-top:12px; }`}</style>
    <div className="co-board-actions">
      <button className="co-quiet-action" onClick={openFullView}>Open in Contribute <Icon name="right" /></button>
      <button className="co-quiet-action" disabled={refreshing} onClick={refresh}><Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button>
    </div>
    {!record && !missing ? <p role="status">Reading this contribution…</p> : null}
    {missing ? <p role="alert">This contribution is no longer in Contribute. It may have been dismissed or replaced.</p> : null}
    {record && unit ? <div className="co-inline-stack">
      <h2>{unit.name} · {unit.records.length} linked {unit.records.length === 1 ? 'change' : 'changes'}</h2>
      {confirming ? <div className="co-inline-confirm" role="group" aria-label="Confirm send">
        <div><strong>Contribute this linked chain to <RepoLink repo={unit.records[0]?.plan?.repo || unit.records[0]?.repo} />?</strong>
          <span>Opens each layer publicly from your GitHub account, parent first. Nothing merges. Every reviewed change is below.</span></div>
        <div className="co-inline-confirm-actions"><button type="button" className="co-btn" onClick={() => setConfirming(false)}>Not now</button>
          <StackSend unit={unit} ledgerReady={ledgerReady} onSendStack={onSendStack} /></div>
        <ReviewNote records={unit.records.filter(member => member.status === 'prepared')} />
      </div> : null}
      {unit.records.map(member => <ContributionCard key={member.id} rec={member} reviewState={reviewStateFor(member, reviewStatus)}
        loadDiff={loadDiff} initialExpanded={member.id === record.id} showDecision={false} />)}
      {confirming ? null : <StackSend unit={unit} ledgerReady={ledgerReady} onSendStack={onSendStack} />}
    </div> : null}
    {record && !unit && confirming ? <SendConfirm record={record} reviewState={reviewStateFor(record, reviewStatus)} onSend={onSend} onClose={() => setConfirming(false)} /> : null}
    {/* No source-chat button here: the reader is already in a chat. While the
        confirmation is open it is the only Send, so the card shows none. */}
    {record && !unit ? <ContributionCard rec={record} reviewState={reviewStateFor(record, reviewStatus)}
      onSend={confirming ? undefined : onSend} onDismiss={onDismiss} loadDiff={loadDiff} initialExpanded /> : null}
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
  const [progress, setProgress] = useState({})
  const [busy, setBusy] = useState(false)
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
  const items = ids.map(id => {
    const read = exact.key === key && Boolean(exact.byId[id])
    const record = newerRecord(records.find(item => item.id === id), read ? exact.byId[id].record : null)
    const unit = record ? preparedStackUnit(record, [record, ...records.filter(item => item.id !== record.id)]) : null
    const item = { id, read: read && ledgerReady, record, unit }
    return { ...item, blocker: batchItemBlocker(item, reviewStatus, ledgerReady) }
  })
  const ready = items.filter(item => !item.blocker && !progress[item.id])
  const loading = items.some(item => (!item.record && !item.read)
    || (item.unit && !ledgerReady && stackReadiness(item.unit).code === 'incomplete'))
  // Every ready item starts at once; the server serializes whatever must not
  // overlap, and each row reports its own result as it lands.
  async function sendAll() {
    setBusy(true)
    setProgress(current => ({ ...current, ...Object.fromEntries(ready.map(item => [item.id, { state: 'sending' }])) }))
    await Promise.all(ready.map(async item => {
      let outcome
      try {
        outcome = (item.unit ? await onSendStack(item.unit.records) : await onSend(item.record)) || {}
      } catch { outcome = { error: 'The result could not be confirmed. Refresh before trying again.' } }
      const sent = outcome.ok || outcome.pending || outcome.alreadyHandled
      setProgress(current => ({ ...current, [item.id]: sent ? { state: 'sent' } : { state: 'failed', note: outcome.error || 'Could not send. Refresh before trying again.' } }))
    }))
    setBusy(false)
  }
  async function refresh() {
    setRefreshing(true)
    try { await onRefresh?.() } finally { setRefreshing(false) }
  }
  const status = item => {
    const done = progress[item.id]
    if (done?.state === 'sending') return <span className="co-batch-status is-busy">Sending…</span>
    if (done?.state === 'sent') return <span className="co-batch-status is-sent">Sent</span>
    if (done?.state === 'failed') return <span className="co-batch-status is-failed">{done.note}</span>
    if (item.record && item.record.status !== 'prepared') return <span className="co-batch-status is-sent">Already sent</span>
    return item.blocker ? <span className="co-batch-status">{item.blocker}</span> : <span className="co-batch-status is-ready">Ready</span>
  }
  const finished = Object.keys(progress).length > 0 && !busy
  return <section className="co-projects-view co-workspace co-inline-view is-embedded" aria-label="Contribute several">
    <style>{`.co-workspace.co-inline-view.is-embedded { padding:16px 20px 40px; } .co-inline-confirm { display:grid; gap:12px; margin:0 0 14px; padding:14px 16px; border:1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius:12px; background:color-mix(in srgb, var(--accent) 10%, transparent); } .co-inline-confirm > div:first-child { display:grid; gap:4px; } .co-inline-confirm strong { font-size:16px; } .co-inline-confirm > div:first-child > span { color:var(--muted); font-size:14px; } .co-inline-confirm-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; } .co-inline-review-note summary { cursor:pointer; color:var(--muted); font-size:14px; } .co-inline-review-note p { margin:8px 0 0; font-size:14px; line-height:1.5; } .co-batch-list { list-style:none; margin:0; padding:0; border:1px solid var(--border); border-radius:10px; } .co-batch-list > li { display:grid; gap:2px; padding:10px 12px; } .co-batch-list > li + li { border-top:1px solid var(--border); } .co-batch-list b { font-weight:600; overflow-wrap:anywhere; } .co-batch-meta { display:flex; flex-wrap:wrap; gap:4px 10px; font-size:13px; color:var(--muted); } .co-batch-status.is-ready, .co-batch-status.is-sent { color:var(--green, #3fb950); font-weight:600; } .co-batch-status.is-failed { color:var(--danger, #f85149); } .co-batch-status.is-busy { color:var(--text); }`}</style>
    <div className="co-board-actions"><button className="co-quiet-action" disabled={refreshing || busy} onClick={refresh}><Icon name="refresh" /> {refreshing ? 'Refreshing…' : 'Refresh'}</button></div>
    <div className="co-inline-confirm" role="group" aria-label="Confirm contributing several">
      <div>
        <strong>{finished ? 'Contribution results' : `Contribute ${ready.length} of ${items.length}?`}</strong>
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
        <button type="button" className="co-btn co-btn-primary" disabled={busy || loading || ready.length === 0} aria-busy={busy} onClick={sendAll}>
          {busy ? 'Contributing…' : loading ? 'Checking…' : `Contribute all ${ready.length}`}
        </button>
      </div>
      <ReviewNote records={items.flatMap(item => item.unit ? stackPublicationRecords(item.unit) : item.record ? [item.record] : [])} />
    </div>
  </section>
}
