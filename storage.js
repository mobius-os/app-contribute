import { DEFAULT_STAGE, stageOf } from './publication-stage.js'
import { stackMeta } from './stack.js'

// Ledger storage layer. contributions/<id>.json is written by the agent
// (from chat turns) and by job.sh (the daily refresh); this app has TWO
// writers of its own — the read-side feed cache (feed-cache.json, there
// to open the next visit at once and to serve an offline open) and the
// Dismiss button, which CAS-flips a prepared record to abandoned to avoid
// clobbering a concurrent submit claim. Dismissal is ONLINE-ONLY (CAS needs
// a live version read), which is why the manifest declares offline writes
// "none". The assembled feed is also cached to feed-cache.json.

const FEED_CACHE = 'feed-cache.json'
const SOURCE_CACHE = 'source-cache.json'
const CYCLE_STATE = 'cycle-state.json'
const RECORD_PREFIX = 'contributions/'
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
const CURRENT_STATUSES = new Set([
  'prepared', 'submitting', 'landing', 'draft', 'open',
])
const RECENT_HISTORY_LIMIT = 24
// History this recent stays in the desk's own set: the Merged list of My PRs
// counts what merged in this window (desk.js MERGED_WINDOW_DAYS).
export const DESK_HISTORY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const BODY_READS_AT_ONCE = 6

function recordTime(record) {
  const value = record?.updated_at || record?.created_at || ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isCanonicalRecord(record) {
  return record?.path === `${RECORD_PREFIX}${record?.id}.json`
}

// Records prepared before the canonical-name migration may exist only as an
// <id>.record.json file. Keep those owner-reviewed records visible, while a
// canonical sibling always owns the lifecycle once it exists.
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

const isCurrentRecord = record => CURRENT_STATUSES.has(record?.status) || !!record?.needs_attention

// The desk's own set: every current item, the history that is recent (a small
// window, plus the Merged week), and every layer of a stack one of those
// belongs to, so a chain is never shown without its settled layers. Older
// history is read when a screen that lists it asks (loadLedger({ history })).
export function buildFeedSnapshot(records, now = Date.now()) {
  const current = []
  const history = []
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object' || !record.id) continue
    if (isCurrentRecord(record)) current.push(record)
    else history.push(record)
  }
  history.sort((a, b) => recordTime(b) - recordTime(a))
  const recent = history.filter((record, index) => index < RECENT_HISTORY_LIMIT || recordTime(record) >= now - DESK_HISTORY_DAYS * DAY_MS)
  const shown = [...current, ...recent]
  const chains = new Set(shown.map(record => stackMeta(record)?.id).filter(Boolean))
  const layers = history.filter(record => !recent.includes(record) && chains.has(stackMeta(record)?.id))
  return [...shown, ...layers]
}

// What the last visit saved: the desk's own records, and an index of the whole
// ledger folder as that visit found it (see indexLedger). Reads at the same
// moment share one read of the file.
let savedFeedRead = null
let ledgerIndex = null
function readSavedFeed() {
  if (!savedFeedRead) {
    savedFeedRead = (async () => {
      try {
        const saved = await window.mobius.storage.get(FEED_CACHE)
        if (!saved || typeof saved !== 'object') return null
        const index = saved.index && typeof saved.index === 'object' && !Array.isArray(saved.index) ? saved.index : null
        if (index && !ledgerIndex) ledgerIndex = index
        return { records: Array.isArray(saved.records) ? saved.records : [], index, savedAt: typeof saved.saved_at === 'string' ? saved.saved_at : '' }
      } catch {
        return null
      }
    })().finally(() => { savedFeedRead = null })
  }
  return savedFeedRead
}

export async function loadCachedFeed() {
  return (await readSavedFeed())?.records ?? []
}

// Whether a visit already saved a feed, and when: a feed that is saved but empty is
// still a saved copy, so a new account is told apart from one with nothing yet.
export async function loadSavedFeedStamp() {
  const saved = await readSavedFeed()
  return saved ? { savedAt: saved.savedAt, count: saved.records.length } : null
}

