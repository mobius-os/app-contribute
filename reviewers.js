// Who was asked to review a PR, and where each of their reviews stands: one row per person, one current status.
// It reads GitHub's own record: the review requests still pending, every "requested" event, and the reviews each person
// submitted. Assigning someone is not asking them, so an assignee never appears here.

// A pending request reads as waiting; one that follows an earlier review of theirs says so, and is never an approval.
export const REVIEWER_STATUS = {
  waiting: { label: 'Waiting', tone: 'is-waiting' },
  waiting_again: { label: 'Waiting for another review', tone: 'is-waiting' },
  approved: { label: 'Approved', tone: 'is-ready' },
  changes: { label: 'Changes requested', tone: 'is-blocker' },
  commented: { label: 'Commented', tone: 'is-tone' },
  dismissed: { label: 'Dismissed', tone: '' },
}
const ANSWERS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', COMMENTED: 'commented', DISMISSED: 'dismissed' }
const VERDICTS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])

// Only people are listed: GitHub shows a team's name only to a token that may read the organisation, which this app's does not.
const personOf = reviewer => (reviewer?.login ? { key: reviewer.login.toLowerCase(), name: reviewer.login } : null)

// Each person's review that stands (their latest verdict if they gave one, else their latest comment) and when they
// last reviewed at all. GitHub's own "latest reviews" leaves out anyone with a request pending again, which is exactly
// who this list is about, so the whole history is read.
function standingReviews(nodes) {
  const submitted = (nodes || []).filter(review => review?.author?.login && Number.isFinite(Date.parse(review.submittedAt)))
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
  const byPerson = new Map()
  for (const review of submitted) {
    const key = review.author.login.toLowerCase()
    const verdict = VERDICTS.has(review.state) ? review : byPerson.get(key)?.verdict
    byPerson.set(key, { review: verdict || review, verdict, lastAt: Date.parse(review.submittedAt) })
  }
  return byPerson
}

// `data` is the PR as GitHub answers the read in pull-details.js (loadPullReviewers). Pending requests come first, then
// the newest request first. Someone whose request was withdrawn without an answer is not listed.
export function reviewersOf(data) {
  const pending = new Map((data?.reviewRequests?.nodes || []).map(node => personOf(node?.requestedReviewer)).filter(Boolean).map(person => [person.key, person]))
  const reviews = standingReviews(data?.reviews?.nodes)
  // The newest request of each person wins; a pending request the events no longer reach (a long thread) is listed undated.
  const asked = new Map([...pending].map(([key, person]) => [key, { ...person, at: NaN, requestedAt: '' }]))
  for (const event of data?.timelineItems?.nodes || []) {
    const person = personOf(event?.requestedReviewer)
    const at = Date.parse(event?.createdAt)
    if (!person || !Number.isFinite(at)) continue
    const known = asked.get(person.key)
    if (!known || !(known.at >= at)) asked.set(person.key, { ...person, at, requestedAt: event.createdAt })
  }
  const rows = []
  for (const person of asked.values()) {
    const mine = reviews.get(person.key)
    // Reviewed before this request: the request is a fresh ask, not the first one.
    const earlier = !!mine && (!Number.isFinite(person.at) || mine.lastAt < person.at)
    const waiting = pending.has(person.key)
    const status = waiting ? (earlier ? 'waiting_again' : 'waiting') : !earlier && ANSWERS[mine?.review.state]
    if (!status) continue
    rows.push({ key: person.key, name: person.name, status, ...REVIEWER_STATUS[status], again: earlier, requestedAt: person.requestedAt, waiting, at: person.at })
  }
  return rows.sort((a, b) => Number(b.waiting) - Number(a.waiting) || (Number.isFinite(b.at) ? b.at : 0) - (Number.isFinite(a.at) ? a.at : 0))
    .map(({ at, waiting, ...row }) => row)
}

// The people with a request still pending: whom a new request need not name again.
export const pendingReviewers = rows => (rows || []).filter(row => row.status.startsWith('waiting')).map(row => row.name)
