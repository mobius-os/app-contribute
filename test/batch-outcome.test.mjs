import test from 'node:test'
import assert from 'node:assert/strict'
import { frontendModules, renderModule } from './render-harness.mjs'
let module
async function load(t) {
  if(!frontendModules){t.skip('MOBIUS_FRONTEND_NODE_MODULES is required');return null}
  return module ||= renderModule(`export { canonicalBatchRecordOutcome, batchRecordOutcome } from './ui/Feed.jsx'`)
}
const record={id:'a',type:'pr',status:'prepared',plan:{repo:'team/repo',head_sha:'a'.repeat(40)}}
const opened={...record,status:'open',number:1,url:'https://github.com/team/repo/pull/1'}
test('acknowledged, pending and unknown batch outcomes cannot settle unchanged prepared work',async t=>{
 const api=await load(t);if(!api)return
 for(const outcome of [{pending:true},{uncertain:true},{ok:true},{alreadyHandled:true},{error:'Unknown'},{error:'Later',failure:{owner:'automatic'}},undefined]) {
  assert.equal(api.batchRecordOutcome(record,record,outcome,'send'),'checking')
 }
})
test('only exact canonical phase evidence settles a batch result, not unrelated or incomplete receipts',async t=>{
 const api=await load(t);if(!api)return
 assert.equal(api.batchRecordOutcome(record,opened,{pending:true},'send'),'done')
 for(const current of [null,record,{...opened,id:'b'},{...opened,plan:{...opened.plan,repo:'other/repo'}},{...opened,url:'https://evil.test/pr/1'},{...opened,status:'submitting'},{...opened,plan:{...opened.plan,head_sha:'b'.repeat(40)}}]) {
  assert.equal(api.canonicalBatchRecordOutcome(record,current,'send'),null)
 }
})
test('review-request settlement needs the named personal draft to be public-ready without a durable readying claim',async t=>{
 const api=await load(t);if(!api)return
 const draft={...opened,status:'draft'}
 assert.equal(api.canonicalBatchRecordOutcome(draft,draft,'ready'),null)
 assert.equal(api.canonicalBatchRecordOutcome(draft,{...opened,readying:true},'ready'),null)
 assert.equal(api.canonicalBatchRecordOutcome(draft,{...opened,number:2,url:'https://github.com/team/repo/pull/2'},'ready'),null)
 assert.equal(api.canonicalBatchRecordOutcome(draft,opened,'ready'),'done')
})
test('known scoped failures retain their honest failure outcome rather than a green completion',async t=>{
 const api=await load(t);if(!api)return
 assert.deepEqual(api.batchRecordOutcome(record,record,{error:'Review changed',failure:{owner:'agent'}},'send'),{error:'Review changed'})
 assert.deepEqual(api.batchRecordOutcome(record,record,{error:'Not allowed',failure:{owner:'owner'}},'send'),{error:'Not allowed'})
})

test('closed or merged drafts and updates show their observed state, never an unproven action-success label',async t=>{
 const api=await load(t);if(!api)return
 for(const mode of ['ready','send']) for(const state of ['closed','merged']) {
  assert.equal(api.batchRecordOutcome({...opened,status:mode==='ready'?'draft':'prepared',plan:{...opened.plan,action:'pr_update'}},{...opened,status:state},{pending:true},mode),state)
 }
})
test('an existing PR link and static planned head cannot settle an unconfirmed update without its canonical publication marker',async t=>{
 const api=await load(t);if(!api)return
 const update={...record,number:1,plan:{...record.plan,action:'pr_update'}}
 assert.equal(api.batchRecordOutcome(update,opened,{pending:true},'send'),'checking')
 assert.equal(api.batchRecordOutcome(update,{...opened,last_submit_push_sha:record.plan.head_sha},{pending:true},'send'),'done')
})
