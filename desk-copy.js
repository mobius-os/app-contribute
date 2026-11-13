// The desk's last-known copy: what GitHub said about the owner's PRs and review requests, which repositories are
// theirs, and where each review stood, as the last full sync found them. The next visit shows it at once and
// updates it quietly. The saved feed (storage.js) and the project snapshot (source cache) are the other two
// parts of the copy; this file has its own writer (index.jsx, once the open reads have answered), so no two
// writers ever replace one another's file.

const DESK_COPY = 'desk-cache.json'
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

const isList = value => Array.isArray(value)

export function normalizeDeskCopy(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.login !== 'string' || !raw.login) return null
  if (typeof raw.synced_at !== 'string' || !isList(raw.incoming) || !isList(raw.review_rows)) return null
  const repositories = raw.repositories && isList(raw.repositories.repositories) ? raw.repositories : { repositories: [], hasNextPage: false }
  return { login: raw.login, syncedAt: raw.synced_at, incoming: raw.incoming, repositories, reviewRows: raw.review_rows }
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
export async function saveDeskCopy({ login, syncedAt, incoming, repositories, reviewRows }) {
  const copy = {
    schema: 1, login, synced_at: syncedAt, incoming,
    repositories: { repositories: repositories.repositories, hasNextPage: !!repositories.hasNextPage },
    review_rows: reviewRows,
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
