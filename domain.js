// Pure logic for the Contribute feed: ledger grouping, headline counts, the
// batched live-refresh query, and display formatting. No React, no I/O.
//
// Ledger records live one JSON file per contribution under contributions/.
// The agent writes them from chat turns; the daily job.sh persists live
// GitHub state back into them; this app writes two things of its own — the
// offline feed cache and the Dismiss CAS flip (storage.js). Shape:
//   { id, type: pr|issue|issue_comment|discussion_comment, repo, number?,
//     url?, title, status: prepared|submitting|draft|open|landing|merged|
//     superseded|closed|commented|abandoned, branch?, chat_id?, created_at, updated_at,
//     summary, last_submit_error?, last_pushed_branch_url?,
//     needs_attention?, attention?, plan? }
// A prepared record staged for review carries `plan`: { action, repo,
// target_url?, title?, body_draft, branch?, repo_path?, base_sha?,
// head_sha?, diff_sha256?, diff_stat, diff_excerpt?(legacy, unused) } — the
// review card renders its file list from the sibling storage file
// contributions/<id>.diff, and falls back to parsing diff_stat when that
// blob is missing, so diff_stat is the one diff field it always needs.
// `submitting` means the platform submit endpoint claimed the record (in
// flight); `landing` is the atomic green-stack claim; `commented` is the
// terminal status for comment actions.

import { stackMeta } from './stack.js'

export const TYPE_LABELS = {
  pr: 'Pull request',
  issue: 'Issue',
  issue_comment: 'Issue comment',
  discussion_comment: 'Discussion comment',
}

export const STATUS_LABELS = {
  prepared: 'Ready',
  submitting: 'Publishing',
  landing: 'Landing',
  draft: 'Draft',
  open: 'Sent',
  merged: 'Merged',
  superseded: 'Already shared',
  closed: 'Not merged',
  commented: 'Commented',
  // Status VALUE stays `abandoned` (the platform ledger contract); the owner
  // sees the reversible destination rather than internal lifecycle wording.
  abandoned: 'In History',
}

// Plain-language narration for the lifecycle state the owner actually sees.
// STATUS_LABELS stays the short, color-coded chip token (Ready, Sent, Merged);
// this is the human sentence that leads the card — it sets a non-technical
// owner's expectations (how long a step takes, what a settled state means).
// The Git vocabulary stays available in detail views, never as the headline.
export const STATUS_NARRATION = {
  prepared: 'Waiting for your OK',
  submitting: 'Publishing — this can take up to a minute',
  landing: 'Landing the verified stack — this can take up to a minute',
  draft: 'Sent as a draft — maintainers review it once it is marked ready',
  open: 'Sent — maintainers will review it; this can take days',
  merged: 'Merged — this improvement is now shared with everyone',
  superseded: 'Superseded — the improvement reached main through another contribution',
  closed: 'Not merged — see GitHub for details',
  commented: 'Comment posted',
  abandoned: 'Moved to History — restore it anytime',
}

// A record flagged needs_attention leads with the attention callout instead of
// its lifecycle narration. The most common cause is a failed automated check,
// so that is the callout's default headline/detail when the platform did not
// send a more specific reason.
export const ATTENTION_HEADLINE = 'Automated tests flagged something'
export const ATTENTION_DETAIL = 'Your agent can look and sort it out.'

// The one human line for a record's current lifecycle state. Returns '' for a
// needs_attention record — the attention callout owns that state's copy — and
// for any unknown future status, so the caller simply omits the line.
export function statusNarration(rec) {
  if (!rec || typeof rec !== 'object' || rec.needs_attention) return ''
  return STATUS_NARRATION[rec.status] || ''
}

// Backend problem codes → one short, human headline. The review-status and
// submit endpoints tag every blocking problem with a stable `code`; the raw
// message is Git jargon (a moved ref, a diff-hash mismatch, a diverged fork).
// The card leads the alert with this headline and keeps the raw message behind
// a Details disclosure. An unmapped code returns '' so the caller falls back to
// the raw message (lenient read — a new backend code still shows something).
// Keys mirror the exact `code=` set `_review_status_problem` emits in the
// platform's routes/github.py (verified 2026-07-16); a key that the backend
// never emits is dead copy, and a real code without a key silently loses its
// friendly headline. Re-verify against that file when adding entries.
export const PROBLEM_HEADLINES = {
  upstream_conflict: 'New upstream changes overlap this contribution',
  branch_moved: 'This changed since you reviewed it — ask your agent to refresh it',
  review_changed: 'This was edited after you reviewed it — ask your agent to refresh it',
  diff_mismatch: 'What you reviewed no longer matches what would be sent — ask your agent to refresh it',
  working_changes: 'Unsaved local edits are in the way — your agent can tidy them up',
  invalid_ancestry: 'This change no longer lines up with its base — ask your agent to refresh it',
  parent_merged: 'An earlier change in this chain was merged — ask your agent to refresh this one',
  invalid_stack: 'This chain of changes is out of order — your agent can restage it',
  missing_checkout: 'The prepared files for this change are missing — your agent can restage it',
  invalid_checkout: 'The prepared files can no longer be verified — your agent can restage it',
  missing_coauthor: 'The prepared commit is missing its agent marker — your agent can restage it',
  missing_diff: 'The reviewed change is incomplete — your agent can restage it',
  missing_diff_hash: 'The reviewed change is incomplete — your agent can restage it',
  invalid_plan: 'The prepared review is incomplete — your agent can restage it',
  review_unavailable: 'This review could not be verified — ask your agent to check it',
  // Autopilot attention types (see autopilot.js). human_required is the only
  // one that interrupts the owner; merge_conflict also needs an owner because
  // resolving it rewrites published history outside the current grant.
  human_required: 'Autopilot needs your input to continue',
  merge_conflict: 'This contribution needs a refresh to merge cleanly',
}

