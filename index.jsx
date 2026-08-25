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
  resolveUncertainLanding,
  resolveUncertainSubmission,
  summarizeSubmissionResolutions,
  syncSetupCompletion,
  upsertRecord,
} from './domain.js'
import { contributionReviewTargetFromIntent, contributionsNeedingAttention, contributionCyclePhase, finishContributionCycleAction, isContributionCycleChat, prePrCheckPhase, indexReviewStatus, partitionReviewUnits, qualityReviewFor, summarizeQualityReviews } from './review.js'
import { preparedContributionUnits, stackMeta } from './stack.js'
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
  landContributionStack,
  refreshPrePrChecks,
  runPrePrChecks,
  setAutopilot,
  submitContribution,
  submitContributionViaMobius,
  submitContributionStack,
  updateContribution,
  withdrawMobiusContribution,
} from './api.js'
import { ConnectionCard } from './ui/ConnectionCard.jsx'
import { openAgentConversation } from './ui/BatchAction.jsx'
import { Feed } from './ui/Feed.jsx'
import { SourceMap } from './ui/SourceMap.jsx'
import { ContributionOverview } from './ui/SourceOverview.jsx'

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

const CONTRIBUTION_VIEWS = ['overview', 'sources', 'prs', 'issues']
const ISSUE_TYPES = new Set(['issue', 'issue_comment', 'discussion_comment'])

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

// Sells the loop when the ledger is empty. Deliberately connection-agnostic:
// the ConnectionCard directly above already says whether GitHub is wired up, so
// this stays focused on the review task rather than implying that contributions
// can be created from this app.
function EmptyState({ view }) {
  const issues = view === 'issues'
  return (
    <div className="co-empty">
      <div className="co-empty-mark">{MERGE_MARK}</div>
      <h2 className="co-empty-title">
        {issues ? 'No issues or comments yet' : 'No pull requests to review'}
      </h2>
      <p className="co-empty-text">
        {issues
          ? 'Issue drafts and follow-up comments prepared for review will appear here.'
          : 'Pull requests prepared for upstream review will appear here. You can inspect each change before anything is shared publicly.'}
      </p>
    </div>
  )
}

function FeedLoadingState({ view }) {
  return (
    <div className="co-feed-loading" role="status" aria-live="polite">
      <span className="ma-spinner is-compact" aria-hidden="true" />
      <span>Loading {view === 'issues' ? 'requests' : 'reviews'}…</span>
    </div>
  )
}