// A shell review handoff names one already-validated contribution id. Resolve
// that record with at most two small reads instead of holding the interaction
// behind the full paged ledger scan. The legacy path preserves prepared work
// created before the canonical-name migration.
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

// The runtime promoted its versioned read from the private `_getWithVersion` to
// a supported `getWithVersion`; accept either so the app runs on a runtime from
// before or after that rename. null on a runtime with neither.
function versionedReader(storage) {
  if (typeof storage?.getWithVersion === 'function') return storage.getWithVersion.bind(storage)
  return typeof storage?._getWithVersion === 'function' ? storage._getWithVersion.bind(storage) : null
}

// User-visible review opening can use the runtime's instant stale-while-
// revalidate read above. Decisions that can publish or reconcile work cannot:
// getWithVersion reaches the server while online and explicitly reports an
// offline fallback, so those actions never accept a cached row as canonical.
// With `strict`, a read that cannot reach the server (offline, or a runtime
// without versioned reads) rejects, so null means the record is absent.
export async function loadFreshContributionRecord(recordId, { strict = false } = {}) {
  const id = typeof recordId === 'string' ? recordId.trim() : ''
  const readVersioned = versionedReader(window.mobius?.storage)
  if (!readVersioned) {
    if (strict) throw new Error('Contribution records cannot be read here')
    return null
  }
  for (const path of contributionRecordPaths(id)) {
    const loaded = await readVersioned(path, 'json')
    if (loaded?.offline && strict) throw new Error('Contribution records cannot be read offline')
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

// The listing's own stamp of a file: it changes whenever the file is written, so
// the same stamp is the same file. '' when the listing gave none (an older
// platform, a test double): such a file is never taken as unchanged.
export const listingStamp = entry => (entry?.modified_at && Number.isFinite(entry.size) ? `${entry.modified_at}|${entry.size}` : '')

const hasContent = entry => Object.prototype.hasOwnProperty.call(entry, 'content')
const recordPath = entry => entry.path || RECORD_PREFIX + entry.name

async function listLedgerFolder({ includeContent }) {
  const storage = window.mobius.storage
  const options = includeContent ? { includeContent: true } : {}
  if (typeof storage.listWithStatus === 'function') return storage.listWithStatus(RECORD_PREFIX, options)
  const entries = await storage.list(RECORD_PREFIX, options)
  return { entries, complete: entries !== null && window.mobius.online !== false }
}

// A delivered body that is not a ledger record (an agent's stray scratch
// file, a list) is not a contribution at all. Skip it: counting it as
// omitted would mark every load partial, pin the feed to its cache, and
// show a permanent "Offline" note while the device is online.
// `path` rides along so subscriptions and the Dismiss CAS write address
// the actual file even if its name ever drifts from rec.id. It only
// reaches this app's own feed cache — dismissal writes start from a
// fresh server read, so the field never lands in the ledger files.
function ledgerRecordOf(entry, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.id) return null
  if (entry.name !== `${body.id}.json` && entry.name !== `${body.id}.record.json`) return null
  return { ...body, path: recordPath(entry) }
}

// What the ledger folder looked like when it was last read: one entry per record
// file with the listing's stamp, whether the record was current then, and its
// stack. A later visit trusts a settled record whose stamp has not moved, so the
// history it does not show is never read again. The record's own file status is
// what counts here, never a display status laid over it from GitHub.
function indexEntry(entry, record) {
  const stack = record ? stackMeta(record)?.id : undefined
  return { stamp: listingStamp(entry), current: isCurrentRecord(record), ...(stack ? { stack } : {}) }
}

// Every record, bodies and all: the first visit, an older saved copy without an
// index, a runtime that cannot read one record fresh, and a screen that lists history.
// Current platforms page include-content listings at a bounded byte budget.
// Exceptional oversized entries stay isolated and are reported to the UI;
// this reader never falls back to an N+1 scan.
function readWholeLedger(entries, saved) {
  const records = []
  const omitted = []
  const index = {}
  const jsonEntries = entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.json'))
  for (const entry of jsonEntries) {
    if (!hasContent(entry)) {
      omitted.push(recordPath(entry))
      continue
    }
    const record = ledgerRecordOf(entry, entry.content)
    if (record) records.push(record)
    index[entry.name] = indexEntry(entry, record)
  }
  return finishLedger({ records, omitted, index, jsonEntries, saved, wholeHistory: true })
}

// A complete directory snapshot proves membership, not that every body was read.
// Fill omitted members from the saved feed, but only when their exact filename is
// still present so a remote deletion cannot be resurrected.
function finishLedger({ records, omitted, index, jsonEntries, saved, wholeHistory = false }) {
  let assembled = records
  if (omitted.length > 0) {
    const presentNames = new Set(jsonEntries.map(entry => entry.name))
    const parsedIds = new Set(records.map(record => record.id))
    assembled = [
      ...records,
      ...(saved?.records || []).filter(record => record?.id && !parsedIds.has(record.id) && (
        presentNames.has(`${record.id}.json`)
        || presentNames.has(`${record.id}.record.json`)
      )),
    ]
  }
  ledgerIndex = index
  return { records: preferCanonicalLedgerRecords(assembled), fromCache: omitted.length > 0, omitted, wholeHistory }
}

// Reads a few record files fresh from the server, a handful at a time. A file the
// server cannot give now (offline, a failed read) is `null`; one that is gone or
// empty is `undefined`.
async function readRecordBodies(readVersioned, entries) {
  const bodies = new Map()
  for (let from = 0; from < entries.length; from += BODY_READS_AT_ONCE) {
    await Promise.all(entries.slice(from, from + BODY_READS_AT_ONCE).map(async entry => {
      try {
        const loaded = await readVersioned(recordPath(entry), 'json')
        bodies.set(entry, loaded?.offline ? null : loaded?.value ?? undefined)
      } catch {
        bodies.set(entry, null)
      }
    }))
  }
  return bodies
}

// What the desk shows, with the least read: the listing says which files exist and
// which were written since the last visit. A current record, one written since, and
// one this visit has no word on are read fresh; a settled one that did not move is
// taken from the saved feed; older settled history is left unread (and says so, in
// the index) until a screen that lists history asks for it. Reading is bounded by
// what the owner has open or just changed, not by how long the ledger has grown.
async function readDeskLedger(entries, saved, readVersioned) {
  const jsonEntries = entries.filter(entry => entry.type === 'file' && entry.name.endsWith('.json'))
  const savedByPath = new Map(saved.records.map(record => [record.path, record]))
  const index = {}
  const records = []
  const toRead = []
  const settledOutside = []
  for (const entry of jsonEntries) {
    const known = saved.index[entry.name]
    if (hasContent(entry)) {
      const record = ledgerRecordOf(entry, entry.content)
      if (record) records.push(record)
      index[entry.name] = indexEntry(entry, record)
    } else if (known && !known.current && known.stamp && known.stamp === listingStamp(entry)) {
      index[entry.name] = known
      if (savedByPath.has(recordPath(entry))) records.push(savedByPath.get(recordPath(entry)))
      else settledOutside.push(entry)
    } else {
      toRead.push(entry)
    }
  }
  const omitted = []
  async function readInto(entries) {
    const bodies = await readRecordBodies(readVersioned, entries)
    for (const entry of entries) {
      const body = bodies.get(entry)
      if (body === null) { omitted.push(recordPath(entry)); continue }
      const record = ledgerRecordOf(entry, body)
      if (record) records.push(record)
      index[entry.name] = indexEntry(entry, record)
    }
  }
  await readInto(toRead)
  // A layer of a stack the desk shows belongs with it, however old.
  const chains = new Set(records.map(record => stackMeta(record)?.id).filter(Boolean))
  const layers = settledOutside.filter(entry => chains.has(index[entry.name].stack))
  await readInto(layers)
  for (const entry of settledOutside) if (!(entry.name in index)) index[entry.name] = saved.index[entry.name]
  return finishLedger({ records, omitted, index, jsonEntries, saved })
}

async function readLedger({ history }) {
  const saved = await readSavedFeed()
  const readVersioned = versionedReader(window.mobius.storage)
  const desk = !history && saved?.index && readVersioned
  const listing = await listLedgerFolder({ includeContent: !desk })
  if (listing?.complete !== true) {
    return { records: saved?.records ?? [], fromCache: true, omitted: [] }
  }
  const entries = listing.entries || []
  return desk ? readDeskLedger(entries, saved, readVersioned) : readWholeLedger(entries, saved)
}

// Visibility, focus, and mount can converge during the same app activation.
// They all want the same authoritative snapshot, so share that expensive
// enumeration while it is in flight rather than issuing parallel 100+ page
// scans. A settled read is never cached here: the next real refresh still
// reaches storage. `history: true` also reads the settled records the desk does
// not show (a screen that lists them asks); it is its own read.
const ledgerLoads = new Map()
export function loadLedger({ history = false } = {}) {
  if (!ledgerLoads.has(history)) {
    ledgerLoads.set(history, readLedger({ history }).finally(() => ledgerLoads.delete(history)))
  }
  return ledgerLoads.get(history)
}

export async function cacheFeed(records) {
  try {
    await window.mobius.storage.set(FEED_CACHE, {
      schema: 3,
      saved_at: new Date().toISOString(),
      records: buildFeedSnapshot(records),
      ...(ledgerIndex ? { index: ledgerIndex } : {}),
    })
  } catch {
    // The cache only improves the next visit; never let it fail a load.
  }
}

function validSourceSnapshot(snapshot) {
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot
    : null
}

export function normalizeSourceSnapshotCache(raw) {
  return validSourceSnapshot(raw?.snapshot)
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
  if (!validSourceSnapshot(snapshot)) return false
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

// The exact start the owner chose, frozen with its cycle so Send again
// resends that work and model unchanged instead of rebuilding today's choice.
// Bounded to the platform's scoped-start limits (G1 `AppChatStart`: a
// control-free `scope_label` of at most 120 characters, `model` at most 256,
// non-empty content), so a cycle is only ever saved for a start the
// platform can accept. Display text is shortened, never refused.
export const START_LIMITS = { title: 200, scopeLabel: 120, event: 80, model: 256, provider: 64, effort: 32 }
export function boundedStartText(value, max) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…'
}
// A named model and effort inside the platform's limits, or null when none is
// named or one value is too long to send.
export function boundedAgent(agent) {
  if (!agent?.provider || !agent?.model) return null
  const model = String(agent.model), provider = String(agent.provider), effort = agent.effort ? String(agent.effort) : ''
  if (model.length > START_LIMITS.model || provider.length > START_LIMITS.provider || effort.length > START_LIMITS.effort) return null
  return { provider, model, ...(effort ? { effort } : {}) }
}
export function freezeStartAction(action) {
  const title = boundedStartText(action?.title, START_LIMITS.title)
  if (!title || typeof action?.draft !== 'string' || !action.draft.trim()) return null
  const frozen = { title, draft: action.draft }
  for (const key of ['event', 'scopeLabel']) {
    const value = action[key] === undefined ? '' : boundedStartText(action[key], START_LIMITS[key])
    if (value) frozen[key] = value
  }
  if (Number.isSafeInteger(action.count)) frozen.count = action.count
  if (action.merge === true) frozen.merge = true
  if (action.agent?.provider && action.agent?.model) {
    const agent = boundedAgent(action.agent)
    if (!agent) return null
    frozen.agent = agent
  }
  return frozen
}

// One cycle of project work: its number k, its deterministic message id and
// the exact frozen start it delivers. `delivered` is display state only.
function normalizeCycle(raw) {
  if (!raw || !Number.isSafeInteger(raw.k) || raw.k < 1 || typeof raw.cid !== 'string' || !raw.cid) return null
  const action = freezeStartAction(raw.action)
  if (!action) return null
  return { k: raw.k, cid: raw.cid.slice(0, 200), action, title: action.title, event: action.event || '',
    started_at: typeof raw.started_at === 'string' ? raw.started_at : '', delivered: raw.delivered === true,
    ...(typeof raw.chat_id === 'string' && raw.chat_id ? { chat_id: raw.chat_id.slice(0, 128) } : {}),
    ...(raw.model_applied === true ? { model_applied: true } : {}), ...(raw.attempted === true ? { attempted: true } : {}),
    ...(raw.closed === true ? { closed: true } : {}) }
}
// Older records counted cycles as `seq`.
const cycleNumber = raw => Number.isSafeInteger(raw?.k) && raw.k >= 0 ? raw.k : Number.isSafeInteger(raw?.seq) && raw.seq >= 0 ? raw.seq : 0

export function normalizeCycleState(raw) {
  if (!raw || typeof raw !== 'object') return null
  const chatId = typeof raw.chat_id === 'string' ? raw.chat_id.trim() : ''
  if (!chatId) return null
  return {
    chat_id: chatId.slice(0, 128),
    started_at: typeof raw.started_at === 'string' ? raw.started_at : '',
    scope: typeof raw.scope === 'string' ? raw.scope.slice(0, 160) : '',
    ...(typeof raw.event === 'string' ? { event: raw.event.slice(0, 80) } : {}),
    ...(typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.slice(0, 240) } : {}),
    ...(Array.isArray(raw.history) ? { history: raw.history.map(item => normalizeCycleState({ ...item, history: undefined, cycle: undefined })).filter(Boolean) } : {}),
    ...(cycleNumber(raw) ? { k: cycleNumber(raw) } : {}),
    ...(normalizeCycle(raw.cycle) ? { cycle: normalizeCycle(raw.cycle) } : {}),
  }
}

