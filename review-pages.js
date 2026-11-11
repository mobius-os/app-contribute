// Reads the rest of everyone who reviewed or commented on a PR. A GitHub answer carries the first page of each
// person's newest review (api.js PR_FIELDS); on a PR with more people the Ask sheet would silently leave the others
// out, and they cannot be added by hand. Every read of PRs passes through api.js fetchLiveStates, which asks for the
// remaining pages here, so every screen sees the whole list. A page that could not be read leaves the list marked
// as not whole (`hasNextPage` stays true): pr-facts.js then says so instead of showing part of it, and this
// must never fail the read it rides on.
import { pullsIn } from './carried-approvals.js'

// The fields of one review, as every page of the list asks for them.
export const REVIEW_FIELDS = 'state body submittedAt author { login __typename } commit { oid }'
const PAGE_SIZE = 100
// Pages read after the first, per PR: up to a thousand more people, far beyond any real review.
const MAX_MORE_PAGES = 10

const moreQuery = (id, after) => `query ContributeMoreReviewers { node(id:${JSON.stringify(id)}) { ... on PullRequest {
  latestReviews(first:${PAGE_SIZE}, after:${JSON.stringify(after)}) { pageInfo { hasNextPage endCursor } nodes { ${REVIEW_FIELDS} } } } } }`

async function completeOne(ask, pull) {
  const list = pull.latestReviews
  for (let page = 0; page < MAX_MORE_PAGES && list.pageInfo.hasNextPage === true; page++) {
    const next = (await ask(moreQuery(pull.id, list.pageInfo.endCursor)))?.node?.latestReviews
    if (!Array.isArray(next?.nodes) || !next.pageInfo?.endCursor) return
    list.nodes.push(...next.nodes)
    list.pageInfo = { hasNextPage: next.pageInfo.hasNextPage === true, endCursor: next.pageInfo.endCursor }
  }
}

// `ask(query)` returns a GitHub answer's data, or null.
export async function completeReviewers(ask, data) {
  try {
    const partial = pullsIn(data).filter(pull => pull.id && Array.isArray(pull.latestReviews?.nodes) && pull.latestReviews.pageInfo?.hasNextPage === true && pull.latestReviews.pageInfo.endCursor)
    await Promise.all(partial.map(pull => completeOne(ask, pull).catch(() => {})))
  } catch {
    // A list left partial is read as partial, which is safe.
  }
  return data
}
