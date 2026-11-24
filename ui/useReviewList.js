import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { fetchChangeProbe } from '../api.js'
import { loadReviewRuns, moreReviewRuns } from '../collaboration.js'
import { SYNC_POLICY } from '../refresh.js'
import { hasActiveReview } from '../review-frame.js'
import { changedReviewRuns, classifyReview, mergeReviewPulls, pendingRespondStarts, readReviewPulls, respondEntries, respondStartsExpireIn, reviewCounts, reviewEntries, reviewKey, withRespondStart, withReviewRun } from '../review-list.js'

// The one sync hub of the open app (refresh.js createSyncHub): index.jsx provides
// it, and every screen asks it to read again instead of keeping a timer of its
// own. Without one (a screen rendered on its own) a screen simply never re-reads.
export const SyncHubContext = createContext(null)
export const useSyncHub = () => useContext(SyncHubContext)

// True while a PR page covers the screen that holds the reader: that screen stays mounted under the page (Back returns to it as it was) but
// nobody sees it, so its own timers (a project's status read every five seconds, a review's clock) rest until the page closes.
export const CoveredContext = createContext(false)
export const useCovered = () => useContext(CoveredContext)

// The set of reviewed PRs changed, or the app opened: read every PR the last read does not already show as current.
const ALL_PULLS = '*'
// The owner's Sync or Retry: read every PR again, whatever the last read said.
const EVERYTHING = '**'
const NONE = []
// A probe key for one of the owner's own PRs, apart from the PRs a review was made of (the same PR can be both), and the signature of a PR that is over.
const OWN = 'own:'
const OVER = /\|(MERGED|CLOSED)$/