// A project record whose current cycle is not yet confirmed in a
// conversation still carries that cycle, so it can be sent again.
function normalizeProjectRecord(raw) {
  const current = normalizeCycleState(raw)
  if (current) return current
  const cycle = normalizeCycle(raw?.cycle)
  return cycle ? { chat_id: '', k: cycleNumber(raw) || cycle.k, cycle, history: normalizeCycleState({ chat_id: '-', history: raw.history })?.history || [] } : null
}

async function cycleKey(projectKey) {
  if (!projectKey) return CYCLE_STATE

  // Project identities contain `:` and may contain `/`, neither of which can
  // safely be used as one storage filename. URL-encoding is not a storage
  // encoding: the request path is decoded before the server validates it, so
  // `app%3A10` still arrives as the rejected `app:10`. A fixed-size digest is
  // collision-resistant, stays within filename limits, and uses only the
  // storage path's portable character set.
  const bytes = new TextEncoder().encode(String(projectKey))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return `project-cycles/${id}.json`
}

function legacyCycleKey(projectKey) {
  if (!projectKey || !/^[A-Za-z0-9._-]+$/.test(String(projectKey))) return null
  return `project-cycles/${projectKey}.json`
}

async function migrateCycleState(key, legacy) {
  const storage = window.mobius.storage
  // A migration is a create-if-absent, not a last-write-wins update. A
  // project can mount in two panes while the first read is still in flight;
  // an unconditional copy could erase the shortcut created by the other
  // pane. The runtime's durable path owns the atomic precondition.
  if (
    typeof storage?.durableWrite === 'function'
    && typeof storage?.getWithVersion === 'function'
  ) {
    try {
      await storage.durableWrite(key, { schema: 1, ...legacy }, { ifNoneMatch: true })
      return normalizeCycleState(await storage.get(key)) || legacy
    } catch (error) {
      if (error?.code === 'conflict') {
        try {
          return normalizeCycleState(await storage.get(key)) || legacy
        } catch {
          return legacy
        }
      }
      return legacy
    }
  }
  // Older runtimes and the app's small test doubles do not expose CAS. Keep
  // the existing best-effort behavior there; failure must never hide the
  // legacy shortcut for this open.
  try {
    await storage.set(key, { schema: 1, ...legacy })
  } catch {
    // The old shortcut still opens this time; a later read can retry repair.
  }
  return legacy
}

