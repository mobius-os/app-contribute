// Ledger storage layer. contributions/<id>.json is written by the agent
// (from chat turns) and by job.sh (the daily refresh); this app has TWO
// writers of its own — the read-side feed cache (feed-cache.json, there
// only to serve the next offline open) and the Dismiss button, which
// CAS-flips a prepared record to abandoned to avoid clobbering a concurrent
// submit claim. Dismissal is ONLINE-ONLY (CAS needs a live version read),
// which is why the manifest declares offline writes "none". The assembled
// feed is also cached to feed-cache.json for the next offline open.

const FEED_CACHE = 'feed-cache.json'
const SOURCE_CACHE = 'source-cache.json'
const CYCLE_STATE = 'cycle-state.json'
const RECORD_PREFIX = 'contributions/'
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const LEGACY_FILE_MAX = 64 * 1024
const LEGACY_PAGE_MAX = 1024 * 1024
const LEGACY_RECORD_MAX = 100
const CURRENT_STATUSES = new Set(['prepared', 'submitting', 'draft', 'open'])
const RECENT_HISTORY_LIMIT = 24

function recordTime(record) {
  const value = record?.updated_at || record?.created_at || ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isCanonicalRecord(record) {
  return record?.path === `${RECORD_PREFIX}${record?.id}.json`
}

// Older Contribute versions could leave an <id>.record.json mirror beside the
// canonical <id>.json record. Preserve a legacy-only record, but once its
// canonical successor exists the successor owns the lifecycle state even when
// the mirror still claims that settled work is active.
function preferCanonicalLedgerRecords(records) {
  const selected = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object' || !record.id) continue
    const current = selected.get(record.id)
    if (!current) {
      selected.set(record.id, record)
      continue
    }
    const currentCanonical = isCanonicalRecord(current)
    const nextCanonical = isCanonicalRecord(record)
    if (
      (nextCanonical && !currentCanonical)
      || (nextCanonical === currentCanonical && recordTime(record) > recordTime(current))
    ) {
      selected.set(record.id, record)
    }
  }
  return [...selected.values()]
}

// The cache is the fast, bounded first screen—not a second source of truth.
// Keep every current item plus a small recent-history window; the authoritative
// ledger refresh follows in the background and replaces it atomically.
export function buildFeedSnapshot(records) {
  const current = []
  const history = []
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object' || !record.id) continue
    if (CURRENT_STATUSES.has(record.status) || record.needs_attention) current.push(record)
    else history.push(record)
  }
  history.sort((a, b) => recordTime(b) - recordTime(a))
  return [...current, ...history.slice(0, RECENT_HISTORY_LIMIT)]
}

export async function loadCachedFeed() {
  try {
    const cached = await window.mobius.storage.get(FEED_CACHE)
    const records = Array.isArray(cached) ? cached : cached?.records
    return Array.isArray(records) ? records : []
  } catch {
    return []
  }
}

// A shell review handoff names one already-validated contribution id. Resolve
// that record with at most two small reads instead of holding the interaction
// behind the full paged ledger scan. The legacy suffix keeps old prepared work
// reachable without turning this focused path into another enumeration.
export function contributionRecordPaths(recordId) {
  const id = typeof recordId === 'string' ? recordId.trim() : ''
  if (!RECORD_ID_RE.test(id)) return []
  return [
    `${RECORD_PREFIX}${id}.json`,
    `${RECORD_PREFIX}${id}.record.json`,
  ]
}

export async function loadContributionRecord(recordId) {
  const id = typeof recordId === 'string' ? recordId.trim() : ''
  for (const path of contributionRecordPaths(id)) {
    const record = await window.mobius.storage.get(path)
    if (record && typeof record === 'object' && record.id === id) {
      return { ...record, path }
    }
  }
  return null
}

// User-visible review opening can use the runtime's instant stale-while-
// revalidate read above. Decisions that can publish or reconcile work cannot:
// getWithVersion reaches the server while online and explicitly reports an
// offline fallback, so those actions never accept a cached row as canonical.
export async function loadFreshContributionRecord(recordId) {
  const id = typeof recordId === 'string' ? recordId.trim() : ''
  const storage = window.mobius?.storage
  const readVersioned = typeof storage?.getWithVersion === 'function'
    ? storage.getWithVersion.bind(storage)
    : (typeof storage?._getWithVersion === 'function'
        ? storage._getWithVersion.bind(storage)
        : null)
  if (!readVersioned) return null
  for (const path of contributionRecordPaths(id)) {
    const loaded = await readVersioned(path, 'json')
    if (loaded?.offline) return null
    const record = loaded?.value
    if (record && typeof record === 'object' && record.id === id) {
      return { ...record, path }
    }
  }
  return null
}