// The live read of every PR a review belongs to. The whole set is read once per
// change of the set; afterwards only the PRs that moved. A review that changed
// state reads its PR at once (`want`); the probe seeing a PR move waits out the
// GitHub cooldown (`wantLater`), so a busy PR costs at most one read per five
// minutes. The owner's Sync and Retry (`readAll`) always read, whatever the budget, and every PR; a quiet catch-up
// (`readAll({ quiet: true })`) asks as the probe does, so it waits out the cooldown, joins a read already due, and leaves
// the PRs the probe finds unmoved unread.
function useReviewPulls({ hub, enabled, token, refs, refsKey, attempt, seed, own, onOwnMoved }) {
  const [live, setLive] = useState({ answered: '', pulls: new Map(), failed: false })
  // The PRs that were over at the last visit (desk-copy.js settledPulls) stand as they were until the first full read answers, and
  // the change probe may find them unmoved: what the open has read is never replaced by them.
  const shown = useMemo(() => ((live.answered && !live.failed) || !seed.length ? live : { ...live, pulls: new Map([...seed.map(pr => [reviewKey(pr.repository.nameWithOwner, pr.number), pr]), ...live.pulls]) }), [live, seed])
  const latest = useRef({ refs, own, answered: '', pulls: shown.pulls, onOwnMoved })
  latest.current = { refs, own, answered: `${refsKey}@${attempt}`, pulls: shown.pulls, onOwnMoved }
  // What the last probe saw of the owner's own PRs, to tell a PR that was merged or closed from one that only moved.
  const probed = useRef(new Map())
  const wanted = useRef(new Set())
  // Whether the newest read of the PRs failed. The hub swallows a failure into `failed` below, so a Sync that awaits the read
  // would never hear of it: readAll answers it.
  const lastReadFailed = useRef(false)
  const mark = useCallback(keys => keys.forEach(key => wanted.current.add(key)), [])
  const want = useCallback(keys => { mark(keys); return hub.changed('reviewPulls') }, [hub, mark])
  const wantLater = useCallback(keys => { mark(keys); return hub.automatic('reviewPulls') }, [hub, mark])
  const readAll = useCallback(({ quiet = false } = {}) => {
    mark([quiet ? ALL_PULLS : EVERYTHING])
    return Promise.resolve(quiet ? hub.automatic('reviewPulls') : hub.refresh('reviewPulls')).then(() => !lastReadFailed.current)
  }, [hub, mark])
  useEffect(() => {
    if (!enabled || !token) return undefined
    return hub.fact('reviewPulls', {
      github: true,
      read: async () => {
        const keys = wanted.current
        if (!keys.size) return null
        wanted.current = new Set()
        const { refs: all, answered, pulls: known } = latest.current
        const forced = keys.has(EVERYTHING)
        const everything = forced || keys.has(ALL_PULLS)
        try {
          const result = { ...await readReviewPulls(token, all, everything ? null : keys, everything && !forced ? known : null), answered }
          lastReadFailed.current = false
          return result
        } catch (error) {
          // The hub keeps a failed GitHub read wanted and reads it again after its cooldown: the PRs asked for go back, or that read finds
          // nothing to read and the failure is never retried.
          keys.forEach(key => wanted.current.add(key))
          lastReadFailed.current = true
          throw error
        }
      },
      apply: result => {
        if (result) setLive(old => ({ answered: result.everything ? result.answered : old.answered, pulls: mergeReviewPulls(old.pulls, result), failed: result.everything ? false : old.failed }))
      },
      // What the last read said stays; with none yet, the saved rows stand (the open reports the failed update itself).
      failed: () => setLive(old => (old.answered === latest.current.answered ? old : { answered: latest.current.answered, pulls: old.pulls, failed: true })),
    })
  }, [hub, enabled, token])
  const seenAttempt = useRef(attempt)
  useEffect(() => {
    const retried = attempt !== seenAttempt.current
    seenAttempt.current = attempt
    if (retried) void readAll()
    else if (refsKey) void want([ALL_PULLS])
  }, [refsKey, attempt, enabled, token, want, readAll])
  useEffect(() => {
    if (!enabled || !token) return undefined
    return hub.watch(
      async () => {
        const watched = [...latest.current.refs.map(ref => ({ ...ref, key: reviewKey(ref.repo, ref.number) })), ...latest.current.own.map(ref => ({ ...ref, key: OWN + reviewKey(ref.repo, ref.number) }))]
        const signatures = await fetchChangeProbe(token, watched)
        if (signatures) probed.current = signatures
        return signatures
      },
      keys => {
        const own = [...keys].filter(key => key.startsWith(OWN))
        // One of the owner's own PRs was merged or closed: read the list at once, so the Desk stops counting it. A new request reads the lists once its
        // cooldown allows. Any other move of an own PR (a push, a review, a comment, new checks) reads just that PR again, also after the cooldown: a
        // busy PR costs the few points of its own read, not the 55 of the lists. The probe is the one a minute that is already made; it adds a point
        // per hundred PRs and no timer.
        if (own.some(key => OVER.test(probed.current.get(key) || ''))) void hub.changed('incoming')
        else if (keys.has('requests')) void hub.automatic('incoming')
        else if (own.length) latest.current.onOwnMoved?.(latest.current.own.filter(ref => keys.has(OWN + reviewKey(ref.repo, ref.number))))
        const moved = latest.current.refs.map(ref => reviewKey(ref.repo, ref.number)).filter(key => keys.has(key))
        if (moved.length) void wantLater(moved)
      },
    )
  }, [hub, enabled, token, wantLater])
  return { live: shown, want, readAll }
}

