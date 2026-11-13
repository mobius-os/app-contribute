// Read-only GitHub projection. No request here approves or mutates a PR.
// Version-specific evidence is checked against the selected head AND base.
import { parseUnifiedDiff } from './ui/diff/parseUnifiedDiff.js'
import { reviewersOf } from './reviewers.js'

export function pullPath(pr) {
  const repo = pr?.repository?.nameWithOwner
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || repo.split('/').some(part => part === '.' || part === '..') || !Number.isInteger(pr.number) || pr.number < 1) throw new Error('Choose a valid pull request.')
  return `repos/${repo}/pulls/${pr.number}`
}
const RETRY_DELAY_MS = 600
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

// One quiet retry for a dropped connection or a GitHub 5xx: the failure the
// owner would only fix by pressing Try again. A real answer (401, 404, 403)
// and an abort are never retried.
async function fetchGithub(token, path, signal, retry) {
  const response = await fetch(`/api/github/api/${path}`, { signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })
    .catch(error => (signal?.aborted ? Promise.reject(error) : null))
  if (retry && (!response || response.status >= 500)) {
    await wait(RETRY_DELAY_MS)
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return fetchGithub(token, path, signal, false)
  }
  return response
}
export async function githubRead(token, path, signal) {
  const response = await fetchGithub(token, path, signal, true)
  const data = response ? await response.json().catch(() => null) : null
  if (!response?.ok || data === null) throw new Error(response?.status === 401 ? 'Reconnect GitHub in Möbius Settings → Accounts to read this contribution.' : `Could not load this information from GitHub${response ? ` (HTTP ${response.status})` : ' (no connection)'}. Try again.`)
  return data
}
export function assertPullVersion(pr, detail) {
  if (detail?.head?.sha !== pr.headRefOid || detail?.base?.sha !== pr.baseRefOid || detail?.base?.ref !== pr.baseRefName) {
    const error = new Error('This PR changed. Sync before reviewing this version.')
    error.code = 'stale'
    throw error
  }
  return detail
}
function pageNumber(page, max = 100) {
  if (!Number.isInteger(page) || page < 1 || page > max) throw new Error('Page is outside the available range.')
}
const count = value => Number.isInteger(value) && value >= 0 ? value : null
export function pullTotals(detail) {
  return { files: count(detail?.changed_files), additions: count(detail?.additions), deletions: count(detail?.deletions) }
}
export async function loadPullDescription(token, pr, signal) {
  return assertPullVersion(pr, await githubRead(token, pullPath(pr), signal))
}
export async function loadPullFiles(token, pr, page = 1, signal) {
  pageNumber(page, 30)
  const path = pullPath(pr)
  const files = await githubRead(token, `${path}/files?per_page=100&page=${page}`, signal)
  if (!Array.isArray(files)) throw new Error('GitHub did not return a file list.')
  // Read the version after the page so a branch that moved meanwhile is caught.
  const detail = await loadPullDescription(token, pr, signal)
  const totals = pullTotals(detail)
  const more = totals.files === null ? files.length === 100 : totals.files > page * 100
  return { files, totals, page, hasMore: more && page < 30, paginationUnknown: totals.files === null,
    capped: page === 30 && (more || (totals.files === null && files.length === 100)) }
}
// REST patches contain hunks rather than full file headers. Use the existing
// canonical parser/renderer, with safely quoted paths, not a second diff viewer.
export function pullFileDiff(file) {
  if (!file?.patch) return null
  const oldPath = JSON.stringify('a/' + (file.previous_filename || file.filename))
  const newPath = JSON.stringify('b/' + file.filename)
  const parsed = parseUnifiedDiff(`diff --git ${oldPath} ${newPath}\n--- ${oldPath}\n+++ ${newPath}\n${file.patch}`)[0]
  return parsed ? { ...parsed, path: file.filename } : null
}
export function safeDetailLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
// Why a check failed, from what the read-only route can reach: the failed step names of its Actions job and
// its first annotations, worst first. The job's log is behind a redirect to another host that the route does
// not follow, so the log itself stays on GitHub (the row's View on GitHub).
const FAILED_RUN = new Set(['failure', 'timed_out', 'startup_failure'])
const FAILED_STEP = new Set(['failure', 'timed_out'])
const NOTE_RANK = { failure: 0, warning: 1, notice: 2 }
const NOTES_SHOWN = 3
const NOTE_TEXT_MAX = 300
const WHY_CHECKS_MAX = 5