export async function loadFreshContributionRecords(recordIds) {
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : [])
    .map((id) => typeof id === 'string' ? id.trim() : '')
    .filter((id) => RECORD_ID_RE.test(id)))]
  const records = await Promise.all(ids.map((id) => loadFreshContributionRecord(id)))
  return records.filter(Boolean)
}

async function readLedger() {
  // Current platforms page include-content listings at a bounded byte budget.
  // A pre-batch runtime ignores the option and returns metadata for every JSON
  // record, so retain a strictly bounded sequential fallback for that one
  // recognizable shape. Mixed responses and oversized sets never fan out:
  // their exceptional entries are isolated and reported to the UI instead.
  const entries = await window.mobius.storage.list(RECORD_PREFIX, {
    includeContent: true,
  })
  if (
    entries === null
    || (entries.length === 0 && window.mobius.online === false)
  ) {
    return { records: await loadCachedFeed(), fromCache: true, omitted: [] }
  }
  const records = []
  const omitted = []
  const jsonEntries = entries.filter((entry) =>
    entry.type === 'file' && entry.name.endsWith('.json'))
  const hasBatchedContent = jsonEntries.some((entry) =>
    Object.prototype.hasOwnProperty.call(entry, 'content'))
  const legacyBytes = jsonEntries.reduce((total, entry) => (
    total + (Number.isFinite(entry.size) ? entry.size : LEGACY_PAGE_MAX + 1)
  ), 0)
  const useLegacyFallback = jsonEntries.length > 0
    && !hasBatchedContent
    && jsonEntries.length <= LEGACY_RECORD_MAX
    && jsonEntries.every((entry) => Number.isFinite(entry.size)
      && entry.size <= LEGACY_FILE_MAX)
    && legacyBytes <= LEGACY_PAGE_MAX

  for (const entry of jsonEntries) {
    const path = entry.path || RECORD_PREFIX + entry.name
    if (useLegacyFallback) {
      const rec = await window.mobius.storage.get(path)
      if (rec && typeof rec === 'object' && rec.id) {
        records.push({ ...rec, path })
      } else {
        omitted.push(path)
      }
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'content')) {
      omitted.push(path)
      continue
    }
    const rec = entry.content
    // `path` rides along so subscriptions and the Dismiss CAS write address
    // the actual file even if its name ever drifts from rec.id. It only
    // reaches this app's own feed cache — dismissal writes start from a
    // fresh server read, so the field never lands in the ledger files.
    if (rec && typeof rec === 'object' && rec.id) {
      records.push({ ...rec, path })
    } else {
      omitted.push(path)
    }
  }
  return {
    records: preferCanonicalLedgerRecords(records),
    fromCache: false,
    omitted,
  }
}

// Visibility, focus, and mount can converge during the same app activation.
// They all want the same authoritative snapshot, so share that expensive
// enumeration while it is in flight rather than issuing parallel 100+ page
// scans. A settled read is never cached here: the next real refresh still
// reaches storage.
let ledgerLoadPromise = null
export function loadLedger() {
  if (!ledgerLoadPromise) {
    ledgerLoadPromise = readLedger().finally(() => {
      ledgerLoadPromise = null
    })
  }
  return ledgerLoadPromise
}

export async function cacheFeed(records) {
  try {
    await window.mobius.storage.set(FEED_CACHE, {
      schema: 2,
      saved_at: new Date().toISOString(),
      records: buildFeedSnapshot(records),
    })
  } catch {
    // The cache only improves the next offline open; never let it fail a load.
  }
}

export function normalizeSourceSnapshotCache(raw) {
  const snapshot = raw?.snapshot || raw
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot
    : null
}

export async function loadCachedSourceSnapshot() {
  try {
    return normalizeSourceSnapshotCache(
      await window.mobius.storage.get(SOURCE_CACHE),
    )
  } catch {
    return null
  }
}

export async function cacheSourceSnapshot(snapshot) {
  if (!normalizeSourceSnapshotCache(snapshot)) return false
  try {
    await window.mobius.storage.set(SOURCE_CACHE, {
      schema: 1,
      saved_at: new Date().toISOString(),
      snapshot,
    })
    return true
  } catch {
    return false
  }
}

export function normalizeCycleState(raw) {
  if (!raw || typeof raw !== 'object') return null
  const chatId = typeof raw.chat_id === 'string' ? raw.chat_id.trim() : ''
  if (!chatId) return null
  return {
    chat_id: chatId.slice(0, 128),
    started_at: typeof raw.started_at === 'string' ? raw.started_at : '',
  }
}

export async function loadCycleState() {
  try {
    return normalizeCycleState(await window.mobius.storage.get(CYCLE_STATE))
  } catch {
    return null
  }
}