// The owner's reviews for the PR reviews page and the rail's badge. A review whose PR the live read has not
// answered yet shows where it stood at the last full sync (`lastKnown`, the rows desk-copy.js saved), and
// "checking" only when there is nothing known; a PR GitHub did not return is unknown, so a stale finding
// never shows up as waiting on you once the read has answered. A read that failed keeps the saved rows (`failed`
// says so, for the header). Until the runs themselves are read (`runsReady`), the saved rows are the list.
export function useReviewList({ hub, enabled = true, token, runs, runsReady = true, lastKnown = NONE, knownPulls = NONE, chats = [], responses = [], pulls = [], ownPulls = NONE, onOwnMoved, ignored, login }) {
  const raw = useMemo(() => reviewEntries(runs), [runs])
  const refs = useMemo(() => raw.map(entry => ({ repo: entry.item.repo, number: entry.item.number })), [raw])
  const refsKey = refs.map(ref => reviewKey(ref.repo, ref.number)).sort().join('|')
  const [attempt, setAttempt] = useState(0)
  const { live, want, readAll } = useReviewPulls({ hub, enabled, token, refs, refsKey, attempt, seed: knownPulls, own: ownPulls, onOwnMoved })
  const pullsMoved = useCallback(pulls => want(pulls.map(pull => reviewKey(pull.repo, pull.number))), [want])
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return useMemo(() => {
    const done = live.answered === `${refsKey}@${attempt}`
    const known = new Map(lastKnown.map(row => [row.id, row]))
    const classified = entry => ({ ...entry, ...classifyReview(entry, { login, ignored, runs, chats, responses, live: live.pulls.get(entry.id) }) })
    const reviews = !runsReady ? lastKnown.map(row => ({ ...row, saved: true })) : raw.map(entry => {
      if (live.pulls.has(entry.id) || (done && !live.failed)) return classified(entry)
      const row = known.get(entry.id)
      if (row) return { ...entry, bucket: row.bucket, confirm: row.confirm, chips: row.chips, decision: row.decision, pull: row.pull, item: entry.item.title ? entry.item : row.item, saved: true }
      return done ? classified(entry) : { ...entry, bucket: 'checking', chips: [] }
    })
    const entries = [...reviews, ...(runsReady ? respondEntries(chats, raw, pulls) : [])]
    return { entries, counts: reviewCounts(entries), checking: entries.some(entry => entry.bucket === 'checking'), settled: raw.length === 0 || done, failed: !!live.failed, livePulls: live.pulls, retry, pullsMoved, syncPulls: readAll }
  }, [raw, live, refsKey, attempt, login, ignored, runs, runsReady, lastKnown, chats, responses, pulls, retry, pullsMoved, readAll])
}

// Leaving a PR page re-reads the runs: whatever happened there shows on the Desk at once.
function usePullPageExit(pullPageOpen, refresh) {
  const hadPullPage = useRef(false)
  useEffect(() => {
    if (pullPageOpen) { hadPullPage.current = true; return }
    if (!hadPullPage.current) return
    hadPullPage.current = false
    void refresh()
  }, [pullPageOpen, refresh])
}

