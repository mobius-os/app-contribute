import { fetchLiveStates } from './api.js'
import { mayMerge } from './collaboration.js'

const ID = /^[A-Za-z0-9_-]{8,64}$/
const SHA = /^[a-f0-9]{40}$/
export function reviewSelectionIdFromIntent(intent) {
  const match = /^review-selection:([A-Za-z0-9_-]{8,64})$/.exec(String(intent || ''))
  return match?.[1] || null
}

// Saved selection data is a proposal. It contains neither consent nor a grant.
export function selectedReviewRequest(value, id) {
  if (!ID.test(id) || value?.request_id !== id || !['review', 'review_merge'].includes(value?.mode)
      || !Array.isArray(value.items) || !value.items.length || value.items.length > 20) throw new Error('This review link is invalid. Ask the agent to prepare it again.')
  const items = value.items.map(item => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(item.repo) || !Number.isInteger(item.number) || item.number < 1
        || !SHA.test(item.head_sha) || !SHA.test(item.base_sha) || typeof item.base_ref !== 'string' || !item.base_ref || item.base_ref.length > 256) throw new Error('This review link is incomplete. Ask the agent to prepare it again.')
    return { repo: item.repo.toLowerCase(), number: item.number, head_sha: item.head_sha, base_ref: item.base_ref, base_sha: item.base_sha }
  }).sort((a, b) => a.repo.localeCompare(b.repo) || a.number - b.number)
  if (new Set(items.map(item => `${item.repo}#${item.number}`)).size !== items.length) throw new Error('This review link repeats a pull request.')
  return { request_id: id, mode: value.mode, items }
}

export async function loadReviewSelection(id) {
  if (!ID.test(id)) throw new Error('Invalid review link.')
  const { value } = await window.mobius.storage.getWithVersion(`review-selections/${id}.json`)
  return selectedReviewRequest(value, id)
}

export async function inspectReviewSelection(token, request) {
  const fields = request.items.map((item, index) => {
    const [owner, name] = item.repo.split('/')
    return `p${index}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}) { nameWithOwner viewerPermission isArchived pullRequest(number:${item.number}) { number title url state isDraft headRefOid baseRefName baseRefOid } }`
  }).join('\n')
  const data = await fetchLiveStates(token, `query ContributeReviewSelection { ${fields} }`)
  if (!data) throw new Error('Could not check these contributions. Retry when GitHub is available.')
  const pulls = request.items.map((item, index) => {
    const repository = data[`p${index}`]
    const pr = repository?.pullRequest
    if (!pr || repository.nameWithOwner?.toLowerCase() !== item.repo || pr.number !== item.number
        || pr.state !== 'OPEN' || pr.headRefOid !== item.head_sha || pr.baseRefOid !== item.base_sha || pr.baseRefName !== item.base_ref) throw new Error('A selected contribution changed or closed. Ask the agent for a fresh review link; nothing was approved.')
    return { ...pr, repository: { nameWithOwner: repository.nameWithOwner, viewerPermission: repository.isArchived ? null : repository.viewerPermission } }
  })
  return { ...request, pulls, canMerge: pulls.every(pr => !pr.isDraft && mayMerge(pr.repository.viewerPermission)) }
}
