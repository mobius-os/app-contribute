// The repositories' last-known lists: the first page of open PRs of each repository the owner has looked at or
// that is read in the background, as the last read found them. The next visit opens a repository from its list at once
// and updates it quietly. One file, with its own writer (the desk copy, desk-copy.js, is another), read whole.
import { PR_FIELDS_STAMP } from './api.js'
import { repositoryName } from './collaboration.js'

const LISTS_COPY = 'repository-lists.json'
// The lists of the repositories read most recently. A list is at most one page (50 PRs, about 3 KB each as kept), so
// the file stays near a quarter of a megabyte for an owner with many repositories.
export const MAX_SAVED_LISTS = 12
// What a review's text becomes in the copy when it had any: the list reads a review's words only to know whether it
// has some (pr-facts.js reviewWords), and the texts were 60% of what a list read returns.
const WORDS_KEPT = '…'

// A PR as the copy keeps it: whole, except for the text of each person's latest review (see WORDS_KEPT). Every row,
// the PR machine and each action read it exactly as from the full read.
export function slimPull(pr) {
  const reviews = pr.latestReviews
  if (!Array.isArray(reviews?.nodes)) return pr
  return { ...pr, latestReviews: { ...reviews, nodes: reviews.nodes.map(node => (node && 'body' in node ? { ...node, body: node.body?.trim() ? WORDS_KEPT : '' } : node)) } }
}

// A copy is read from a file the app wrote, but an older version or a damaged write must never break a screen: only whole items stay.
const isFullPull = pr => !!pr && Number.isInteger(pr.number) && typeof pr.url === 'string' && typeof pr.headRefOid === 'string'
  && typeof pr.repository?.nameWithOwner === 'string' && !pr.titlesOnly
const count = value => (Number.isInteger(value) && value >= 0 ? value : 0)
const moment = value => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '')

function normalizeList(raw) {
  const repo = repositoryName(raw?.repo)
  const syncedAt = moment(raw?.synced_at)
  if (!repo || !syncedAt || !Array.isArray(raw.pulls)) return null
  const pulls = raw.pulls.filter(isFullPull)
  // A next page needs the cursor that opens it; without it the list says it is the whole of what it holds.
  const hasNextPage = raw.has_next_page === true && typeof raw.end_cursor === 'string' && !!raw.end_cursor
  return { repo, syncedAt, openedAt: moment(raw.opened_at), pulls, total: Math.max(count(raw.total), pulls.length), hasNextPage, endCursor: hasNextPage ? raw.end_cursor : null }
}

// The copy as the store restores it, or null when it is not one this version trusts: written with other PR fields, or
// without an account. `login` says whose lists they are; the caller drops them when another account is signed in.
export function normalizeListCopy(raw) {
  if (!raw || typeof raw !== 'object' || raw.pr_fields !== PR_FIELDS_STAMP || typeof raw.login !== 'string' || !raw.login || !Array.isArray(raw.lists)) return null
  return { login: raw.login, lists: raw.lists.map(normalizeList).filter(Boolean) }
}

export async function loadListCopy() {
  try {
    return normalizeListCopy(await window.mobius.storage.get(LISTS_COPY))
  } catch {
    return null
  }
}

// The lists worth keeping, newest first and at most MAX_SAVED_LISTS: those read last. `lists` are
// { repo, syncedAt, openedAt, total, hasNextPage, endCursor, pulls } with full PRs only.
export const listsToKeep = lists => [...lists].sort((a, b) => Date.parse(b.syncedAt) - Date.parse(a.syncedAt)).slice(0, MAX_SAVED_LISTS)

// The file as it is written. Its text says whether anything moved since the last write (ui/useBackgroundLists.js).
export const listCopyOf = ({ login, lists }) => ({
  schema: 1, pr_fields: PR_FIELDS_STAMP, login,
  lists: listsToKeep(lists).map(list => ({
    repo: list.repo, synced_at: list.syncedAt, opened_at: list.openedAt || null, total: list.total,
    has_next_page: list.hasNextPage, end_cursor: list.endCursor, pulls: list.pulls.map(slimPull),
  })),
})

// Whether it was saved; a runtime that cannot save one is no failure.
export async function saveListCopy(copy) {
  try {
    await window.mobius.storage.set(LISTS_COPY, copy)
    return true
  } catch {
    return false
  }
}