export async function loadCycleState(projectKey) {
  try {
    const key = await cycleKey(projectKey)
    const raw = await window.mobius.storage.get(key)
    const current = normalizeProjectRecord(raw)
    if (current || !projectKey) return current

    // Older builds stored already-safe project identities directly. Preserve
    // only that provably same-identity form while moving it to the fixed
    // digest namespace; identities containing ':' or '/' never had a valid
    // legacy path. In particular, do not probe a digest of the former
    // `app:<row-id>` identity: the row may have been reused and the old state
    // carries no evidence that it belongs to this project.
    const legacyKey = legacyCycleKey(projectKey)
    if (!legacyKey) return null
    const legacy = normalizeCycleState(await window.mobius.storage.get(legacyKey))
    if (!legacy) return null
    return migrateCycleState(key, legacy)
  } catch {
    return null
  }
}

// Not called by the app (beginProjectCycle writes cycles): test/workspace.test.mjs seeds storage with it to prove
// project keys stay isolated and digested.
export async function saveCycleState(state, projectKey) {
  const normalized = normalizeCycleState(state)
  if (!normalized) return false
  try {
    await window.mobius.storage.set(await cycleKey(projectKey), {
      schema: 1,
      ...normalized,
    })
    return true
  } catch {
    return false
  }
}

