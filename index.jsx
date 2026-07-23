// Contribute — thin app shell. The module tree is declared in mobius.json's
// source_files; the multi-file installer fetches each path and esbuild bundles
// from this entry, resolving the relative imports below at compile time.
//
//   theme.js    — the single app stylesheet (CSS)
//   domain.js   — pure logic: grouping, counts, the batched live-refresh query
//   storage.js  — the window.mobius.storage ledger layer (+ offline cache,
//                 the full-diff read, and the Dismiss CAS flip)
//   api.js      — same-origin /api/github/* transport
//   github-connection.js — bounded connection-attempt state machine
//   ui/*.jsx    — one React component per file (owned copies, not shared imports)
//
// Only App lives here: it owns ledger + connection state, runs the best-effort
// live refresh, keeps prepared cards live via a rescan when the partner returns
// to the app, wires the review flow (Send calls the platform's direct PR
// submit endpoint; Feedback returns to the source chat; Dismiss CAS-abandons),
// and composes header, tiles, connection card, feed.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CSS } from './theme.js'
import {
  actionableSourceProjects,
  attachSourceProjects,
} from './source-map.js'
import {
  applyLiveStates,
  buildRefreshQuery,
  groupRecords,
  isSubmissionResolutionSettled,
  mergeRecordUpdates,
  reconcileLedgerSnapshot,
  resolveUncertainSubmission,
  summarizeSubmissionResolutions,
} from './domain.js'
import { indexReviewStatus } from './review.js'
import { abandonPrepared, cacheFeed, loadFullDiff, loadLedger, restoreAbandoned } from './storage.js'
import { createRefreshCoordinator } from './refresh.js'
import {
  fetchGithubStatus,
  fetchLiveStates,
  fetchReviewStatus,
  fetchSourceStatus,
  submitContribution,
  submitContributionStack,
} from './api.js'
import { ConnectionCard } from './ui/ConnectionCard.jsx'
import { Feed } from './ui/Feed.jsx'
import { SourceMap } from './ui/SourceMap.jsx'
import { SourceOverview } from './ui/SourceOverview.jsx'

// The one icon that isn't chrome: the empty-state mark. A branch merging up
// into a trunk — the same motif as the app icon, so the two read as kin.
const MERGE_MARK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
       style={{ width: 30, height: 30 }}>
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="18" cy="9" r="2.6" />
    <path d="M6 8.6v6.8" />
    <path d="M18 11.6c0 3.2-3 4.4-6 4.4" />
  </svg>
)

const CONTRIBUTION_VIEWS = ['contributions', 'sources']

// The app's own icon, with a lettered fallback for installs whose icon route
// 404s. Mirrors the App Store header pattern.
function Header({ appId, fromCache, omittedCount, checking, children }) {
  const [iconFailed, setIconFailed] = useState(false)
  return (
    <header className="co-header">
      <div className="co-header-main">
        {iconFailed ? (
          <span className="co-brand-fallback" aria-hidden="true">C</span>
        ) : (
          <img
            src={`/api/apps/${appId}/icon?size=64`}
            alt=""
            width={34}
            height={34}
            className="co-brand-icon"
            onError={() => setIconFailed(true)}
          />
        )}
        <div className="co-brand-copy">
          <h1 className="co-title">Contribute</h1>
          <span className="co-subtitle">Review and share Möbius improvements</span>
        </div>
      </div>
      <div className="co-toolbar">
        {checking && (
          <span className="co-toolbar-check" role="status" aria-live="polite">
            <span className="ma-spinner is-compact" aria-hidden="true" />
            <span>Checking…</span>
          </span>
        )}
        {children}
      </div>
      {fromCache && (
        <span className="co-offline-note">Offline — showing your last synced feed.</span>
      )}
      {!fromCache && omittedCount > 0 && (
        <span className="co-offline-note" role="status">
          {omittedCount} contribution {omittedCount === 1 ? 'record needs' : 'records need'} repair.
        </span>
      )}
    </header>
  )
}