export function problemHeadline(code) {
  if (typeof code !== 'string' || !code) return ''
  return PROBLEM_HEADLINES[code] || ''
}

// Reconcile server/storage results into the current ledger without losing the
// enumerated storage path needed by later CAS writes. Keeping this pure makes
// the app's render state, callback mirror, and offline cache share one update.
export function mergeRecordUpdates(records, updates) {
  const list = Array.isArray(updates) ? updates : [updates]
  const byId = new Map(list.filter(Boolean).map((rec) => [rec.id, rec]))
  if (byId.size === 0) return records
  return records.map((rec) => {
    const update = byId.get(rec.id)
    return update ? { ...update, path: rec.path } : rec
  })
}

// Resolve the ambiguous result of a public submit whose browser response was
// lost. The durable ledger is the authority: a successful server action has
// already advanced the row, while a rejected action has persisted its blocker.
// Never guess from the network error and never invite a blind retry.
export function resolveUncertainSubmission(rec, ledger) {
  if (!rec?.id || ledger?.fromCache || !Array.isArray(ledger?.records)) {
    return { state: 'unconfirmed', record: null }
  }
  const stored = ledger.records.find((candidate) => candidate?.id === rec.id)
  if (!stored) return { state: 'unconfirmed', record: null }
  if (['submitting'].includes(stored.status)) {
    return { state: 'publishing', record: stored }
  }
  if (['draft', 'open', 'merged', 'closed'].includes(stored.status)) {
    return { state: 'published', record: stored }
  }
  if (stored.status === 'prepared' && stored.last_submit_error) {
    return { state: 'blocked', record: stored }
  }
  return { state: 'unchanged', record: stored }
}

export function resolveUncertainLanding(records, ledger) {
  if (!Array.isArray(records) || records.length === 0 || ledger?.fromCache ||
      !Array.isArray(ledger?.records)) {
    return { state: 'unconfirmed', records: [] }
  }
  const ids = new Set(records.map((rec) => rec?.id).filter(Boolean))
  const stored = ledger.records.filter((rec) => ids.has(rec?.id))
  if (stored.length !== ids.size) return { state: 'unconfirmed', records: stored }
  if (stored.every((rec) => rec.status === 'merged')) {
    return { state: 'landed', records: stored }
  }
  if (stored.some((rec) => rec.status === 'landing')) {
    return { state: 'landing', records: stored }
  }
  if (stored.every((rec) => rec.status === 'open') &&
      stored.some((rec) => rec.last_land_error)) {
    return { state: 'blocked', records: stored }
  }
  return { state: 'unchanged', records: stored }
}

// An unchanged prepared row is not conclusive immediately after a lost POST:
// the request may still be waiting to claim the record. Give the follow-up
// ledger read its bounded retry before deciding that the result is unknown.
export function isSubmissionResolutionSettled(resolution) {
  return ['publishing', 'published', 'blocked'].includes(resolution?.state)
}

// Reduce a single or stacked reconciliation to the owner-facing outcome. Any
// row still `submitting` keeps the whole action in Publishing: it is durable
// enough to suppress a duplicate retry, but it is not evidence that GitHub
// opened a pull request. Only an all-published set may use submitted/opened
// semantics.
export function summarizeSubmissionResolutions(resolutions) {
  const list = Array.isArray(resolutions) ? resolutions : []
  const published = list.filter((item) => item?.state === 'published').length
  const publishing = list.filter((item) => item?.state === 'publishing').length
  const blocked = list.filter((item) => item?.state === 'blocked').length
  const total = list.length
  let state = 'unconfirmed'
  if (publishing > 0) state = 'publishing'
  else if (total > 0 && published === total) state = 'published'
  else if (blocked > 0) state = 'blocked'
  return { state, total, published, publishing, blocked }
}

