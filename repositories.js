import { repositoryName } from './collaboration.js'

export const FOLLOWED_REPOSITORIES = 'followed-repositories.json'
export function followedRepositories(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(repositoryName).filter(Boolean))]
}

// One versioned write of a preference: read it, change it, write it only if nobody else has since, and once more if
// somebody had. `change(value)` answers the next value.
async function changePreference(path, change, conflictWords) {
  const store = window.mobius.storage
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { value, version } = await store.getWithVersion(path)
    const next = change(value)
    try {
      await store.durableWrite(path, next, version ? { ifMatch: version } : { ifNoneMatch: true })
      return next
    } catch (error) { if (error.code !== 'conflict') throw error }
  }
  throw new Error(conflictWords)
}

// This is a workspace preference, never a GitHub permission or merge grant.
export async function followRepository(name) {
  const repo = repositoryName(name)
  if (!repo) throw new Error('Choose a valid GitHub repository.')
  if (window.mobius?.online === false) throw new Error('Reconnect before adding a repository.')
  return changePreference(FOLLOWED_REPOSITORIES, value => followedRepositories([...(Array.isArray(value) ? value : []), repo]),
    'Your project list changed elsewhere. Try adding this repository again.')
}

// The repositories whose pull requests are always loaded in the background (list-tiers.js), as the owner chose them:
// { 'owner/name': true | false }. The platform's repository is loaded unless the owner turned it off, so a choice about
// another repository never decides it. Only a preference of this workspace: it grants nothing on GitHub.
export const PINNED_REPOSITORIES = 'pinned-repositories.json'
export function pinChoices(value) {
  const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []
  return Object.fromEntries(entries.map(([name, chosen]) => [repositoryName(name), chosen]).filter(([name, chosen]) => name && typeof chosen === 'boolean'))
}
export function pinnedRepositories(choices, platformRepo = '') {
  const platform = repositoryName(platformRepo)
  const pinned = Object.entries(choices).filter(([, chosen]) => chosen).map(([name]) => name)
  return new Set(platform && choices[platform] !== false ? [platform, ...pinned] : pinned)
}

export async function setRepositoryPinned(name, pinned) {
  const repo = repositoryName(name)
  if (!repo) throw new Error('Choose a valid GitHub repository.')
  return changePreference(PINNED_REPOSITORIES, value => ({ ...pinChoices(value), [repo]: !!pinned }),
    'The repositories you always load changed elsewhere. Try again.')
}