// The review runs the Desk's rows wear their frames from, with the live
// Respond-to-feedback conversations that come in the same list (another agent
// job on a PR). The hub's `runs` fact reads them: every 10 s while a review or
// conversation is at work, every 30 s otherwise, at once when the frame is shown
// again, on Sync (the returned `refresh`), and whenever a PR page or the review
// link starts, stops or re-reads a review (`onRunsChanged` in PullRequests and
// ReviewSelection). This is the one copy of the runs: the PR page reads it too,
// and `patch` shows an action's own answer in it. These are reads of the
// platform's review list, not of GitHub, though loadReviewRuns may re-check
// GitHub for a run that still waits on it, at most once a minute per run.
// A Respond conversation the owner just started (`respondStarted`) is shown at
// once and read for at once, so its PR does not keep its old state until the next read.
// It stands in only until a read lists it or its own deadline passes, whether reads succeed or not.
export function useDeskReviewRuns({ hub, token, appId, connState, sendOnly, pullPageOpen, onReviewsMoved }) {
  const [runs, setRuns] = useState([])
  const [listedChats, setListedChats] = useState([])
  const started = useRef([])
  const [startedChats, setStartedChats] = useState([])
  const keepStarted = useCallback(next => { started.current = next; setStartedChats(next) }, [])
  const respondChats = useMemo(() => [...listedChats, ...startedChats], [listedChats, startedChats])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const lastReadFailed = useRef(false)
  const enabled = !sendOnly && connState === 'connected'
  // The runs last shown, to tell which review changed state since (a read of a
  // changed review hands it to onReviewsMoved; the owner's own action does not).
  const shown = useRef([])
  const show = useCallback(list => { shown.current = list; setRuns(list) }, [])
  // The list is paged (collaboration.js): the first page holds every run that is not finished and the newest finished ones, and says so in `cut` when older
  // finished runs exist. Reading more (readMore) adds older finished runs; they are kept across the reads that follow, which only ever return the first page.
  const firstPage = useRef([])
  const older = useRef({ read: false, runs: [], cursor: null, hasMore: false })
  const meta = useRef({ cut: '', cursor: null })
  const [cut, setCut] = useState('')
  const [more, setMore] = useState({ busy: false, error: '' })
  const withOlder = useCallback(first => { const have = new Set(first.map(run => run.id)); return [...first, ...older.current.runs.filter(run => !have.has(run.id))] }, [])
  const movedRef = useRef(onReviewsMoved)
  movedRef.current = onReviewsMoved
  useEffect(() => {
    if (!enabled) return undefined
    return hub.fact('runs', {
      read: async () => {
        try {
          const list = await loadReviewRuns(token, appId)
          lastReadFailed.current = false
          return list
        } catch (error) {
          lastReadFailed.current = true
          throw error
        }
      },
      apply: list => {
        firstPage.current = list.runs || []
        const merged = withOlder(firstPage.current)
        const moved = changedReviewRuns(shown.current, merged)
        show(merged)
        meta.current = { cut: older.current.read && list.cut !== 'any' ? (older.current.hasMore ? 'finished' : '') : list.cut || '', cursor: older.current.read ? older.current.cursor : list.next_cursor || null }
        setCut(meta.current.cut)
        const listed = list.respond_chats || []
        setListedChats(listed)
        keepStarted(pendingRespondStarts(started.current, listed, Date.now(), SYNC_POLICY.respondStartGraceMs))
        setError('')
        if (moved.length) movedRef.current?.(moved)
      },
      failed: failure => setError(failure.message),
      every: { live: SYNC_POLICY.runsLiveMs, idle: SYNC_POLICY.runsIdleMs },
      live: list => started.current.length > 0 || (!!list && (hasActiveReview(list.runs) || (list.respond_chats || []).length > 0)),
    })
  }, [hub, enabled, token, appId, show, keepStarted, withOlder])
  // A start also ends at its own deadline: when reads fail there is no apply to prune it.
  useEffect(() => {
    const wait = respondStartsExpireIn(startedChats, Date.now(), SYNC_POLICY.respondStartGraceMs)
    if (wait === null) return undefined
    const timer = setTimeout(() => keepStarted(pendingRespondStarts(started.current, [], Date.now(), SYNC_POLICY.respondStartGraceMs)), wait)
    return () => clearTimeout(timer)
  }, [startedChats, keepStarted])
  // Answers whether the newest read of the runs went through, so a Sync can say so (the hub keeps a failed read to `failed` above).
  const refresh = useCallback(() => Promise.resolve(hub.refresh('runs')).then(() => !lastReadFailed.current), [hub])
  // The owner asks for the older finished runs: one page more, kept. A page that cannot be read leaves the list as it was and says so.
  const readMore = useCallback(async () => {
    const cursor = meta.current.cursor
    if (!cursor || more.busy) return
    setMore({ busy: true, error: '' })
    try {
      const page = await moreReviewRuns(token, appId, { runs: [], has_more: true, next_cursor: cursor })
      const known = new Set(older.current.runs.map(run => run.id))
      older.current = { read: true, runs: [...older.current.runs, ...(page.runs || []).filter(run => !known.has(run.id))], cursor: page.next_cursor || null, hasMore: page.has_more === true }
      show(withOlder(firstPage.current))
      meta.current = { cut: older.current.hasMore ? 'finished' : '', cursor: older.current.cursor }
      setCut(meta.current.cut)
      setMore({ busy: false, error: '' })
    } catch {
      setMore({ busy: false, error: 'The older reviews could not be read just now. Try again.' })
    }
  }, [token, appId, show, withOlder, more.busy])
  const respondStarted = useCallback(chat => {
    keepStarted(withRespondStart(started.current, { ...chat, state: 'running', at: Date.now() }))
    void refresh()
  }, [keepStarted, refresh])
  useEffect(() => {
    if (sendOnly || connState === 'checking') return
    if (connState !== 'connected') { setReady(true); return }
    void refresh().finally(() => setReady(true))
  }, [connState, refresh, sendOnly, token, appId])
  // An owner action's own answer replaces that run in the shared copy; reads begun before it must not land.
  const patch = useCallback(run => {
    hub.supersede('runs')
    show(withReviewRun(shown.current, run))
  }, [hub, show])
  usePullPageExit(pullPageOpen, refresh)
  return { runs, respondChats, error, ready, refresh, patch, respondStarted, runsCut: { cut, busy: more.busy, error: more.error, onMore: cut === 'finished' ? readMore : null } }
}