export default function ContributeApp({ appId, token }) {
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'checking' })
  const [loading, setLoading] = useState(true)
  const [ledgerReady, setLedgerReady] = useState(false)
  const [omittedCount, setOmittedCount] = useState(0)
  const [view, setViewState] = useState(() => {
    try {
      const saved = sessionStorage.getItem('contribute-view-v3')
      return CONTRIBUTION_VIEWS.includes(saved) ? saved : 'overview'
    }
    catch { return 'overview' }
  })
  const [sourceSnapshot, setSourceSnapshot] = useState(null)
  const [projectFocus, setProjectFocus] = useState('')
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceError, setSourceError] = useState('')
  const [reviewStatus, setReviewStatus] = useState({
    state: 'loading', byId: {}, checkedAt: '',
  })
  const [reviewFocus, setReviewFocus] = useState(null)
  const [focusedRecordLookup, setFocusedRecordLookup] = useState({
    recordId: '', ready: false,
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
  const tabRefs = useRef({})
  // Latest records for callbacks (the connect-flow refresh) that must not take
  // a `records` dependency and re-bind on every ledger change.
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])
  const connRef = useRef(conn)
  const connectionRequestRef = useRef(0)
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

  // Every app-owned agent handoff uses the durable first-turn primitive. It
  // creates one visible chat and waits until the first request is accepted,
  // while Contribute stays in front. The button exposes an optional link to
  // that conversation after the start succeeds. A single in-flight guard prevents two rapid taps
  // from creating duplicate contribution cycles.
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
        scope: action.scope,
        scopeLabel: action.scopeLabel,
      })
      if (!started?.chatId) throw new Error('Missing chat id')
      window.mobius?.signal?.(action.event || 'contribute_agent_handoff', {
        item_count: Number(action.count || 0),
      })
      return { ok: true, chatId: started.chatId }
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
          let chats = await window.mobius.chat.list({ scope: 'contribute-cycle' })
          if (!chats.length) {
            chats = (await window.mobius.chat.list()).filter(isContributionCycleChat)
          }
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
              }
              await saveCycleState(saved)
              if (!cancelled) {
                setCycle({
                  phase,
                  chatId: saved.chat_id,
                  startedAt: saved.started_at,
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
    return applyLiveStates(recs, refresh.aliases, data, refresh.repoAliases)
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

  const refreshPrePrChecksState = useCallback(async () => {
    if (connRef.current.state !== 'connected') return { ok: false }
    const outcome = await refreshPrePrChecks(token, appId)
    if (outcome.ok && outcome.records.length > 0) {
      applyRecordUpdates(outcome.records)
    }
    return outcome
  }, [token, appId, applyRecordUpdates])

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
      refreshPrePrChecksState()
    }
    return status
  }, [token, fromCache, runLiveRefresh, refreshPrePrChecksState])

  const refreshIncomingReviews = useCallback(async () => {
    if (connRef.current.state !== 'connected') {
      setIncomingReviews([])
      return []
    }
    const rows = await fetchIncomingReviews(token)
    setIncomingReviews(rows)
    return rows
  }, [token])

  useEffect(() => {
    if (conn.state === 'connected') refreshIncomingReviews()
    else setIncomingReviews([])
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
      ledgerReadyRef.current = true
      setLedgerReady(true)
      signalReady({ item_count: recordsRef.current.length })
      window.mobius?.signal?.('error', {
        message: String(err?.message || err),
        source: 'load',
      })
    })
    return () => { cancelled = true }
  }, [token, fetchRefreshed, signalReady])

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
    if (connRef.current.state === 'connected') {
      await refreshPrePrChecksState()
    }
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
  }, [fetchRefreshed, refreshPrePrChecksState, refreshReviewStatus, replaceFeed])
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

  const hasActivePrePrChecks = records.some(
    (rec) => prePrCheckPhase(rec) === 'running',
  )
  useEffect(() => {
    if (!hasActivePrePrChecks || conn.state !== 'connected') return undefined
    let cancelled = false
    let timer = null
    const poll = async () => {
      await refreshPrePrChecksState()
      if (!cancelled) timer = window.setTimeout(poll, 15000)
    }
    timer = window.setTimeout(poll, 2500)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [hasActivePrePrChecks, conn.state, refreshPrePrChecksState])

  const setView = useCallback((next) => {
    if (!CONTRIBUTION_VIEWS.includes(next)) next = 'overview'
    setViewState(next)
    try { sessionStorage.setItem('contribute-view-v3', next) } catch { /* optional */ }
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
      })
      setView('prs')
      window.mobius?.signal?.('contribution_review_opened', { id: target.recordId })
    }
    window.addEventListener('message', onReviewIntent)
    return () => window.removeEventListener('message', onReviewIntent)
  }, [setView])

  // The full contribution history is intentionally loaded in the background,
  // but it can span hundreds of records. A standalone review should not wait
  // for that enumeration: fetch its exact row directly and add it to the live
  // feed. A dependency stack still waits for the ledger because showing only
  // one layer would make the review incomplete and potentially misleading.
  useEffect(() => {
    const recordId = reviewFocus?.recordId
    if (!recordId || ledgerReady) return undefined
    let cancelled = false
    setFocusedRecordLookup({ recordId, ready: false })
    loadContributionRecord(recordId).then((record) => {
      if (cancelled) return
      if (record) {
        const next = upsertRecord(recordsRef.current, record)
        recordsRef.current = next
        setRecords(next)
        setLoading(false)
      }
      setFocusedRecordLookup({
        recordId,
        ready: !record || !stackMeta(record),
      })
    }).catch(() => {
      // A failed direct read is not proof that the review disappeared. Keep
      // waiting for the already-running authoritative ledger scan instead.
      if (!cancelled) setFocusedRecordLookup({ recordId, ready: false })
    })
    return () => { cancelled = true }
  }, [reviewFocus?.recordId, ledgerReady])

  const consumeReviewFocus = useCallback((nonce) => {
    setReviewFocus((current) => current?.nonce === nonce ? null : current)
  }, [])

  const focusedReviewReady = !reviewFocus || ledgerReady || (
    focusedRecordLookup.recordId === reviewFocus.recordId
      && focusedRecordLookup.ready
  )

  const viewProjects = useCallback((projectKey = '') => {
    setProjectFocus(projectKey)
    setView('sources')
  }, [setView])

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

  const loadProjectDiff = useCallback(
    (project) => fetchSourceDiff(token, project),
    [token],
  )

  // Contributions is one long reading feed; Repository map owns two internal
  // panes on desktop. Reset the shared page scroller at the boundary so a deep
  // feed position never shifts the map header or couples the two scroll modes.
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0, left: 0 })
  }, [view])

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
      }
    }
    const refreshed = { ...canonical, path: canonical.path || rec.path }
    applyRecordUpdates(refreshed)
    if (
      refreshed.status === 'prepared' &&
      qualityReviewFor(refreshed).state !== 'all_clear'
    ) {
      return {
        reviewNeeded: true,
        record: refreshed,
        error: 'Review this exact version first. The Review action is ready on this card.',
      }
    }
    const updating = refreshed.plan?.action === 'pr_update'
    let viaMobius = false
    let outcome
    if (updating) {
      if (connRef.current.state !== 'connected') {
        return { error: 'Connect GitHub before updating this pull request.' }
      }
      outcome = await updateContribution({ appId, token, rec: refreshed })
    } else {
      const decision = contributionPathDecision(
        refreshed,
        submissionMethod,
        connRef.current.state,
      )
      if (decision.error) return { error: decision.error }
      viaMobius = decision.method === 'mobius'
      outcome = viaMobius
        ? await submitContributionViaMobius({ appId, token, rec: refreshed })
        : await submitContribution({
            appId,
            token,
            rec: refreshed,
            autopilot: autopilotDefault && connRef.current.autopilotAvailable === true,
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
  }, [
    appId,
    token,
    autopilotDefault,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

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

  const onRunPrePrChecks = useCallback(async (rec) => {
    const outcome = await runPrePrChecks({ appId, token, rec })
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      applyRecordUpdates(next)
      window.mobius?.signal?.('pre_pr_checks_started', {
        id: rec.id,
        url: next.pre_pr_checks?.url || '',
      })
      return { ok: true, record: next }
    }
    if (outcome.record) {
      applyRecordUpdates({ ...outcome.record, path: rec.path })
    }
    if (outcome.uncertain) {
      try {
        const fresh = await loadFreshContributionRecord(rec.id)
        if (fresh) {
          applyRecordUpdates({ ...fresh, path: rec.path })
          const phase = prePrCheckPhase(fresh)
          if (phase === 'running') {
            return { pending: true, record: fresh }
          }
          if (phase === 'passed') return { ok: true, record: fresh }
          if (phase === 'failed') {
            return { error: fresh.pre_pr_checks?.message || outcome.error }
          }
        }
      } catch { /* the visibility refresh remains authoritative */ }
      return { pending: true }
    }
    return {
      error: outcome.error || 'Could not start GitHub checks.',
      unsupported: outcome.unsupported,
    }
  }, [appId, token, applyRecordUpdates])

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
    setIncomingReviews((current) => current.filter((row) => row.url !== item.url))
    return { ok: true }
  }, [appId, token, startAgentTask])

  // One explicit confirmation can publish an exact, already-reviewed chain.
  // The response may contain partial progress (for example, parent opened and
  // child creation bounced), so merge every returned ledger record rather
  // than treating the stack as all-or-nothing after public work has begun.
  const onSendStack = useCallback(async (stackRecords) => {
    const decision = contributionStackDecision(
      stackRecords,
      submissionMethod,
      connRef.current.state,
    )
    if (decision.error) return { error: decision.error }
    if (decision.method === 'mobius') {
      return {
        error: 'Related PR stacks still use your personal GitHub connection. Connect GitHub and choose Personal GitHub, or prepare these as independent changes.',
      }
    }
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
    if (outcome.alreadyHandled) {
      try {
        const wanted = new Set(stackRecords.map((rec) => rec.id))
        const fresh = (await loadFreshContributionRecords([...wanted]))
          .filter((rec) => wanted.has(rec.id))
          .map((rec) => ({ ...rec, path: stackRecords.find((item) => item.id === rec.id)?.path }))
        if (fresh.length > 0) applyRecordUpdates(fresh)
      } catch { /* the ordinary refresh below remains authoritative */ }
      refreshReviewStatus()
      return { alreadyHandled: true }
    }
    if (outcome.uncertain) {
      let resolutions = stackRecords.map(() => ({ state: 'unconfirmed', record: null }))
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const records = await loadFreshContributionRecords(
            stackRecords.map((rec) => rec.id),
          )
          const ledger = {
            records,
            fromCache: window.mobius.online === false,
          }
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
  }, [
    appId,
    token,
    submissionMethod,
    applyRecordUpdates,
    refreshReviewStatus,
  ])

  // Landing is a second public action with its own explicit confirmation. The
  // platform advances only an unchanged, unprotected app branch after proving
  // the exact reviewed chain and every PR's CI result. As with Send, a lost
  // browser response is reconciled from the durable ledger before any retry.
  const onLandStack = useCallback(async (stackRecords) => {
    const outcome = await landContributionStack({
      appId,
      token,
      recordIds: stackRecords.map((rec) => rec.id),
    })
    const updates = outcome.ok || outcome.records || []
    if (updates.length > 0) applyRecordUpdates(updates)
    if (outcome.ok) {
      window.mobius?.signal?.('contribution_stack_landed', {
        stack_id: stackRecords[0]?.plan?.stack?.id || '',
        item_count: outcome.ok.length,
        target_branch: outcome.targetBranch || '',
      })
      refreshReviewStatus()
      return { ok: true, landed: outcome.ok.length }
    }
    if (outcome.uncertain) {
      let resolution = { state: 'unconfirmed', records: [] }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
        try {
          const records = await loadFreshContributionRecords(
            stackRecords.map((rec) => rec.id),
          )
          resolution = resolveUncertainLanding(stackRecords, {
            records,
            fromCache: window.mobius.online === false,
          })
        } catch {
          resolution = { state: 'unconfirmed', records: [] }
        }
        if (resolution.state !== 'unconfirmed') break
      }
      if (resolution.records.length > 0) {
        applyRecordUpdates(resolution.records.map((rec, index) => ({
          ...rec,
          path: stackRecords.find((item) => item.id === rec.id)?.path ||
            stackRecords[index]?.path,
        })))
      }
      if (resolution.state === 'landed') {
        refreshReviewStatus()
        return { ok: true, landed: resolution.records.length }
      }
      if (resolution.state === 'landing') {
        // The durable `landing` journal is explicit prior approval. Repeating
        // the same endpoint cannot push again: the platform takes the source
        // lock, reads the exact upstream ref, and only settles the saved result.
        const recovered = await landContributionStack({
          appId,
          token,
          recordIds: stackRecords.map((rec) => rec.id),
        })
        const recoveredUpdates = recovered.ok || recovered.records || []
        if (recoveredUpdates.length > 0) applyRecordUpdates(recoveredUpdates)
        refreshReviewStatus()
        if (recovered.ok) return { ok: true, landed: recovered.ok.length }
        return {
          pending: recovered.uncertain,
          error: recovered.error || 'Landing is still being reconciled from its saved journal.',
        }
      }
      if (resolution.state === 'blocked') {
        refreshReviewStatus()
        return { error: resolution.records.find((rec) => rec.last_land_error)?.last_land_error || 'Nothing was changed.' }
      }
      refreshReviewStatus()
      return {
        error: 'We could not confirm the landing. Reopen Contribute before trying again.',
      }
    }
    refreshReviewStatus()
    return { error: outcome.error || 'Could not land this PR stack.' }
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
  // on success it moves from History back to Ready for review in place; on a
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

  const prRecords = useMemo(
    () => records.filter((rec) => rec.type === 'pr'),
    [records],
  )
  const issueRecords = useMemo(
    () => records.filter((rec) => ISSUE_TYPES.has(rec.type)),
    [records],
  )
  const visibleRecords = view === 'issues' ? issueRecords : prRecords
  const prGroups = useMemo(() => groupRecords(prRecords), [prRecords])
  const issueGroups = useMemo(() => groupRecords(issueRecords), [issueRecords])
  const groups = view === 'issues' ? issueGroups : prGroups
  const readyPrUnits = useMemo(() => {
    const units = preparedContributionUnits(prGroups.ready, prRecords)
    return partitionReviewUnits(units, reviewStatus).readyToSend
  }, [prGroups.ready, prRecords, reviewStatus])
  const readyPrCount = readyPrUnits.reduce(
    (total, unit) => total + unit.records.filter(
      (rec) => rec.status === 'prepared',
    ).length,
    0,
  )
  const sourceProjects = useMemo(
    () => attachSourceProjects(sourceSnapshot, records),
    [sourceSnapshot, records],
  )
  const actionableProjects = useMemo(
    () => actionableSourceProjects(sourceProjects),
    [sourceProjects],
  )
  const cycleAction = useMemo(
    () => finishContributionCycleAction(
      prRecords,
      reviewStatus,
      actionableProjects.length,
    ),
    [prRecords, reviewStatus, actionableProjects.length],
  )
  const onStartCycle = useCallback(async () => {
    if (!cycleAction) return
    setCycle({
      phase: 'starting', chatId: '', startedAt: '', runtime: null, error: '',
    })
    const outcome = await startAgentTask({
      ...cycleAction,
      scope: 'contribute-cycle',
      scopeLabel: 'Contribution cycle',
    })
    if (!outcome.ok) {
      setCycle({
        phase: 'idle', chatId: '', startedAt: '', runtime: null,
        error: outcome.error || 'Could not start the cycle.',
      })
      return
    }
    const startedAt = new Date().toISOString()
    const saved = { chat_id: outcome.chatId, started_at: startedAt }
    await saveCycleState(saved)
    setCycle({
      phase: 'running', chatId: outcome.chatId, startedAt,
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
  const qualitySummary = useMemo(
    () => summarizeQualityReviews(prRecords, reviewStatus),
    [prRecords, reviewStatus],
  )
  const attentionPrCount = useMemo(
    () => contributionsNeedingAttention(prRecords, reviewStatus).length,
    [prRecords, reviewStatus],
  )
  const runningCheckCount = useMemo(
    () => prRecords.filter((rec) => prePrCheckPhase(rec) === 'running').length,
    [prRecords],
  )
  const activePublicPrCount = prGroups.open.length
  const isEmpty = visibleRecords.length === 0

  // The toolbar reflects only the app's first connection/feed read. Once that
  // read settles, an unavailable GitHub status is rendered as a retryable
  // content state instead of leaving "Checking…" visible forever.
  const checking = loading && records.length === 0 && !sourceSnapshot

  // Design world: four distinct rooms, one quiet collaboration language.
  return (
    <div className="co-root" data-design-seed="1c15eb06">
      <style>{CSS}</style>
      <div className="co-header-shell">
        <Header
          appId={appId}
          fromCache={fromCache}
          checking={checking}
        >
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
      <main ref={pageRef} className={'co-page' + (view === 'sources' ? ' is-sources' : '')}>
        <nav className="co-tabs" role="tablist" aria-label="Contribute views">
          <button
            type="button"
            role="tab"
            id="co-tab-overview"
            aria-controls="co-panel-overview"
            aria-selected={view === 'overview'}
            tabIndex={view === 'overview' ? 0 : -1}
            data-view="overview"
            ref={(node) => { tabRefs.current.overview = node }}
            className={view === 'overview' ? 'is-active' : ''}
            onClick={() => setView('overview')}
            onKeyDown={onTabKeyDown}
          >
            Overview
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
          <button
            type="button"
            role="tab"
            id="co-tab-prs"
            aria-controls="co-panel-prs"
            aria-selected={view === 'prs'}
            tabIndex={view === 'prs' ? 0 : -1}
            data-view="prs"
            ref={(node) => { tabRefs.current.prs = node }}
            className={view === 'prs' ? 'is-active' : ''}
            onClick={() => setView('prs')}
            onKeyDown={onTabKeyDown}
          >
            Reviews
          </button>
          <button
            type="button"
            role="tab"
            id="co-tab-issues"
            aria-controls="co-panel-issues"
            aria-selected={view === 'issues'}
            tabIndex={view === 'issues' ? 0 : -1}
            data-view="issues"
            ref={(node) => { tabRefs.current.issues = node }}
            className={view === 'issues' ? 'is-active' : ''}
            onClick={() => setView('issues')}
            onKeyDown={onTabKeyDown}
          >
            Requests
          </button>
        </nav>

        {view === 'overview' ? (
          <ContributionOverview
            projects={sourceProjects}
            loading={sourceLoading && !sourceSnapshot}
            reviewSummary={qualitySummary}
            incomingReviews={incomingReviews}
            onAssignIncomingReview={onAssignIncomingReview}
            onViewProjects={() => viewProjects()}
            onViewProject={viewProjects}
            onViewReviews={() => setView('prs')}
            cycleAction={cycleAction}
            cycle={cycle}
            omittedCount={fromCache ? 0 : omittedCount}
            onStartCycle={onStartCycle}
            onStopCycle={onStopCycle}
            onOpenCycle={onOpenCycle}
          />
        ) : view === 'sources' ? (
          <SourceMap
            snapshot={sourceSnapshot}
            projects={sourceProjects}
            focusKey={projectFocus}
            conn={conn}
            loading={sourceLoading}
            error={sourceError}
            onRetry={() => refreshSources()}
            loadProjectDiff={loadProjectDiff}
            onStartAgent={startAgentTask}
            onViewReviews={() => setView('prs')}
          />
        ) : (
          <div
            id={view === 'issues' ? 'co-panel-issues' : 'co-panel-prs'}
            className="co-contributions-view"
            role="tabpanel"
            aria-labelledby={view === 'issues' ? 'co-tab-issues' : 'co-tab-prs'}
          >
            <ConnectionCard
              conn={conn}
              token={token}
              onChanged={refreshConnection}
              onRetry={refreshConnection}
              placement="content"
              submissionMethod={submissionMethod}
              onChooseSubmissionMethod={onChooseSubmissionMethod}
            />
            {/* Name the cold-load state without flashing an inaccurate empty
                inbox before the authoritative ledger arrives. */}
            {loading || !focusedReviewReady ? <FeedLoadingState view={view} /> : isEmpty ? (
              <EmptyState view={view} />
            ) : (
              <Feed
                groups={groups}
                records={visibleRecords}
                projects={sourceProjects}
                reviewStatus={reviewStatus}
                onSend={onSend}
                onRunPrePrChecks={submissionMethod === 'github'
                  ? onRunPrePrChecks
                  : null}
                onSendStack={onSendStack}
                onLandStack={onLandStack}
                onFeedback={onFeedback}
                onDismiss={onDismiss}
                onRestore={onRestore}
                onSetAutopilot={onSetAutopilot}
                onWithdraw={onWithdraw}
                onConnectApp={onConnectApp}
                onStartAgent={startAgentTask}
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
