// Contribute — thin app shell. The module tree is declared in mobius.json's
// source_files; the multi-file installer fetches each path and Rolldown bundles
// from this entry, resolving the relative imports below at compile time.
//
//   theme.js    — the single app stylesheet (CSS)
//   domain.js   — pure logic: grouping, counts, the batched live-refresh query
//   contribution-policy.js — target-aware personal GitHub / Möbius bot routing
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
  attachSourceProjects,
  recordsForProject,
} from './source-map.js'
import {
  applyLiveStates,
  buildRefreshQuery,
  isSubmissionResolutionSettled,
  mergeRecordUpdates,
  reconcileLedgerSnapshot,
  resolveUncertainSubmission,
  summarizeSubmissionResolutions,
  syncSetupCompletion,
  upsertRecord,
} from './domain.js'
import { contributionActionScope, contributionApprovalIsCurrent, contributionPhaseApprovalIsCurrent, contributionReviewTargetFromIntent, focusedContributionNavigationReady, focusedContributionReady, indexReviewStatus, qualityReviewFor } from './review.js'
import { buildContributionRun, findRunItemByRecord } from './run.js'
import { stackPublicationRecords } from './stack.js'
import { abandonPrepared, cacheFeed, cacheSourceSnapshot, loadAppSettings, loadCachedFeed, loadCachedSourceSnapshot, loadContributionRecord, loadFreshContributionRecord, loadFreshContributionRecords, loadCycleState, loadFullDiff, loadLedger, restoreAbandoned, saveAppSettings } from './storage.js'
import { createRefreshCoordinator, isVisibleFrameMessage } from './refresh.js'
import {
  contributionPathDecision,
  contributionStackDecision,
} from './contribution-policy.js'
import {
  assignIncomingReview,
  fetchIncomingReviews,
  fetchGithubStatus,
  fetchLiveStates,
  fetchMobiusContributionStatus,
  fetchReviewStatus,
  fetchSourceDiff,
  fetchSourceStatus,
  markContributionReady,
  setAutopilot,
  submitContribution,
  submitContributionViaMobius,
  submitContributionStack,
  updateContribution,
  updateContributionStack,
  withdrawMobiusContribution,
} from './api.js'
import { ConnectionSettings } from './ui/ConnectionCard.jsx'
import { openAgentConversation } from './ui/BatchAction.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { Icon } from './ui/Icons.jsx'
import { SourceMap } from './ui/SourceMap.jsx'
import { ProjectControls } from './ui/ProjectControls.jsx'
import { TaskPane } from './ui/TaskPane.jsx'
import { PullRequests } from './ui/PullRequests.jsx'
import { discoverRepositories, mayMerge } from './collaboration.js'

// The app's own icon, with a lettered fallback for installs whose icon route
// 404s. Mirrors the App Store header pattern.
function Header({ appId, fromCache, checking, children }) {
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
        </div>
      </div>
      <div className="co-toolbar">
        {checking && (
          <span className="co-toolbar-check" role="status" aria-live="polite">
            <span className="ma-spinner is-compact" aria-hidden="true" />
            <span className="co-visually-hidden">Updating contribution state</span>
          </span>
        )}
        {children}
      </div>
      {fromCache && (
        <span className="co-offline-note">Offline — showing your last synced feed.</span>
      )}
    </header>
  )
}

