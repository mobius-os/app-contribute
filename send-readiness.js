// One readiness model for every Send surface: which publication unit owns a
// record, whether its next phase can be sent now, and why not. Pure; the
// guarded Send handlers in index.jsx remain the only publication path.
import { uncertainPublication } from './domain.js'
import { regionsOf } from './lifecycle-record.js'
import { leadingReason, qualityReviewFor, reviewCheckBlocker, reviewStateFor } from './review.js'
import { publicationStackUnit, stackIntent, stackPublicationRecords, stackReadiness } from './stack.js'

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

// The PR a record became, only when its saved URL is exactly that PR.
export function publishedPull(record) {
  const repo = record?.plan?.repo || record?.repo || ''
  const number = Number(record?.number)
  return REPO.test(repo) && Number.isSafeInteger(number) && number > 0
    && record?.url === `https://github.com/${repo}/pull/${number}` ? { number, url: record.url } : null
}

// Where a record stands, in the words of the lifecycle regions, never the status word: an update
// waiting on a public PR reads `prepared` there, and an update stranded by a merge reads `merged`.
// Every ledger record has a type; one without is read as the pull request these surfaces are about.
const regionsFor = record => regionsOf(record?.type ? record : { type: 'pr', ...record })
export const publicationStateOf = record => regionsFor(record)?.publication ?? null
// The PR merged or closed before the update went out. It is not a send that went out, whatever
// the PR's own state says.
export const isStranded = record => regionsFor(record)?.update === 'STRANDED_UPDATE'
// Replaced by other work: the card follows `superseded_by` to the current version.
export const isSuperseded = record => publicationStateOf(record) === 'SUPERSEDED'
const PUBLIC_PULLS = ['DRAFT', 'OPEN', 'QUEUED', 'MERGED', 'MERGED_ELSEWHERE', 'ORPHANED', 'CLOSED', 'CLOSED_QUIET']
// A public PR with an exact receipt and no update of its own still to go out: an update that is
// waiting, being sent, unconfirmed or stranded is not a send that has happened.
export function isPublished(record) {
  const found = regionsFor(record)
  return Boolean(found) && PUBLIC_PULLS.includes(found.publication) && found.update === 'NONE' && Boolean(publishedPull(record))
}

// The update was dropped, not sent: the PR is public with nothing waiting, and the last thing that
// happened to its update region (the history in `lifecycle`, whether the engine wrote it or read it
// from an abandoned word) was the owner discarding it. A record with no such entry reads as before.
export function isDroppedUpdate(record) {
  const last = (regionsFor(record)?.vector.history || []).filter(entry => entry.region === 'update' && !entry.refused).at(-1)
  return isPublished(record) && last?.type === 'DISCARD_UPDATE'
}

// What a published PR is called on a card: one word per publication state, so "merged" means the PR
// merged into the default branch and nothing else (a merge into another branch, or an update that
// went out, is not it). Each card maps these keys to its own pill.
const PULL_KEYS = { DRAFT: 'draft', OPEN: 'open', QUEUED: 'open', MERGED: 'merged', MERGED_ELSEWHERE: 'merged_elsewhere',
  ORPHANED: 'orphaned', CLOSED: 'closed', CLOSED_QUIET: 'closed' }
export const pullKey = record => PULL_KEYS[publicationStateOf(record)] || ''
export const closedUnmerged = record => pullKey(record) === 'closed'
// The pill of a stranded update: which way its PR ended first.
export const strandedPill = record => (closedUnmerged(record) ? 'PR closed first' : 'PR merged first')

export const needsSourceRefresh = reviewState => reviewState?.state === 'needs_refresh'
export const sendNeedsAttention = record => Boolean(record?.last_submit_error) || record?.needs_attention === true
export const reviewIncomplete = record => qualityReviewFor(record).state !== 'all_clear'

