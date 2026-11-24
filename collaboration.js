// GitHub owns people, permissions and assignments. Contribute owns the private
// review journey; a repository role never becomes an automatic merge grant.
import { PR_FIELDS, fetchLiveStates } from './api.js'
import { mayWrite } from './pr-machine.js'
import { sameLogin } from './domain.js'

export { PR_FIELDS } from './api.js'
// What one agent review says now (review-reading.js) lives in its own module; the screens keep importing it from here.
export { OWNER_ITEM_STATES, REVIEW_STATE_NAMES, ignoreKey, ignoredNote, reviewBlocked, reviewItemProgress, reviewReading, reviewRunHalted, reviewRunStateLabel, reviewStartedAt, withIgnoreNote, withoutIgnoreNote } from './review-reading.js'
export const mayAssign = permission => ['TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
// Merge rights are write rights: the machine owns the one list.
export const mayMerge = mayWrite
// This is discovery, not authority: the server rechecks exact repositories at
// admission and before publication. Older snapshots still need that preflight.
// A takeover never marks a draft ready (the owner does), so there is one scope.
export const TAKEOVER_SCOPE = 'named_pr_repairs_and_reviewed_successors'
export function takeoverBlocker(pulls) {
  if (pulls.some(pr => !mayMerge(pr.repository?.viewerPermission))) return 'Requires merge access to every selected PR.'
  // GitHub returns `headRepository: null` when the source fork was deleted:
  // no fix can be pushed there. Only an absent field (older snapshot) defers
  // to the server's push-rights preflight.
  if (pulls.some(pr => pr.headRepository === null)) return 'The PR’s source repository was deleted, so fixes cannot be sent.'
  if (pulls.some(pr => pr.headRepository && (pr.headRepository.isArchived || !mayMerge(pr.headRepository.viewerPermission)))) return 'Requires push access to the PR’s source repository to send fixes.'
  return ''
}
// GitHub's rollup counts include check runs and commit statuses. Like GitHub's
// own "18/18", skipped and neutral runs count as passing; anything failed or
// cancelled is a failure; the rest is still pending. A green rollup is not a
// review verdict or proof that branch-required checks passed.
export const PASSING_CHECKS = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])
export const FAILING_CHECKS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'STARTUP_FAILURE', 'ACTION_REQUIRED', 'STALE'])
export function checkSummary(pr) {
  const counts = pr?.commits?.nodes?.at(-1)?.commit?.statusCheckRollup?.contexts
  if (!Number.isInteger(counts?.totalCount) || counts.totalCount < 0) return null
  const groups = [counts.checkRunCountsByState, counts.statusContextCountsByState]
  if (groups.some(group => !Array.isArray(group))) return null
  const states = groups.flat()
  if (states.some(item => !item?.state || !Number.isInteger(item.count) || item.count < 0)) return null
  const sum = test => states.filter(item => test(item.state)).reduce((total, item) => total + item.count, 0)
  const passed = sum(state => PASSING_CHECKS.has(state))
  const failed = sum(state => FAILING_CHECKS.has(state))
  const total = counts.totalCount
  if (passed + failed > total) return null
  return { passed, failed, total, state: failed ? 'failure' : passed === total ? 'success' : 'pending' }
}
// Two different "bases": GitHub's baseRefOid is the PR's comparison base,
// while a run is bound to the target branch's live tip when the owner
// consents (the server checks exactly that). Runs and review links use the tip.
export const baseTip = pr => pr?.baseRef?.target?.oid || null
// The conversation count a row shows: issue-style comments plus review
// submissions, the same two sources the PR page's Comments tab lists.
export const conversationCount = pr => (pr?.comments?.totalCount || 0) + (pr?.reviews?.totalCount || 0)
export const prKey = pr => `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`
export const mergeSelection = (old, next) => [...new Map([...old, ...next].map(pr => [prKey(pr), pr])).values()]
const BOT_LOGINS = new Set(['dependabot', 'renovate', 'github-actions'])
// A GitHub App login ends in [bot]; a bot account by convention in -bot or _bot. A person
// named abbot or talbot is not one.
export const isBotAuthor = login => /\[bot\]$|[-_]bot$/i.test(login || '') || BOT_LOGINS.has((login || '').toLowerCase())

