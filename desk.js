// The Desk home: pure logic for the side views, their counts, and the
// per-project grouping the envelopes render. UI stays in ui/Desk.jsx and
// ui/DeskViews.jsx; everything here is testable without a DOM.
import { prKey } from './collaboration.js'
import { attentionListItems } from './run.js'
import { sameLogin } from './domain.js'
import { NAMES } from './names.js'
import { standingFor, waitsOnReviewers } from './pr-standing.js'
import { projectIsQuiet } from './source-map.js'
import { DESK_HISTORY_DAYS } from './storage.js'

// The four views (finding 2). Every other place a PR can be lives inside one of them.
// `short` is the word under the count on the phone's four-segment bar.
export const DESK_VIEWS = [
  { key: 'needs', label: NAMES.needsYou, short: NAMES.needsYou, icon: 'review' },
  { key: 'requests', label: NAMES.reviewRequests, short: 'Requests', icon: 'feedback' },
  { key: 'mine', label: NAMES.myPrs, short: NAMES.myPrs, icon: 'pull' },
  { key: 'runs', label: NAMES.agentRuns, short: NAMES.agentRuns, icon: 'cycle' },
]

// The views that were folded in, by the view that holds their rows now. A saved
// place or an older link to one of them lands there.
export const FOLDED_VIEWS = { confirm: 'needs', edits: 'needs', merged: 'mine', work: 'runs', reviews: 'runs' }
export const deskViewKey = key => FOLDED_VIEWS[key] || key

// The one decision (pr-standing.js) the repository list and the PR page read for a PR, so a desk row says what they say.
// `facts` are what it is decided from besides the PR: the saved reviews, live conversations, answers and set-aside notes.
export const deskStanding = (pr, login, facts = {}) => standingFor({ pr, login, ...facts })

// PRs the owner authored, out of everything GitHub says involves them.
export function authoredPulls(incoming, login) {
  return (incoming || []).filter(pr => !pr.reviewRequested && sameLogin(pr?.author?.login, login))
}

// The quiet "Waiting on others" block under Needs you: your own PRs that have gone to their reviewers and sat there this long.
// It is a reminder, never a number: no badge, chip or sentence counts it (The One Count Rule).
export const WAITING_ON_OTHERS_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000

// The PRs a row of Needs you already stands for (a PR, a feedback card or a review run): the quiet block never repeats one of them.
const needsRowKey = row => row.pr ? pullKey(row.pr) : row.item ? [...feedbackPullKeys([row.item])][0] : `${String(row.entry.item.repo).toLowerCase()}#${row.entry.item.number}`

// Those PRs of one repository, longest wait first, as { pr, decision, days }. Which ones wait on reviewers is the PR machine's word
// (waitsOnReviewers). "Since" is GitHub's updatedAt, the one date the desk already holds that every way a PR goes back to its reviewers
// moves (opened for review, a push, a review request or an ask), so on fresh data the days fall short of the true wait and never run over
// it. No date, no row.
export function waitingOnOthers(project, decisions, login, reviewEntries = [], facts = {}, now = Date.now()) {
  const listed = new Set(projectNeedsRows(project, decisions, login, reviewEntries, facts).map(needsRowKey))
  return authoredPulls(project.incomingReviews, login)
    .filter(pr => !listed.has(pullKey(pr)))
    .map(pr => ({ pr, decision: deskStanding(pr, login, facts), days: Math.floor((now - (Date.parse(pr.updatedAt || '') || now)) / DAY_MS) }))
    .filter(({ decision, days }) => waitsOnReviewers(decision) && days >= WAITING_ON_OTHERS_DAYS)
}

// The first answer of the review requests (api.js fetchOwnPulls) laid over the list as it stood: the PRs that
// concern the owner (asked for their review, or theirs) are replaced by that read, every other stays as it was
// until the full read of the PRs that involve them answers.
export function withOwnerPulls(incoming, owned, login) {
  const concernsOwner = pr => pr.reviewRequested || sameLogin(pr?.author?.login, login)
  return [...owned, ...(incoming || []).filter(pr => !concernsOwner(pr))]
}

// Submitting a review answers its request on GitHub, which then stops listing
// the PR as waiting on the owner. Say so at once instead of at the next read.
export function settleReviewRequest(incoming, repo, number) {
  const key = `${repo.toLowerCase()}#${number}`
  return incoming.map(pr => (pr.reviewRequested && prKey(pr) === key ? { ...pr, reviewRequested: false } : pr))
}