// All of a project's agent work runs in ONE app-owned conversation, scoped
// `contribute-cycle:<project digest>`. The platform keeps at most one active
// conversation per scope, so a project can never have two owners. Cycle k is
// one message in it with the deterministic id `<scope>:k`. The platform
// de-duplicates that id per conversation, not per scope, so this record is
// consulted before every delivery: only its current, unconfirmed cycle is
// ever sent, and a retry stays bound to the conversation it went to.
export async function projectCycleScope(projectKey) {
  return `contribute-cycle:${(await cycleKey(projectKey)).replace(/^project-cycles\/|\.json$/g, '').slice(0, 32)}`
}

// Record cycle k = observed + 1 with its frozen start, before delivering it.
// A pane that observed an older k is refused, so two panes pressing Start on
// the same state record (and send) one cycle.
export async function beginProjectCycle(projectKey, action = {}, observedK = 0) {
  const storage = window.mobius?.storage
  if (!storage?.getWithVersion || !storage?.durableWrite) return { ok: false, error: 'Safe cycle starts are unavailable in this Möbius version.' }
  const frozen = freezeStartAction(action)
  if (!frozen) return { ok: false, error: 'This agent handoff is incomplete.' }
  try {
    const key = await cycleKey(projectKey)
    const scope = await projectCycleScope(projectKey)
    const { value, version, offline } = await storage.getWithVersion(key)
    if (offline) return { ok: false, error: 'Reconnect before starting new project work.' }
    const previous = normalizeProjectRecord(value)
    if (cycleNumber(value) !== observedK) return { ok: false, changed: true, error: 'Project work changed in another view. It is shown now; start again if you still need to.' }
    const k = observedK + 1
    const cycle = { k, cid: `${scope}:${k}`, action: frozen, started_at: new Date().toISOString(), delivered: false }
    const history = [...(previous?.history || [])]
    if (previous?.chat_id && previous.title) history.unshift({ chat_id: previous.chat_id, title: previous.title, event: previous.event, started_at: previous.started_at })
    const next = { schema: 4, scope, chat_id: previous?.chat_id || '', title: frozen.title, event: frozen.event || '', started_at: cycle.started_at, k, cycle, history: history.slice(0, 50) }
    const receipt = await storage.durableWrite(key, next, version ? { ifMatch: version } : { ifNoneMatch: true })
    if (receipt?.durability !== 'synced') return { ok: false, error: 'This start was not saved online. Sync before trying again.' }
    return { ok: true, scope, k, cid: cycle.cid, action: frozen }
  } catch {
    return { ok: false, error: 'Project work changed in another view or could not be saved. Sync and try again.' }
  }
}

