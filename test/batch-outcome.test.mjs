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

const phase={...record,updated_at:'2026-10-08T22:00:00Z',plan:{...record.plan,action:'pr',branch:'fix/a',base_branch:'main'}}
const failed={...phase,updated_at:'2026-10-08T22:00:02Z',last_submit_error:'Branch protection rejected this exact attempt'}
test('a newer exact terminal canonical submit failure settles pending or unknown without a public PR receipt',async t=>{
 const api=await load(t);if(!api)return
 for(const outcome of [{pending:true},{uncertain:true},{record:{...phase,status:'submitting'}},{error:'Old callback failure',failure:{owner:'agent'}},undefined]) {
  assert.deepEqual(api.batchRecordOutcome(phase,failed,outcome,'send'),{error:failed.last_submit_error})
 }
 assert.deepEqual(api.canonicalBatchRecordOutcome({...phase,last_submit_error:'Prior failure'},failed,'send'),{error:failed.last_submit_error})
})
test('old errors, unavailable versions and unrelated canonical phases do not settle an uncertain action',async t=>{
 const api=await load(t);if(!api)return
 for(const value of [phase,{...failed,updated_at:phase.updated_at},{...failed,updated_at:undefined},{...failed,updated_at:'invalid'},{...failed,id:'other'},{...failed,plan:{...failed.plan,repo:'other/repo'}},{...failed,plan:{...failed.plan,head_sha:'b'.repeat(40)}},{...failed,plan:{...failed.plan,branch:'different'}},{...failed,plan:{...failed.plan,base_branch:'other'}},{...failed,status:'submitting'}]) {
  assert.equal(api.canonicalBatchRecordOutcome(phase,value,'send'),null)
 }
 assert.equal(api.canonicalBatchRecordOutcome({...phase,last_submit_error:failed.last_submit_error},failed,'send'),null)
 assert.equal(api.canonicalBatchRecordOutcome({...phase,updated_at:'invalid'},failed,'send'),null)
 assert.equal(api.canonicalBatchRecordOutcome({...phase,last_submit_error:failed.last_submit_error,last_submit_error_code:'old_code'},failed,'send'),null)
 assert.equal(api.batchRecordOutcome(phase,phase,{error:failed.last_submit_error},'send'),'checking')
})
test('a fresh durable submit-attempt identity can distinguish a repeated diagnostic from an old error',async t=>{
 const api=await load(t);if(!api)return
 const retry={...phase,last_submit_error:failed.last_submit_error,submit_started_at:'2026-10-08T21:59:00Z'}
 assert.equal(api.canonicalBatchRecordOutcome(retry,{...failed,submit_started_at:retry.submit_started_at},'send'),null)
 assert.deepEqual(api.canonicalBatchRecordOutcome(retry,{...failed,submit_started_at:'2026-10-08T22:00:01Z'},'send'),{error:failed.last_submit_error})
})
test('new exact ready failure requires cleared claim, canonical draft target and a newer diagnostic',async t=>{
 const api=await load(t);if(!api)return
 const draft={...opened,updated_at:phase.updated_at,status:'draft'}
 const readyFailed={...draft,updated_at:failed.updated_at,last_ready_error:'Connected account no longer matches',last_ready_error_code:'github_not_connected'}
 assert.deepEqual(api.batchRecordOutcome(draft,readyFailed,{pending:true,error:'Still resolving'},'ready'),{error:readyFailed.last_ready_error})
 for(const value of [{...readyFailed,readying:true},{...readyFailed,number:2,url:'https://github.com/team/repo/pull/2'},{...readyFailed,url:'https://github.com/other/repo/pull/1'},{...readyFailed,updated_at:phase.updated_at},{...readyFailed,last_ready_error_code:'ready_unconfirmed'}]) {
  assert.equal(api.canonicalBatchRecordOutcome(draft,value,'ready'),null)
 }
 assert.equal(api.canonicalBatchRecordOutcome({...draft,last_ready_error:readyFailed.last_ready_error,last_ready_error_code:readyFailed.last_ready_error_code},readyFailed,'ready'),null)
})


test('missing frozen versions cannot attribute a canonical diagnostic to this confirmed phase',async t=>{
 const api=await load(t);if(!api)return
 assert.equal(api.canonicalBatchRecordOutcome(record,failed,'send'),null)
 assert.equal(api.canonicalBatchRecordOutcome(record,{...failed,submit_started_at:'2026-10-08T22:00:01Z'},'send'),null)
 assert.equal(api.canonicalBatchRecordOutcome({...opened,status:'draft'},{...opened,status:'draft',updated_at:failed.updated_at,last_ready_error:'New failure',last_ready_error_code:'ready_failed'},'ready'),null)
 assert.deepEqual(api.canonicalBatchRecordOutcome({...phase,updated_at:undefined,created_at:phase.updated_at},failed,'send'),{error:failed.last_submit_error})
})
