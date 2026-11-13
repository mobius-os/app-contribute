// The Checks tab's rows: GitHub's check runs and commit statuses read as one list, sorted by what needs the owner
// (failing, then running, then passed, then skipped). Pure, so every edge state is tested without a browser.
//
// What counts as passing is the PR list's own rule (`checkSummary` in collaboration.js): skipped and neutral runs
// pass, anything failed or cancelled fails, and what is left is still pending. A check GitHub has not settled, or
// one with a result this list does not know, is never counted as passed.
import { FAILING_CHECKS, PASSING_CHECKS } from './collaboration.js'
import { CHECK_RESULT_WORDS, CHECK_STATE_WORDS } from './names.js'

// The order the tab shows its groups, and the chips' order.
export const CHECK_STATES = ['failing', 'running', 'passed', 'skipped']
// Passed and skipped rows fold when there are many; a failing or running check is never hidden.
const FOLDING = new Set(['passed', 'skipped'])
const FOLD_SHOWN = 3

// A check run reports its status until it completes, then its conclusion; a commit status (it has a `context`)
// reports one state. Both are GitHub's lowercase words for what the rollup counts in capitals.
const verdictOf = item => String((item.context != null ? item.state : item.status === 'completed' ? item.conclusion : item.status) ?? '')
const toState = verdict => {
  const upper = verdict.toUpperCase()
  if (FAILING_CHECKS.has(upper)) return 'failing'
  if (upper === 'SUCCESS') return 'passed'
  return PASSING_CHECKS.has(upper) ? 'skipped' : 'running'
}

// How long a finished check took, or null when GitHub gave no usable start and end. A skipped check
// "took" nothing, so it has no time.
const durationOf = (item, state) => {
  const span = Date.parse(item.completed_at) - Date.parse(item.started_at)
  return state !== 'running' && state !== 'skipped' && Number.isFinite(span) && span >= 0 ? span : null
}

// When a row says its time: a running check says when it started, a finished one how long it took (or, with no start
// and end to measure, when GitHub last reported it). A queued, waiting or skipped check has no time worth saying.
const whenOf = (item, state, verdict, duration) => {
  if (state === 'running') return verdict === 'in_progress' && item.started_at ? { at: item.started_at, prefix: 'started ' } : null
  const at = item.completed_at || item.updated_at
  return state === 'skipped' || duration !== null || !at ? null : { at, prefix: '' }
}

// One row per check. `verdict` is GitHub's own word for the result, which `resultWord` says in the row.
export function checkRow(item) {
  const verdict = verdictOf(item)
  const state = toState(verdict)
  const duration = durationOf(item, state)
  return { key: `${item.context != null ? 'status' : 'run'}:${item.id}`, name: item.name || item.context || 'Unnamed check', state, verdict,
    link: item.details_url || item.target_url || item.html_url || '', detail: item.output?.title || item.description || '', why: item.why || null,
    duration, when: whenOf(item, state, verdict, duration) }
}

export const checkRows = data => (data?.groups || []).flatMap(group => group.items || []).map(checkRow)

// How many checks are in each state, `passing` being passed and skipped together (the tab's "18/20").
export function checkCounts(rows) {
  const counts = { all: rows.length, ...Object.fromEntries(CHECK_STATES.map(state => [state, rows.filter(row => row.state === state).length])) }
  return { ...counts, passing: counts.passed + counts.skipped }
}

// The groups the tab draws for a filter ('all' or one state): empty ones are left out, names read in order.
export function checkGroups(rows, filter = 'all') {
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })
  return CHECK_STATES.filter(state => filter === 'all' || filter === state)
    .map(state => ({ state, rows: rows.filter(row => row.state === state).sort(byName) }))
    .filter(group => group.rows.length)
}

// A long passed or skipped group shows its first few rows. A fold that would hide a single row is not worth a button.
export const foldsAt = (state, count) => FOLDING.has(state) && count > FOLD_SHOWN + 1
export const foldedRows = (group, open) => (open || !foldsAt(group.state, group.rows.length) ? group.rows : group.rows.slice(0, FOLD_SHOWN))

// "1 running · 12 passed · 6 skipped": only the states that have checks, in the order of the groups.
export const countWords = counts => CHECK_STATES.filter(state => counts[state]).map(state => `${counts[state]} ${CHECK_STATE_WORDS[state].toLowerCase()}`).join(' · ')

// The word on a row: GitHub's own result for that check.
export const resultWord = row => CHECK_RESULT_WORDS[row.verdict] || CHECK_RESULT_WORDS.pending

// "6m 03s", "48s", "1h 02m".
export function durationWords(ms) {
  const seconds = Math.round(ms / 1000)
  const pad = value => String(value).padStart(2, '0')
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${pad(seconds % 60)}s` : `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}