// The authoritative current cycle, read online immediately before any
// delivery. Throws when it cannot be read online.
export async function loadCurrentCycle(projectKey) {
  const storage = window.mobius?.storage
  if (!storage?.getWithVersion) throw new Error('Safe cycle starts are unavailable in this Möbius version.')
  const { value, offline } = await storage.getWithVersion(await cycleKey(projectKey))
  if (offline) throw new Error('Reconnect before sending.')
  return { k: cycleNumber(value), cycle: normalizeCycle(value?.cycle), chat_id: typeof value?.chat_id === 'string' ? value.chat_id : '' }
}

// Update cycle k's own facts (the conversation it went to, whether its model
// was applied, whether it was delivered) only while k is still current.
export async function updateCurrentCycle(projectKey, k, cid, facts = {}) {
  const storage = window.mobius?.storage
  try {
    const key = await cycleKey(projectKey)
    const { value, version, offline } = await storage.getWithVersion(key)
    if (offline || !version || cycleNumber(value) !== k || value?.cycle?.cid !== cid) return false
    const cycle = { ...value.cycle }
    if (facts.chatId) cycle.chat_id = String(facts.chatId)
    if (facts.modelApplied) cycle.model_applied = true
    if (facts.delivered) cycle.delivered = true
    if (facts.attempted) cycle.attempted = true
    if (facts.closed) cycle.closed = true
    const next = { ...value, ...(facts.delivered && facts.chatId ? { chat_id: String(facts.chatId) } : {}), cycle }
    const receipt = await storage.durableWrite(key, next, { ifMatch: version })
    return receipt?.durability === 'synced'
  } catch { return false }
}

