// The desk's last-known copy: what GitHub said about the owner's PRs and review requests, which repositories are
// theirs, and where each review stood, as the last full sync found them. The next visit shows it at once and
// updates it quietly. The saved feed (storage.js) and the project snapshot (source cache) are the other two
// parts of the copy; this file has its own writer (index.jsx, once the open reads have answered), so no two
// writers ever replace one another's file.

import { PR_FIELDS_STAMP } from './api.js'

const DESK_COPY = 'desk-cache.json'
// The PRs of the copy were read with the fields PR_FIELDS_STAMP names. A copy written with others (a later version asks for
// more) is not shown: its rows would lack what the desk now reads, so that visit opens like a first one and saves a fresh copy.
// The reviews the Agent runs view lists, in the states that say where a PR stands. A row still being read, or one GitHub
// could not read, is no last-known state.
const KNOWN_BUCKETS = new Set(['waiting', 'running', 'stalled', 'done'])

// What one Agent runs row keeps of a classified review: exactly what the desk and its rows read (ui/ReviewsView.jsx
// ReviewRow, desk.js needsRows), so the copy never carries the run's documents or the PR's full read.
export function slimReviewRow(entry) {
  if (!entry?.run || !KNOWN_BUCKETS.has(entry.bucket)) return null
  const { id, at, bucket, confirm, chips, item, run, pull, decision } = entry
  return {
    id, at, bucket, confirm: !!confirm, chips,
    item: { repo: item.repo, number: item.number, title: item.title || '' },
    run: { created_at: run.created_at },
    pull: { state: pull?.state, isDraft: pull?.isDraft, author: { login: pull?.author?.login } },
    decision: decision ? { state: decision.state, turn: decision.turn, role: decision.role, next: decision.next, label: decision.label } : undefined,
  }
}

// A PR that is over (merged or closed) stands as its state says whatever else GitHub holds about it, so the next
// visit keeps only what a desk row reads of it and the change probe compares (review-list.js pullSignature). That
// is enough to show it, and a probe that finds it unmoved leaves it unread: a long review history is mostly PRs
// that are over, and they are most of what a full read costs.
export function settledPulls(pulls) {
  return [...pulls.values()].filter(pr => pr.state === 'MERGED' || pr.state === 'CLOSED').map(pr => ({
    number: pr.number, title: pr.title, url: pr.url, state: pr.state, isDraft: pr.isDraft, updatedAt: pr.updatedAt,
    headRefOid: pr.headRefOid, headRefName: pr.headRefName, baseRefName: pr.baseRefName,
    author: { login: pr.author?.login }, repository: { nameWithOwner: pr.repository?.nameWithOwner },
  }))
}

// A copy is read from a file the app wrote, but an older version or a damaged write must never break a screen: only whole items stay.
const isPull = pr => !!pr && Number.isInteger(pr.number) && typeof pr.repository?.nameWithOwner === 'string' && typeof pr.url === 'string'
const isSettledPull = pr => !!pr && Number.isInteger(pr.number) && typeof pr.repository?.nameWithOwner === 'string' && typeof pr.state === 'string'
const isRow = row => !!row && typeof row.id === 'string' && Number.isInteger(row.item?.number) && typeof row.item?.repo === 'string' && Array.isArray(row.chips)
const wholeItems = (list, valid) => (Array.isArray(list) ? list.filter(valid) : null)

export function normalizeDeskCopy(raw) {
  if (!raw || typeof raw !== 'object' || raw.pr_fields !== PR_FIELDS_STAMP || typeof raw.login !== 'string' || !raw.login) return null
  const incoming = wholeItems(raw.incoming, isPull), reviewRows = wholeItems(raw.review_rows, isRow)
  if (typeof raw.synced_at !== 'string' || !incoming || !reviewRows) return null
  const repositories = raw.repositories && Array.isArray(raw.repositories.repositories) ? raw.repositories : { repositories: [], hasNextPage: false }
  return { login: raw.login, syncedAt: raw.synced_at, incoming, repositories, reviewRows, reviewPulls: wholeItems(raw.review_pulls, isSettledPull) || [] }
}

export async function loadDeskCopy() {
  try {
    return normalizeDeskCopy(await window.mobius.storage.get(DESK_COPY))
  } catch {
    return null
  }
}

// Writes only what changed: the open writes it once its reads answered and again when a later read moved something.
let lastSaved = ''
export async function saveDeskCopy({ login, syncedAt, incoming, repositories, reviewRows, reviewPulls }) {
  const copy = {
    schema: 1, pr_fields: PR_FIELDS_STAMP, login, synced_at: syncedAt, incoming,
    repositories: { repositories: repositories.repositories, hasNextPage: !!repositories.hasNextPage },
    review_rows: reviewRows, review_pulls: reviewPulls,
  }
  const text = JSON.stringify(copy)
  if (text === lastSaved) return false
  try {
    await window.mobius.storage.set(DESK_COPY, copy)
    lastSaved = text
    return true
  } catch {
    return false
  }
}