// Group one repository's PRs into base→head chains (a stack) so related work
// reads as one unit. Order inside a chain follows merge order: the PR whose
// base no other PR provides merges first.
export function chainPulls(pulls) {
  const list = (pulls || []).filter(pr => pr?.headRefName)
  const byHead = new Map(list.map(pr => [pr.headRefName, pr]))
  const roots = list.filter(pr => !byHead.has(pr.baseRefName))
  const chained = new Set()
  const groups = []
  for (const root of roots) {
    const chain = [root]
    chained.add(root.headRefName)
    let next = list.find(pr => pr.baseRefName === chain[chain.length - 1].headRefName && !chained.has(pr.headRefName))
    while (next) {
      chain.push(next)
      chained.add(next.headRefName)
      next = list.find(pr => pr.baseRefName === chain[chain.length - 1].headRefName && !chained.has(pr.headRefName))
    }
    groups.push(chain)
  }
  // A cycle (never expected from GitHub) or missing data falls back to singles.
  for (const pr of list) if (!chained.has(pr.headRefName)) groups.push([pr])
  return groups
}

// What merged this recently is the Merged list; storage.js keeps that much history in the desk's own set.
export const MERGED_WINDOW_DAYS = DESK_HISTORY_DAYS

export function mergedRecently(records, now = Date.now()) {
  const cutoff = now - MERGED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  return (records || []).filter(record => ['merged', 'superseded'].includes(record?.status)
    && (Date.parse(record.updated_at || record.created_at || '') || 0) >= cutoff)
}

// A PR's identity across feedback records and the authored-PR list.
export const pullKey = pr => `${String(pr?.repository?.nameWithOwner || '').toLowerCase()}#${pr?.number}`

// PRs that already have a feedback card, so the PR is not listed a second time.
export function feedbackPullKeys(items) {
  return new Set((items || []).map(feedbackPull).filter(Boolean).map(pullKey))
}

export const sameRepo = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

// A review run that waits on you (its result, a draft to send, a question, a stop)
// and is not already a row of its own in Needs you.
const AGENT_WAITS = new Set(['waiting', 'stalled'])
export const agentRunsWaiting = (entries, shownKeys) => (entries || [])
  .filter(entry => AGENT_WAITS.has(entry.bucket) && !shownKeys.has(entry.id))

// Drafts are a quiet line, not a number (deskCounts). A PR GitHub could not be read completely has no step to act on yet.
const QUIET_DRAFTS = new Set(['author.draft', 'author.draft_ready'])
const waitsOnYou = decision => decision.turn === 'you' && !QUIET_DRAFTS.has(decision.state) && decision.state !== 'unknown'

// The Needs you step (the key of a NEEDS_CHIPS chip) a PR's shared decision puts it under: Merge when merging is the next
// step, otherwise Fix on your own PR and Review again on someone else's that you reviewed.
export const stepOf = decision => (decision.next === 'merge' ? 'merge' : decision.role === 'author' ? 'fix' : 'again')

// Everything Needs you lists, as one definition for a project's card, the project's number in the rail and the
// chips (deskCounts), so they cannot disagree. One row per PR or saved decision, in the first of these that holds it:
// a review request (Review), a saved feedback card (To look at), your own PR whose decision waits on you, then a review
// run that waits on you. Your own PRs and the runs sit under the step of their shared decision (stepOf).
export function needsRows({ requests = [], pulls = [], decisions = [], entries = [], login = '', facts = {} }) {
  const items = attentionListItems(decisions)
  const covered = feedbackPullKeys(items)
  const own = authoredPulls(pulls, login).filter(pr => !covered.has(pullKey(pr)))
  const decided = own.map(pr => ({ pr, decision: deskStanding(pr, login, facts) })).filter(({ decision }) => waitsOnYou(decision))
  // A run is left out only when its PR already is a row. The incoming PRs and the review list read GitHub separately, so a PR can
  // read as "waiting on reviewers" here (no row) while the review list's newer read says its review waits on you: that run stays.
  const listed = new Set([...covered, ...requests.map(pullKey), ...decided.map(({ pr }) => pullKey(pr))])
  // A run's own decision, read from the newer PR, is held to the same rule as a PR's: a draft ready to open is a quiet line, not a row.
  const runs = agentRunsWaiting(entries, listed).filter(entry => !entry.decision || waitsOnYou(entry.decision))
  return [
    ...requests.map(pr => ({ step: 'review', pr })),
    ...items.map(item => ({ step: 'look', item })),
    ...decided.map(({ pr, decision }) => ({ step: stepOf(decision), pr, decision })),
    // A Respond conversation has no decision of its own here, and it is always on your own PR.
    ...runs.map(entry => ({ step: entry.decision ? stepOf(entry.decision) : 'fix', entry })),
  ]
}

