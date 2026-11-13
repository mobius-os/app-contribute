// The GitHub reads that fill a repository's list of open PRs (repository-lists.js), beside the full read of
// collaboration.js discoverPulls: the titles alone, the details of exact PRs in groups, the probe that says which
// PRs moved, and the count of open PRs. Each goes through fetchLiveStates (api.js, via collaboration.js graph), so a
// full read here completes the reviewers and marks carried approvals as every other read of PRs does.
import { readExactPulls, validPullRef } from './api.js'
import { graph, repositoryName } from './collaboration.js'

// What a row can say from GitHub's quick answer: the title and who, when and in what state. Nothing about checks,
// reviewers, labels or comments, so a row read this way is marked `titlesOnly` and shows only these.
export const TITLE_FIELDS = 'id number title url state isDraft createdAt updatedAt headRefOid author { login } reviewDecision repository { nameWithOwner viewerPermission }'
// A first page: what the list asks for (collaboration.js discoverPulls reads the same 50).
export const PAGE_SIZE = 50
// The details of a page are read in groups of this many PRs, all at once (measured: three groups of ten answer in 2.6 s,
// the whole page as one read in 3.3 to 5.3 s).
const GROUP_SIZE = 10
// A probe sees this many PRs of a repository; a repository with more is read, not probed (repository-lists.js).
export const PROBE_PAGE = 100
const COUNT_BATCH = 50

function repositoriesOf(repos) {
  return [...new Set(repos.map(repositoryName).filter(Boolean))]
}
const openPulls = name => JSON.stringify(`repo:${name} is:pr is:open`)

// The first page of a repository's open PRs with titles and status only (about a second). Throws when GitHub did not answer.
export async function readTitles(token, repo) {
  const name = repositoryName(repo)
  if (!name) throw new Error('Choose a valid repository.')
  const data = await graph(token, `query ContributeListTitles {
    rateLimit { remaining }
    search(query:${openPulls(name)}, type:ISSUE, first:${PAGE_SIZE}) { nodes { ... on PullRequest { ${TITLE_FIELDS} } } issueCount pageInfo { hasNextPage endCursor } }
  }`)
  if (!data.search) throw new Error('GitHub did not return pull requests. Sync to try again.')
  const { nodes, issueCount, pageInfo } = data.search
  return { pulls: nodes.filter(pr => pr?.repository?.nameWithOwner && pr.headRefOid).map(pr => ({ ...pr, titlesOnly: true })), total: issueCount, ...pageInfo }
}

// The details of exact PRs (PR_FIELDS), read in groups of ten all at once. `onGroup(pulls)` hears each group as it
// answers, so rows fill in while the slower groups are still out. Every group is read and shown before a failed one is
// thrown: the rows that did arrive stay.
export async function readPullGroups(token, refs, { onGroup } = {}) {
  const wanted = refs.filter(validPullRef)
  const groups = Array.from({ length: Math.ceil(wanted.length / GROUP_SIZE) }, (_, index) => wanted.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE))
  const outcomes = await Promise.allSettled(groups.map(async group => {
    const pulls = (await readExactPulls(token, group, 'ContributeListDetails')).filter(Boolean)
    onGroup?.(pulls)
    return pulls
  }))
  const failed = outcomes.find(outcome => outcome.status === 'rejected')
  if (failed) throw failed.reason
  return outcomes.flatMap(outcome => outcome.value)
}

// What a PR looks like to the probe: the facts of PR_FIELDS that move on GitHub and show on a row, as one string. The
// update time covers comments, reviews, labels and assignees; the head covers pushes; the check counts and whether it
// merges move without the PR being updated. It reads the same from a whole PR and from a probe's answer.
export function moveSignature(pr) {
  const rollup = pr.commits?.nodes?.at(-1)?.commit?.statusCheckRollup
  const counts = [...(rollup?.contexts?.checkRunCountsByState || []), ...(rollup?.contexts?.statusContextCountsByState || [])].map(item => `${item.state}:${item.count}`).sort()
  return [pr.updatedAt, pr.headRefOid, pr.isDraft, pr.mergeable, rollup?.state, rollup?.contexts?.totalCount, ...counts].join('|')
}

const PROBE_FIELDS = `number updatedAt headRefOid isDraft mergeable commits(last:1) { nodes { commit { statusCheckRollup { state contexts {
  totalCount checkRunCountsByState { state count } statusContextCountsByState { state count } } } } } }`

// What GitHub holds of the open PRs of these repositories, in the order a list shows them, as a signature each: one
// question for all of them, a point per repository however many PRs it holds up to a hundred. Answers
// Map(name -> { total, pulls: [{ number, signature }] }), without a repository GitHub did not answer for.
export async function readListProbe(token, repos) {
  const names = repositoriesOf(repos)
  if (!names.length) return new Map()
  const asks = names.map((name, index) => `r${index}: search(query:${openPulls(name)}, type:ISSUE, first:${PROBE_PAGE}) { issueCount nodes { ... on PullRequest { ${PROBE_FIELDS} } } }`)
  const data = await graph(token, `query ContributeListProbe { rateLimit { remaining } ${asks.join(' ')} }`)
  const probes = names.map((name, index) => [name, data[`r${index}`]]).filter(([, search]) => Array.isArray(search?.nodes))
  return new Map(probes.map(([name, search]) => [name, { total: search.issueCount, pulls: search.nodes.filter(pr => pr?.number).map(pr => ({ number: pr.number, signature: moveSignature(pr) })) }]))
}

// How many open PRs each repository has, as one question (a point, about a second for seventeen repositories).
// Answers Map(name -> count), without a repository GitHub did not answer for.
export async function readOpenCounts(token, repos) {
  const names = repositoriesOf(repos)
  const counts = new Map()
  for (let from = 0; from < names.length; from += COUNT_BATCH) {
    const batch = names.slice(from, from + COUNT_BATCH)
    const data = await graph(token, `query ContributeOpenCounts { rateLimit { remaining } ${batch.map((name, index) => `r${index}: search(query:${openPulls(name)}, type:ISSUE, first:1) { issueCount }`).join(' ')} }`)
    batch.forEach((name, index) => { if (Number.isInteger(data[`r${index}`]?.issueCount)) counts.set(name, data[`r${index}`].issueCount) })
  }
  return counts
}