async function checkFailure(token, repoPath, run, signal) {
  // An Actions job is its check run: GitHub gives both the same id. Another app's check has no job to read.
  const isJob = run.app?.slug === 'github-actions'
  const [job, notes] = await Promise.allSettled([
    isJob ? githubRead(token, `${repoPath}/actions/jobs/${run.id}`, signal) : null,
    run.output?.annotations_count > 0 ? githubRead(token, `${repoPath}/check-runs/${run.id}/annotations?per_page=10`, signal) : null,
  ])
  const steps = (Array.isArray(job.value?.steps) ? job.value.steps : []).filter(step => FAILED_STEP.has(step?.conclusion)).map(step => String(step.name))
  const annotations = (Array.isArray(notes.value) ? notes.value : [])
    .filter(note => note?.message)
    .sort((a, b) => (NOTE_RANK[a.annotation_level] ?? 3) - (NOTE_RANK[b.annotation_level] ?? 3))
    .slice(0, NOTES_SHOWN)
    .map(note => ({ where: note.path ? `${note.path}${Number.isInteger(note.start_line) ? `:${note.start_line}` : ''}` : '', text: String(note.message).slice(0, NOTE_TEXT_MAX) }))
  return steps.length || annotations.length ? { steps, annotations } : null
}

// A check that has no reason to show is left as it came: the row falls back to its GitHub link.
async function withFailureReasons(token, repoPath, runs, signal) {
  const failed = new Set(runs.filter(run => FAILED_RUN.has(run.conclusion) && Number.isInteger(run.id)).slice(0, WHY_CHECKS_MAX))
  return Promise.all(runs.map(async run => {
    const why = failed.has(run) ? await checkFailure(token, repoPath, run, signal) : null
    return why ? { ...run, why } : run
  }))
}

