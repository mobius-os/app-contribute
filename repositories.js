import { repositoryName } from './collaboration.js'

export const FOLLOWED_REPOSITORIES = 'followed-repositories.json'
export function followedRepositories(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(repositoryName).filter(Boolean))]
}

// This is a workspace preference, never a GitHub permission or merge grant.
export async function followRepository(name) {
  const repo = repositoryName(name)
  if (!repo) throw new Error('Choose a valid GitHub repository.')
  if (window.mobius?.online === false) throw new Error('Reconnect before adding a repository.')
  const store = window.mobius.storage
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { value, version } = await store.getWithVersion(FOLLOWED_REPOSITORIES)
    const next = followedRepositories([...(Array.isArray(value) ? value : []), repo])
    try {
      await store.durableWrite(FOLLOWED_REPOSITORIES, next, version ? { ifMatch: version } : { ifNoneMatch: true })
      return next
    } catch (error) { if (error.code !== 'conflict') throw error }
  }
  throw new Error('Your project list changed elsewhere. Try adding this repository again.')
}
