// A PR retargeted to a branch the review never saw shows that review as current. The review of the same code is still found (GitHub
// retargets a PR when its parent merges), and the Review tab now says it was made against another branch.
import assert from 'node:assert/strict'
import test from 'node:test'
import { reviewForPull, reviewedOtherBranch } from '../collaboration.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { standingFor } from '../pr-standing.js'

const HEAD = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const pull = (extra = {}) => ({ number: 9, repository: { nameWithOwner: 'team/repo' }, headRefOid: HEAD, baseRefName: 'main', baseRef: { target: { oid: TIP } }, url: 'https://github.com/team/repo/pull/9', ...extra })
const reviewItem = (extra = {}) => ({ repo: 'team/repo', number: 9, head_sha: HEAD, base_ref: 'main', base_sha: TIP, state: 'all_clear', ...extra })
const run = item => ({ id: 'r1', state: 'done', execution_state: 'completed', mode: 'review', chat_id: 'chat-1', created_at: new Date().toISOString(), items: [item] })

test('a review is of another branch only when its branch is known and is not the one the PR is aimed at now', () => {
  const review = item => reviewForPull([run(item)], pull())
  assert.equal(reviewedOtherBranch(review(reviewItem()), pull()), false, 'the branch it was made against')
  assert.equal(reviewedOtherBranch(review(reviewItem({ base_ref: 'release' })), pull()), true, 'retargeted')
  const moved = review(reviewItem({ base_sha: 'c'.repeat(40) }))
  assert.equal(moved.exactBase, false)
  assert.equal(reviewedOtherBranch(moved, pull()), false, 'the tip of the same branch moved on: not another branch')
  assert.equal(reviewedOtherBranch(review(reviewItem({ base_ref: '' })), pull({ baseRefName: 'main' })), false, 'a review that does not name its branch is not claimed to be of another')
  assert.equal(reviewedOtherBranch(review(reviewItem()), pull({ baseRefName: '' })), false)
  assert.equal(reviewedOtherBranch(null, pull()), false)
  assert.equal(reviewedOtherBranch(review(reviewItem()), null), false)
})

test('the review of a retargeted PR is still found (the same code), and says it did not see this branch', () => {
  const retargeted = pull({ baseRefName: 'release' })
  const found = reviewForPull([run(reviewItem())], retargeted)
  assert.equal(found?.exactBase, false)
  assert.equal(reviewedOtherBranch(found, retargeted), true)
})

let renderer
async function renderTab(t, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewTab } from './ui/ReviewTab.jsx'
    export function render(props) { return renderToStaticMarkup(React.createElement(ReviewTab, props)) }
  `)
  const live = { ...props.pr, state: 'OPEN', author: { login: 'sam' }, mergeable: 'MERGEABLE', repository: { ...props.pr.repository, viewerPermission: 'WRITE' }, latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }
  const standing = standingFor({ pr: live, login: 'me', runs: [{ ...props.status.run, items: [props.status.item] }] })
  return (await renderer).render({ ...props, standing })
}
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('the Review tab says, in one plain line under the saved version, that the review was made against another branch', async (t) => {
  const retargeted = pull({ baseRefName: 'release' })
  const html = await renderTab(t, { pr: retargeted, status: reviewForPull([run(reviewItem())], retargeted) })
  if (!html) return
  assert.match(strip(html), /This review was made against main\. This PR now targets release\./)
  assert.match(html, /<p class="co-review-note">This review was made against main\. This PR now targets release\.<\/p>/, 'in the tab\'s own note style')
  for (const [label, item] of [['exact', reviewItem()], ['the tip moved on the same branch', reviewItem({ base_sha: 'c'.repeat(40) })]]) {
    const same = await renderTab(t, { pr: pull(), status: reviewForPull([run(item)], pull()) })
    assert.doesNotMatch(same, /made against/, label)
  }
})