export async function loadPullChecks(token, pr, page = 1, signal) {
  pageNumber(page)
  const repoPath = pullPath(pr).split('/pulls/')[0]
  if (!/^[a-f0-9]{40,64}$/i.test(pr.headRefOid || '')) throw new Error('The selected head commit is unavailable.')
  const path = `${repoPath}/commits/${pr.headRefOid}`
  const sources = [
    ['Check runs', `${path}/check-runs?filter=latest&per_page=100&page=${page}`, 'check_runs'],
    ['Commit statuses', `${path}/status?per_page=100&page=${page}`, 'statuses'],
  ]
  const [results] = await Promise.all([
    Promise.allSettled(sources.map(async ([name, url, field]) => {
    const data = await githubRead(token, url, signal)
    if (!Array.isArray(data?.[field])) throw new Error(`GitHub did not return ${name.toLowerCase()}.`)
    if (field === 'statuses' && data.sha !== pr.headRefOid) throw Object.assign(new Error('Status results did not match the selected head. Sync to read them again.'), { code: 'stale' })
    if (field === 'check_runs' && data[field].some(item => item.head_sha !== pr.headRefOid)) throw Object.assign(new Error('Check runs did not match the selected head. Sync to read them again.'), { code: 'stale' })
    const total = count(data.total_count)
    const items = field === 'check_runs' ? await withFailureReasons(token, repoPath, data[field], signal) : data[field]
    return { name, total, items, hasMore: total === null ? data[field].length === 100 : total > page * 100, paginationUnknown: total === null }
    })),
    loadPullDescription(token, pr, signal),
  ])
  // A successful sibling must never hide a mismatched version.
  const mismatch = results.find(result => result.status === 'rejected' && result.reason.code === 'stale')
  if (mismatch) throw mismatch.reason
  const groups = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  return { groups, page, head: pr.headRefOid, hasMore: page < 100 && groups.some(group => group.hasMore),
    capped: page === 100 && groups.some(group => group.hasMore), paginationUnknown: groups.some(group => group.paginationUnknown),
    errors: results.flatMap((result, index) => result.status === 'rejected' ? [`${sources[index][0]}: ${result.reason.message}`] : []) }
}
export async function loadPullActivity(token, pr, page = 1, signal) {
  pageNumber(page)
  const path = pullPath(pr), query = `?per_page=50&page=${page}`
  const requests = [
    ['comment', path.replace('/pulls/', '/issues/') + '/comments'],
    ['review', path + '/reviews'],
  ]
  const results = await Promise.allSettled(requests.map(async ([type, url]) => {
    const items = await githubRead(token, url + query, signal)
    if (!Array.isArray(items)) throw new Error(`Could not load ${type}s.`)
    return items.map(item => ({ ...item, kind: type, date: item.submitted_at || item.created_at }))
  }))
  const items = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))
  const more = results.some(result => result.status === 'fulfilled' && result.value.length === 50)
  // The proxy does not forward REST Link headers. A full page is a probe,
  // not proof of a next page; the UI makes that uncertainty explicit.
  return { items, page, hasMore: more && page < 100, capped: more && page === 100, paginationUnknown: true,
    errors: results.flatMap((result, index) => result.status === 'rejected' ? [`${requests[index][0]}s: ${result.reason.message}`] : []) }
}
async function pullGraphRead(token, pr, fields, variables, signal) {
  pullPath(pr)
  const [owner, name] = pr.repository.nameWithOwner.split('/')
  const query = `query ContributePullContext($owner:String!, $name:String!, $number:Int!, $after:String) {
    repository(owner:$owner, name:$name) { pullRequest(number:$number) {
      headRefOid baseRefOid baseRefName ${fields}
    } }
  }`
  // $after is used by thread reads only; avoid unused-variable validation errors.
  const document = fields.includes('$after') ? query : query.replace(', $after:String', '')
  const response = await fetch('/api/github/graphql', { method: 'POST', signal,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables: { owner, name, number: pr.number, ...variables } }) })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.data?.repository?.pullRequest) throw new Error('Could not load this context from GitHub. Open on GitHub or try again.')
  const data = body.data.repository.pullRequest
  assertPullVersion(pr, { head: { sha: data.headRefOid }, base: { sha: data.baseRefOid, ref: data.baseRefName } })
  return { data, errors: Array.isArray(body.errors) ? ['GitHub returned partial context; some information is unavailable.'] : [] }
}
export async function loadPullThreads(token, pr, after = null, signal) {
  if (after !== null && (typeof after !== 'string' || after.length > 1024)) throw new Error('Invalid discussion cursor.')
  const { data, errors } = await pullGraphRead(token, pr, `reviewThreads(first:50, after:$after) {
    pageInfo { hasNextPage endCursor } nodes {
      id path line startLine diffSide startDiffSide subjectType originalLine originalStartLine isResolved isOutdated
      comments(first:50) { totalCount pageInfo { hasNextPage } nodes { id body url createdAt author { login } } }
    }
  }`, { after }, signal)
  if (!data.reviewThreads) errors.push('Inline review threads are unavailable; resolution is not known.')
  const connection = data.reviewThreads
  return { threads: connection?.nodes?.filter(Boolean) || [], hasMore: connection?.pageInfo?.hasNextPage === true,
    nextCursor: connection?.pageInfo?.endCursor || null, errors }
}
// Who was asked to review this PR and where each review stands (reviewers.js words the rows). Review requests and
// their "requested" events are GitHub's own record of asking; an assignee is not among them. A person's standing verdict
// can come from far back in the history (an old change request stays through later comments), so each connection is read
// to its end, oldest first. When the walk cannot reach the end (a page fails, GitHub answers a page with partial-context
// errors, or the history is past the page limit) the read fails: a list built from part of the history would show a wrong
// standing as if it were complete.
const REVIEWER_PAGE_LIMIT = 20
async function readCompletePage(token, pr, fields, variables, signal) {
  const page = await pullGraphRead(token, pr, fields, variables, signal)
  if (page.errors.length) throw new Error('GitHub returned only part of the review history.')
  return page.data
}
export async function loadPullReviewers(token, pr, signal) {
  const person = '__typename ... on User { login }'
  const connections = {
    reviewRequests: { args: 'first:100', nodes: `requestedReviewer { ${person} }` },
    reviews: { args: 'first:100', nodes: 'state submittedAt author { login }' },
    timelineItems: { args: 'first:100, itemTypes:[REVIEW_REQUESTED_EVENT]', nodes: `... on ReviewRequestedEvent { createdAt requestedReviewer { ${person} } }` },
  }
  const field = (name, after) => `${name}(${connections[name].args}${after ? ', after:$after' : ''}) { pageInfo { hasNextPage endCursor } nodes { ${connections[name].nodes} } }`
  const first = await readCompletePage(token, pr, Object.keys(connections).map(name => field(name, false)).join('\n'), {}, signal)
  const errors = !first.reviewRequests || !first.timelineItems || !first.reviews ? ['Who was asked to review is unavailable.'] : []
  const data = {}
  for (const name of Object.keys(connections)) {
    const connection = first[name]
    if (!connection) continue
    const nodes = [...(connection.nodes || [])]
    let more = connection.pageInfo
    for (let pages = 1; more?.hasNextPage; pages += 1) {
      if (pages >= REVIEWER_PAGE_LIMIT || !more.endCursor) throw new Error('Too much review history to read in full.')
      const next = (await readCompletePage(token, pr, field(name, true), { after: more.endCursor }, signal))[name]
      if (!next) throw new Error('Could not read all of the review history.')
      nodes.push(...(next.nodes || []))
      more = next.pageInfo
    }
    data[name] = { nodes }
  }
  return { reviewers: reviewersOf(data), errors }
}

