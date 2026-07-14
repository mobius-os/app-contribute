// Contribute — thin app shell. The module tree is declared in mobius.json's
// source_files; the multi-file installer fetches each path and esbuild bundles
// from this entry, resolving the relative imports below at compile time.
//
//   theme.js    — the single app stylesheet (CSS)
//   domain.js   — pure logic: grouping, counts, the batched live-refresh query
//   storage.js  — the window.mobius.storage ledger layer (+ offline cache,
//                 the full-diff read, and the Dismiss CAS flip)
//   api.js      — same-origin /api/github/* reads (status + read-only GraphQL)
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
  applyLiveStates,
  buildRefreshQuery,
  countStats,
  groupRecords,
} from './domain.js'
import { abandonPrepared, cacheFeed, loadFullDiff, loadLedger, restoreAbandoned } from './storage.js'
import { fetchGithubStatus, fetchLiveStates, submitContribution } from './api.js'
import { StatTiles } from './ui/StatTiles.jsx'
import { ConnectionCard } from './ui/ConnectionCard.jsx'
import { Feed } from './ui/Feed.jsx'

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

// The app's own icon, with a lettered fallback for installs whose icon route
// 404s. Mirrors the App Store header pattern.
function Header({ appId, fromCache }) {
  return (
    <header className="co-header">
      <img
        src={`/api/apps/${appId}/icon?size=64`}
        alt=""
        width={34}
        height={34}
        className="co-brand-icon"
        onError={(e) => {
          e.currentTarget.style.display = 'none'
          const f = e.currentTarget.nextElementSibling
          if (f) f.style.display = 'flex'
        }}
      />
      <span className="co-brand-fallback" style={{ display: 'none' }} aria-hidden="true">
        C
      </span>
      <div>
        <h1 className="co-title">Contribute</h1>
        <span className="co-subtitle">What your agent has shared upstream</span>
        {fromCache && (
          <span className="co-offline-note">Offline — showing your last synced feed.</span>
        )}
      </div>
    </header>
  )
}

// Sells the loop when the ledger is empty. Deliberately connection-agnostic:
// the ConnectionCard directly above already says whether GitHub is wired up, so
// this stays a single clear invitation rather than branching on state.
function EmptyState() {
  return (
    <div className="co-empty">
      <div className="co-empty-mark">{MERGE_MARK}</div>
      <div className="co-empty-title">No contributions yet</div>
      <p className="co-empty-text">
        Your agent can improve Möbius for everyone. When it fixes an app or the
        platform, ask it to share the change upstream — approved contributions
        show up here, from prepared all the way to merged.
      </p>
    </div>
  )
}