// A directory rescan is authoritative for which records exist, but its async
// GitHub overlay can finish after a submit/dismiss response has already moved
// one of those records forward in the UI. Preserve the newer in-memory row by
// updated_at so a slow refresh cannot resurrect Ready or Submitting after the
// action has completed. Equal timestamps keep the current row, retaining a
// same-session live GitHub overlay when the stored lifecycle row is unchanged.
export function reconcileLedgerSnapshot(current, snapshot) {
  const currentById = new Map(
    (current || []).filter(Boolean).map((rec) => [rec.id, rec]),
  )
  return (snapshot || []).map((incoming) => {
    const present = currentById.get(incoming.id)
    if (!present) return incoming
    const presentTime = Date.parse(present.updated_at || present.created_at || '') || 0
    const incomingTime = Date.parse(incoming.updated_at || incoming.created_at || '') || 0
    return presentTime >= incomingTime ? present : incoming
  })
}

// Feed groups: Ready to propose (waiting on the owner's go-ahead), Open
// (live on GitHub, or in flight to it — `submitting` sits here because the
// platform has claimed it and it is seconds from public), History (settled:
// merged/superseded/closed/commented/abandoned). An unknown future status lands in
// History so it degrades to visible-but-quiet instead of vanishing.
export function groupRecords(records) {
  const ready = []
  const open = []
  const history = []
  for (const rec of records) {
    if (rec.status === 'prepared') ready.push(rec)
    else if (
      rec.status === 'submitting' ||
      rec.status === 'landing' ||
      rec.status === 'draft' ||
      rec.status === 'open'
    ) open.push(rec)
    else history.push(rec)
  }
  const newestFirst = (a, b) =>
    String(b.updated_at || b.created_at || '').localeCompare(
      String(a.updated_at || a.created_at || ''))
  ready.sort(newestFirst)
  open.sort(newestFirst)
  history.sort(newestFirst)
  return { ready, open, history }
}

export function countStats(records) {
  let merged = 0
  let open = 0
  let ready = 0
  for (const rec of records) {
    if (rec.status === 'merged') merged += 1
    else if (
      rec.status === 'submitting' ||
      rec.status === 'landing' ||
      rec.status === 'draft' ||
      rec.status === 'open'
    ) open += 1  // submitting counts as Open so an in-flight record never vanishes from the tiles
    else if (rec.status === 'prepared') ready += 1
  }
  return { merged, open, ready }
}

// Records whose live GitHub state is worth polling, and the repo one targets —
// shared by the refresh query and the landability overlay below.
const LIVE_STATUSES = ['draft', 'open', 'landing']
const recordRepo = (rec) => rec?.plan?.repo || rec?.repo || ''

// One GraphQL document refreshes every live PR/issue in a single round-trip
// (aliased resource(url:) nodes cost ~1 rate-limit point total). Comments carry
// no meaningful live state, so only pr/issue records participate. Open
// multi-layer stacks additionally probe their repo's landability in the same
// request. Returns null when nothing needs refreshing.
export function buildRefreshQuery(records) {
  const targets = records.filter((rec) =>
    (rec.type === 'pr' || rec.type === 'issue') &&
    LIVE_STATUSES.includes(rec.status) &&
    typeof rec.url === 'string' &&
    rec.url.startsWith('https://github.com/'))
  // Only a live, multi-layer stack can atomically land, so probe landability
  // just for those repos. Everything else lands through GitHub's own merge/queue.
  const stackRepos = [...new Set(targets.filter(stackMeta).map(recordRepo).filter(Boolean))]
  if (targets.length === 0 && stackRepos.length === 0) return null
  // JSON.stringify escapes quotes/backslashes, exactly the GraphQL string
  // escaping a url needs; every node (PR, issue, or repo) uses this one idiom.
  const resourceNode = (alias, url, body) =>
    alias + ': resource(url: ' + JSON.stringify(url) + ') { __typename ' + body + ' }'
  const aliases = {}
  const parts = targets.map((rec, i) => {
    aliases['r' + i] = rec.id
    return resourceNode('r' + i, rec.url,
      '... on PullRequest { state isDraft statusCheckRollup { state } } ... on Issue { state }')
  })
  const repoAliases = {}
  stackRepos.forEach((full, i) => {
    repoAliases['repo' + i] = full
    // refUpdateRule is the viewer's EFFECTIVE rule for the default branch and is
    // readable without admin (unlike branchProtectionRules). Its presence
    // (protection, required checks, or a merge queue) means an atomic
    // fast-forward would bypass repository-owned rules, so we don't offer Land.
    parts.push(resourceNode('repo' + i, 'https://github.com/' + full,
      '... on Repository { viewerPermission defaultBranchRef { refUpdateRule { viewerCanPush } } }'))
  })
  return { query: 'query { ' + parts.join(' ') + ' }', aliases, repoAliases }
}

