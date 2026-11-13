// A GitHub that holds open PRs per repository and answers the questions the repository lists ask (list-reads.js and
// collaboration.js discoverPulls), as GitHub answers them: the full first page, the titles, exact PRs, the probe and the counts.
// `world` is { 'owner/name': [PR, ...] } and may be changed between reads. `calls` records every question in order.
import { moveSignature } from '../list-reads.js'

const HEAD = 'a'.repeat(40)
export const fullPull = (repo, number, extra = {}) => ({
  id: `PR_${repo}_${number}`, number, title: `Change ${number}`, url: `https://github.com/${repo}/pull/${number}`, state: 'OPEN', isDraft: false,
  headRefOid: HEAD, headRefName: `branch-${number}`, baseRefName: 'main', baseRefOid: 'b'.repeat(40), baseRef: { target: { oid: 'b'.repeat(40) } },
  additions: 3, deletions: 1, changedFiles: 1, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z',
  author: { login: 'maker' }, assignees: { nodes: [] },
  repository: { nameWithOwner: repo, viewerPermission: 'WRITE', squashMergeAllowed: true },
  headRepository: { nameWithOwner: repo, viewerPermission: 'WRITE', isArchived: false },
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }], totalCount: 1 }, comments: { totalCount: 2, nodes: [] }, reviews: { totalCount: 0 }, reviewRequests: { totalCount: 0 },
  commits: { totalCount: 1, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }], statusContextCountsByState: [] } } } }] },
  reviewDecision: null, mergeable: 'MERGEABLE',
  latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [] },
  latestReviews: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  viewerLatestReview: null, reviewThreads: { pageInfo: { hasPreviousPage: false }, nodes: [] },
  ...extra,
})

const TITLE_KEYS = ['id', 'number', 'title', 'url', 'state', 'isDraft', 'createdAt', 'updatedAt', 'headRefOid', 'author', 'reviewDecision']
const light = pr => ({ ...Object.fromEntries(TITLE_KEYS.map(key => [key, pr[key]])), repository: { nameWithOwner: pr.repository.nameWithOwner, viewerPermission: pr.repository.viewerPermission } })
const probed = pr => ({ number: pr.number, updatedAt: pr.updatedAt, headRefOid: pr.headRefOid, isDraft: pr.isDraft, mergeable: pr.mergeable, commits: pr.commits })

export function installGithub(world, { hold = null, moreReviewers = {} } = {}) {
  const calls = [], compared = []
  const previous = globalThis.fetch
  const openIn = repo => (world[repo.toLowerCase()] || []).filter(pr => pr.state === 'OPEN')
  const repoOf = text => /repo:([\w.-]+\/[\w.-]+)/.exec(text)[1].toLowerCase()
  async function answer(query) {
    // GitHub refuses a question whose braces or brackets do not close; so does this one.
    const bare = query.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      if (bare.split(open).length !== bare.split(close).length) throw Object.assign(new Error('Expected NAME: unbalanced ' + open + close), { status: 400 })
    }
    const name = /query (\w+)/.exec(query)[1]
    const record = { name, query, repos: [...query.matchAll(/repo:([\w.-]+\/[\w.-]+)/g)].map(match => match[1].toLowerCase()) }
    calls.push(record)
    if (hold) await hold(record)
    if (name === 'ContributePullRequests') {
      const repo = repoOf(query)
      const start = Number(/after:"c(\d+)"/.exec(query)?.[1] || 0)
      const all = openIn(repo)
      const nodes = all.slice(start, start + 50)
      const more = start + 50 < all.length
      return { search: { nodes, issueCount: all.length, pageInfo: { hasNextPage: more, endCursor: more ? `c${start + 50}` : null } } }
    }
    if (name === 'ContributeListTitles') {
      const all = openIn(repoOf(query))
      return { search: { nodes: all.slice(0, 50).map(light), issueCount: all.length, pageInfo: { hasNextPage: all.length > 50, endCursor: all.length > 50 ? 'c50' : null } } }
    }
    if (name === 'ContributeListProbe' || name === 'ContributeOpenCounts') {
      const aliases = [...query.matchAll(/(r\d+): search\(query:"repo:([\w.-]+\/[\w.-]+) is:pr is:open"/g)]
      const probing = name === 'ContributeListProbe'
      return Object.fromEntries(aliases.map(([, alias, repo]) => [alias, probing
        ? { issueCount: openIn(repo).length, nodes: openIn(repo).slice(0, 100).map(probed) } : { issueCount: openIn(repo).length }]))
    }
    // The rest of a PR's reviewers (review-pages.js): `moreReviewers[id]` holds them, if a test gave any.
    if (name === 'ContributeMoreReviewers') {
      const id = /node\(id:"([^"]+)"/.exec(query)[1]
      return { node: { latestReviews: { pageInfo: { hasNextPage: false, endCursor: 'end' }, nodes: moreReviewers[id] || [] } } }
    }
    // Exact PRs, one alias each (ContributeListDetails, ContributeReviewPulls).
    const reads = [...query.matchAll(/(p\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\) \{ pullRequest\(number:(\d+)\)/g)]
    return Object.fromEntries(reads.map(([, alias, owner, repo, number]) => [alias, { pullRequest: (world[`${owner}/${repo}`.toLowerCase()] || []).find(pr => pr.number === Number(number)) || null }]))
  }
  globalThis.fetch = async (url, options) => {
    // The comparison of two commits (carried-approvals.js): nothing can be told, so a mark of "unknown" is the proof it was asked.
    if (String(url).startsWith('/api/github/api/repos/')) { compared.push(String(url)); return new Response('{}', { status: 404 }) }
    if (url !== '/api/github/graphql') throw new Error('Unexpected request to ' + url)
    try {
      const data = await answer(JSON.parse(options.body).query)
      return new Response(JSON.stringify({ data: { rateLimit: { remaining: 4000 }, ...data } }))
    } catch (error) {
      if (error.status) return new Response(JSON.stringify({ detail: error.message }), { status: error.status })
      throw error
    }
  }
  return { calls, compared, names: () => calls.map(call => call.name), restore() { globalThis.fetch = previous } }
}

export const signatureOf = moveSignature