// A repository's Needs you rows (finding 4); its rail badge is how many there are.
export function projectNeedsRows(project, decisions, login, reviewEntries = [], facts = {}) {
  return needsRows({
    requests: project.reviewRequests || [], pulls: project.incomingReviews || [], decisions, login, facts,
    entries: (reviewEntries || []).filter(entry => sameRepo(entry.item.repo, project.canonical_repo)),
  })
}

export const projectNeedsCount = (...args) => projectNeedsRows(...args).length

// The counts of the Needs you chips: one per next step. The rail badge is their sum
// (needsCount), so the two can never disagree. A PR counts once, under the step of its
// shared decision (needsRows). Drafts ready to open and local files are not urgent:
// they get a quiet line and the project banner, never a number here.
export function deskCounts({ decisions = [], incoming = [], records = [], login = '', reviews = null, reviewEntries = [], runs, chats, responses, ignored } = {}) {
  const facts = { runs, chats, responses, ignored }
  const rows = needsRows({ requests: (incoming || []).filter(pr => pr.reviewRequested), pulls: incoming || [], decisions, entries: reviewEntries, login, facts })
  const inStep = step => rows.filter(row => row.step === step).length
  const pulls = authoredPulls(incoming, login)
  return {
    questions: inStep('look'),
    requests: inStep('review'),
    merge: inStep('merge'),
    fix: inStep('fix'),
    again: inStep('again'),
    drafts: pulls.filter(pr => deskStanding(pr, login, facts).state === 'author.draft_ready').length,
    mine: pulls.length,
    merged: mergedRecently(records).length,
    reviewsRunning: reviews?.running || 0,
    reviewsFinished: reviews?.done || 0,
  }
}

// The Needs you chips, in order; each filters the list below it to its rows.
export const NEEDS_CHIPS = [
  { key: 'look', label: 'To look at', count: counts => counts.questions },
  { key: 'review', label: 'Review', count: counts => counts.requests },
  { key: 'merge', label: 'Merge', count: counts => counts.merge },
  { key: 'fix', label: 'Fix', count: counts => counts.fix },
  { key: 'again', label: NAMES.reviewAgain, count: counts => counts.again || 0 },
]

export const needsCount = counts => NEEDS_CHIPS.reduce((total, chip) => total + chip.count(counts), 0)

// A badge on a view that waits on you is purple and is the sum of that page's
// chips; the others are a quiet total of what the page holds.
export function railBadge(view, counts) {
  switch (view) {
    case 'needs': return needsCount(counts)
    case 'requests': return counts.requests
    case 'mine': return counts.mine
    case 'runs': return counts.reviewsRunning || 0
    default: return 0
  }
}

// A quiet dot on anything that changed since the owner last opened Contribute.
// The timestamp lives in app settings, written once per visit.
export const DESK_LAST_LOOKED_KEY = 'desk_last_looked'

export function newSince(value, lastLooked) {
  const seen = Date.parse(lastLooked || '') || 0
  if (!seen) return false
  const changed = Date.parse(value || '') || 0
  return changed > seen
}

// Feedback about a published PR reads best on the PR itself: its page shows
// the review text in Conversation. Publication decisions keep their card.
export function feedbackPull(item) {
  if (!['public_attention', 'private_review'].includes(item?.kind)) return null
  const record = item?.record
  const repo = record?.plan?.repo || record?.repo
  const number = Number(record?.number)
  if (!repo || !Number.isSafeInteger(number) || number <= 0) return null
  return { number, repository: { nameWithOwner: repo } }
}

// The rail's project groups, in the directory's own order: projects with
// something going on first, quiet apps folded, externals last.
export function splitProjects(projects, attention = {}) {
  const tracked = (projects || []).filter(project => project.kind !== 'external' && !project.builtHere)
  const isQuiet = project => projectIsQuiet(project) && !attention[project.key] && !(project.reviewRequests?.length)
  return {
    active: tracked.filter(project => !isQuiet(project)),
    quiet: tracked.filter(isQuiet),
    builtHere: (projects || []).filter(project => project.builtHere),
    external: (projects || []).filter(project => project.kind === 'external'),
  }
}