// Sells the loop when the ledger is empty. Deliberately connection-agnostic:
// the ConnectionCard directly above already says whether GitHub is wired up, so
// this stays focused on the review task rather than implying that contributions
// can be created from this app.
function EmptyState() {
  return (
    <div className="co-empty">
      <div className="co-empty-mark">{MERGE_MARK}</div>
      <h2 className="co-empty-title">No contributions to review</h2>
      <p className="co-empty-text">
        Changes your agent prepares for upstream review will appear here. You
        can inspect each change before anything is shared publicly.
      </p>
    </div>
  )
}

export default function ContributeApp({ appId, token }) {
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'checking' })
  const [loading, setLoading] = useState(true)
  const [omittedCount, setOmittedCount] = useState(0)
  const [view, setViewState] = useState(() => {
    try {
      const saved = sessionStorage.getItem('contribute-view-v2')
      return CONTRIBUTION_VIEWS.includes(saved) ? saved : 'contributions'
    }
    catch { return 'contributions' }
  })
  const [sourceSnapshot, setSourceSnapshot] = useState(null)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState('')
  const [sourceFocus, setSourceFocus] = useState(null)
  const [reviewStatus, setReviewStatus] = useState({
    state: 'loading', byId: {}, checkedAt: '',
  })
  const pageRef = useRef(null)
  const tabRefs = useRef({})
  // Latest records for callbacks (the connect-flow refresh) that must not take
  // a `records` dependency and re-bind on every ledger change.
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const connRef = useRef(conn)
  const connectionRequestRef = useRef(0)
  useEffect(() => { connRef.current = conn }, [conn])

  // Every local ledger result must update the render, the callback mirror, and
  // the offline cache together. Keeping that write in one place prevents a
  // dismissed/restored card from reappearing when an offline mount reads a
  // stale cache before the next visibility rescan.
  const replaceFeed = useCallback((next) => {
    recordsRef.current = next
    setRecords(next)
    cacheFeed(next)
    return next
  }, [])

  const applyRecordUpdates = useCallback((updates) => (
    replaceFeed(mergeRecordUpdates(recordsRef.current, updates))
  ), [replaceFeed])

  // Best-effort live refresh of the open PR/issue records in ONE batched
  // GraphQL round-trip. Returns the refreshed array — a NEW array only when
  // GitHub actually moved a record, the same reference otherwise (nothing to
  // refresh, a null/failed result, or no change), so callers can detect "no
  // change" with ===. A null/failed result leaves stored state untouched
  // (applyLiveStates passes records through), so a flaky network never blanks
  // or downgrades the feed. Pure fetch: the caller owns setRecords/cacheFeed.
  const fetchRefreshed = useCallback(async (recs) => {
    const refresh = buildRefreshQuery(recs)
    if (!refresh) return recs
    const data = await fetchLiveStates(token, refresh.query)
    return applyLiveStates(recs, refresh.aliases, data)
  }, [token])

  // Refresh in place: apply the fresh states to both React state and the
  // offline cache. Used by the connect-flow and return-to-app rescans, where
  // there is no other pending write to fold the result into.
  const runLiveRefresh = useCallback(async (recs) => {
    const next = await fetchRefreshed(recs)
    if (next !== recs) {
      replaceFeed(reconcileLedgerSnapshot(recordsRef.current, next))
    }
    return next
  }, [fetchRefreshed, replaceFeed])

  const refreshReviewStatus = useCallback(async () => {
    setReviewStatus((current) => ({ ...current, state: 'loading' }))
    const outcome = await fetchReviewStatus(token, appId)
    if (outcome.ok) {
      const indexed = indexReviewStatus(outcome.data)
      setReviewStatus(indexed)
      return indexed
    }
    const next = {
      state: 'unavailable',
      byId: {},
      checkedAt: '',
    }
    setReviewStatus(next)
    return next
  }, [token, appId])

  // Local Sources refresh: fetch-free and safe to repeat after an agent edit.
  // A 404 specifically means this app source arrived before the companion
  // backend route was restarted into the running server, so say that plainly.
  const refreshSources = useCallback(async () => {
    setSourceLoading(true)
    const result = await fetchSourceStatus(token)
    if (result.ok) {
      setSourceSnapshot(result.data)
      setSourceError('')
      window.mobius?.signal?.('source_map_viewed', {
        source_count: 1 + (result.data?.apps?.length || 0),
      })
    } else {
      setSourceError(result.unsupported ? 'restart' : 'unavailable')
    }
    setSourceLoading(false)
  }, [token])

  useEffect(() => { refreshSources() }, [refreshSources])
  useEffect(() => { refreshReviewStatus() }, [refreshReviewStatus])

  // Re-read connection status after an in-app connect/disconnect, and — when we
  // land connected and have a real (non-cached) ledger — re-run the live
  // refresh now that GitHub is reachable. Passed to ConnectionCard as onChanged.
  const refreshConnection = useCallback(async () => {
    const requestId = connectionRequestRef.current + 1
    connectionRequestRef.current = requestId
    const status = await fetchGithubStatus(token)
    if (requestId !== connectionRequestRef.current) return connRef.current
    connRef.current = status
    setConn(status)
    if (status.state === 'connected' && !fromCache) {
      runLiveRefresh(recordsRef.current)
    }
    return status
  }, [token, fromCache, runLiveRefresh])

  // Mount: read the ledger and the connection status together, then run the
  // live refresh only when GitHub is reachable and connected AND we enumerated
  // the real ledger (fromCache means list() failed — we're offline, so skip
  // both the refresh and the cache write).
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [ledger, status] = await Promise.all([
        loadLedger(),
        fetchGithubStatus(token),
      ])
      if (cancelled) return
      const recs = ledger.records
      recordsRef.current = recs
      setOmittedCount(ledger.omitted.length)
      setRecords(recs)
      setFromCache(ledger.fromCache)
      setConn(status)
      setLoading(false)
      window.mobius?.signal?.('app_ready', { item_count: recs.length })

      if (ledger.fromCache) return
      let toCache = recs
      if (status.state === 'connected') {
        const next = await fetchRefreshed(recs)
        if (cancelled) return
        if (next !== recs) {
          recordsRef.current = next
          setRecords(next)
          toCache = next
        }
      }
      cacheFeed(toCache)
    }
    load().catch((err) => {
      if (cancelled) return
      setLoading(false)
      window.mobius?.signal?.('error', {
        message: String(err?.message || err),
        source: 'load',
      })
    })
    return () => { cancelled = true }
  }, [token, fetchRefreshed])

  // Event-driven liveness: refresh when the app becomes actionable again.
  // Focus + visibility can fire together, and an online transition can land
  // during either refresh, so one coordinator deduplicates concurrent work and
  // preserves exactly one trailing refresh when an event arrives mid-flight.
  // There is deliberately no timer: a hidden/idle app consumes no resources.
  const refreshWorkRef = useRef(null)
  const runRefreshWork = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    const [ledger] = await Promise.all([
      loadLedger(),
      refreshReviewStatus(),
    ])
    setOmittedCount(ledger.omitted.length)
    if (!ledger.fromCache) {
      let next = ledger.records
      if (connRef.current.state === 'connected') {
        next = await fetchRefreshed(next)
      }
      replaceFeed(reconcileLedgerSnapshot(recordsRef.current, next))
      setFromCache(false)
    }
  }, [fetchRefreshed, refreshReviewStatus, replaceFeed])
  refreshWorkRef.current = runRefreshWork
  const refreshCoordinatorRef = useRef(null)
  if (!refreshCoordinatorRef.current) {
    refreshCoordinatorRef.current = createRefreshCoordinator(
      () => refreshWorkRef.current(),
    )
  }

  useEffect(() => {
    const requestRefresh = refreshCoordinatorRef.current
    document.addEventListener('visibilitychange', requestRefresh)
    window.addEventListener('focus', requestRefresh)
    window.addEventListener('online', requestRefresh)
    return () => {
      document.removeEventListener('visibilitychange', requestRefresh)
      window.removeEventListener('focus', requestRefresh)
      window.removeEventListener('online', requestRefresh)
    }
  }, [])

  const setView = useCallback((next) => {
    if (!CONTRIBUTION_VIEWS.includes(next)) next = 'contributions'
    setViewState(next)
    try { sessionStorage.setItem('contribute-view-v2', next) } catch { /* optional */ }
  }, [])

  const onTabKeyDown = useCallback((event) => {
    const current = CONTRIBUTION_VIEWS.indexOf(event.currentTarget.dataset.view)
    let index = current
    if (event.key === 'ArrowRight') index = (current + 1) % CONTRIBUTION_VIEWS.length
    else if (event.key === 'ArrowLeft') index = (current - 1 + CONTRIBUTION_VIEWS.length) % CONTRIBUTION_VIEWS.length
    else if (event.key === 'Home') index = 0
    else if (event.key === 'End') index = CONTRIBUTION_VIEWS.length - 1
    else return
    event.preventDefault()
    const next = CONTRIBUTION_VIEWS[index]
    setView(next)
    requestAnimationFrame(() => tabRefs.current[next]?.focus())
  }, [setView])

  const openSourceProject = useCallback((key) => {
    setSourceFocus((current) => ({ key, request: (current?.request || 0) + 1 }))
    setView('sources')
  }, [setView])

  const onAskSourceAgent = useCallback((project, action) => {
    if (!action || window.parent === window) {
      return { ok: false, reason: 'standalone' }
    }
    window.parent.postMessage(
      { type: 'moebius:new-chat', draft: action.draft },
      window.location.origin,
    )
    window.mobius?.signal?.('source_agent_handoff', {
      action: action.event,
      project: project.key,
    })
    return { ok: true }
  }, [])

  // Contributions is one long reading feed; Repository map owns two internal
  // panes on desktop. Reset the shared page scroller at the boundary so a deep
  // feed position never shifts the map header or couples the two scroll modes.
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0, left: 0 })
  }, [view])

  // Send = direct PR submit. The platform claims the prepared record,
  // recomputes the branch diff, adapts it to a strictly-behind reusable fork
  // without changing the fork's default branch, pushes the topic branch, opens
  // the PR, and returns the updated ledger record. On a partner-actionable
  // failure the
  // server rolls the record back to `prepared` with last_submit_error, and the
  // card stays ready for feedback/retry instead of handing off to an agent chat.
  const onSend = useCallback(async (rec) => {
    const outcome = await submitContribution({ appId, token, rec })
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.('contribution_submitted', {
        id: rec.id,
        url: outcome.url || next.url,
      })
      refreshReviewStatus()
      return { ok: true, record: next, url: outcome.url || next.url }
    }
    if (outcome.record) {
      const next = { ...outcome.record, path: rec.path }
      applyRecordUpdates(next)
    }
    if (outcome.uncertain) {
      // The POST may have completed even though its response never reached the
      // browser. Re-read the durable ledger instead of showing a raw network
      // error or enabling a potentially duplicate retry. A short second read
      // covers the common server-restart / connection-recovery boundary.
      let resolution = { state: 'unconfirmed', record: null }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          resolution = resolveUncertainSubmission(rec, await loadLedger())
        } catch {
          resolution = { state: 'unconfirmed', record: null }
        }
        if (isSubmissionResolutionSettled(resolution)) break
      }
      if (resolution.record) {
        const next = { ...resolution.record, path: rec.path }
        applyRecordUpdates(next)
        if (resolution.state === 'published') {
          window.mobius?.signal?.('contribution_submitted', {
            id: rec.id,
            url: next.url || '',
            reconciled: true,
          })
          refreshReviewStatus()
          return { ok: true, record: next, url: next.url || '' }
        }
        if (resolution.state === 'publishing') {
          refreshReviewStatus()
          return { pending: true, record: next }
        }
        if (resolution.state === 'blocked') {
          refreshReviewStatus()
          return { error: 'Nothing was sent. This contribution needs an update before you try again.' }
        }
      }
      refreshReviewStatus()
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create a duplicate.',
      }
    }
    refreshReviewStatus()
    return { error: outcome.error || 'Could not submit this PR.' }
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  // One explicit confirmation can publish an exact, already-reviewed chain.
  // The response may contain partial progress (for example, parent opened and
  // child creation bounced), so merge every returned ledger record rather
  // than treating the stack as all-or-nothing after public work has begun.
  const onSendStack = useCallback(async (stackRecords) => {
    const outcome = await submitContributionStack({
      appId,
      token,
      recordIds: stackRecords.map((rec) => rec.id),
    })
    const updates = outcome.ok || outcome.records || []
    if (updates.length > 0) {
      applyRecordUpdates(updates)
    }
    if (outcome.ok) {
      window.mobius?.signal?.('contribution_stack_submitted', {
        stack_id: stackRecords[0]?.plan?.stack?.id || '',
        item_count: outcome.submitted?.length || 0,
      })
      refreshReviewStatus()
      return { ok: true, submitted: outcome.submitted?.length || 0 }
    }
    if (outcome.uncertain) {
      let resolutions = stackRecords.map(() => ({ state: 'unconfirmed', record: null }))
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const ledger = await loadLedger()
          resolutions = stackRecords.map((rec) => resolveUncertainSubmission(rec, ledger))
        } catch {
          resolutions = stackRecords.map(() => ({ state: 'unconfirmed', record: null }))
        }
        if (resolutions.every(isSubmissionResolutionSettled)) break
      }
      const durable = resolutions.flatMap((item, index) => item.record
        ? [{ ...item.record, path: stackRecords[index].path }]
        : [])
      if (durable.length > 0) applyRecordUpdates(durable)
      const summary = summarizeSubmissionResolutions(resolutions)
      if (summary.state === 'published') {
        window.mobius?.signal?.('contribution_stack_submitted', {
          stack_id: stackRecords[0]?.plan?.stack?.id || '',
          item_count: summary.published,
          reconciled: true,
        })
        refreshReviewStatus()
        return { ok: true, submitted: summary.published }
      }
      if (summary.state === 'publishing') {
        refreshReviewStatus()
        return {
          pending: true,
          publishing: summary.publishing,
          published: summary.published,
        }
      }
      refreshReviewStatus()
      if (summary.blocked > 0) {
        return {
          error: summary.published > 0
            ? 'Saved progress was restored. The remaining changes show what needs updating.'
            : 'Nothing was sent. These changes need an update before you try again.',
        }
      }
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create duplicates.',
      }
    }
    refreshReviewStatus()
    return { error: outcome.error || 'Could not submit this PR stack.' }
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  // Feedback = return to the chat that created the contribution, with a small
  // draft already pointing at the exact record. Attention follow-ups can pass
  // a more specific draft. Older records may not have
  // chat_id; in that case the card says so rather than opening an ambiguous
  // new chat.
  const onFeedback = useCallback((rec, opts = {}) => {
    if (window.parent === window) {
      return { ok: false, reason: 'standalone' }
    }
    if (!rec.chat_id) {
      return { ok: false, reason: 'missing-chat' }
    }
    const draft = opts.draft || (
      'Feedback on contribution ' + rec.id +
      ' ("' + (rec.title || 'untitled') + '"): '
    )
    window.parent.postMessage(
      { type: 'moebius:open-chat', chatId: rec.chat_id, draft },
      window.location.origin)
    window.mobius?.signal?.('contribution_feedback_opened', { id: rec.id })
    return { ok: true }
  }, [])

  // Dismiss = CAS flip to abandoned (storage.js owns the If-Match dance). On
  // success the record moves to History in place; on a conflict the feed is
  // reloaded so the card shows whatever actually happened to it.
  const onDismiss = useCallback(async (rec) => {
    const outcome = await abandonPrepared({ appId, token, rec })
    if (outcome.ok) {
      // Pure updater — the feed cache catches up on the next rescan/mount,
      // and the runtime mirror already holds the flipped record.
      const flipped = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(flipped)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_dismissed', { id: rec.id })
    } else if (outcome.conflict !== undefined || outcome.gone) {
      const ledger = await loadLedger()
      if (!ledger.fromCache) {
        replaceFeed(ledger.records)
      }
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  // Undrop = CAS flip a dropped record back to `prepared`. Mirrors onDismiss:
  // on success it moves from History back to Ready for review in place; on a
  // conflict/gone the feed reloads so the card reflects reality.
  const onRestore = useCallback(async (rec) => {
    const outcome = await restoreAbandoned({ appId, token, rec })
    if (outcome.ok) {
      const flipped = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(flipped)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_restored', { id: rec.id })
    } else if (outcome.conflict !== undefined || outcome.gone) {
      const ledger = await loadLedger()
      if (!ledger.fromCache) {
        replaceFeed(ledger.records)
      }
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  const groups = useMemo(() => groupRecords(records), [records])
  const sourceProjects = useMemo(
    () => attachSourceProjects(sourceSnapshot, records),
    [sourceSnapshot, records],
  )
  const actionableProjects = useMemo(
    () => actionableSourceProjects(sourceProjects),
    [sourceProjects],
  )
  const isEmpty = records.length === 0
  // The toolbar reflects only the app's first connection/feed read. Once that
  // read settles, an unavailable GitHub status is rendered as a retryable
  // content state instead of leaving "Checking…" visible forever.
  const checking = loading || conn.state === 'checking'

  return (
    <div className="co-root">
      <style>{CSS}</style>
      <main ref={pageRef} className={'co-page' + (view === 'sources' ? ' is-sources' : '')}>
        <Header
          appId={appId}
          fromCache={fromCache}
          omittedCount={omittedCount}
          checking={checking}
        >
          <ConnectionCard
            conn={conn}
            token={token}
            onChanged={refreshConnection}
            placement="toolbar"
          />
        </Header>
        <nav className="co-tabs" role="tablist" aria-label="Contribute views">
          <button
            type="button"
            role="tab"
            id="co-tab-contributions"
            aria-controls="co-panel-contributions"
            aria-selected={view === 'contributions'}
            tabIndex={view === 'contributions' ? 0 : -1}
            data-view="contributions"
            ref={(node) => { tabRefs.current.contributions = node }}
            className={view === 'contributions' ? 'is-active' : ''}
            onClick={() => setView('contributions')}
            onKeyDown={onTabKeyDown}
          >
            Contributions
          </button>
          <button
            type="button"
            role="tab"
            id="co-tab-sources"
            aria-controls="co-panel-sources"
            aria-selected={view === 'sources'}
            tabIndex={view === 'sources' ? 0 : -1}
            data-view="sources"
            ref={(node) => { tabRefs.current.sources = node }}
            className={view === 'sources' ? 'is-active' : ''}
            onClick={() => setView('sources')}
            onKeyDown={onTabKeyDown}
          >
            Projects
          </button>
        </nav>

        {view === 'sources' ? (
          <SourceMap
            snapshot={sourceSnapshot}
            projects={sourceProjects}
            conn={conn}
            loading={sourceLoading}
            error={sourceError}
            onRetry={refreshSources}
            focusRequest={sourceFocus}
            onAskAgent={onAskSourceAgent}
          />
        ) : (
          <div
            id="co-panel-contributions"
            className="co-contributions-view"
            role="tabpanel"
            aria-labelledby="co-tab-contributions"
          >
            <SourceOverview
              projects={actionableProjects}
              loading={sourceLoading}
              onViewAll={() => setView('sources')}
            />
            <ConnectionCard
              conn={conn}
              token={token}
              onChanged={refreshConnection}
              onRetry={refreshConnection}
              placement="content"
            />
            {/* Hold the feed area blank until the first load resolves so an empty
                ledger doesn't flash the sell-the-loop copy before data arrives. */}
            {loading ? null : isEmpty ? (
              actionableProjects.length > 0 ? null : <EmptyState />
            ) : (
              <Feed
                groups={groups}
                records={records}
                reviewStatus={reviewStatus}
                onSend={onSend}
                onSendStack={onSendStack}
                onFeedback={onFeedback}
                onDismiss={onDismiss}
                onRestore={onRestore}
                loadDiff={loadFullDiff}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
