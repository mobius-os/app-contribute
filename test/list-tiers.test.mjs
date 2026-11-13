// Which repositories are read before anyone opens them: pinned, active, quiet.
import assert from 'node:assert/strict'
import test from 'node:test'

import { ACTIVE_DAYS, listTiers } from '../list-tiers.js'
import { hasActiveReview, reviewRepositoriesAtWork } from '../review-frame.js'

const project = (repo, extra = {}) => ({ key: repo, canonical_repo: repo, name: repo, contributions: [], reviewRequests: [], incomingReviews: [], ...extra })
const NOW = Date.parse('2026-11-13T12:00:00Z')
const tiers = (projects, extra = {}) => listTiers({ projects, pinned: new Set(), login: 'owner', now: NOW, ...extra })

test('a repository nothing is going on in is quiet', () => {
  assert.deepEqual(tiers([project('o/idle')]), { pinned: [], active: [], quiet: ['o/idle'] })
})

test('the repositories the owner pinned are always read, even with nothing going on, and ahead of the active ones', () => {
  const result = tiers([project('o/busy', { reviewRequests: [{}] }), project('o/pinned'), project('O/Also-Pinned')], { pinned: new Set(['o/pinned', 'o/also-pinned']) })
  assert.deepEqual(result, { pinned: ['o/pinned', 'o/also-pinned'], active: ['o/busy'], quiet: [] })
})

test('each thing the owner has going on makes a repository active', () => {
  const cases = {
    'a review request': project('o/a', { reviewRequests: [{ number: 1 }] }),
    'a PR of their own that is open': project('o/b', { incomingReviews: [{ author: { login: 'Owner' } }] }),
    'a saved PR of their own': project('o/c', { contributions: [{ id: 'rec' }] }),
  }
  for (const [what, item] of Object.entries(cases)) assert.deepEqual(tiers([item]).active, [item.canonical_repo], what)
  assert.deepEqual(tiers([project('o/d', { incomingReviews: [{ author: { login: 'someone' } }] })]).quiet, ['o/d'], 'someone else\'s PR that only involves the owner is not their own')
})

test('an agent review or a Respond conversation at work makes a repository active, one that has stopped does not', () => {
  const run = (repo, state, execution = 'running') => ({ id: repo, state: 'reviewing', execution_state: execution, items: [{ repo, number: 1, state }] })
  const runs = [run('o/review', 'reviewing'), run('O/Pushing', 'pushing'), run('o/stopped', 'reviewing', 'stopped'), run('o/finished', 'all_clear')]
  const result = tiers(['o/review', 'o/pushing', 'o/stopped', 'o/finished', 'o/respond'].map(repo => project(repo)), { runs, respondChats: [{ repo: 'O/Respond', number: 3, state: 'running' }] })
  assert.deepEqual(result.active, ['o/review', 'o/pushing', 'o/respond'])
  assert.deepEqual(result.quiet, ['o/stopped', 'o/finished'])
  assert.deepEqual([...reviewRepositoriesAtWork(runs)].sort(), ['o/pushing', 'o/review'])
  assert.equal(hasActiveReview(runs), true)
  assert.equal(hasActiveReview([run('o/x', 'all_clear')]), false)
})

test('a repository the owner opened within the last week is active, an older visit is not', () => {
  const opened = { 'o/new': '2026-11-07T13:00:00Z', 'o/old': '2026-11-05T11:00:00Z', 'o/never': '' }
  const result = tiers(['o/new', 'o/old', 'o/never'].map(repo => project(repo)), { openedAt: repo => opened[repo] })
  assert.deepEqual(result, { pinned: [], active: ['o/new'], quiet: ['o/old', 'o/never'] })
  assert.equal(ACTIVE_DAYS, 7)
})

test('a repository counts once, in the order the app lists it, and one without a GitHub repository is left out', () => {
  const result = tiers([project('o/b', { reviewRequests: [{}] }), project('o/a', { reviewRequests: [{}] }), project('O/B'), { key: 'local', name: 'Built here', canonical_repo: null }])
  assert.deepEqual(result, { pinned: [], active: ['o/b', 'o/a'], quiet: [] })
})