// Why one prepared record cannot be sent now, or '' when it can. Chat cards
// pass `requireCheck`: without a current positive source check they fail closed.
export function sendBlocker(record, reviewState, { requireCheck = false } = {}) {
  if (!record) return 'This contribution is no longer in Contribute.'
  if (record.status !== 'prepared') {
    if (isStranded(record)) return 'The pull request ended before this update went out, so it cannot be sent.'
    // An abandoned update whose pull request is still public reads as that live PR, so it was not dismissed.
    return publicationStateOf(record) === 'ABANDONED' ? 'This contribution was dismissed.' : 'This contribution is not waiting to be sent.'
  }
  if (!['pr', 'pr_update'].includes(record.plan?.action)) return 'Only pull requests can be sent from here.'
  if (needsSourceRefresh(reviewState)) return 'The reviewed source changed. Sync Contribute to read it again.'
  // The last send may already be public: it stays locked until observed.
  if (uncertainPublication(record)) return 'GitHub has not confirmed the last send yet.'
  if (sendNeedsAttention(record)) return 'The last send needs attention in Contribute.'
  if (reviewIncomplete(record)) return 'This exact version needs review first.'
  const unchecked = reviewCheckBlocker(reviewState)
  if (unchecked) return unchecked
  if (requireCheck && reviewState?.state !== 'ready') return 'This contribution needs a current source check in Contribute.'
  return ''
}

// The unit that owns one record: the record itself, or its complete stack,
// whose next ready phase one request sends in layer order.
export function publicationUnit(record, records, reviewStatus, options) {
  const blocker = rec => sendBlocker(rec, reviewStateFor(rec, reviewStatus), options)
  if (stackIntent(record).kind === 'standalone') {
    const reason = isPublished(record) ? '' : blocker(record)
    return { key: `record:${record.id}`, stack: false, records: [record], ready: !reason && record.status === 'prepared' ? [record] : [], reason }
  }
  const unit = publicationStackUnit(record, records)
  const readiness = stackReadiness(unit)
  const phase = readiness.ok ? stackPublicationRecords(unit) : []
  const reason = readiness.ok ? leadingReason(phase.map(blocker)) : readiness.code === 'settled' ? '' : readiness.message
  // `stackCode` says why a stack cannot be sent as a whole (stack.js
  // stackReadiness: incomplete, invalid, restack, refresh), '' when it can.
  return { key: `stack:${unit.id}`, stack: true, records: unit.records, ready: reason ? [] : phase, reason,
    stackCode: readiness.ok || readiness.code === 'settled' ? '' : readiness.code }
}

// Distinct units for the named records. Several layers of one stack share one.
export function publicationUnits(ids, records, reviewStatus, options) {
  const byId = new Map((records || []).map(record => [record.id, record]))
  const units = new Map()
  for (const id of ids) {
    const record = byId.get(id)
    const unit = record ? publicationUnit(record, records, reviewStatus, options)
      : { key: `record:${id}`, stack: false, records: [], ready: [], reason: 'This contribution is no longer in Contribute.' }
    if (!units.has(unit.key)) units.set(unit.key, unit)
  }
  return [...units.values()]
}

// The records whose review status a chat card must ask for: the records it
// names plus every prepared layer of their stacks, because a stack's next
// phase is checked as a whole and the server answers only addressed records.
// Bounded by the server's per-request limit.
export const REVIEW_ADDRESS_LIMIT = 50
export function reviewAddressFor(ids, records) {
  const named = [...new Set(ids || [])]
  const addressed = new Set(named)
  const byId = new Map((records || []).map(record => [record.id, record]))
  for (const id of named) {
    const record = byId.get(id)
    const unit = record ? publicationStackUnit(record, records) : null
    for (const member of unit?.records || []) if (member.status === 'prepared') addressed.add(member.id)
  }
  return [...addressed].slice(0, REVIEW_ADDRESS_LIMIT)
}

// Chat sends only with the platform binding the confirmed snapshot, checked at
// the moment of the write: if the binding disappeared after Confirm (for
// example a connection refresh against an older Möbius), or the record would
// go through the relay, which cannot bind it, nothing is sent.
export function writeBindingRefusal({ requireBinding = false, frozenBinding = false, relay = false } = {}) {
  if (!requireBinding || (frozenBinding === true && !relay)) return null
  return {
    notAttempted: true,
    error: 'This Möbius no longer confirms the exact version you approved, so nothing was sent. Open Contribute to send it.',
    failure: { owner: 'owner', code: 'binding_unavailable' },
  }
}
