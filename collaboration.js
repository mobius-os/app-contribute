// GitHub owns people, permissions and assignments. Contribute owns the private
// review journey; a repository role never becomes an automatic merge grant.
import { fetchLiveStates } from './api.js'

export const PR_FIELDS = `id number title url headRefOid baseRefName baseRefOid isDraft
  author { login } assignees(first:100) { nodes { login } }
  repository { nameWithOwner viewerPermission }
  reviewDecision mergeable`
export const mayAssign = permission => ['TRIAGE', 'WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
export const mayMerge = permission => ['WRITE', 'MAINTAIN', 'ADMIN'].includes(permission)
export const prKey = pr => `${pr.repository.nameWithOwner.toLowerCase()}#${pr.number}`
export const mergeSelection = (old, next) => [...new Map([...old, ...next].map(pr => [prKey(pr), pr])).values()]
export function matchingPulls(pulls, filter, login) {
  const same = value => value?.toLowerCase() === login?.toLowerCase()
  return pulls.filter(pr => filter === 'unassigned' ? !pr.assignees?.nodes?.length
    : filter === 'assigned' ? pr.assignees?.nodes?.some(user => same(user.login))
      : filter === 'authored' ? same(pr.author?.login) : true)
}

async function graph(token, query) {
  const result = await fetchLiveStates(token, query)
  if (!result) throw new Error('Could not check GitHub. Refresh to try again.')
  return result
}
export async function discoverRepositories(token, cursor = null) {
  const data = await graph(token, `query ContributeRepositories { viewer { repositories(first:100,
    affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER], orderBy:{field:UPDATED_AT,direction:DESC},
    after:${JSON.stringify(cursor)}) { nodes { nameWithOwner viewerPermission isArchived pullRequests(states:OPEN) { totalCount } }
    pageInfo { hasNextPage endCursor } } } }`)
  if (!data.viewer?.repositories) throw new Error('GitHub did not return repository access. Refresh to try again.')
  const connection = data.viewer.repositories
  return { repositories: connection.nodes.filter(repo => mayAssign(repo.viewerPermission) && !repo.isArchived).map(repo => ({ ...repo, openPullRequestCount: repo.pullRequests?.totalCount || 0 })), ...connection.pageInfo }
}
export function repositoryName(value) {
  const name = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '')
  return /^[\w.-]+\/[\w.-]+$/.test(name) ? name.toLowerCase() : ''
}

export async function discoverRepository(token, value) {
  const name = repositoryName(value)
  if (!name) throw new Error('Enter a GitHub repository, such as owner/project.')
  const [owner, repo] = name.split('/')
  const data = await graph(token, `query ContributeRepository { repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(repo)}) { nameWithOwner viewerPermission isArchived } }`)
  if (!data.repository) throw new Error('Repository not found, or your GitHub account cannot access it.')
  return data.repository
}
export async function discoverPulls(token, repo = '', cursor = null) {
  const queryText = repo ? `repo:${repo} is:pr is:open` : 'is:pr is:open involves:@me'
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Choose a valid repository.')
  const data = await graph(token, `query ContributePullRequests {
    search(query:${JSON.stringify(queryText)},type:ISSUE,first:50,after:${JSON.stringify(cursor)}) {
      nodes { ... on PullRequest { ${PR_FIELDS} } }
      issueCount pageInfo { hasNextPage endCursor }
    }
  }`)
  if (!data.search) throw new Error('GitHub did not return pull requests. Refresh to try again.')
  return { pulls: data.search.nodes.filter(pr => pr?.repository?.nameWithOwner && pr.headRefOid),
    total: data.search.issueCount, ...data.search.pageInfo }
}
export async function collaborationRequest(token, appId, path, body) {
  const response = await fetch(`/api/github/contributions/${encodeURIComponent(appId)}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(response.status === 404
    ? 'These controls need the companion Möbius update to be activated.'
    : typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Could not complete this action. Refresh before retrying.')
  return data
}

export function reviewRunRequest(choice) {
  return {
    request_id: choice.request_id, mode: choice.mode,
    items: choice.pulls.map(pr => ({ repo: pr.repository.nameWithOwner, number: pr.number,
      head_sha: pr.headRefOid, base_ref: pr.baseRefName, base_sha: pr.baseRefOid })),
  }
}

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

// A review verdict is about both selected head and base, never a lookalike PR.
export function reviewForPull(runs, pr) {
  if (!pr.headRefOid || !pr.baseRefOid || !pr.baseRefName) return null
  for (const run of runs) {
    const item = run.items?.find(item => item.repo.toLowerCase() === pr.repository.nameWithOwner.toLowerCase()
      && item.number === pr.number && item.head_sha === pr.headRefOid
      && item.base_sha === pr.baseRefOid && item.base_ref === pr.baseRefName)
    if (item) return { run, item }
  }
  return null
}