const FEEDBACK_PAGE_LIMIT = 20

// A checklist is complete only when nothing was left unread, so these walk
// every page rather than the first. `partial` says a page failed, GitHub capped
// the list, or the walk stopped at the page limit, so the list may be missing
// items. A page that fails after the first keeps what was read; a PR that moved
// (stale) still throws.
async function readEveryPage(readPage, firstAt, nextAt) {
  const pages = []
  let at = firstAt
  for (;;) {
    let page
    try { page = await readPage(at) } catch (error) {
      if (!pages.length || error.code === 'stale') throw error
      return { pages, partial: true }
    }
    pages.push(page)
    if (!page.hasMore) return { pages, partial: pages.some(read => read.errors?.length || read.capped) }
    at = nextAt(page)
    if (at === null || pages.length >= FEEDBACK_PAGE_LIMIT) return { pages, partial: true }
  }
}
export async function loadAllPullActivity(token, pr, signal) {
  const { pages, partial } = await readEveryPage(page => loadPullActivity(token, pr, page, signal), 1, page => page.page + 1)
  // Each page is ordered on its own; the whole conversation must be in time order.
  const items = pages.flatMap(page => page.items).sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0))
  return { items, partial }
}
export async function loadAllPullThreads(token, pr, signal) {
  const { pages, partial } = await readEveryPage(after => loadPullThreads(token, pr, after, signal), null, page => page.nextCursor)
  return { threads: pages.flatMap(page => page.threads), partial }
}
export async function loadPullRelated(token, pr, signal) {
  const { data, errors } = await pullGraphRead(token, pr, `
    closingIssuesReferences(first:50) { pageInfo { hasNextPage } nodes { __typename number title url repository { nameWithOwner } } }
    timelineItems(first:50, itemTypes:[CROSS_REFERENCED_EVENT]) {
      pageInfo { hasNextPage } nodes { ... on CrossReferencedEvent { source {
        __typename ... on Issue { number title url repository { nameWithOwner } }
        ... on PullRequest { number title url repository { nameWithOwner } }
      } } }
    }`, {}, signal)
  const related = new Map()
  function add(item, relationship) {
    if (!['Issue', 'PullRequest'].includes(item?.__typename) || !Number.isInteger(item.number) || !safeDetailLink(item.url)) return
    const existing = related.get(item.url)
    related.set(item.url, { ...item, relationships: [...new Set([...(existing?.relationships || []), relationship])] })
  }
  data.closingIssuesReferences?.nodes?.forEach(item => add(item, 'May close'))
  data.timelineItems?.nodes?.forEach(event => add(event?.source, 'Mentions this PR'))
  if (!data.closingIssuesReferences) errors.push('Linked closing issues are unavailable.')
  if (!data.timelineItems) errors.push('Cross-references are unavailable.')
  return { items: [...related.values()], errors,
    truncated: data.closingIssuesReferences?.pageInfo?.hasNextPage === true || data.timelineItems?.pageInfo?.hasNextPage === true }
}

