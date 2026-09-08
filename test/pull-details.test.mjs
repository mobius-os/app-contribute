import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPullVersion, loadPullDescription, loadPullFiles, loadPullActivity, pullPath } from '../pull-details.js'
const pr = { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'a'.repeat(40), baseRefOid: 'b'.repeat(40), baseRefName: 'main' }
const detail = () => ({ head: {sha:pr.headRefOid}, base: {sha:pr.baseRefOid,ref:pr.baseRefName}, body: 'Description' })
const response = data => new Response(JSON.stringify(data))
test('read paths cannot escape the selected repository', () => {
  assert.equal(pullPath(pr),'repos/team/repo/pulls/7')
  for (const name of ['../repo','x/y/z','https://evil.test/repo']) assert.throws(()=>pullPath({...pr,repository:{nameWithOwner:name}}))
  assert.throws(()=>pullPath({...pr,number:0}))
})
test('each component of the selected head and base is required', () => {
  assert.deepEqual(assertPullVersion(pr,detail()),detail())
  for (const field of ['head','base']) { const changed=detail();changed[field].sha='c'.repeat(40);assert.throws(()=>assertPullVersion(pr,changed),{code:'stale'}) }
  const changed=detail();changed.base.ref='release';assert.throws(()=>assertPullVersion(pr,changed),{code:'stale'})
})
test('descriptions are GET-only and do not fetch file patches', async t => {
  const calls=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return response(detail())})
  assert.equal((await loadPullDescription('fixture',pr)).body,'Description')
  assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.ok(!calls[0].url.includes('/files'))
})
test('file page rejects a changed branch rather than showing stale diff evidence', async t => {
  t.mock.method(globalThis,'fetch',async url => response(url.includes('/files?') ? [{filename:'file.js',patch:'+changed'}] : {...detail(),head:{sha:'c'.repeat(40)}}))
  await assert.rejects(loadPullFiles('fixture',pr),{code:'stale'})
})
test('file pages retain absent binary patches and disclose the provider cap', async t => {
  t.mock.method(globalThis,'fetch',async url=>response(url.includes('/files?')?Array.from({length:100},(_,i)=>({filename:'file'+i})):detail()))
  const first=await loadPullFiles('fixture',pr);assert.equal(first.hasMore,true);assert.equal(first.files[0].patch,undefined)
  const last=await loadPullFiles('fixture',pr,30);assert.equal(last.hasMore,false);assert.equal(last.capped,true)
  await assert.rejects(loadPullFiles('fixture',pr,31))
})
test('activity retains successful comments when reviews fail and reports the failure', async t => {
  t.mock.method(globalThis,'fetch',async url=>url.includes('/reviews?')?new Response('',{status:503}):response([{id:1,body:'Question',created_at:'2026-09-07T12:00:00Z'}]))
  const result=await loadPullActivity('fixture',pr)
  assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'comment');assert.equal(result.errors.length,1)
})
