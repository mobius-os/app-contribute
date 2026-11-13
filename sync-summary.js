// What a Sync changed on the desk, in one quiet line. The desk is what the line speaks for (Needs you, Review
// requests and the repositories' GitHub updates); the repositories' own PR lists are not compared here, so the line
// says "Nothing new for you" and never "nothing changed". Pure, so every sentence is tested without a browser.
import { needsCount } from './desk.js'
import { projectHasSharedUpdates } from './source-map.js'
import { prKey } from './collaboration.js'

// The facts a Sync is compared by, read from what the app shows right now.
export function syncFacts({ incoming = [], counts = {}, projects = [], checks = {} } = {}) {
  return {
    requests: new Set(incoming.filter(pr => pr.reviewRequested).map(prKey)),
    needs: needsCount(counts),
    behind: new Set(projects.filter(project => projectHasSharedUpdates(project) || checks[project.key]?.newCommits > 0).map(project => project.name)),
  }
}

const plural = (count, one, many) => `**${count}** ${count === 1 ? one : many}`

// `**3**` marks the numbers (ui/Shine.jsx Words). The words follow what changed, in the order the desk lists it.
export function syncLine(before, after) {
  const newRequests = [...after.requests].filter(key => !before.requests.has(key)).length
  const moved = after.needs - before.needs
  const newBehind = [...after.behind].filter(name => !before.behind.has(name))
  const parts = [
    newRequests > 0 ? plural(newRequests, 'new review request', 'new review requests') : '',
    moved > 0 ? `${plural(moved, 'more thing needs', 'more things need')} you` : '',
    moved < 0 ? `${plural(-moved, 'fewer thing needs', 'fewer things need')} you` : '',
    newBehind.length ? `${newBehind.join(', ')} ${newBehind.length === 1 ? 'has' : 'have'} new commits on GitHub` : '',
  ].filter(Boolean)
  return parts.length ? `Synced. ${parts.join(' · ')}` : 'Synced. Nothing new for you.'
}

// How long the line stays before it goes away by itself.
export const SYNC_LINE_MS = 6000