export default function ContributeApp({ appId, token }) {
  const [records, setRecords] = useState([])
  const [fromCache, setFromCache] = useState(false)
  const [conn, setConn] = useState({ state: 'unknown' })
  const [loading, setLoading] = useState(true)
  // Latest records for callbacks (the connect-flow refresh) that must not take
  // a `records` dependency and re-bind on every ledger change.
  const recordsRef = useRef(records)
  useEffect(() => { recordsRef.current = records }, [records])

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
      setRecords(next)
      cacheFeed(next)
    }
  }, [fetchRefreshed])

  // Re-read connection status after an in-app connect/disconnect, and — when we
  // land connected and have a real (non-cached) ledger — re-run the live
  // refresh now that GitHub is reachable. Passed to ConnectionCard as onChanged.
  const refreshConnection = useCallback(async () => {
    const status = await fetchGithubStatus(token)
    setConn(status)
    if (status.state === 'connected' && !fromCache) {
      runLiveRefresh(recordsRef.current)
    }
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

  // Rescan the ledger when the partner comes back to the app — the app's only
  // liveness mechanism. A submit can flip a record (claim → submitting →
  // draft/open) while the app is hidden, and feedback can move focus into a
  // chat. The return visit is the moment to catch records the agent added or
  // the platform submitted, and Dismiss already updates its own card locally.
  // Fresh (non-cache) results replace the feed and re-run the live refresh so
  // GitHub state rides along.
  useEffect(() => {
    let running = false
    async function rescan() {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        const ledger = await loadLedger()
        if (!ledger.fromCache) {
          setRecords(ledger.records)
          setFromCache(false)
          cacheFeed(ledger.records)
          runLiveRefresh(ledger.records)
        }
      } finally {
        running = false
      }
    }
    document.addEventListener('visibilitychange', rescan)
    window.addEventListener('focus', rescan)
    return () => {
      document.removeEventListener('visibilitychange', rescan)
      window.removeEventListener('focus', rescan)
    }
  }, [runLiveRefresh])

  // Send = direct PR submit. The platform claims the prepared record,
  // recomputes the branch diff, safely fast-forwards a stale reusable fork,
  // pushes to it, opens the PR, and returns the updated ledger record. On a
  // partner-actionable failure the
  // server rolls the record back to `prepared` with last_submit_error, and the
  // card stays ready for feedback/retry instead of handing off to an agent chat.
  const onSend = useCallback(async (rec) => {
    const outcome = await submitContribution({ appId, token, rec })
    if (outcome.ok) {
      const next = { ...outcome.ok, path: rec.path }
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? next : r)))
      cacheFeed(recordsRef.current.map((r) => (r.id === rec.id ? next : r)))
      window.mobius?.signal?.('contribution_submitted', {
        id: rec.id,
        url: outcome.url || next.url,
      })
      return { ok: true, record: next, url: outcome.url || next.url }
    }
    if (outcome.record) {
      const next = { ...outcome.record, path: rec.path }
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? next : r)))
      cacheFeed(recordsRef.current.map((r) => (r.id === rec.id ? next : r)))
    }
    return { error: outcome.error || 'Could not submit this PR.' }
  }, [appId, token])

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
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? flipped : r)))
      window.mobius?.signal?.('contribution_dismissed', { id: rec.id })
    } else if (outcome.conflict !== undefined || outcome.gone) {
      const ledger = await loadLedger()
      if (!ledger.fromCache) {
        setRecords(ledger.records)
        cacheFeed(ledger.records)
      }
    }
    return outcome
  }, [appId, token])

  // Undrop = CAS flip a dropped record back to `prepared`. Mirrors onDismiss:
  // on success it moves from History back to Ready for review in place; on a
  // conflict/gone the feed reloads so the card reflects reality.
  const onRestore = useCallback(async (rec) => {
    const outcome = await restoreAbandoned({ appId, token, rec })
    if (outcome.ok) {
      const flipped = { ...outcome.ok, path: rec.path }
      setRecords((prev) => prev.map((r) => (r.id === rec.id ? flipped : r)))
      window.mobius?.signal?.('contribution_restored', { id: rec.id })
    } else if (outcome.conflict !== undefined || outcome.gone) {
      const ledger = await loadLedger()
      if (!ledger.fromCache) {
        setRecords(ledger.records)
        cacheFeed(ledger.records)
      }
    }
    return outcome
  }, [appId, token])

  const stats = useMemo(() => countStats(records), [records])
  const groups = useMemo(() => groupRecords(records), [records])
  const isEmpty = records.length === 0

  return (
    <div className="co-root">
      <style>{CSS}</style>
      <div className="co-page">
        <Header appId={appId} fromCache={fromCache} />
        <StatTiles stats={stats} />
        <ConnectionCard conn={conn} token={token} onChanged={refreshConnection} />
        {/* Hold the feed area blank until the first load resolves so an empty
            ledger doesn't flash the sell-the-loop copy before data arrives. */}
        {loading ? null : isEmpty ? <EmptyState /> : (
          <Feed
            groups={groups}
            onSend={onSend}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
            onRestore={onRestore}
            loadDiff={loadFullDiff}
          />
        )}
      </div>
    </div>
  )
}