const SETTINGS_FILE = 'settings.json'
const DEFAULT_APP_SETTINGS = Object.freeze({
  autopilot_default: true,
  submission_method: 'github',
  new_pr_stage: DEFAULT_STAGE,
})
// Older builds kept one app-wide agent model here. Each launch now carries its
// own model choice (none means the chat default), so these keys are retired.
// `review_agent` is not their return: it is only where a Review, Re-review or
// Fix window starts. That window still sends its own choice for its own run.
const RETIRED_SETTINGS = ['agent_provider', 'agent_model', 'agent_effort']

export function normalizeAppSettings(raw) {
  const kept = raw && typeof raw === 'object'
    ? Object.fromEntries(Object.entries(raw).filter(([key]) => !RETIRED_SETTINGS.includes(key)))
    : {}
  const { review_agent: savedAgent, ...others } = kept
  const reviewAgent = boundedAgent(savedAgent)
  return { ...DEFAULT_APP_SETTINGS, ...others, submission_method: 'github', new_pr_stage: stageOf(others.new_pr_stage), ...(reviewAgent ? { review_agent: reviewAgent } : {}) }
}

// App-level preferences (not per-contribution): publication and Autopilot.
// Missing/unreadable → defaults. Any explicit save writes the normalized copy,
// which drops the retired app-wide model keys.
export async function loadAppSettings() {
  try {
    const raw = await window.mobius.storage.get(SETTINGS_FILE)
    if (raw && typeof raw === 'object' && RETIRED_SETTINGS.some(key => key in raw)) await clearRetiredSettings()
    return normalizeAppSettings(raw)
  } catch {
    return normalizeAppSettings(null)
  }
}

// Remove the retired keys with a versioned compare-and-set on the copy read
// at that moment, never a blind write: a settings save that lands in between
// changes the version, and the retry keeps that newer value. Best effort; a
// later explicit save drops the keys anyway.
async function clearRetiredSettings(attempts = 3) {
  const storage = window.mobius.storage
  if (typeof storage?.getWithVersion !== 'function' || typeof storage?.durableWrite !== 'function') return
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { value, version, offline } = await storage.getWithVersion(SETTINGS_FILE)
      if (offline || !version || !value || typeof value !== 'object' || !RETIRED_SETTINGS.some(key => key in value)) return
      const cleaned = Object.fromEntries(Object.entries(value).filter(([key]) => !RETIRED_SETTINGS.includes(key)))
      await storage.durableWrite(SETTINGS_FILE, cleaned, { ifMatch: version })
      return
    } catch (error) {
      if (error?.code !== 'conflict' && error?.status !== 412) return
    }
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
  // blind-write fallback.
  const readVersioned = versionedReader(s)
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