// A Repository resource() node → whether its stack may be atomically landed
// here: true only when the viewer can push AND the default branch carries no
// update rule an atomic land must not bypass. Anything else (unknown,
// protected, ruled, or unpushable) is false, so the UI fails safe — an unknown
// or unreachable repo never shows a Land button that would only fail.
export function repoLandability(node) {
  if (!node || typeof node !== 'object') return false
  const perm = node.viewerPermission
  if (perm !== 'ADMIN' && perm !== 'MAINTAIN' && perm !== 'WRITE') return false
  const ref = node.defaultBranchRef
  return !!ref && !ref.refUpdateRule
}

// Maps one resource() node to a ledger status. null = no verdict (deleted,
// inaccessible, or an unexpected type) — callers leave the record stale.
// job.sh mirrors this mapping in Python; keep the two in step.
export function liveStatusFor(node) {
  if (!node || typeof node !== 'object') return null
  if (node.__typename === 'PullRequest') {
    if (node.state === 'MERGED') return 'merged'
    if (node.state === 'CLOSED') return 'closed'
    if (node.state === 'OPEN') return node.isDraft ? 'draft' : 'open'
    return null
  }
  if (node.__typename === 'Issue') {
    if (node.state === 'CLOSED') return 'closed'
    if (node.state === 'OPEN') return 'open'
  }
  return null
}

// Overlays fresh GraphQL results onto the record list for display. Never
// mutates the inputs; records without a verdict pass through unchanged.
export function applyLiveStates(records, aliases, data, repoAliases) {
  if (!data) return records
  const liveById = new Map()
  for (const [alias, recId] of Object.entries(aliases)) {
    const status = liveStatusFor(data[alias])
    if (!status) continue
    const node = data[alias]
    const checks = node?.__typename === 'PullRequest'
      ? (node.statusCheckRollup?.state || 'NONE')
      : ''
    liveById.set(recId, { status, checks })
  }
  const landByRepo = new Map()
  if (repoAliases) {
    for (const [alias, full] of Object.entries(repoAliases)) {
      landByRepo.set(full, repoLandability(data[alias]))
    }
  }
  if (liveById.size === 0 && landByRepo.size === 0) return records
  return records.map((rec) => {
    // Repo-level landability overlay: only allocates a new record when the
    // value actually moves, so the caller's === "nothing changed" check holds.
    let base = rec
    if (landByRepo.size > 0) {
      const full = recordRepo(rec)
      if (full && landByRepo.has(full)) {
        const landable = landByRepo.get(full)
        if (rec.land_eligible !== landable) base = { ...rec, land_eligible: landable }
      }
    }
    const live = liveById.get(rec.id)
    if (!live) return base
    const next = live.checks ? { ...base, live_checks_state: live.checks } : base
    // `landing` is a durable public-action journal, not a display overlay. An
    // OPEN verdict can be a momentary GitHub lag after the default ref moved;
    // only a terminal MERGED/CLOSED result may settle the journal here.
    if (base.status === 'landing' && ['open', 'draft'].includes(live.status)) {
      return next
    }
    return live.status !== next.status ? { ...next, status: live.status } : next
  })
}

// The App Store's per-app "Setup" tag reads a shared localStorage record
// keyed by installed app id; each catalog app with `setup.scope: 'app'` owns
// writing its entry when its setup finishes (Reflection does the same).
// Contribute's one setup step is the GitHub connection, so mirror each
// definitive connection verdict into the record: `connected` marks setup
// complete, `disconnected` clears it so the tag truthfully returns after a
// disconnect. Transient states (checking / unknown / unsupported) leave the
// record untouched. `storage` is a localStorage-like object injected by the
// caller; returns true when the record was actually changed. Unparseable
// existing data is a safe no-op (returns false, stored value left alone);
// only parseable-but-wrong-shape data is replaced by a fresh record.
export const SETUP_COMPLETIONS_KEY = 'mobius:setup-complete:v1'

export function syncSetupCompletion(appId, connState, storage) {
  if (appId == null || !storage) return false
  if (connState !== 'connected' && connState !== 'disconnected') return false
  try {
    const parsed = JSON.parse(storage.getItem(SETUP_COMPLETIONS_KEY) || '{}')
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    const id = String(appId)
    if (connState === 'connected') {
      if (data[id]?.completedAt) return false
      data[id] = { completedAt: new Date().toISOString() }
    } else {
      if (!(id in data)) return false
      delete data[id]
    }
    storage.setItem(SETUP_COMPLETIONS_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function timeAgo(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago'
  return new Date(t).toLocaleDateString()
}
