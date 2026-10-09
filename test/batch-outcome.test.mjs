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
  assert.equal(api.batchRecordOutcome({...opened,status:mode==='ready'?'draft':'prepared',plan:{...opened.plan,action:'pr_update'}},{...opened,status:state,plan:{...opened.plan,action:'pr_update'}},{pending:true},mode),state)
 }
})
test('an existing PR link and static planned head cannot settle an unconfirmed update without its canonical publication marker',async t=>{
 const api=await load(t);if(!api)return
 const update={...record,number:1,plan:{...record.plan,action:'pr_update'}}
 assert.equal(api.batchRecordOutcome(update,{...opened,plan:update.plan},{pending:true},'send'),'checking')
 assert.equal(api.batchRecordOutcome(update,{...opened,plan:update.plan,last_submit_push_sha:record.plan.head_sha},{pending:true},'send'),'done')
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

const stacked={...phase,plan:{...phase.plan,branch:'stack/chain/2',base_branch:undefined,base_sha:'b'.repeat(40),stack:{id:'chain',position:2,total:2,base_branch:'stack/chain/1',parent_record_id:'parent'}}}
test('late stack failures belong only to the frozen effective target and member identity',async t=>{
 const api=await load(t);if(!api)return
 for(const mode of ['send','ready']) {
  const frozen=mode==='ready'?{...stacked,status:'draft',number:2,url:'https://github.com/team/repo/pull/2'}:stacked
  const errorKey=mode==='ready'?'last_ready_error':'last_submit_error'
  const current={...frozen,updated_at:failed.updated_at,[errorKey]:'Exact stack phase failed'}
  assert.deepEqual(api.canonicalBatchRecordOutcome(frozen,current,mode),{error:current[errorKey]})
  const alternatives=[
   {...frozen.plan,stack:{...frozen.plan.stack,base_branch:'stack/other/1'}},
   {...frozen.plan,stack:{...frozen.plan.stack,parent_record_id:'other'}},
   {...frozen.plan,stack:{...frozen.plan.stack,id:'other'}},
   {...frozen.plan,stack:{...frozen.plan.stack,position:1}},
   {...frozen.plan,stack:{...frozen.plan.stack,total:3}},
   {...frozen.plan,stack:undefined}, {...frozen.plan,stack:null},
   {...frozen.plan,stack:{...frozen.plan.stack,position:'invalid'}},
   {...frozen.plan,base_branch:'stack/chain/1'},
  ]
  for(const plan of alternatives) {
   assert.equal(api.canonicalBatchRecordOutcome(frozen,{...current,plan},mode),null,mode+' '+JSON.stringify(plan))
   assert.equal(api.batchRecordOutcome(frozen,{...current,plan},{pending:true},mode),'checking')
  }
  const noStack={...frozen,plan:{...frozen.plan}};delete noStack.plan.stack
  assert.equal(api.canonicalBatchRecordOutcome(noStack,current,mode),null,'added stack is a different phase')
  const removed={...current,plan:{...current.plan}};delete removed.plan.stack
  assert.equal(api.canonicalBatchRecordOutcome(frozen,removed,mode),null,'removed stack is a different phase')
  const malformed={...frozen,plan:{...frozen.plan,stack:{...frozen.plan.stack,total:1}}}
  assert.equal(api.canonicalBatchRecordOutcome(malformed,{...current,plan:malformed.plan},mode),null,'invalid descriptors cannot identify failure')
  assert.deepEqual(api.canonicalBatchRecordOutcome(frozen,{...current,plan:{...current.plan,stack:{...current.plan.stack,name:'New display label'}}},mode),{error:current[errorKey]},'display label is not publication identity')
 }
})

test('flat descriptor additions, removals and fallback branch drift cannot attribute another publication phase',async t=>{
 const api=await load(t);if(!api)return
 for(const mode of ['send','ready']) {
  const frozen=mode==='ready'?{...phase,status:'draft',number:1,url:'https://github.com/team/repo/pull/1'}:phase
  const current={...frozen,updated_at:failed.updated_at,[mode==='ready'?'last_ready_error':'last_submit_error']:'New diagnostic'}
  for(const key of ['action','branch','base_branch']) {
   const plan={...current.plan};delete plan[key]
   assert.equal(api.canonicalBatchRecordOutcome(frozen,{...current,plan},mode),null,'removed '+key)
  }
  assert.equal(api.canonicalBatchRecordOutcome(frozen,{...current,plan:{...current.plan,base_sha:'c'.repeat(40)}},mode),null,'added base SHA')
  const fallback={...frozen,branch:'fix/a',plan:{...frozen.plan}};delete fallback.plan.branch
  assert.equal(api.canonicalBatchRecordOutcome(fallback,{...current,branch:'fix/other',plan:fallback.plan},mode),null,'effective fallback branch changed')
 }
})

test('first-layer parent absence and invalid values cannot impersonate its frozen descriptor',async t=>{
 const api=await load(t);if(!api)return
 for(const mode of ['send','ready']) {
  const frozen={...stacked,status:mode==='ready'?'draft':'prepared',number:mode==='ready'?1:undefined,url:mode==='ready'?'https://github.com/team/repo/pull/1':undefined,plan:{...stacked.plan,branch:'stack/chain/1',stack:{...stacked.plan.stack,position:1,base_branch:'main',parent_record_id:''}}}
  const current={...frozen,updated_at:failed.updated_at,[mode==='ready'?'last_ready_error':'last_submit_error']:'Exact first-layer diagnostic'}
  for(const parent of [null,undefined,42]) {
   const plan={...current.plan,stack:{...current.plan.stack,parent_record_id:parent}}
   assert.equal(api.canonicalBatchRecordOutcome(frozen,{...current,plan},mode),null)
  }
  const missing={...current,plan:{...current.plan,stack:{...current.plan.stack}}};delete missing.plan.stack.parent_record_id
  assert.equal(api.canonicalBatchRecordOutcome(frozen,missing,mode),null)
  const absent={...frozen,plan:missing.plan}
  assert.deepEqual(api.canonicalBatchRecordOutcome(absent,missing,mode),{error:current[mode==='ready'?'last_ready_error':'last_submit_error']},'unchanged optional root parent stays valid')
  assert.equal(api.canonicalBatchRecordOutcome(absent,current,mode),null,'adding the parent descriptor is not this frozen phase')
  const invalid={...frozen,plan:{...frozen.plan,stack:{...frozen.plan.stack,parent_record_id:null}}}
  assert.equal(api.canonicalBatchRecordOutcome(invalid,{...current,plan:invalid.plan},mode),null)
 }
})


test('explicit preflight rejection is not an uncertain public attempt, but cannot release an existing claim',async t=>{
 const api=await load(t);if(!api)return
 const error='Fresh ledger unavailable. Nothing was sent.'
 const stopped={notAttempted:true,error,failure:{owner:'automatic'}}
 for(const mode of ['send','ready']) {
  const frozen=mode==='ready'?{...opened,status:'draft'}:record
  assert.deepEqual(api.batchRecordOutcome(frozen,frozen,stopped,mode),{notAttempted:true,error})
  for(const flag of ['pending','uncertain','ok','alreadyHandled']) {
   assert.equal(api.batchRecordOutcome(frozen,frozen,{...stopped,[flag]:true},mode),'checking')
  }
  assert.equal(api.batchRecordOutcome(frozen,{...frozen,status:'submitting'},stopped,mode),'checking')
  assert.equal(api.batchRecordOutcome(frozen,{...frozen,readying:true},stopped,mode),'checking')
  assert.equal(api.batchRecordOutcome(frozen,opened,stopped,mode),'done','canonical settlement still wins')
 }
})

// Publication adds receipts, not permission to change the confirmed intent.
test('canonical public outcomes require the same frozen publication intent in every phase',async t=>{
 const api=await load(t);if(!api)return
 const stopped={notAttempted:true,error:'Approval changed',failure:{owner:'agent',code:'approval_changed'}}
 for(const source of [phase,stacked]) for(const mode of ['send','ready']) {
  const frozen={...source,...(mode==='ready'?{status:'draft',number:1,url:opened.url}:{})}
  const publicRecord={...frozen,status:'open',number:1,url:opened.url}
  const plans=[]
  for(const key of ['action','branch','base_branch','base_sha']) {
   plans.push({...frozen.plan,[key]:'different'})
   const removed={...frozen.plan};delete removed[key]
   if(frozen.plan[key]!==undefined)plans.push(removed)
  }
  if(source===stacked) {
   for(const [key,value] of Object.entries({id:'other',position:1,total:3,base_branch:'main',parent_record_id:'other'}))
    plans.push({...frozen.plan,stack:{...frozen.plan.stack,[key]:value}})
   for(const value of [null,undefined,{}, {...frozen.plan.stack,total:1}])plans.push({...frozen.plan,stack:value})
   const removed={...frozen.plan};delete removed.stack;plans.push(removed)
   const absentParent={...frozen.plan,stack:{...frozen.plan.stack}};delete absentParent.stack.parent_record_id;plans.push(absentParent)
   for(const value of [null,undefined,42])plans.push({...frozen.plan,stack:{...frozen.plan.stack,parent_record_id:value}})
  } else plans.push({...frozen.plan,stack:stacked.plan.stack})
  for(const plan of plans) for(const status of ['draft','open','landing','closed','merged']) {
   const current={...publicRecord,status,plan}
   assert.equal(api.canonicalBatchRecordOutcome(frozen,current,mode),null,mode+' '+status+' '+JSON.stringify(plan))
   assert.deepEqual(api.batchRecordOutcome(frozen,current,stopped,mode),{notAttempted:true,error:stopped.error})
   for(const outcome of [{pending:true},{uncertain:true},{ok:true},{alreadyHandled:true},{}])
    assert.equal(api.batchRecordOutcome(frozen,current,outcome,mode),'checking')
  }
  // Owning publication writes these operational fields without rewriting plan.
  const published={...publicRecord,branch:frozen.plan.branch,head_repository:'owner/repo',
   publication_stage:'ready',submitted_at:failed.updated_at,updated_at:failed.updated_at,
   last_submit_push_sha:frozen.plan.head_sha,last_submit_base_branch:source===stacked?'stack/chain/1':'main',
   last_submit_upstream_sha:'c'.repeat(40),last_pushed_branch:'owner:'+frozen.plan.branch}
  if(source===stacked)published.plan={...published.plan,stack:{...published.plan.stack,name:'New display name'}}
  assert.equal(api.canonicalBatchRecordOutcome(frozen,{...published,last_submit_base_branch:'other'},mode),null,'observed target cannot contradict frozen target')
  for(const outcome of [stopped,{pending:true},{uncertain:true},{}])
   assert.equal(api.batchRecordOutcome(frozen,published,outcome,mode),'done')
  for(const status of ['closed','merged'])assert.equal(api.canonicalBatchRecordOutcome(frozen,{...published,status},mode),status)
  const fallback={...frozen,branch:'fix/a',plan:{...frozen.plan}};delete fallback.plan.branch
  assert.equal(api.canonicalBatchRecordOutcome(fallback,{...published,plan:fallback.plan,branch:'fix/other'},mode),null)
  assert.equal(api.canonicalBatchRecordOutcome(fallback,{...published,plan:fallback.plan,branch:'fix/a'},mode),'done')
 }
})


test('backend attribution normalization settles only its exact published head and unchanged intent',async t=>{
 const api=await load(t);if(!api)return
 const normalized='d'.repeat(40)
 for(const source of [phase,stacked]) for(const action of ['pr','pr_update']) {
  const frozen={...source,plan:{...source.plan,action},...(action==='pr_update'?{number:1,url:opened.url}:{})}
  const published={...frozen,status:'open',number:1,url:opened.url,head_sha:normalized,
   plan:{...frozen.plan,head_sha:normalized,attribution_normalized_from:frozen.plan.head_sha},last_submit_push_sha:normalized}
  for(const outcome of [{pending:true},{uncertain:true},{ok:true},{}])
   assert.equal(api.batchRecordOutcome(frozen,published,outcome,'send'),'done')
  const invalid=[
   {...published,plan:{...published.plan,attribution_normalized_from:undefined}},
   {...published,plan:{...published.plan,attribution_normalized_from:'e'.repeat(40)}},
   {...published,head_sha:undefined}, {...published,head_sha:'e'.repeat(40)},
   {...published,last_submit_push_sha:undefined}, {...published,last_submit_push_sha:frozen.plan.head_sha},
   {...published,head_sha:'bad',last_submit_push_sha:'bad',plan:{...published.plan,head_sha:'bad'}},
   {...published,status:'submitting'}, {...published,status:'prepared'},
  ]
  for(const key of ['action','branch','base_branch','base_sha'])invalid.push({...published,plan:{...published.plan,[key]:'other'}})
  if(source===stacked)for(const key of ['id','position','total','base_branch','parent_record_id'])
   invalid.push({...published,plan:{...published.plan,stack:{...published.plan.stack,[key]:'other'}}})
  for(const current of invalid) {
   assert.equal(api.canonicalBatchRecordOutcome(frozen,current,'send'),null,JSON.stringify(current))
   for(const outcome of [{ok:true},{pending:true},{uncertain:true},{}])
    assert.equal(api.batchRecordOutcome(frozen,current,outcome,'send'),'checking')
  }
  assert.equal(api.batchRecordOutcome(frozen,frozen,{ok:true},'send'),'checking','acknowledgement alone is not publication')
  assert.equal(api.canonicalBatchRecordOutcome({...frozen,status:'draft',number:1,url:opened.url},published,'ready'),null,'requesting review cannot normalize a head')
 }
})
