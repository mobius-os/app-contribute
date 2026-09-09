import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectReviewSelection, reviewSelectionIdFromIntent, selectedReviewRequest } from '../review-selection.js'
import { followedRepositories, followRepository } from '../repositories.js'
import { attachSourceProjects } from '../source-map.js'

const ID = 'selection-fixture'
const item = { repo:'owner/project', number:7, head_sha:'a'.repeat(40), base_ref:'main', base_sha:'b'.repeat(40) }
const proposal = { request_id:ID, mode:'review_merge', items:[item] }

test('review links name proposals, not an executable action or embedded grant', () => {
  assert.equal(reviewSelectionIdFromIntent('review-selection:' + ID), ID)
  for (const invalid of ['review-selection:../record', 'review-selection:a', 'review-selection:' + ID + '?merge=true']) assert.equal(reviewSelectionIdFromIntent(invalid), null)
  assert.deepEqual(selectedReviewRequest({ ...proposal, chat_approval:{context:'untrusted'}, items:[{ ...item, approval:{source:'chat'} }] }, ID), proposal)
  for (const value of [{ ...proposal, request_id:'another-id' }, { ...proposal, mode:'merge' }, { ...proposal, items:[] }, { ...proposal, items:[item,item] }, { ...proposal, items:[{...item, head_sha:'short'}] }]) assert.throws(() => selectedReviewRequest(value, ID))
})

test('exact proposal inspection never advances its selected versions or writes to GitHub', async t => {
  let changes = {}
  let permission = 'WRITE'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/github/graphql')
    assert.doesNotMatch(options.body, /mutation/)
    return new Response(JSON.stringify({data:{p0:{ nameWithOwner:'owner/project', viewerPermission:permission, pullRequest:{number:7,title:'A change',url:'https://github.com/owner/project/pull/7',state:'OPEN',headRefOid:item.head_sha,baseRefOid:item.base_sha,baseRefName:'main', ...changes} }}}))
  })
  assert.equal((await inspectReviewSelection('fixture', proposal)).canMerge, true)
  permission = 'READ'
  assert.equal((await inspectReviewSelection('fixture', proposal)).canMerge, false)
  for (const change of [{state:'CLOSED'},{headRefOid:'c'.repeat(40)},{baseRefOid:'c'.repeat(40)},{baseRefName:'another'},{number:8}]) {
    changes = change
    await assert.rejects(inspectReviewSelection('fixture', proposal), /changed or closed/)
  }
})

test('GitHub access does not import unrelated repos; saved work and explicit membership survive offline', () => {
  const repo = {nameWithOwner:'openai/baselines', viewerPermission:'ADMIN', openPullRequestCount:42}
  assert.deepEqual(attachSourceProjects(null, [], [], [repo]), [])
  assert.equal(attachSourceProjects(null, [], [], [], ['openai/baselines'])[0].canonical_repo, 'openai/baselines')
  const records = [{id:'saved',repo:'other/old-project',type:'pr',status:'merged'}]
  assert.equal(attachSourceProjects(null, records)[0].canonical_repo, 'other/old-project')
  const incoming = [{repository:{nameWithOwner:'team/work'}}]
  assert.equal(attachSourceProjects(null, [], incoming)[0].incomingReviews.length, 1)
})

test('following a repository preserves concurrent choices and never grants permissions', async t => {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  let writes = 0
  globalThis.window = {mobius:{online:true,storage:{
    getWithVersion:async () => ({value: writes ? ['team/other'] : [], version:'v'+writes}),
    durableWrite:async (_key, value, condition) => {
      writes += 1
      if (writes === 1) throw Object.assign(new Error('concurrent choice'), {code:'conflict'})
      assert.deepEqual(value, ['team/other','team/new'])
      assert.deepEqual(condition, {ifMatch:'v1'})
    },
  }}}
  assert.deepEqual(await followRepository('https://github.com/TEAM/new'), ['team/other','team/new'])
  assert.deepEqual(followedRepositories(['team/new','TEAM/new','bad']), ['team/new'])
  globalThis.window.mobius.online = false
  await assert.rejects(followRepository('team/new'), /Reconnect/)
})
