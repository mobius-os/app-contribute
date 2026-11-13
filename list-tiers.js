// Which repositories have their list of open PRs read before anyone opens them, and in what order (ui/useBackgroundLists.js).
//   pinned  the owner's "always load" repositories, the platform's by default (repositories.js)
//   active  the owner has something going on there: an open PR or a saved PR of their own, a review request, an agent
//           review or Respond conversation at work, or they opened it within the last week
//   quiet   everything else: not read until opened
// Within a tier the order is the repositories' own (source-map.js puts the platform first, then what waits on the owner).
import { repositoryName } from './collaboration.js'
import { sameLogin } from './domain.js'
import { reviewRepositoriesAtWork } from './review-frame.js'

export const ACTIVE_DAYS = 7
const DAY_MS = 86400000

const repoOf = project => repositoryName(project?.canonical_repo)

// `projects` are the repositories the app lists (source-map.js attachSourceProjects), `pinned` the names the owner keeps
// loaded, `runs` and `respondChats` the agent work in progress, `openedAt(repo)` when the owner last opened a repository's list.
export function listTiers({ projects, pinned, login, runs = [], respondChats = [], openedAt = () => '', now = Date.now() }) {
  const atWork = reviewRepositoriesAtWork(runs)
  for (const chat of respondChats) atWork.add(String(chat.repo).toLowerCase())
  const recently = repo => now - (Date.parse(openedAt(repo)) || -Infinity) < ACTIVE_DAYS * DAY_MS
  const isActive = (project, repo) => !!project.reviewRequests?.length || !!project.contributions?.length
    || (project.incomingReviews || []).some(pr => sameLogin(pr.author?.login, login)) || atWork.has(repo) || recently(repo)
  const tiers = { pinned: [], active: [], quiet: [] }
  const seen = new Set()
  for (const project of projects) {
    const repo = repoOf(project)
    if (!repo || seen.has(repo)) continue
    seen.add(repo)
    tiers[pinned.has(repo) ? 'pinned' : isActive(project, repo) ? 'active' : 'quiet'].push(repo)
  }
  return tiers
}
