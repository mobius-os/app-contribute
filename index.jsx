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
import {
  contributionActionScope,
  contributionApprovalIsCurrent,
  contributionCyclePhase,
  contributionReviewTargetFromIntent,
  focusedContributionNavigationReady,
  focusedContributionReady,
  indexReviewStatus,
  isContributionCycleChat,
  qualityReviewFor,
} from './review.js'
import { buildContributionRun } from './run.js'
import { abandonPrepared, cacheFeed, cacheSourceSnapshot, loadAppSettings, loadCachedFeed, loadCachedSourceSnapshot, loadContributionRecord, loadFreshContributionRecord, loadFreshContributionRecords, loadCycleState, loadFullDiff, loadLedger, restoreAbandoned, saveAppSettings, saveCycleState } from './storage.js'
import { createRefreshCoordinator, isVisibleFrameMessage } from './refresh.js'
import {
  contributionPathDecision,
  contributionStackDecision,
} from './contribution-policy.js'
import {
  connectPublishedApp,
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
import { ConnectionCard } from './ui/ConnectionCard.jsx'
import { openAgentConversation } from './ui/BatchAction.jsx'
import { ContributionRun } from './ui/Feed.jsx'
import { Icon } from './ui/Icons.jsx'
import { SourceMap } from './ui/SourceMap.jsx'

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

function RunLoadingState() {
  return (
    <div className="co-feed-loading" role="status" aria-live="polite">
      <span className="ma-spinner is-compact" aria-hidden="true" />
      <span>Building the current contribution run…</span>
    </div>
  )
}

function stalePublicApproval() {
  return {
    error: 'This exact public action changed after you opened it. Nothing was sent; review the refreshed details and approve again.',
    failure: { owner: 'owner', code: 'approval_changed' },
  }
}

function ProjectControl({ showingProjects, count, onOpen, onBack }) {
  return (
    <button
      type="button"
      className={'co-project-control' + (showingProjects ? ' is-back' : '')}
      onClick={showingProjects ? onBack : onOpen}
      aria-label={showingProjects ? 'Back to current run' : `Browse ${count} projects`}
    >
      <Icon name={showingProjects ? 'left' : 'merge'} size={15} />
      <span>{showingProjects ? 'Current run' : 'Projects'}</span>
      {!showingProjects && count > 0 ? <b>{count}</b> : null}
    </button>
  )
}

export default function ContributeApp({ appId, token }) {
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'checking' })
  const [loading, setLoading] = useState(true)
  const [ledgerReady, setLedgerReady] = useState(false)
  const [omittedCount, setOmittedCount] = useState(0)
  const [showProjects, setShowProjects] = useState(false)
  const [sourceSnapshot, setSourceSnapshot] = useState(null)
  const [projectFocus, setProjectFocus] = useState('')
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
  // Whether a new Send grants autopilot. Default on; consulted only at Send
  // time (job.sh keys off each record's stamped grant, never this preference).
  const [autopilotDefault, setAutopilotDefault] = useState(true)
  const [submissionMethod, setSubmissionMethod] = useState('github')
  const [cycle, setCycle] = useState({
    phase: 'idle', chatId: '', startedAt: '', runtime: null, error: '',
  })
  const pageRef = useRef(null)
  const projectsNavRef = useRef(null)
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

  const viewRun = useCallback(() => {
    const handle = projectsNavRef.current
    projectsNavRef.current = null
    try { handle?.close?.() } catch {}
    setProjectFocus('')
    setShowProjects(false)
  }, [])

  const viewProjects = useCallback(async (projectKey = '') => {
    setProjectFocus(projectKey)
    if (projectsNavRef.current) {
      setShowProjects(true)
      return
    }
    if (!window.mobius?.nav?.open) {
      setShowProjects(true)
      return
    }
    let handle = null
    handle = window.mobius.nav.open('contribute-projects', {
      onBack: () => {
        if (projectsNavRef.current !== handle) return
        projectsNavRef.current = null
        setProjectFocus('')
        setShowProjects(false)
      },
      onForward: () => {
        projectsNavRef.current = handle
        setProjectFocus(projectKey)
        setShowProjects(true)
      },
    })
    projectsNavRef.current = handle
    const outcome = await handle.outcome
    if (projectsNavRef.current !== handle) {
      handle.close()
      return
    }
    if (!['owned', 'standalone'].includes(outcome?.status)) {
      projectsNavRef.current = null
      return
    }
    setShowProjects(true)
  }, [])

  useEffect(() => () => {
    try { projectsNavRef.current?.close?.() } catch {}
    projectsNavRef.current = null
  }, [])

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

  const refreshCycle = useCallback(async (chatId, startedAt = '') => {
    if (!chatId || typeof window.mobius?.chat?.status !== 'function') return null
    try {
      const runtime = await window.mobius.chat.status(chatId)
      const phase = contributionCyclePhase(runtime)
      setCycle((current) => current.chatId && current.chatId !== chatId
        ? current
        : {
            phase,
            chatId,
            startedAt: startedAt || current.startedAt,
            scope: current.scope,
            runtime,
            error: '',
          })
      return runtime
    } catch {
      setCycle((current) => current.chatId && current.chatId !== chatId
        ? current
        : {
            ...current,
            phase: current.phase === 'checking' ? 'paused' : current.phase,
            chatId,
            startedAt: startedAt || current.startedAt,
            error: 'Progress is temporarily unavailable.',
          })
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function restoreCycle() {
      let saved = await loadCycleState()
      if (!saved && typeof window.mobius?.chat?.list === 'function') {
        try {
          const chats = (await window.mobius.chat.list()).filter(isContributionCycleChat)
          chats.sort((a, b) => String(b.activity_at || b.updated_at || '').localeCompare(
            String(a.activity_at || a.updated_at || ''),
          ))
          for (const chat of chats.slice(0, 3)) {
            const runtime = await window.mobius.chat.status(chat.id)
            const phase = contributionCyclePhase(runtime)
            if (['running', 'waiting', 'paused'].includes(phase)) {
              saved = {
                chat_id: String(chat.id),
                started_at: chat.created_at || chat.updated_at || '',
                scope: typeof chat.scope === 'string' ? chat.scope : '',
              }
              await saveCycleState(saved)
              if (!cancelled) {
                setCycle({
                  phase,
                  chatId: saved.chat_id,
                  startedAt: saved.started_at,
                  scope: saved.scope,
                  runtime,
                  error: '',
                })
              }
              return
            }
          }
        } catch { /* an ordinary idle card is the safe fallback */ }
      }
      if (!saved || cancelled) return
      setCycle({
        phase: 'checking',
        chatId: saved.chat_id,
        startedAt: saved.started_at,
        scope: saved.scope,
        runtime: null,
        error: '',
      })
      await refreshCycle(saved.chat_id, saved.started_at)
    }
    restoreCycle()
    return () => { cancelled = true }
  }, [refreshCycle])

  useEffect(() => {
    if (cycle.phase !== 'running' || !cycle.chatId) return undefined
    let cancelled = false
    let timer = null
    async function poll() {
      const runtime = await refreshCycle(cycle.chatId, cycle.startedAt)
      if (!cancelled && runtime?.running) {
        timer = window.setTimeout(poll, 3500)
      }
    }
    timer = window.setTimeout(poll, 1800)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [cycle.phase, cycle.chatId, cycle.startedAt, refreshCycle])

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
          : (status.state === 'connected' ? 'github' : 'mobius'),
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
      viewRun()
      window.mobius?.signal?.('contribution_review_opened', { id: target.recordId })
    }
    window.addEventListener('message', onReviewIntent)
    return () => window.removeEventListener('message', onReviewIntent)
  }, [viewRun])

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

  const openProjectReview = useCallback((record, projectKey = '') => {
    if (!record?.id) return
    setProjectFocus(projectKey)
    setShowProjects(false)
    setReviewFocus({
      recordId: record.id,
      returnProjectKey: projectKey,
      nonce: `project:${record.id}:${Date.now()}`,
      refreshMountedLedger: ledgerReadyRef.current,
    })
  }, [])

  const loadProjectDiff = useCallback(
    (project) => fetchSourceDiff(token, project),
    [token],
  )

  // Contributions is one long reading feed; Repository map owns two internal
  // panes on desktop. Reset the shared page scroller at the boundary so a deep
  // feed position never shifts the map header or couples the two scroll modes.
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0, left: 0 })
  }, [showProjects])

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

  // A merged app contribution can finish by attaching its reviewed public
  // identity to the same local app row. The backend rechecks GitHub and the
  // immutable merged package; this handler only reflects the durable result.
  const onConnectApp = useCallback(async (rec) => {
    const outcome = await connectPublishedApp({
      appId,
      token,
      recordId: rec.id,
    })
    if (!outcome.ok) {
      return {
        error: outcome.error || 'Could not connect this published app.',
      }
    }
    const next = { ...outcome.ok, path: rec.path }
    applyRecordUpdates(next)
    refreshSources()
    window.mobius?.signal?.('published_app_connected', {
      contribution_id: rec.id,
      app_id: outcome.connection?.app_id,
      status: outcome.connection?.status,
    })
    return {
      ok: true,
      connection: outcome.connection,
    }
  }, [appId, token, applyRecordUpdates, refreshSources])

  const onToggleAutopilotDefault = useCallback(async (next) => {
    setAutopilotDefault(next)
    const settings = await loadAppSettings()
    saveAppSettings({ ...settings, autopilot_default: next })
  }, [])

  const onChooseSubmissionMethod = useCallback(async (next) => {
    if (next !== 'mobius' && next !== 'github') return
    setSubmissionMethod(next)
    const settings = await loadAppSettings()
    await saveAppSettings({ ...settings, submission_method: next })
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

  // One explicit confirmation can publish an exact, already-reviewed chain.
  // The response may contain partial progress (for example, parent opened and
  // child creation bounced), so merge every returned ledger record rather
  // than treating the stack as all-or-nothing after public work has begun.
  const onSendStack = useCallback(async (stackRecords) => {
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
    if (stackRecords.some((approved, index) => (
      !contributionApprovalIsCurrent(approved, currentRecords[index])
    ))) {
      return stalePublicApproval()
    }

    const updating = currentRecords.every(
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
      let resolutions = currentRecords.map(() => ({ state: 'unconfirmed', record: null }))
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const records = await loadFreshContributionRecords(
            currentRecords.map((rec) => rec.id),
          )
          const ledger = {
            records,
            fromCache: window.mobius.online === false,
          }
          resolutions = currentRecords.map((rec) => resolveUncertainSubmission(rec, ledger))
        } catch {
          resolutions = currentRecords.map(() => ({ state: 'unconfirmed', record: null }))
        }
        if (resolutions.every(isSubmissionResolutionSettled)) break
      }
      const durable = resolutions.flatMap((item, index) => item.record
        ? [{ ...item.record, path: currentRecords[index].path }]
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
    () => attachSourceProjects(sourceSnapshot, records),
    [sourceSnapshot, records],
  )
  const contributionRun = useMemo(() => buildContributionRun({
    records,
    reviewStatus,
    projects: sourceProjects,
    incomingReviews,
  }), [records, reviewStatus, sourceProjects, incomingReviews])
  const cycleAction = contributionRun.privateAction
  const onStartCycle = useCallback(async (requestedAction = cycleAction) => {
    if (!requestedAction) return
    const scope = contributionActionScope(requestedAction)
    setCycle({
      phase: 'starting', chatId: '', startedAt: '', scope, runtime: null, error: '',
    })
    const outcome = await startAgentTask({
      ...requestedAction,
      scopeLabel: 'Private contribution work',
    })
    if (!outcome.ok) {
      setCycle({
        phase: 'idle', chatId: '', startedAt: '', runtime: null,
        error: outcome.error || 'Could not start the cycle.',
      })
      return
    }
    const startedAt = new Date().toISOString()
    const saved = { chat_id: outcome.chatId, started_at: startedAt, scope }
    await saveCycleState(saved)
    setCycle({
      phase: 'running', chatId: outcome.chatId, startedAt,
      scope,
      runtime: { running: true }, error: '',
    })
    await refreshCycle(outcome.chatId, startedAt)
  }, [cycleAction, startAgentTask, refreshCycle])

  const onStopCycle = useCallback(async () => {
    if (!cycle.chatId || typeof window.mobius?.chat?.stop !== 'function') {
      setCycle((current) => ({
        ...current,
        error: 'Stop is unavailable in this Möbius version.',
      }))
      return
    }
    const chatId = cycle.chatId
    setCycle((current) => ({ ...current, phase: 'stopping', error: '' }))
    try {
      const stopped = await window.mobius.chat.stop(chatId)
      const runtime = await window.mobius.chat.status(chatId).catch(() => null)
      if (stopped?.stopped === false || runtime?.running) {
        setCycle((current) => ({
          ...current,
          phase: 'running',
          runtime: runtime || current.runtime,
          error: 'The agent is still stopping. Try again in a moment.',
        }))
        return
      }
      setCycle((current) => ({
        ...current,
        phase: 'stopped',
        runtime: runtime || { running: false },
        error: '',
      }))
    } catch {
      setCycle((current) => ({
        ...current,
        phase: 'running',
        error: 'Could not stop the agent. Try again.',
      }))
    }
  }, [cycle.chatId])

  const onOpenCycle = useCallback(() => {
    openAgentConversation(cycle.chatId)
  }, [cycle.chatId])

  // The toolbar reflects only the app's first connection/feed read. Once that
  // read settles, an unavailable GitHub status is rendered as a retryable
  // content state instead of leaving "Checking…" visible forever.
  const checking = loading && records.length === 0 && !sourceSnapshot

  // The current run is the workshop. Projects is a prominent lens in the same
  // header rather than a second top-level room, and owns a real shell Back entry.
  return (
    <div className="co-root" data-design-seed="ae1883df">
      <style>{CSS}</style>
      <div className="co-header-shell">
        <Header
          appId={appId}
          fromCache={fromCache}
          checking={checking}
        >
          <ProjectControl
            showingProjects={showProjects}
            count={sourceProjects.length}
            onOpen={() => viewProjects()}
            onBack={viewRun}
          />
          <ConnectionCard
            conn={conn}
            token={token}
            onChanged={refreshConnection}
            placement="toolbar"
            autopilotDefault={autopilotDefault}
            onToggleAutopilotDefault={onToggleAutopilotDefault}
            submissionMethod={submissionMethod}
            onChooseSubmissionMethod={onChooseSubmissionMethod}
          />
        </Header>
      </div>
      <main ref={pageRef} className={'co-page' + (showProjects ? ' is-sources' : '')}>
        {showProjects ? (
          <SourceMap
            snapshot={sourceSnapshot}
            projects={sourceProjects}
            focusKey={projectFocus}
            conn={conn}
            loading={sourceLoading}
            error={sourceError}
            onRetry={() => refreshSources()}
            loadProjectDiff={loadProjectDiff}
            onViewReview={openProjectReview}
          />
        ) : (
          <div className="co-contributions-view">
            <ConnectionCard
              conn={conn}
              token={token}
              onChanged={refreshConnection}
              onRetry={refreshConnection}
              placement="content"
              submissionMethod={submissionMethod}
              onChooseSubmissionMethod={onChooseSubmissionMethod}
            />
            {loading || !focusedReviewReady ? <RunLoadingState /> : (
              <ContributionRun
                run={contributionRun}
                loading={sourceLoading && !sourceSnapshot}
                omittedCount={fromCache ? 0 : omittedCount}
                publicationPreference={submissionMethod}
                githubState={conn.state}
                reviewStatus={reviewStatus}
                cycle={cycle}
                onStartCycle={onStartCycle}
                onStopCycle={onStopCycle}
                onOpenCycle={onOpenCycle}
                onSend={onSend}
                onSendStack={onSendStack}
                onMarkReady={onMarkReady}
                onFeedback={onFeedback}
                onDismiss={onDismiss}
                onRestore={onRestore}
                onSetAutopilot={onSetAutopilot}
                onWithdraw={onWithdraw}
                onConnectApp={onConnectApp}
                onAssignIncomingReview={onAssignIncomingReview}
                onViewProject={viewProjects}
                loadDiff={loadFullDiff}
                focusTarget={reviewFocus}
                focusReady={focusedReviewReady}
                onFocusConsumed={consumeReviewFocus}
              />
            )}
          </div>
        )}
      </main>
    </div>
  )
}