export async function saveCycleState(state) {
  const normalized = normalizeCycleState(state)
  if (!normalized) return false
  try {
    await window.mobius.storage.set(CYCLE_STATE, {
      schema: 1,
      ...normalized,
    })
    return true
  } catch {
    return false
  }
}

export async function clearCycleState() {
  try {
    await window.mobius.storage.remove(CYCLE_STATE)
    return true
  } catch {
    return false
  }
}

const SETTINGS_FILE = 'settings.json'
const DEFAULT_APP_SETTINGS = Object.freeze({ autopilot_default: true })

export function normalizeAppSettings(raw) {
  return raw && typeof raw === 'object'
    ? { ...DEFAULT_APP_SETTINGS, ...raw }
    : { ...DEFAULT_APP_SETTINGS }
}

// App-level preferences (not per-contribution). Currently just the global
// "grant autopilot on new sends" default, consulted only at Send time — job.sh
// keys off each record's grant, never this file. Missing/unreadable → defaults.
export async function loadAppSettings() {
  try {
    const raw = await window.mobius.storage.get(SETTINGS_FILE)
    return normalizeAppSettings(raw)
  } catch {
    return normalizeAppSettings(null)
  }
}

export async function saveAppSettings(settings) {
  try {
    await window.mobius.storage.set(SETTINGS_FILE, settings || {})
    return true
  } catch {
    return false
  }
}

// The staged full diff sits beside its record as raw text. null = absent
// (a comment-only plan, or a v1 record) or unreadable — the card shows a
// quiet "no diff stored" either way.
export async function loadFullDiff(rec) {
  try {
    return await window.mobius.storage.getText(RECORD_PREFIX + rec.id + '.diff')
  } catch {
    return null
  }
}

// Archive and restore are the SAME guarded status flip in opposite directions, so
// they share one CAS engine. The runtime's durableWrite({ifMatch}) and
// getWithVersion pairing is the same guarded path useDocument uses, so it
// keeps the mirror and subscribers coherent. A 412 means someone else (the
// agent claiming it, another tab) won the race: re-read once and retry only if
// the record is still in the expected `from` status. There is intentionally no
// blind-write fallback: losing concurrency safety must never be an availability
// strategy.
//
// Outcomes: {ok: rec} flipped | {conflict: rec|null} changed under us |
// {gone: true} record vanished | {error: string} ('offline' when the
// network verdict says so).
async function casFlipStatus({ rec, from, to }) {
  const path = rec.path || RECORD_PREFIX + rec.id + '.json'
  const s = window.mobius && window.mobius.storage
  // The versioned read is the other half of durableWrite({ifMatch}): without a
  // version there is nothing to match on, and there is deliberately no
  // blind-write fallback. The runtime promoted this from the private
  // `_getWithVersion` to a supported `getWithVersion`; accept either so the
  // app runs on a runtime from before or after that rename.
  const readVersioned = typeof s?.getWithVersion === 'function'
    ? s.getWithVersion.bind(s)
    : (typeof s?._getWithVersion === 'function' ? s._getWithVersion.bind(s) : null)
  if (!s || typeof s.durableWrite !== 'function' || !readVersioned) {
    return { error: 'Safe storage updates are unavailable.' }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = null
    let version = null
    try {
      const loaded = await readVersioned(path, 'json')
      current = loaded.value
      version = loaded.version
    } catch (err) {
      if (window.mobius && window.mobius.online === false) return { error: 'offline' }
      return { error: String((err && err.message) || err) }
    }
    if (!current || typeof current !== 'object') return { gone: true }
    if (current.status !== from) return { conflict: current }
    if (!version) {
      return { error: 'Safe storage updates are unavailable.' }
    }
    const next = {
      ...current,
      status: to,
      updated_at: new Date().toISOString(),
    }
    try {
      await s.durableWrite(path, next, { ifMatch: version })
      return { ok: next }
    } catch (err) {
      if (err && err.code === 'conflict') continue // durableWrite's 412
      if (window.mobius && window.mobius.online === false) return { error: 'offline' }
      return { error: String((err && err.message) || err) }
    }
  }
  // Two straight 412s: the record keeps changing — treat as a conflict and
  // let the caller refresh the feed rather than fight for the write.
  return { conflict: null }
}

// Move to History = CAS-flip a still-`prepared` record to `abandoned`.
export async function abandonPrepared({ appId, token, rec }) {
  return casFlipStatus({ appId, token, rec, from: 'prepared', to: 'abandoned' })
}

// Restore = the reverse: CAS-flip an `abandoned` record back to `prepared` so it
// returns to Ready for review (the plan, diff blob, and branch are untouched by
// the archive, so a restored record is fully reviewable/sendable again).
export async function restoreAbandoned({ appId, token, rec }) {
  return casFlipStatus({ appId, token, rec, from: 'abandoned', to: 'prepared' })
}
