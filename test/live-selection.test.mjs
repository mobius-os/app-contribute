import assert from 'node:assert/strict'
import test from 'node:test'
import { liveSelection } from '../collaboration.js'

const pr = (number, head, base, extra = {}) => ({ number, headRefOid: head, baseRefOid: base, baseRefName: 'main', isDraft: false, state: 'OPEN', repository: { nameWithOwner: 'team/repo' }, ...extra })
function github(current) {
  return async (_url, options) => {
    const query = JSON.parse(options.body).query
    const number = Number(query.match(/pullRequest\(number:(\d+)\)/)[1])
    return new Response(JSON.stringify({ data: { repository: { pullRequest: current[number] } } }))
  }
}

test('an unchanged PR follows its moved target branch instead of failing the launch', async t => {
  t.mock.method(globalThis, 'fetch', github({ 7: pr(7, 'head-a', 'base-new') }))
  const [rebound] = await liveSelection('token', [pr(7, 'head-a', 'base-old')])
  assert.equal(rebound.headRefOid, 'head-a')
  assert.equal(rebound.baseRefOid, 'base-new')
})

test('changed code or draft state is never silently accepted', async t => {
  t.mock.method(globalThis, 'fetch', github({ 7: pr(7, 'head-b', 'base-new'), 8: pr(8, 'head-c', 'base-new', { isDraft: true }) }))
  await assert.rejects(liveSelection('token', [pr(7, 'head-a', 'base-old')]), error => error.code === 'changed' && /#7 changed/.test(error.message))
  await assert.rejects(liveSelection('token', [pr(8, 'head-c', 'base-old')]), error => error.code === 'changed')
})

test('same-head retargeting cannot inherit the original merge consent', async t => {
  t.mock.method(globalThis, 'fetch', github({ 7: pr(7, 'head-a', 'base-new', {
    baseRefName: 'production', baseRef: { target: { oid: 'production-tip' } },
  }) }))
  await assert.rejects(liveSelection('token', [pr(7, 'head-a', 'base-old')]),
    error => error.code === 'changed' && /#7 changed/.test(error.message))
})

test('merge admission can follow a new tip of the originally approved target', async t => {
  const { reviewRunRequest } = await import('../collaboration.js')
  t.mock.method(globalThis, 'fetch', github({ 7: pr(7, 'head-a', 'comparison', {
    baseRef: { target: { oid: 'main-new-tip' } },
  }) }))
  const pulls = await liveSelection('token', [pr(7, 'head-a', 'comparison', {
    baseRef: { target: { oid: 'main-old-tip' } },
  })])
  const request = reviewRunRequest({ request_id: 'fixture-request', mode: 'review_merge', pulls })
  assert.equal(request.items[0].base_ref, 'main')
  assert.equal(request.items[0].base_sha, 'main-new-tip')
  assert.equal(request.items[0].head_sha, 'head-a')
})
