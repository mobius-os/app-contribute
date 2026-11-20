// Open for review is offered only for a record the platform will honour; where the server still refuses, its own reason is shown.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { actionsMenuModel, mayRunYourAction } from '../actions-menu.js'
import { canOpenForReview, openForReviewRefusal } from '../ready-offer.js'
import { standingFor } from '../pr-standing.js'

const HEAD = 'b'.repeat(40)
const OLD = 'a'.repeat(40)
// A personal draft the app sent, checked at its exact version, as the platform wants it.
const draft = (extra = {}) => ({ id: 'r', status: 'draft', submission_mode: 'github', url: 'https://github.com/o/r/pull/7', number: 7,
  plan: { head_sha: HEAD, repo: 'o/r' }, quality_review: { state: 'all_clear', reviewed_head_sha: HEAD }, last_submit_push_sha: HEAD, last_submit_base_branch: 'main', ...extra })

test('a draft that satisfies every condition of the platform is offered, as before', () => {
  assert.equal(canOpenForReview(draft()), true)
  assert.equal(openForReviewRefusal(draft()), '')
  assert.equal(canOpenForReview(draft({ plan: { head_sha: HEAD, attribution_normalized_from: OLD }, quality_review: { state: 'all_clear', reviewed_head_sha: OLD } })), true, 'a check of the commit the plan was normalised from counts')
})

test('each condition the platform refuses on, alone, takes the offer away and says why', () => {
  const cases = [
    [{ submission_mode: 'mobius-bot' }, /cannot be opened for review from this connection/, 'a relay record'],
    [{ url: undefined }, /no pull request on GitHub recorded/, 'no PR url'],
    [{ number: undefined }, /no pull request on GitHub recorded/, 'no PR number'],
    [{ quality_review: { state: 'changes_needed', reviewed_head_sha: HEAD } }, /agent check must be all clear/, 'a check that found problems'],
    [{ quality_review: { state: 'all_clear', reviewed_head_sha: OLD } }, /agent check must be all clear for this exact version/, 'a check of an older version'],
    [{ quality_review: undefined }, /agent check must be all clear/, 'no check at all'],
    [{ last_submit_push_sha: OLD }, /version on GitHub is not the version that was checked/, 'a push of another version'],
    [{ last_submit_base_branch: '' }, /branch this draft targets is not recorded/, 'no base branch'],
  ]
  for (const [change, words, name] of cases) {
    const record = draft(change)
    assert.equal(canOpenForReview(record), false, name)
    assert.match(openForReviewRefusal(record), words, name)
  }
})

test('a record that does not name its version is not judged: the platform answers, and its reason is shown', () => {
  assert.equal(canOpenForReview({ status: 'draft', submission_mode: 'github' }), true)
  assert.equal(canOpenForReview({ status: 'draft', submission_mode: 'mobius-bot' }), false, 'a relay draft is refused whatever else is known')
})

// ---- The menu.
const pull = (extra = {}) => ({ number: 7, state: 'OPEN', isDraft: true, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE', author: { login: 'alex' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }], statusContextCountsByState: [] } } } }] }, ...extra })
const rows = (record, capabilities) => actionsMenuModel([pull()], [standingFor({ pr: pull(), login: 'alex' })], { record, capabilities }).you.map(item => item.intent)

test('the menu offers Open for review for a record the platform honours and not for one it refuses, whatever the capability says', () => {
  assert.deepEqual(rows(draft(), {}), ['open_for_review'], 'a satisfying record: as it was, with no capability')
  assert.deepEqual(rows(draft({ quality_review: { state: 'all_clear', reviewed_head_sha: OLD } }), {}), [], 'a stale check: no offer')
  assert.ok(!rows(draft({ last_submit_base_branch: '' }), { mark_ready_now: true }).includes('open_for_review'), 'the generic route would skip the record\'s review gate, so it is not a way around it')
  assert.equal(mayRunYourAction('open_for_review', { record: null, capabilities: { mark_ready_now: true } }), true, 'a draft with no record of ours is the platform\'s own action, as before')
  assert.equal(mayRunYourAction('open_for_review', { record: { status: 'draft', submission_mode: 'mobius-bot' }, capabilities: { mark_ready_now: true } }), true, 'a relay draft goes the capability route, as before')
})

test('when the server still refuses, the sheet shows its reason', () => {
  const app = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(app, /error: outcome\.error \|\| 'Could not open for review\.',\s*failure: outcome\.failure,/)
  const api = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
  assert.match(api, /error: detail\.message \|\| 'Could not open for review\.'/)
})