export function matchingPulls(pulls, filter, login) {
  const same = value => value?.toLowerCase() === login?.toLowerCase()
  const test = {
    // A row that holds only its titles does not know its assignees yet: it is neither assigned nor unassigned.
    unassigned: pr => !pr.titlesOnly && !pr.assignees?.nodes?.length,
    assigned: pr => pr.assignees?.nodes?.some(user => same(user.login)),
    authored: pr => same(pr.author?.login),
    drafts: pr => pr.isDraft,
    failing: pr => checkSummary(pr)?.failed > 0,
    bots: pr => isBotAuthor(pr.author?.login),
  }[filter]
  return test ? pulls.filter(test) : pulls
}

export async function graph(token, query) {
  const result = await fetchLiveStates(token, query)
  if (!result) throw new Error('Could not check GitHub. Sync to try again.')
  return result
}
export async function discoverRepositories(token, cursor = null) {
  const data = await graph(token, `query ContributeRepositories { viewer { repositories(first:100,
    affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER], orderBy:{field:UPDATED_AT,direction:DESC},
    after:${JSON.stringify(cursor)}) { nodes { nameWithOwner viewerPermission isArchived pullRequests(states:OPEN) { totalCount } }
    pageInfo { hasNextPage endCursor } } } }`)
  if (!data.viewer?.repositories) throw new Error('GitHub did not return repository access. Sync to try again.')
  const connection = data.viewer.repositories
  return { repositories: connection.nodes.filter(repo => mayAssign(repo.viewerPermission) && !repo.isArchived).map(repo => ({ ...repo, openPullRequestCount: repo.pullRequests?.totalCount || 0 })), ...connection.pageInfo }
}
// What a person pastes to name a repository: owner/name, or a github.com link to it or to anything inside it (a PR, a
// branch), with or without http(s)://, www. and a trailing .git, or the ssh form git@github.com:owner/name.git. Only a
// link may carry more than owner/name; a bare "a/b/c" is not a repository.
const GITHUB_LINK_START = /^(?:git@github\.com:|(?:https?:\/\/)?(?:www\.)?github\.com\/)/i
export function repositoryName(value) {
  const text = String(value || '').trim()
  const isLink = GITHUB_LINK_START.test(text)
  const parts = text.replace(GITHUB_LINK_START, '').split(/[?#]/)[0].split('/').filter(Boolean)
  if (parts.length < 2 || (!isLink && parts.length > 2)) return ''
  const name = `${parts[0]}/${parts[1].replace(/\.git$/i, '')}`
  return /^[\w.-]+\/[\w.-]+$/.test(name) ? name.toLowerCase() : ''
}

// Repositories whose name contains the words, among the ones this GitHub account can see: how a name alone (no owner) is added.
const REPOSITORY_SEARCH_LIMIT = 8
export async function searchRepositories(token, words) {
  const text = String(words || '').trim()
  if (!text) return []
  const data = await graph(token, `query ContributeFindRepository { search(query:${JSON.stringify(`${text} in:name`)},type:REPOSITORY,first:${REPOSITORY_SEARCH_LIMIT}) {
    nodes { ... on Repository { nameWithOwner description viewerPermission isArchived } } } }`)
  if (!data.search) throw new Error('GitHub did not return repositories. Try again.')
  return data.search.nodes.filter(repo => repo?.nameWithOwner)
}

export async function discoverRepository(token, value) {
  const name = repositoryName(value)
  if (!name) throw new Error('Enter a GitHub repository, such as owner/project.')
  const [owner, repo] = name.split('/')
  const data = await graph(token, `query ContributeRepository { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}) { nameWithOwner viewerPermission isArchived } }`)
  if (!data.repository) throw new Error('Repository not found, or your GitHub account cannot access it.')
  return data.repository
}
// The open PRs a list reads at a time (and a repository's lists keep as their first page).
export const PAGE_SIZE = 50
export async function discoverPulls(token, repo = '', cursor = null) {
  const queryText = repo ? `repo:${repo} is:pr is:open` : 'is:pr is:open involves:@me'
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Choose a valid repository.')
  const data = await graph(token, `query ContributePullRequests {
    search(query:${JSON.stringify(queryText)},type:ISSUE,first:${PAGE_SIZE},after:${JSON.stringify(cursor)}) {
      nodes { ... on PullRequest { ${PR_FIELDS} } }
      issueCount pageInfo { hasNextPage endCursor }
    }
  }`)
  if (!data.search) throw new Error('GitHub did not return pull requests. Sync to try again.')
  return { pulls: data.search.nodes.filter(pr => pr?.repository?.nameWithOwner && pr.headRefOid),
    total: data.search.issueCount, ...data.search.pageInfo }
}
// Re-read one exact PR identity without scanning all open PR pages.
export async function discoverPull(token, repo, number) {
  const name = repositoryName(repo)
  if (!name || !Number.isSafeInteger(number) || number < 1) throw new Error('Choose a valid pull request.')
  const [owner, project] = name.split('/')
  const data = await graph(token, `query ContributeExactPull { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(project)}) { pullRequest(number:${number}) { ${PR_FIELDS} mergedAt } } }`)
  const pr = data.repository?.pullRequest
  if (!pr || pr.number !== number || pr.repository.nameWithOwner.toLowerCase() !== name) throw new Error('This PR is unavailable to your GitHub account.')
  return pr
}

// Owner consent covers each PR's exact code (its head). The target branch moves
// whenever anything merges, so a launch rebinds an unchanged PR to the current
// tip of the SAME target instead of failing on a stale list. Retargeting,
// changed code or draft state needs the owner to look again.
export async function liveSelection(token, pulls) {
  const fresh = await Promise.all(pulls.map(pr => discoverPull(token, pr.repository.nameWithOwner, pr.number)))
  const changed = fresh.filter((pr, index) => pr.headRefOid !== pulls[index].headRefOid || pr.baseRefName !== pulls[index].baseRefName || pr.isDraft !== pulls[index].isDraft || (pr.state && pr.state !== 'OPEN'))
  if (changed.length) {
    throw Object.assign(new Error(`${changed.map(pr => `#${pr.number}`).join(', ')} changed since this list loaded. Review the current version, then start again.`), { code: 'changed' })
  }
  return pulls.map((pr, index) => ({ ...pr, baseRefOid: fresh[index].baseRefOid, baseRefName: fresh[index].baseRefName, baseRef: fresh[index].baseRef }))
}

export async function collaborationRequest(token, appId, path, body) {
  const response = await fetch(`/api/github/contributions/${encodeURIComponent(appId)}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  // A body that cannot be decoded reads as empty, and the error says so (`unreadable`), so a caller
  // that needs the platform's own word can tell "refused" from "the answer was lost".
  let unreadable = false
  const data = await response.json().catch(() => { unreadable = true; return {} })
  // A route that does not exist answers a bare 404; a 404 that explains itself (a PR GitHub cannot show) is the platform's own word.
  const routeMissing = response.status === 404 && (!data.detail || data.detail === 'Not Found')
  if (!response.ok) throw Object.assign(new Error(routeMissing
    ? 'These controls need the companion Möbius update to be activated.'
    : typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Could not complete this action. Sync before retrying.'),
  { status: response.status, ...(unreadable ? { unreadable } : {}), ...(typeof data.detail?.code === 'string' ? { code: data.detail.code } : {}) })
  return data
}

// A core review run Contribute did not start is read through G1's minimized
// projection: id, chat_id, state, execution_state, mode, created_at,
// `app_id: null`, `can_stop: false`, a top-level `post_review` boolean,
// `details_in_owning_chat: true`, and items with only repo, number, head_sha,
// base_ref, base_sha, state and an optional `public_review: {state, url}`.
// Prompts, findings and approval wording stay in the owning conversation.
export const runDetailsElsewhere = run => run?.details_in_owning_chat === true
// Own runs carry their frozen options; minimized runs the top-level flag.
export const runPostsReview = run => runDetailsElsewhere(run) ? run.post_review === true : run?.options?.post_review === true
// Observe of a run this app does not own is refused with this code: the core
// owns its reconciliation, so it is "not ours", not an error.
export const NOT_OURS_TO_OBSERVE = 'details_in_owning_chat'
export const notOursToObserve = error => error?.status === 403 && error?.code === NOT_OURS_TO_OBSERVE

// A Review only run that posts on GitHub is not private, so its name says so.
// A run whose mode is not reported is not assumed to be private.
export const reviewRunTitle = run => run.mode === 'review_fix_merge' ? 'Review, fix & merge' : run.mode === 'review_merge' ? 'Review & merge'
  : runPostsReview(run) ? 'GitHub review' : run.mode === 'review' ? 'Private review' : 'Review run'

// The fix an agent prepared that waits for the owner's Push. The platform saves the
// fix's new commit as `head_sha` and the PR version it builds on as `from_sha`
// (contribution_reviews.py, propose repair), so `base` is the version it answers to.
export function waitingRepair(item) {
  const attempt = (item?.repair_attempts || []).find(entry => entry.state === 'proposed')
  if (!attempt) return null
  return { id: attempt.id, commit: attempt.head_sha || '', base: attempt.from_sha || '', files: Array.isArray(attempt.files) ? attempt.files : [], summary: attempt.summary || '' }
}

// Public outcomes a run saved before GitHub settled them. The server's observe
// step is read-only reconciliation, so the view settles them itself: a queued
// PR reads as merged even while its conversation waits on the owner or stopped.
const UNSETTLED = new Set(['queued', 'merging', 'merge_unknown', 'pushing', 'push_unknown', 'marking_ready', 'ready_unknown', 'verdict_posting', 'verdict_unknown'])
export const awaitsGithub = run => run.state !== 'complete' && (run.items || []).some(item => UNSETTLED.has(item.state))
export const OBSERVE_EVERY_MS = 60000
const observedAt = new Map()
const notOurs = new Set()

// The list of runs as one short read: runs and items without their documents (the findings in full, what a review ran,
// a drafted verdict's text, each fix's files, the run's own instructions), a tenth of the full list. A Möbius that does
// not know the option ignores it and answers in full, with no `view` marker; a short run is marked so a screen that shows
// documents knows to read the one run first (ui/useRunDocuments.js). The runs and items carry every field the lists, rows
// and the PR machine read.
//
// The list is paged. A platform that knows paging answers `has_more` and `next_cursor`: its first page holds every run that
// is not finished plus the newest finished ones, so nothing that waits on the owner is ever cut; the rest is older finished
// history. An older platform cuts the list at one page of 100 and says nothing, so a full page is read as "there may be more".
// A list that is cut says so in `cut`: 'finished' (older finished runs are not here; every unfinished one is) or 'any' (an older
// platform's full page: an unfinished run may be missing too). A list with nothing hidden has no `cut`, so a screen never presents
// a cut list as the whole of it.
const RUNS_PAGE = 100
const pagesKnown = list => typeof list?.has_more === 'boolean'
function cutOf(list) {
  if (pagesKnown(list)) return list.has_more ? { cut: 'finished' } : {}
  return (list?.runs || []).length >= RUNS_PAGE ? { cut: 'any' } : {}
}
// A run another conversation owns is the same short copy in both forms: it has no documents to read.
const withMarkedRuns = list => (list?.view === 'summary' ? { ...list, runs: (list.runs || []).map(run => (runDetailsElsewhere(run) ? run : { ...run, summary_only: true })) } : list)
const runsList = async (token, appId) => {
  const list = await collaborationRequest(token, appId, 'review-runs?view=summary')
  return { ...withMarkedRuns(list), ...cutOf(list) }
}

// The next page of older finished runs after `list` (what the first read answered), added to it. The list is returned as it was
// when the platform has no further page to give; a cursor it refuses (400) throws, and the caller keeps what it has.
export async function moreReviewRuns(token, appId, list) {
  if (!list?.has_more || !list.next_cursor) return list
  const page = await collaborationRequest(token, appId, `review-runs?view=summary&cursor=${encodeURIComponent(list.next_cursor)}`)
  const known = new Set((list.runs || []).map(run => run.id))
  const more = (withMarkedRuns(page)?.runs || []).filter(run => !known.has(run.id))
  const { cut, ...rest } = list
  return { ...rest, runs: [...(list.runs || []), ...more], has_more: page.has_more === true, next_cursor: page.next_cursor || null, ...(page.has_more === true ? { cut: 'finished' } : {}) }
}

// Shows the saved list at once (onList), then re-reads it after any due
// GitHub reconciliation so a settled merge replaces "In merge queue".
export async function loadReviewRuns(token, appId, { onList, now = Date.now() } = {}) {
  const list = await runsList(token, appId)
  onList?.(list)
  // Only Contribute's own runs can be observed through its app route; a
  // minimized run is reconciled by its owning conversation.
  const due = (list.runs || []).filter(run => !runDetailsElsewhere(run) && !notOurs.has(run.id) && awaitsGithub(run) && now - (observedAt.get(run.id) ?? -Infinity) >= OBSERVE_EVERY_MS)
  if (!due.length) return list
  due.forEach(run => observedAt.set(run.id, now))
  const settled = await Promise.allSettled(due.map(run => collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/observe`, {})))
  // A refusal that names the run as not ours stops its polling for good.
  settled.forEach((result, index) => { if (result.status === 'rejected' && notOursToObserve(result.reason)) notOurs.add(due[index].id) })
  return settled.some(result => result.status === 'fulfilled') ? runsList(token, appId) : list
}

// What the platform accepts for each mode, and nothing else (unknown or
// unenforced options are refused): editable review and merge prompts for every
// mode; fix guidance and a round cap only for Review, fix & merge, where
// takeover enforces them; the post-review grant (and its verdict form) only for
// Review only, with or without merge, and only when chosen. Automatic
// continuation is not supported, so it is never sent.
const PUBLISHING_MODES = new Set(['review', 'review_merge'])
export function requestOptions(options, mode) {
  const value = options || {}
  const prompt = key => typeof value[key] === 'string' && value[key].trim() ? { [key]: value[key] } : {}
  return {
    ...prompt('review_prompt'), ...prompt('merge_prompt'),
    ...(mode === 'review_fix_merge' ? {
      ...prompt('fix_prompt'),
      ...(Number.isSafeInteger(value.max_rounds) && value.max_rounds >= 1 ? { max_rounds: value.max_rounds } : {}),
    } : {}),
    ...(PUBLISHING_MODES.has(mode) && value.post_review === true ? {
      post_review: true, ...(value.propose_verdict === true ? { propose_verdict: true } : {}),
      ...(mode === 'review' && value.propose_verdict === true && value.agent_submits_verdict === true ? { agent_submits_verdict: true } : {}),
    } : {}),
  }
}

export function reviewRunRequest(choice) {
  return {
    request_id: choice.request_id, mode: choice.mode,
    ...(choice.mode === 'review_fix_merge' ? { confirmation_scope: TAKEOVER_SCOPE } : {}),
    ...(choice.mode === 'review_fix_merge' && String(choice.takeover_reason || '').trim() ? { takeover_reason: choice.takeover_reason.trim() } : {}),
    ...(choice.options ? { options:requestOptions(choice.options, choice.mode) } : {}),
    ...(choice.preview_sha256 ? { preview_sha256:choice.preview_sha256 } : {}),
    ...(choice.agent ? { agent:choice.agent } : {}),
    items: choice.pulls.map(pr => {
      if (!baseTip(pr)) throw new Error(`Couldn’t read the target branch of #${pr.number}. Sync and try again.`)
      return { repo: pr.repository.nameWithOwner, number: pr.number,
        head_sha: pr.headRefOid, base_ref: pr.baseRefName, base_sha: baseTip(pr) }
    }),
  }
}

// A public write is only as true as its answer. Of the ways one can end, a decoded receipt for this
// action proves it happened and a decoded 4xx proves it did not. Everything else may have reached
// GitHub: the connection dropped before the answer, a gateway or server error, an answer whose body
// cannot be read (whatever its status) or a "success" that is not this action's receipt. That is
// { pending }, never a plain failure the sheet would offer to retry and never a success it would claim. `receipt` turns the decoded answer
// into the fields the sheet reads, or null when it is not this action's completion. With `shellConfirm` (owner-grant.js, askOwner) the
// shell's own sheet comes first, for exactly the body about to be sent: a cancel or a refusal is the outcome and nothing is sent.
// `onConfirmed` runs once the owner has nothing left to confirm, just before the request goes out, so the app's own sheet can say
// "Merging…" only from then on.
async function publicWrite(token, appId, path, body, { code, words, receipt, action, scope = {}, shellConfirm, onConfirmed }) {
  const stopped = action && shellConfirm ? await shellConfirm(action, scope, body) : null
  if (stopped) return stopped
  onConfirmed?.()
  let result
  try {
    result = await collaborationRequest(token, appId, path, body)
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && !error.unreadable) return { error: error.message }
    return { pending: true, error: error.code === code ? error.message : words }
  }
  const settled = receipt(result)
  return settled ? { ok: true, ...settled } : { pending: true, error: words }
}

// The owner's own Merge: this exact version, by the repository's allowed method.
// Returns the outcome shape the confirm sheet already reads: { ok } | { pending }
// (GitHub may have merged; read it back, never repeat) | { error } | { cancelled } (only with `shell.shellConfirm`: the owner closed Möbius's
// sheet, nothing was sent). `shell` is { shellConfirm, onConfirmed } of publicWrite, passed through. The platform
// re-checks everything at the moment of merging and refuses what GitHub refuses.
export const mergePull = (token, appId, pr, { method = '', ...shell } = {}) => publicWrite(token, appId, 'pulls/merge', {
  repo: pr.repository.nameWithOwner, number: pr.number, head_sha: pr.headRefOid, ...(method ? { method } : {}),
}, {
  action: 'merge', ...shell, code: 'merge_unconfirmed', words: 'GitHub may have merged it. Check the pull request before trying again.',
  receipt: result => ['merged', 'queued'].includes(result?.state) ? { state: result.state, mergeSha: result.merge_sha || '' } : null,
})

// The owner's own status change on one PR, at this exact version, once: `ready` (open a draft for
// review), `draft` (back to draft), `close`, `request-reviewers` (ask for re-review) or `ask-approval` (a note asking
// reviewers who looked again to approve). Same outcome
// shapes as mergePull. GitHub cannot pin a version on these writes, so the platform reports the head
// it saw afterwards (observedHead) and the sheet says so if it moved. The receipt of each is the state
// it names, with that head; any other answer may still have reached GitHub.
// `action` is the PR machine's id for it, which the platform's owner confirmation names too.
const STATUS_WRITE = {
  ready: { action: 'open_for_review', state: 'ready', code: 'ready_unconfirmed', words: 'GitHub may have marked it ready. Check the pull request before trying again.' },
  draft: { action: 'back_to_draft', state: 'draft', code: 'draft_unconfirmed', words: 'GitHub may have turned it back into a draft. Check the pull request before trying again.' },
  close: { action: 'close', state: 'closed', code: 'close_unconfirmed', words: 'GitHub may have closed it. Check the pull request before trying again.' },
  'request-reviewers': { action: 'ask_rereview', state: 'requested', code: 'reviewers_unconfirmed', words: 'GitHub may have asked for another review. Check the pull request before trying again.' },
  'request-review': { action: 'request_review', state: 'requested', code: 'reviewers_unconfirmed', words: 'GitHub may have asked for the review. Check the pull request before trying again.' },
  'ask-approval': { action: 'ask_approval', state: 'asked', code: 'approval_unconfirmed', words: 'GitHub may have posted the note. Check the pull request before trying again.' },
}
export const pullAction = (token, appId, pr, action, extra = {}, shell = {}) => {
  const write = STATUS_WRITE[action]
  return publicWrite(token, appId, `pulls/${action}`, {
    repo: pr.repository.nameWithOwner, number: pr.number, head_sha: pr.headRefOid, ...extra,
  }, {
    action: write.action, ...shell, code: write.code, words: write.words,
    receipt: result => result?.state === write.state && typeof result.observed_head_sha === 'string' ? { state: write.state, observedHead: result.observed_head_sha } : null,
  })
}

// Request review for several PRs at once: one request per PR, naming the ticked people who may be asked there (not its
// author, not who approved this version). `done` (which this fills) holds each PR/person pair already asked, or that GitHub may
// have taken, on an earlier try: a retry sends only the pairs still missing, so a changed selection reaches every PR it was
// never asked on and nobody is asked twice. { ok } when every PR is asked or has nobody left to ask, { pending } when GitHub
// may have taken a request (read it back, never repeat), otherwise { error } naming the PRs that were refused. `shell` is
// { shellConfirm, onConfirmed } of publicWrite: each request is then confirmed on Möbius's own sheet first, and closing that sheet
// stops here: { cancelled } when nothing was asked yet, else the outcome so far (a request GitHub may have taken is still
// answered { pending }, so it is read back and never sent again).
export async function requestReviewMany(token, appId, pulls, people, { approvedBy = () => [], done = new Set(), shell = {} } = {}) {
  const asked = [], skipped = [], refused = [], unsure = []
  const pairOf = (pr, login) => `${prKey(pr)}|${login.toLowerCase()}`
  const pendingWords = () => `GitHub may have asked for the review on ${unsure.map(number => '#' + number).join(', ')}. Check ${unsure.length === 1 ? 'it' : 'them'} before trying again.`
  for (const pr of pulls) {
    const eligible = people.filter(login => !sameLogin(login, pr.author?.login) && !approvedBy(pr).some(name => sameLogin(name, login)))
    if (!eligible.length) { skipped.push(pr.number); continue }
    const askable = eligible.filter(login => !done.has(pairOf(pr, login)))
    if (!askable.length) continue
    const outcome = await pullAction(token, appId, pr, 'request-review', { reviewers: askable }, shell)
    if (outcome.cancelled) {
      const stopped = 'You closed Möbius’s sheet before the rest, so nothing more was sent.'
      if (unsure.length) return { pending: true, error: `${pendingWords()} ${stopped}` }
      return asked.length ? { error: `Asked on ${asked.map(number => '#' + number).join(', ')}. ${stopped}` } : { cancelled: true }
    }
    if (outcome.ok) { asked.push(pr.number); askable.forEach(login => done.add(pairOf(pr, login))) }
    else if (outcome.pending) { unsure.push(pr.number); askable.forEach(login => done.add(pairOf(pr, login))) }
    else refused.push(`#${pr.number}: ${outcome.error}`)
  }
  if (unsure.length) return { pending: true, error: pendingWords() }
  if (refused.length) return { error: `Not asked: ${refused.join(' · ')}.${asked.length ? ` Asked on ${asked.map(number => '#' + number).join(', ')}.` : ''}` }
  return { ok: true, state: 'requested', asked, skipped }
}

// Everyone a PR's repository lets work on it: the list Assign shows, read to its end (a few pages at most), which is also
// who GitHub lets be asked to review. Logins only; who may not be asked (the author, a bot, someone who approved this
// version) is for the sheet to leave out.
const PEOPLE_PAGES = 5
export async function loadReviewPeople(token, appId, pr) {
  const logins = []
  for (let page = 1, seen = 0; page && seen < PEOPLE_PAGES; seen += 1) {
    const next = await collaborationRequest(token, appId, `assignees?repo=${encodeURIComponent(pr.repository.nameWithOwner)}&page=${page}`)
    logins.push(...(next.assignees || []).map(person => person.login).filter(Boolean))
    page = next.next_page
  }
  return logins
}

// What a finished private review would say on GitHub, word for word, with the hash that binds the
// post to it. Read-only: the platform writes nothing here.
export const previewPostedFindings = (token, appId, run, item) =>
  collaborationRequest(token, appId, `review-runs/${encodeURIComponent(run.id)}/post-preview`,
    { repo: item.repo, number: item.number, head_sha: item.head_sha })

// Post exactly the previewed words, once, as a plain comment review at the reviewed version. Same
// outcome shapes as mergePull. `shell` is { shellConfirm, onConfirmed } of publicWrite: Möbius confirms the same words first.
export const postFindings = (token, appId, run, item, preview, shell = {}) => publicWrite(token, appId,
  `review-runs/${encodeURIComponent(run.id)}/post`,
  { repo: item.repo, number: item.number, head_sha: item.head_sha, preview_sha256: preview.preview_sha256 }, {
    action: 'post_findings', scope: { run_id: run.id }, ...shell,
    code: 'post_unconfirmed', words: 'GitHub may have posted it. Check the pull request before trying again.',
    receipt: result => result?.state === 'posted' ? { state: 'posted', url: result.url || '' } : null,
  })

// Assignment is additive on GitHub. Return each outcome so partial batches
// never look like an all-or-nothing success or silently retry failed requests.
export async function assignPulls(token, appId, pulls, login) {
  const outcomes = []
  for (const pr of pulls) {
    try {
      await collaborationRequest(token, appId, 'assign-review', {
        repo: pr.repository.nameWithOwner, number: pr.number,
        expected_head_sha: pr.headRefOid, assignee: login,
      })
      outcomes.push({ key: prKey(pr), ok: true })
    } catch (error) { outcomes.push({ key: prKey(pr), ok: false, error: error.message }) }
  }
  return outcomes
}

// Every saved review of one PR (repo and number), at any version, newest first by when its run began. The one place a PR is
// matched to its reviews: the row, the Review tab and a saved record's frame all start from here.
const newestFirst = (a, b) => (Date.parse(b.run.created_at || '') || 0) - (Date.parse(a.run.created_at || '') || 0)
export const reviewsOfPr = (runs, repo, number) => (runs || []).flatMap(run => (run.items || [])
  .filter(item => String(item.repo).toLowerCase() === String(repo).toLowerCase() && item.number === number)
  .map(item => ({ run, item }))).sort(newestFirst)

// A run belongs to the PR's exact code (repo, number, head), never a lookalike PR. The target branch is not part of that
// identity: GitHub retargets a PR (its parent branch merged) without changing its code, and the review of that code still
// stands. `exactBase` says whether the run saw the branch the PR is aimed at, at its current tip, instead of hiding the
// difference. Prefer the run on the current branch tip; otherwise the newest for this code.
function reviewAtHead(reviews, pr) {
  const matches = reviews.filter(({ item }) => !!pr.headRefOid && item.head_sha === pr.headRefOid)
    .map(review => ({ ...review, exactBase: !!baseTip(pr) && review.item.base_sha === baseTip(pr) && review.item.base_ref === pr.baseRefName }))
  return matches.find(match => match.exactBase) || matches[0] || null
}
// A review made against another branch than the one the PR is aimed at now. The review of the same code still stands (above), but it did not see
// this branch: the Review tab says so, and a fact that speaks of the review as current for this PR (the Merge sheet's) leaves it out. A tip that
// moved on the same branch is not this (`exactBase` is false then too, and the branch is the same). Nothing is claimed where either side is unknown.
export const reviewedOtherBranch = (review, pr) => !!review?.item?.base_ref && !!pr?.baseRefName && review.item.base_ref !== pr.baseRefName

// A PR whose target was not read is not matched at all.
export const reviewForPull = (runs, pr) => (pr.headRefOid && pr.baseRefName ? reviewAtHead(reviewsOfPr(runs, pr.repository.nameWithOwner, pr.number), pr) : null)

// The newest review of this PR at some other version, for when the PR has
// changed since it was reviewed: reviewForPull only matches the current head, and
// "never reviewed" would be wrong.
export const earlierReviewForPull = (runs, pr) => reviewsOfPr(runs, pr.repository.nameWithOwner, pr.number).find(({ item }) => item.head_sha !== pr.headRefOid) || null

// The review of this PR the PR machine reads (pr-facts.js): the one at the PR's current code, else the newest earlier one.
// It is the same choice as the Review tab's, without needing the target branch to have been read.
export function reviewOfPull(runs, pr) {
  if (!pr) return null
  const all = reviewsOfPr(runs, pr.repository?.nameWithOwner, pr.number)
  return reviewAtHead(all, pr) || all[0] || null
}

// What each "Who sees the result?" choice grants (the review window's switch, ui/ReviewConfirmation.jsx).
export const WHO_OPTIONS = {
  private: { post_review: false, propose_verdict: false, agent_submits_verdict: false },
  draft: { post_review: true, propose_verdict: true, agent_submits_verdict: false },
  agent: { post_review: true, propose_verdict: true, agent_submits_verdict: true },
}
// "Draft for me" needs a Möbius that can post a review and propose its verdict.
export const offersDraft = capabilities => capabilities?.post_review === true && capabilities?.propose_verdict === true

// The PR machine's agent jobs (pr-machine.js) as the platform runs them. On your
// own PR a review is only ever a private check; Finish it for me and Take over
// are the same platform mode, told apart by whose PR it is (and Take over's reason).
// A raw mode (a retry, a saved link) passes through with its own defaults.
// Someone else's PR opens on "Draft for me" when `draftFirst` (the host offers it): a private review
// ends with nothing to send. "Agent posts" is never a default.
const REVIEW_INTENTS = {
  review: { mode: 'review', options: WHO_OPTIONS.private },
  check_my_pr: { mode: 'review', options: WHO_OPTIONS.private },
  finish_it: { mode: 'review_fix_merge' },
  take_over: { mode: 'review_fix_merge' },
}
// A Review tapped before the host's capabilities arrived opened on "Only me" and is marked `draftPending`. Once they are known the
// window takes the draft default if the host offers it (the owner cannot have chosen yet: the choice appears with the capabilities).
export function settleDraftDefault(choice, capabilities) {
  if (!choice?.draftPending || !capabilities) return choice
  const { draftPending, ...settled } = choice
  return offersDraft(capabilities) ? { ...settled, options: WHO_OPTIONS.draft, request_id: crypto.randomUUID() } : settled
}
export function reviewIntent(choice, draftFirst = false) {
  const known = REVIEW_INTENTS[choice]
  if (!known) return { mode: choice }
  return { intent: choice, ...known, ...(choice === 'review' && draftFirst ? { options: WHO_OPTIONS.draft } : {}) }
}