export default function ContributeApp({ appId, token }) {
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'checking' })
  const [loading, setLoading] = useState(true)
  const [ledgerReady, setLedgerReady] = useState(false)
  const [omittedCount, setOmittedCount] = useState(0)
  const [sourceSnapshot, setSourceSnapshot] = useState(null)
  const [projectFocus, setProjectFocus] = useState(null)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState('')
  const [reviewStatus, setReviewStatus] = useState({
    state: 'loading', byId: {}, checkedAt: '',
  })
  const [reviewFocus, setReviewFocus] = useState(null)
  const [focusedRecordLookup, setFocusedRecordLookup] = useState({
    nonce: '', recordId: '', ready: false,
  })
  const [incomingReviews, setIncomingReviews] = useState([])
  const repositoryRequest = useRef(0)
  const [repositoryAccess, setRepositoryAccess] = useState({ repositories: [], error: '', hasNextPage: false })
  const loadRepositories = useCallback(async (cursor = null) => {
    const requestId = ++repositoryRequest.current
    try {
      const next = await discoverRepositories(token, cursor)
      if (requestId !== repositoryRequest.current) return
      setRepositoryAccess(old => ({ ...next, error: '', repositories: cursor
        ? [...new Map([...old.repositories, ...next.repositories].map(repo => [repo.nameWithOwner, repo])).values()]
        : next.repositories }))
    } catch (error) { if (requestId === repositoryRequest.current) setRepositoryAccess(old => ({ ...old, error: error.message })) }
  }, [token])
  useEffect(() => {
    if (conn.state === 'connected') void loadRepositories()
    else { repositoryRequest.current += 1; setRepositoryAccess({ repositories: [], error: '', hasNextPage: false }) }
    return () => { repositoryRequest.current += 1 }
  }, [conn.state, loadRepositories])
  // Whether a new Send grants autopilot. Default on; consulted only at Send
  // time (job.sh keys off each record's stamped grant, never this preference).
  const [autopilotDefault, setAutopilotDefault] = useState(true)
  const [submissionMethod, setSubmissionMethod] = useState('mobius')
  const [submissionError, setSubmissionError] = useState('')
  const [earlierCycle, setEarlierCycle] = useState(null)
  useEffect(() => { void loadCycleState().then(setEarlierCycle) }, [])
  const pageRef = useRef(null)
  // Latest records for callbacks (the connect-flow refresh) that must not take
  // a `records` dependency and re-bind on every ledger change.
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const connRef = useRef(conn)
  const connectionRequestRef = useRef(0)
  const reviewStatusRequestRef = useRef(0)
  const incomingReviewsRequestRef = useRef(0)
  const agentStartRef = useRef(false)
  const sourceSnapshotRef = useRef(sourceSnapshot)
  const readySignalRef = useRef(false)
  const ledgerReadyRef = useRef(false)
  useEffect(() => { connRef.current = conn }, [conn])
  useEffect(() => { sourceSnapshotRef.current = sourceSnapshot }, [sourceSnapshot])

  const signalReady = useCallback((details = {}) => {
    if (readySignalRef.current) return
    readySignalRef.current = true
    window.mobius?.signal?.('app_ready', details)
  }, [])

  // Every app-owned agent handoff uses the durable first-turn primitive. A
  // scoped handoff is admitted atomically by the platform, so two panes or a
  // remounted frame resolve to one exact conversation without a read/create
  // race. The local guard exists only for immediate button feedback.
  const startAgentTask = useCallback(async (action) => {
    if (!action?.title || !action?.draft) {
      return { ok: false, error: 'This agent handoff is incomplete.' }
    }
    if (agentStartRef.current) {
      return { ok: false, error: 'Another agent task is already starting.' }
    }
    if (!window.mobius?.chat?.start) {
      return { ok: false, error: 'Agent handoffs are unavailable in this Möbius version.' }
    }
    agentStartRef.current = true
    try {
      const started = await window.mobius.chat.start({
        title: action.title,
        draft: action.draft,
        scope: contributionActionScope(action),
        scopeLabel: action.scopeLabel,
      })
      if (!started?.chatId) throw new Error('Missing chat id')
      window.mobius?.signal?.(action.event || 'contribute_agent_handoff', {
        item_count: Number(action.count || 0),
        outcome: started.outcome || (started.reused ? 'reused' : 'started'),
      })
      return {
        ok: true,
        chatId: started.chatId,
        reused: started.reused === true,
        outcome: started.outcome || (started.reused ? 'reused' : 'started'),
      }
    } catch {
      return { ok: false, error: 'Could not start the agent. Try again.' }
    } finally {
      agentStartRef.current = false
    }
  }, [])

  // Keep the App Store's "Setup" tag truthful: every settled connection
  // status — initial load, in-app connect, disconnect — lands here via
  // setConn. The frame's virtual localStorage forwards the shared completion
  // key to the shell, which fans it out to every mounted app frame,
  // including the App Store's.
  useEffect(() => {
    const setupState = submissionMethod === 'mobius' ? 'connected' : conn.state
    try { syncSetupCompletion(appId, setupState, window.localStorage) } catch {}
  }, [appId, conn.state, submissionMethod])

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
    const requestId = reviewStatusRequestRef.current + 1
    reviewStatusRequestRef.current = requestId
    setReviewStatus((current) => ({ ...current, state: 'loading' }))
    const outcome = await fetchReviewStatus(token, appId)
    if (requestId !== reviewStatusRequestRef.current) return null
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
  const refreshSources = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet && !sourceSnapshotRef.current) setSourceLoading(true)
    const result = await fetchSourceStatus(token)
    if (result.ok) {
      sourceSnapshotRef.current = result.data
      setSourceSnapshot(result.data)
      setSourceError('')
      cacheSourceSnapshot(result.data)
      window.mobius?.signal?.('source_map_viewed', {
        source_count: 1 + (result.data?.apps?.length || 0),
      })
    } else if (!sourceSnapshotRef.current) {
      setSourceError(result.unsupported ? 'restart' : 'unavailable')
    }
    setSourceLoading(false)
  }, [token])

  useEffect(() => {
    let cancelled = false
    async function loadSources() {
      const cached = await loadCachedSourceSnapshot()
      if (cached && !cancelled) {
        sourceSnapshotRef.current = cached
        setSourceSnapshot(cached)
        setSourceLoading(false)
        signalReady({
          source: 'project-snapshot',
          item_count: 1 + (cached?.apps?.length || 0),
        })
      }
      if (!cancelled) await refreshSources({ quiet: !!cached })
    }
    loadSources()
    return () => { cancelled = true }
  }, [refreshSources, signalReady])
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

  const refreshIncomingReviews = useCallback(async () => {
    const requestId = incomingReviewsRequestRef.current + 1
    incomingReviewsRequestRef.current = requestId
    if (connRef.current.state !== 'connected') {
      setIncomingReviews([])
      return []
    }
    const rows = await fetchIncomingReviews(token)
    if (
      requestId !== incomingReviewsRequestRef.current
      || connRef.current.state !== 'connected'
    ) return []
    setIncomingReviews(rows)
    return rows
  }, [token])

  useEffect(() => {
    refreshIncomingReviews()
  }, [conn.state, refreshIncomingReviews])

  // Mount: the cached first screen, GitHub status, and app preferences are all
  // small independent reads. Publish them without holding those controls
  // behind the much larger ledger enumeration. The live refresh still waits
  // for both GitHub and the authoritative ledger.
  useEffect(() => {
    let cancelled = false
    async function load() {
      // Start the single-file snapshot read before the paged authoritative
      // ledger scan. It gives repeat visits a useful queue immediately while
      // the full ledger catches up without ever becoming a second truth.
      const cachedPromise = loadCachedFeed()
      const ledgerPromise = Promise.resolve().then(() => loadLedger())
      const statusPromise = fetchGithubStatus(token)
      const settingsPromise = loadAppSettings()
      const cached = await cachedPromise
      if (!cancelled && cached.length > 0) {
        recordsRef.current = cached
        setRecords(cached)
        setLoading(false)
        signalReady({
          item_count: cached.length,
          source: 'snapshot',
        })
      }
      const [status, appSettings] = await Promise.all([
        statusPromise,
        settingsPromise,
      ])
      if (cancelled) return
      if (typeof appSettings.autopilot_default === 'boolean') {
        setAutopilotDefault(appSettings.autopilot_default)
      }
      const savedMethod = appSettings.submission_method
      setSubmissionMethod(
        savedMethod === 'mobius' || savedMethod === 'github'
          ? savedMethod
          : 'mobius',
      )
      connRef.current = status
      setConn(status)

      const ledger = await ledgerPromise
      if (cancelled) return
      const recs = ledger.records
      recordsRef.current = recs
      setOmittedCount(ledger.omitted.length)
      setRecords(recs)
      setFromCache(ledger.fromCache)
      setLoading(false)
      ledgerReadyRef.current = true
      setLedgerReady(true)
      signalReady({ item_count: recs.length })

      if (ledger.fromCache) return
      let toCache = recs
      let feedReplaced = false
      if (status.state === 'connected') {
        const next = await fetchRefreshed(recs)
        if (cancelled) return
        if (next !== recs) {
          // A public action or focused exact read may have advanced one row
          // while the mount-time GitHub overlay was in flight. Reconcile at
          // settlement so that slower startup work cannot overwrite it.
          toCache = replaceFeed(reconcileLedgerSnapshot(recordsRef.current, next))
          feedReplaced = true
        }
      }
      if (!feedReplaced) cacheFeed(toCache)
    }
    load().catch((err) => {
      if (cancelled) return
      setLoading(false)
      ledgerReadyRef.current = true
      setLedgerReady(true)
      signalReady({ item_count: recordsRef.current.length })
      window.mobius?.signal?.('error', {
        message: String(err?.message || err),
        source: 'load',
      })
    })
    return () => { cancelled = true }
  }, [token, fetchRefreshed, replaceFeed, signalReady])

  // Event-driven liveness: refresh when the app becomes actionable again.
  // Focus + visibility can fire together, and an online transition can land
  // during either refresh, so one coordinator deduplicates concurrent work and
  // preserves exactly one trailing refresh when an event arrives mid-flight.
  // There is deliberately no timer: a hidden/idle app consumes no resources.
  const refreshWorkRef = useRef(null)
  const runRefreshWork = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    // Mount already owns the first authoritative scan. Startup focus and
    // visibility events must not queue another full pass behind it.
    if (!ledgerReadyRef.current) return
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
    const refreshOnForeground = (event) => {
      if (isVisibleFrameMessage(event, window.parent)) requestRefresh()
    }
    document.addEventListener('visibilitychange', requestRefresh)
    window.addEventListener('focus', requestRefresh)
    window.addEventListener('online', requestRefresh)
    window.addEventListener('message', refreshOnForeground)
    return () => {
      document.removeEventListener('visibilitychange', requestRefresh)
      window.removeEventListener('focus', requestRefresh)
      window.removeEventListener('online', requestRefresh)
      window.removeEventListener('message', refreshOnForeground)
    }
  }, [])

  // Shell review cards use the platform's one-shot app-intent rail. The card
  // names only the ledger record; this app resolves the record's current stage
  // and enclosing stack from authoritative storage.
  useEffect(() => {
    function onReviewIntent(event) {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type !== 'moebius:app-intent') return
      const target = contributionReviewTargetFromIntent(event.data.intent)
      if (!target) return
      setReviewFocus({
        ...target,
        nonce: String(event.data.nonce ?? Date.now()),
        refreshMountedLedger: ledgerReadyRef.current,
      })
      if (target.queue) setProjectFocus({ key: '', nonce: String(event.data.nonce ?? Date.now()) })
      window.mobius?.signal?.('contribution_review_opened', { id: target.recordId })
    }
    window.addEventListener('message', onReviewIntent)
    return () => window.removeEventListener('message', onReviewIntent)
  }, [])

  // A queue intent has no exact record to fresh-read. If it arrived after the
  // app had already mounted, join the same deduplicated foreground refresh as
  // focus/visibility events before exposing the queue. An intent that arrived
  // during the initial authoritative scan can use that scan when it settles.
  useEffect(() => {
    const nonce = reviewFocus?.nonce
    if (!reviewFocus?.queue || !nonce) return undefined
    let cancelled = false
    let resolving = false
    setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: false })

    const resolveFocusedQueue = async () => {
      if (cancelled || resolving || !ledgerReadyRef.current) return
      if (!reviewFocus.refreshMountedLedger) {
        setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: true })
        return
      }
      if (document.visibilityState !== 'visible') return
      resolving = true
      try {
        await refreshCoordinatorRef.current()
        if (!cancelled) {
          setFocusedRecordLookup({ nonce, recordId: '', queue: true, ready: true })
        }
      } finally {
        resolving = false
      }
    }

    resolveFocusedQueue()
    document.addEventListener('visibilitychange', resolveFocusedQueue)
    window.addEventListener('focus', resolveFocusedQueue)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', resolveFocusedQueue)
      window.removeEventListener('focus', resolveFocusedQueue)
    }
  }, [reviewFocus?.queue, reviewFocus?.nonce, reviewFocus?.refreshMountedLedger, ledgerReady])

  // The full contribution history is intentionally loaded in the background,
  // but it can span hundreds of records. Fetch the exact focused row directly,
  // then render as soon as the active snapshot contains either that standalone
  // record or every layer in its stack. Public actions still fresh-read their
  // exact records, so this fast path changes navigation latency, not authority.
  useEffect(() => {
    const recordId = reviewFocus?.recordId
    const nonce = reviewFocus?.nonce
    if (reviewFocus?.queue || !recordId || !nonce) return undefined
    let cancelled = false
    let resolvingStack = false
    let needsStackRefresh = false
    setFocusedRecordLookup({ nonce, recordId, ready: false })

    const resolveIncompleteStack = async () => {
      if (
        cancelled
        || resolvingStack
        || !needsStackRefresh
        || !ledgerReadyRef.current
        || window.mobius?.online === false
        || document.visibilityState !== 'visible'
      ) return
      resolvingStack = true
      try {
        await refreshCoordinatorRef.current()
        if (!cancelled) setFocusedRecordLookup({ nonce, recordId, ready: true })
      } finally {
        resolvingStack = false
      }
    }

    async function resolveFocusedReview() {
      const record = await loadContributionRecord(recordId)
      if (cancelled) return
      if (!record) {
        if (window.mobius?.online === false) {
          // An absent offline cache entry is not proof that the review was
          // deleted. A complete cached unit may still open safely; otherwise
          // keep waiting for a real foreground read.
          if (focusedContributionReady(recordsRef.current, recordId)) {
            setFocusedRecordLookup({ nonce, recordId, ready: true })
          } else {
            needsStackRefresh = true
          }
          return
        }
        // Both canonical and legacy exact reads settled without a record. This
        // is the only focused path that may truthfully report disappearance
        // without waiting for the larger ledger scan.
        setFocusedRecordLookup({ nonce, recordId, ready: true })
        return
      }

      const next = upsertRecord(recordsRef.current, record)
      recordsRef.current = next
      setRecords(next)
      setLoading(false)
      if (focusedContributionReady(next, recordId)) {
        setFocusedRecordLookup({ nonce, recordId, ready: true })
        return
      }

      // A focused stack record does not name every sibling. If the mounted
      // app's prior ledger predates this stack, join the existing deduplicated
      // foreground refresh rather than creating a third full-history reader.
      // Mount already owns the same scan while the first ledger is loading.
      needsStackRefresh = true
      await resolveIncompleteStack()
    }
    document.addEventListener('visibilitychange', resolveIncompleteStack)
    window.addEventListener('focus', resolveIncompleteStack)
    window.addEventListener('online', resolveIncompleteStack)
    resolveFocusedReview().catch(() => {
      // A failed direct read is not proof that the review disappeared. Keep
      // waiting for any foreground ledger refresh instead.
      if (!cancelled) setFocusedRecordLookup({ nonce, recordId, ready: false })
    })
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', resolveIncompleteStack)
      window.removeEventListener('focus', resolveIncompleteStack)
      window.removeEventListener('online', resolveIncompleteStack)
    }
  }, [reviewFocus?.recordId, reviewFocus?.nonce, ledgerReady])

  const consumeReviewFocus = useCallback((nonce) => {
    setReviewFocus((current) => current?.nonce === nonce ? null : current)
  }, [])

  const focusedReviewReady = focusedContributionNavigationReady(
    reviewFocus,
    focusedRecordLookup,
    records,
  )

  const loadProjectDiff = useCallback(
    (project) => fetchSourceDiff(token, project),
    [token],
  )

  // New PRs use the owner's selected publication path. An existing-PR update
  // stays on the personal GitHub identity that owns its public branch. Both
  // actions consume one exact reviewed record and remain explicit clicks.
  const onSend = useCallback(async (rec) => {
    let canonical = null
    try {
      canonical = await loadFreshContributionRecord(rec.id)
    } catch { /* handled by the safe refresh error below */ }
    if (!canonical) {
      return {
        error: 'Contribute could not refresh the saved review. Nothing was sent; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    const refreshed = { ...canonical, path: canonical.path || rec.path }
    applyRecordUpdates(refreshed)
    if (!contributionApprovalIsCurrent(rec, refreshed)) {
      return stalePublicApproval()
    }
    if (
      refreshed.status === 'prepared' &&
      qualityReviewFor(refreshed).state !== 'all_clear'
    ) {
      return {
        reviewNeeded: true,
        record: refreshed,
        error: 'Review this exact version first. The Review action is ready on this card.',
        failure: { owner: 'agent' },
      }
    }
    const updating = refreshed.plan?.action === 'pr_update'
    let viaMobius = false
    let outcome
    if (updating) {
      if (connRef.current.state !== 'connected') {
        return {
          error: 'Connect GitHub before updating this pull request.',
          failure: { owner: 'owner', code: 'github_not_connected' },
        }
      }
      outcome = await updateContribution({ appId, token, rec: refreshed })
    } else {
      const decision = contributionPathDecision(
        refreshed,
        submissionMethod,
        connRef.current.state,
      )
      if (decision.error) return {
        error: decision.error,
        failure: { owner: 'owner' },
      }
      viaMobius = decision.method === 'mobius'
      outcome = viaMobius
        ? await submitContributionViaMobius({ appId, token, rec: refreshed })
        : await submitContribution({
            appId,
            token,
            rec: refreshed,
            autopilot: autopilotDefault && connRef.current.autopilotAvailable === true,
            publicationStage: 'ready',
          })
    }
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.(updating ? 'contribution_updated' : 'contribution_submitted', {
        id: rec.id,
        url: outcome.url || next.url,
        via: viaMobius ? 'mobius' : 'github',
      })
      refreshReviewStatus()
      return {
        ok: true,
        record: next,
        url: outcome.url || next.url,
        viaMobius,
        updated: updating,
      }
    }
    if (outcome.pending) {
      const next = { ...outcome.pending, path: rec.path }
      applyRecordUpdates(next)
      return { pending: true, record: next, viaMobius }
    }
    if (outcome.alreadyHandled) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
      } catch { /* the ordinary refresh below remains authoritative */ }
      refreshReviewStatus()
      return { alreadyHandled: true }
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
          const fresh = await loadFreshContributionRecord(rec.id)
          resolution = resolveUncertainSubmission(rec, {
            records: fresh ? [fresh] : [],
            fromCache: window.mobius.online === false,
          })
        } catch {
          resolution = { state: 'unconfirmed', record: null }
        }
        if (isSubmissionResolutionSettled(resolution)) break
      }
      if (resolution.record) {
        const next = { ...resolution.record, path: rec.path }
        applyRecordUpdates(next)
        if (resolution.state === 'published') {
          window.mobius?.signal?.(updating ? 'contribution_updated' : 'contribution_submitted', {
            id: rec.id,
            url: next.url || '',
            reconciled: true,
          })
          refreshReviewStatus()
          return {
            ok: true,
            record: next,
            url: next.url || '',
            viaMobius,
            updated: updating,
          }
        }
        if (resolution.state === 'publishing') {
          refreshReviewStatus()
          return { pending: true, record: next, viaMobius }
        }
        if (resolution.state === 'blocked') {
          refreshReviewStatus()
          return {
            error: 'Nothing was sent. This contribution needs an update before you try again.',
            failure: { owner: 'agent', code: 'review_refresh_needed' },
          }
        }
      }
      refreshReviewStatus()
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create a duplicate.',
        failure: { owner: 'automatic' },
      }
    }
    refreshReviewStatus()
    return {
      error: outcome.error || 'Could not submit this PR.',
      failure: outcome.failure,
    }
  }, [
    appId,
    token,
    autopilotDefault,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

  const onMarkReady = useCallback(async (rec) => {
    let canonical = null
    try {
      canonical = await loadFreshContributionRecord(rec.id)
    } catch { /* handled by the safe error below */ }
    if (!canonical) {
      return {
        error: 'Contribute could not refresh this draft. Nothing changed; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    const current = { ...canonical, path: canonical.path || rec.path }
    applyRecordUpdates(current)
    if (!contributionApprovalIsCurrent(rec, current)) {
      return stalePublicApproval()
    }
    if (current.status === 'open') return { alreadyHandled: true, record: current }
    if (current.status !== 'draft' || current.submission_mode === 'mobius-bot') {
      return {
        error: current.submission_mode === 'mobius-bot'
          ? 'Möbius relay drafts cannot request review from this connection yet.'
          : 'This pull request is no longer a personal draft.',
        failure: { owner: 'owner', code: 'ready_not_available' },
      }
    }

    let outcome = await markContributionReady({ appId, token, rec: current })
    if (outcome.record) {
      applyRecordUpdates({ ...outcome.record, path: current.path })
    }
    if (outcome.ok) {
      const next = { ...outcome.ok, path: current.path }
      applyRecordUpdates(next)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_ready_for_review', {
        id: next.id,
        url: outcome.url || next.url || '',
      })
      return { ok: true, record: next }
    }

    if (outcome.uncertain) {
      let fresh = null
      try { fresh = await loadFreshContributionRecord(rec.id) } catch { /* keep uncertain */ }
      if (fresh?.status === 'open') {
        const next = { ...fresh, path: current.path }
        applyRecordUpdates(next)
        refreshReviewStatus()
        return { ok: true, record: next }
      }
      if (fresh?.readying) {
        // The durable claim proves the earlier owner approval reached Möbius.
        // Repeating this route is read-only reconciliation; it cannot issue a
        // second GitHub mutation.
        outcome = await markContributionReady({ appId, token, rec: fresh })
        if (outcome.record) {
          applyRecordUpdates({ ...outcome.record, path: current.path })
        }
        if (outcome.ok) {
          const next = { ...outcome.ok, path: current.path }
          applyRecordUpdates(next)
          refreshReviewStatus()
          return { ok: true, record: next }
        }
      }
      refreshReviewStatus()
      return {
        pending: Boolean(fresh?.readying || outcome.record?.readying),
        error: outcome.error || 'Review-stage confirmation is still being reconciled.',
        failure: outcome.failure || { owner: 'automatic' },
      }
    }

    refreshReviewStatus()
    return {
      error: outcome.error || 'Could not request review for this pull request.',
      failure: outcome.failure,
    }
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  const relaySubmittingIds = useMemo(() => records
    .filter((rec) => (
      rec.submission_mode === 'mobius-bot' &&
      rec.status === 'submitting' &&
      rec.relay_contribution_id
    ))
    .map((rec) => rec.id)
    .sort()
    .join('\0'), [records])

  // The relay may acknowledge before GitHub has opened the draft. Poll only
  // the exact durable ids; remounting resumes from the ledger and never creates
  // another submission.
  useEffect(() => {
    if (!relaySubmittingIds || window.mobius?.online === false) return undefined
    let cancelled = false
    let timer = null
    const poll = async () => {
      const wanted = new Set(relaySubmittingIds.split('\0'))
      const active = recordsRef.current.filter((rec) => wanted.has(rec.id))
      for (const rec of active) {
        const outcome = await fetchMobiusContributionStatus({ appId, token, rec })
        if (cancelled) return
        if (outcome.ok) {
          const next = { ...outcome.ok, path: rec.path }
          applyRecordUpdates(next)
          if (next.url) {
            window.mobius?.signal?.('contribution_submitted', {
              id: next.id,
              url: next.url,
              via: 'mobius',
              reconciled: true,
            })
          }
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 30000)
    }
    timer = window.setTimeout(poll, 1200)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [relaySubmittingIds, appId, token, applyRecordUpdates])

  const onWithdraw = useCallback(async (rec) => {
    const outcome = await withdrawMobiusContribution({ appId, token, rec })
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.('contribution_withdrawn', { id: rec.id })
      refreshReviewStatus()
      return { ok: next }
    }
    if (outcome.uncertain) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh?.status === 'closed') {
          const next = { ...fresh, path: rec.path }
          applyRecordUpdates(next)
          return { ok: next }
        }
      } catch { /* keep the explicit uncertain result */ }
    }
    return outcome
  }, [appId, token, applyRecordUpdates, refreshReviewStatus])

  // Pause / resume autopilot for one shipped PR. Platform endpoint (not a ledger
  // write); on success we re-read that record so the mirrored autopilot block
  // and any cleared human_required flag land in the feed.
  const onSetAutopilot = useCallback(async (rec, enabled) => {
    const outcome = await setAutopilot({
      appId, token, recordId: rec.id, enabled,
    })
    if (outcome.ok) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
      } catch { /* the next refresh reconciles */ }
      return { ok: true }
    }
    return { error: outcome.error || 'Could not update autopilot.' }
  }, [appId, token, applyRecordUpdates])

  const onToggleAutopilotDefault = useCallback(async (next) => {
    setAutopilotDefault(next)
    const settings = await loadAppSettings()
    saveAppSettings({ ...settings, autopilot_default: next })
  }, [])

  const onChooseSubmissionMethod = useCallback(async (next) => {
    if (next !== 'mobius' && next !== 'github') return
    setSubmissionMethod(next)
    setSubmissionError('')
    const settings = await loadAppSettings()
    const saved = await saveAppSettings({ ...settings, submission_method: next })
    if (!saved) setSubmissionError('Selected for this session, but your choice could not be saved. Check your connection and try again.')
    window.mobius?.signal?.('contribution_method_changed', { method: next })
  }, [])

  const onAssignIncomingReview = useCallback(async (item) => {
    const repo = item?.repository?.nameWithOwner || ''
    const outcome = await assignIncomingReview({ appId, token, repo, number: item?.number })
    if (!outcome.ok) return outcome
    const started = await startAgentTask({
      event: 'assign_and_review_incoming_pr',
      title: `Review ${repo} #${item.number}`,
      count: 1,
      draft: [
        `Thoroughly review ${item.url}.`,
        '',
        'The owner explicitly assigned this exact pull request to themselves from Contribute.',
        'Inspect the complete current diff with expanding scope for correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt.',
        'Do not change the author’s branch. Prepare specific, actionable suggestions for sound findings and re-review if the author updates it.',
        'Do not submit a GitHub review or comment without the owner’s exact approval for that public action.',
      ].join('\n'),
    })
    if (!started.ok) {
      return {
        ...started,
        error: 'Assigned on GitHub, but the review conversation did not start. Try again to resume it.',
      }
    }
    // The assignment settled after any earlier incoming-review request began.
    // Invalidate that request before hiding this row so its stale response
    // cannot put the just-assigned review back into the queue.
    incomingReviewsRequestRef.current += 1
    setIncomingReviews((current) => current.filter((row) => row.url !== item.url))
    return { ok: true }
  }, [appId, token, startAgentTask])

  // One explicit confirmation advances the exact current phase of an already-
  // reviewed chain. The response may contain partial progress, so merge every
  // returned ledger record rather than treating the phase as all-or-nothing.
  const onSendStack = useCallback(async (stackRecords) => {
    const approvedPublicationRecords = stackPublicationRecords({
      type: 'stack', records: stackRecords, total: stackRecords.length,
    })
    let freshRecords = []
    try {
      freshRecords = await loadFreshContributionRecords(
        stackRecords.map((rec) => rec.id),
      )
    } catch { /* handled by the complete-set check below */ }
    const freshById = new Map(freshRecords.map((rec) => [rec.id, rec]))
    const currentRecords = stackRecords.flatMap((approved) => {
      const current = freshById.get(approved.id)
      return current ? [{ ...current, path: current.path || approved.path }] : []
    })
    if (currentRecords.length !== stackRecords.length) {
      return {
        error: 'Contribute could not refresh the complete reviewed chain. Nothing was sent; try again once it reconnects.',
        failure: { owner: 'automatic' },
      }
    }
    applyRecordUpdates(currentRecords)
    const publicationRecords = stackPublicationRecords({
      type: 'stack', records: currentRecords, total: currentRecords.length,
    })
    if (!contributionPhaseApprovalIsCurrent(
      approvedPublicationRecords,
      publicationRecords,
    )) {
      return stalePublicApproval()
    }
    const updating = publicationRecords.length > 0 && publicationRecords.every(
      (rec) => rec?.plan?.action === 'pr_update',
    )
    if (updating && connRef.current.state !== 'connected') {
      return {
        error: 'Connect Personal GitHub before updating these pull requests.',
        failure: { owner: 'owner', code: 'github_not_connected' },
      }
    }
    if (!updating) {
      const decision = contributionStackDecision(
        currentRecords,
        submissionMethod,
        connRef.current.state,
      )
      if (decision.error) return {
        error: decision.error,
        failure: { owner: 'owner' },
      }
      if (decision.method === 'mobius') {
        return {
          error: 'Related PR stacks use Personal GitHub; the Möbius relay supports standalone drafts only.',
          failure: { owner: 'owner', code: 'github_not_connected' },
        }
      }
    }
    const writeStack = updating
      ? updateContributionStack
      : submitContributionStack
    const outcome = await writeStack({
      appId,
      token,
      recordIds: currentRecords.map((rec) => rec.id),
      publicationStage: 'ready',
    })
    const updates = outcome.ok || outcome.records || []
    if (updates.length > 0) {
      applyRecordUpdates(updates)
    }
    if (outcome.ok) {
      window.mobius?.signal?.(
        updating ? 'contribution_stack_updated' : 'contribution_stack_submitted',
        {
          stack_id: currentRecords[0]?.plan?.stack?.id || '',
          item_count: outcome.submitted?.length || 0,
        },
      )
      refreshReviewStatus()
      return { ok: true, submitted: outcome.submitted?.length || 0 }
    }
    if (outcome.alreadyHandled) {
      try {
        const wanted = new Set(currentRecords.map((rec) => rec.id))
        const fresh = (await loadFreshContributionRecords([...wanted]))
          .filter((rec) => wanted.has(rec.id))
          .map((rec) => ({ ...rec, path: currentRecords.find((item) => item.id === rec.id)?.path }))
        if (fresh.length > 0) applyRecordUpdates(fresh)
      } catch { /* the ordinary refresh below remains authoritative */ }
      refreshReviewStatus()
      return { alreadyHandled: true }
    }
    if (outcome.uncertain) {
      let resolutions = publicationRecords.map(() => ({
        state: 'unconfirmed', record: null,
      }))
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const records = await loadFreshContributionRecords(
            publicationRecords.map((rec) => rec.id),
          )
          const ledger = {
            records,
            fromCache: window.mobius.online === false,
          }
          resolutions = publicationRecords.map(
            (rec) => resolveUncertainSubmission(rec, ledger),
          )
        } catch {
          resolutions = publicationRecords.map(() => ({
            state: 'unconfirmed', record: null,
          }))
        }
        if (resolutions.every(isSubmissionResolutionSettled)) break
      }
      const durable = resolutions.flatMap((item, index) => item.record
        ? [{ ...item.record, path: publicationRecords[index].path }]
        : [])
      if (durable.length > 0) applyRecordUpdates(durable)
      const summary = summarizeSubmissionResolutions(resolutions)
      if (summary.state === 'published') {
        window.mobius?.signal?.('contribution_stack_submitted', {
          stack_id: currentRecords[0]?.plan?.stack?.id || '',
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
          failure: { owner: 'agent', code: 'review_refresh_needed' },
        }
      }
      return {
        error: 'We could not confirm the result. Reopen Contribute to check before trying again; a retry will not create duplicates.',
        failure: { owner: 'automatic' },
      }
    }
    refreshReviewStatus()
    return {
      error: outcome.error || 'Could not submit this PR stack.',
      failure: outcome.failure,
    }
  }, [
    appId,
    token,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

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
    // App frames have an opaque origin, so `*` is required for this one hop to
    // the direct parent. AppCanvas accepts it only from the exact mounted live
    // contentWindow and narrows the message before the shell sees chat metadata.
    window.parent.postMessage(
      { type: 'moebius:open-chat', chatId: rec.chat_id, draft },
      '*')
    window.mobius?.signal?.('contribution_feedback_opened', { id: rec.id })
    return { ok: true }
  }, [])

  // Dismiss = CAS flip to abandoned (storage.js owns the If-Match dance). On
  // success the record moves to the Run's Dismissed fold in place; on a conflict the feed is
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
    } else if (outcome.conflict) {
      applyRecordUpdates({ ...outcome.conflict, path: rec.path })
    } else if (outcome.gone) {
      replaceFeed(recordsRef.current.filter((item) => item.id !== rec.id))
    } else if (outcome.conflict === null) {
      const fresh = await loadFreshContributionRecord(rec.id)
      if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  // Restore = CAS flip an archived record back to `prepared`. Mirrors onDismiss:
  // on success it moves from Dismissed back to the current Run in place; on a
  // conflict/gone the feed reloads so the card reflects reality.
  const onRestore = useCallback(async (rec) => {
    const outcome = await restoreAbandoned({ appId, token, rec })
    if (outcome.ok) {
      const flipped = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(flipped)
      refreshReviewStatus()
      window.mobius?.signal?.('contribution_restored', { id: rec.id })
    } else if (outcome.conflict) {
      applyRecordUpdates({ ...outcome.conflict, path: rec.path })
    } else if (outcome.gone) {
      replaceFeed(recordsRef.current.filter((item) => item.id !== rec.id))
    } else if (outcome.conflict === null) {
      const fresh = await loadFreshContributionRecord(rec.id)
      if (fresh) applyRecordUpdates({ ...fresh, path: rec.path })
    }
    return outcome
  }, [appId, token, applyRecordUpdates, replaceFeed, refreshReviewStatus])

  const sourceProjects = useMemo(
    () => attachSourceProjects(sourceSnapshot, records, incomingReviews, repositoryAccess.repositories),
    [sourceSnapshot, records, incomingReviews, repositoryAccess.repositories],
  )
  const contributionRun = useMemo(() => buildContributionRun({
    records,
    reviewStatus,
    projects: sourceProjects,
    incomingReviews: [],
  }), [records, reviewStatus, sourceProjects, incomingReviews])
  const focusedRecord = records.find(record => record.id === reviewFocus?.recordId)
  const focusedProjectKey = sourceProjects.find(project =>
    recordsForProject(focusedRecord ? [focusedRecord] : [], project).length > 0)?.key || ''
  const routedFocusRef = useRef('')
  useEffect(() => {
    if (!reviewFocus?.recordId || !focusedReviewReady || sourceLoading || routedFocusRef.current === reviewFocus.nonce) return
    routedFocusRef.current = reviewFocus.nonce
    setProjectFocus({ key: focusedProjectKey, nonce: reviewFocus.nonce })
  }, [reviewFocus, focusedReviewReady, sourceLoading, focusedProjectKey])

  function projectRun(project) {
    return project ? buildContributionRun({
      records: recordsForProject(records, project), reviewStatus, projects: [project],
      incomingReviews: [],
    }) : contributionRun
  }
  function projectMergeRun(project) {
    const projects = (project ? [project] : sourceProjects).filter(item => mayMerge(item.viewerPermission))
    const repositories = new Set(projects.map(item => item.canonical_repo?.toLowerCase()))
    return buildContributionRun({
      records: records.filter(record => repositories.has((record.repo || record.plan?.repo || '').toLowerCase())),
      reviewStatus, projects, incomingReviews: [],
    })
  }
  function renderPullRequests(project, navigation) {
    return <PullRequests key={project?.key || 'all'} appId={appId} token={token}
      project={project} conn={conn} onChanged={refreshIncomingReviews}
      records={recordsForProject(records, project)} onRecord={record => {
        const found = findRunItemByRecord(projectRun(project), record.id)
        if (found) navigation.onSelect(found.item.id)
      }} />
  }

  // The toolbar reflects only the app's first connection/feed read. Once that
  // read settles, an unavailable GitHub status is rendered as a retryable
  // content state instead of leaving "Checking…" visible forever.
  const checking = loading && records.length === 0 && !sourceSnapshot

  // One workspace owns project context and the exact contribution beneath it.
  return (
    <div className="co-root" data-design-seed="ae1883df">
      <style>{CSS}</style>
      <div className="co-header-shell">
        <Header appId={appId} fromCache={fromCache} checking={checking}>
          <ConnectionSettings
            conn={conn} token={token} onChanged={refreshConnection}
            autopilotDefault={autopilotDefault} onToggleAutopilotDefault={onToggleAutopilotDefault}
            submissionMethod={submissionMethod} onChooseSubmissionMethod={onChooseSubmissionMethod}
            submissionError={submissionError}
          />
        </Header>
      </div>
      <main ref={pageRef} className="co-page is-sources">
        <SourceMap
          snapshot={sourceSnapshot} projects={sourceProjects} focusKey={projectFocus}
          conn={conn} loading={sourceLoading} error={sourceError}
          onRetry={() => refreshSources()} loadProjectDiff={loadProjectDiff}
          renderControls={(project) => project ? <ProjectControls
            key={project.key} appId={appId} token={token} project={project} run={projectRun(project)} mergeRun={projectMergeRun(project)}
            loading={loading || !ledgerReady || sourceLoading || !!sourceError}
            onStart={startAgentTask}
          /> : null}
          renderActivity={(project, navigation) => (
            <>
            
            {!project && repositoryAccess.error ? <p className="co-run-error" role="alert">{repositoryAccess.error} <button className="co-btn" onClick={() => loadRepositories()}>Retry</button></p> : null}
            {!project && repositoryAccess.hasNextPage ? <button className="co-btn" onClick={() => loadRepositories(repositoryAccess.endCursor)}>Load more repositories</button> : null}
            {project && conn.state !== 'connected' ? <TaskPane id="task:pulls"><h3>Review contributions</h3><p>Connect GitHub in the top right to see this project’s public pull requests, assign work, and run reviews. Your saved contributions remain here.</p></TaskPane> : null}
            {project ? <ContributionRun
              renderPublicWork={project ? () => renderPullRequests(project, navigation) : null}
              run={projectRun(project)} presentation={project ? 'project' : 'overview'}
              projectName={project?.name || 'all projects'}
              selectedId={navigation.selectedId} onSelect={navigation.onSelect} onBack={navigation.onBack}
              loading={loading} omittedCount={fromCache ? 0 : omittedCount}
              publicationPreference={submissionMethod} githubState={conn.state}
              reviewStatus={reviewStatus}
              onSend={onSend} onSendStack={onSendStack} onMarkReady={onMarkReady}
              onFeedback={onFeedback} onDismiss={onDismiss} onRestore={onRestore}
              onSetAutopilot={onSetAutopilot} onWithdraw={onWithdraw}
              onAssignIncomingReview={onAssignIncomingReview} loadDiff={loadFullDiff}
              focusTarget={(project?.key || '') === focusedProjectKey ? reviewFocus : null}
              focusReady={focusedReviewReady && !sourceLoading}
              onFocusConsumed={consumeReviewFocus}
            /> : null}
            </>
          )}
        />
      </main>
    </div>
  )
}