// One page of the PR's commits, oldest first, as GitHub lists them. Each carries what the Commits
// tab shows: headline, message, time, authors (co-authors included) and the checks' overall result.
// Like the other graph reads it is checked against the selected head and base, so a list from a
// branch that moved is flagged stale instead of shown.
export async function loadPullCommits(token, pr, after = null, signal) {
  if (after !== null && (typeof after !== 'string' || after.length > 1024)) throw new Error('Invalid commit cursor.')
  const { data, errors } = await pullGraphRead(token, pr, `commits(first:50, after:$after) {
    totalCount pageInfo { hasNextPage endCursor } nodes { commit {
      oid abbreviatedOid url messageHeadline messageBody committedDate additions deletions changedFilesIfAvailable
      authors(first:5) { nodes { name user { login } } }
      statusCheckRollup { state }
    } }
  }`, { after }, signal)
  const connection = data.commits
  if (!connection) errors.push('The commit list is unavailable.')
  return { commits: (connection?.nodes || []).map(node => node?.commit).filter(Boolean), total: count(connection?.totalCount),
    hasMore: connection?.pageInfo?.hasNextPage === true, nextCursor: connection?.pageInfo?.endCursor || null, head: pr.headRefOid, errors }
}

// GitHub lists at most this many files for one commit, and its Link headers do not reach the app, so a
// full list is read as possibly cut short.
const COMMIT_FILE_LIMIT = 300

// One commit's own files and patches, in the shape the Files changed viewer reads. A commit never changes,
// so unlike the PR's own reads it needs no head/base check; the sha GitHub answers with must be the one asked for.
export async function loadPullCommitFiles(token, pr, oid, signal) {
  if (!/^[a-f0-9]{40,64}$/i.test(oid || '')) throw new Error('Choose a valid commit.')
  const commit = await githubRead(token, `${pullPath(pr).split('/pulls/')[0]}/commits/${oid}`, signal)
  if (!Array.isArray(commit?.files) || String(commit.sha).toLowerCase() !== oid.toLowerCase()) throw new Error('GitHub did not return the files of this commit.')
  const totals = { files: commit.files.length, additions: count(commit.stats?.additions), deletions: count(commit.stats?.deletions) }
  return { files: commit.files, totals, page: 1, hasMore: false, truncated: commit.files.length >= COMMIT_FILE_LIMIT }
}
