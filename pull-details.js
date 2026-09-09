// Read-only GitHub projection. These calls never approve, review, or mutate a PR.
// File pages are checked against the selected head/base after reading, so a
// moving branch cannot silently put unrelated patches under an old approval.
export function pullPath(pr) {
  const repo = pr?.repository?.nameWithOwner
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || repo.split('/').some(part => part === '.' || part === '..') || !Number.isInteger(pr.number) || pr.number < 1) throw new Error('Choose a valid pull request.')
  return `repos/${repo}/pulls/${pr.number}`
}
export async function githubRead(token, path, signal) {
  const response = await fetch(`/api/github/api/${path}`, { signal, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } })
  const data = await response.json().catch(() => null)
  if (!response.ok || data === null) throw new Error(response.status === 401 ? 'Reconnect GitHub to read this contribution.' : 'Could not load this information from GitHub. Try again.')
  return data
}
export function assertPullVersion(pr, detail) {
  if (detail.head?.sha !== pr.headRefOid || detail.base?.sha !== pr.baseRefOid || detail.base?.ref !== pr.baseRefName) {
    const error = new Error('This PR changed. Refresh the PR list before reviewing this version.')
    error.code = 'stale'
    throw error
  }
  return detail
}
export async function loadPullDescription(token, pr, signal) {
  return assertPullVersion(pr, await githubRead(token, pullPath(pr), signal))
}
export async function loadPullFiles(token, pr, page = 1, signal) {
  if (!Number.isInteger(page) || page < 1 || page > 30) throw new Error('File page is outside GitHub’s available range.')
  const path = pullPath(pr)
  const files = await githubRead(token, `${path}/files?per_page=100&page=${page}`, signal)
  if (!Array.isArray(files)) throw new Error('GitHub did not return a file list.')
  await loadPullDescription(token, pr, signal)
  return { files, hasMore: files.length === 100 && page < 30, capped: files.length === 100 && page === 30 }
}
export async function loadPullActivity(token, pr, page = 1, signal) {
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
  return { items, hasMore: results.some(result => result.status === 'fulfilled' && result.value.length === 50),
    errors: results.flatMap((result, index) => result.status === 'rejected' ? [`${requests[index][0]}s: ${result.reason.message}`] : []) }
}
