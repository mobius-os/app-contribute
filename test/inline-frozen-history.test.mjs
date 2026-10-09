import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession } from '../inline-session.js'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
const reviews = records => ({state:'ready',byId:Object.fromEntries(records.map(rec=>[rec.id,{state:'ready'}]))})
const receipt = rec => ({...rec,status:'open',number:12,url:`https://github.com/${rec.plan.repo}/pull/12`,updated_at:'2026-10-08T22:07:00Z'})
function fixture(records, outcome={pending:true}) {
 const states=[],sends=[],key='chat-send-batch:'+records.map(rec=>rec.id).join(',')
 const session=createInlineSession({sessionId:'history',actions:[{key}],publish:state=>states.push(state),loadExact:async id=>records.find(rec=>rec.id===id),
  send:async rec=>{sends.push(rec);return outcome},sendStack:async recs=>{sends.push(recs);return outcome}})
 async function read(){session.updateLedger(records,true,reviews(records));await session.hydrate()}
 return {session,states,sends,key,read}
}
for(const blocked of ['changes needed','unreviewed','whole linked unit','incomplete linked unit']) test(`frozen history excludes ${blocked} skipped work without reconstructing eligibility`,async()=>{
 const skipped=blocked.includes('linked unit')?targetCaseRecords({stack:true}):[targetRecord('skipped.2')]
 if(blocked==='incomplete linked unit')skipped.pop()
 skipped[0].quality_review=blocked==='unreviewed'?undefined:{state:'changes_needed'}
 const records=[targetRecord('first.3'),...skipped],f=fixture(records)
 try{await f.read();assert.equal(f.session.canFreeze(f.key),true);assert.deepEqual(f.session.readFrozenRecords(f.key),[])
  f.session.activate(f.key);const frozen=f.session.readFrozenRecords(f.key)
  assert.deepEqual(frozen.map(rec=>rec.id),['first.3']);assert.deepEqual(f.session.readFrozenRecords('chat-send:skipped.2'),[])
  frozen[0].plan.branch='mutated local copy';assert.equal(f.session.readFrozenRecords(f.key)[0].plan.branch,'fix/original')
  await f.session.confirm(f.key);assert.equal(f.sends.length,1);assert.equal(f.sends[0].plan.branch,'fix/original');
  const phases=JSON.parse(f.states.at(-1).checkpoint.data).phases;assert.deepEqual(phases.flatMap(phase=>phase.phaseIds),['first.3']);assert.deepEqual(phases.flatMap(phase=>phase.observations.map(value=>value.id)),['first.3']);
  assert.deepEqual(f.session.readFrozenRecords(f.key),[])
 }finally{f.session.dispose()}
})
test('a deduplicated ready chain freezes full successful parent context while excluding an independent skipped unit',async()=>{
 const chain=targetCaseRecords({stack:true});chain[0]=receipt(chain[0])
 const records=[...chain,{...targetRecord('skipped.3'),quality_review:{state:'changes_needed'}}],f=fixture(records)
 try{await f.read();f.session.activate(f.key);assert.deepEqual(f.session.readFrozenRecords(f.key).map(rec=>rec.id),chain.map(rec=>rec.id))
  await f.session.confirm(f.key);assert.equal(f.sends.length,1);assert.equal(f.sends[0][0].status,'open');assert.deepEqual(f.sends[0].filter(rec=>rec.status==='prepared').map(rec=>rec.id),[chain[1].id])
 }finally{f.session.dispose()}
})
test('all ready independent units freeze together; cancel and disposal do not expose latent history',async()=>{
 const records=[targetRecord(),targetRecord('other.2')],f=fixture(records)
 try{await f.read();f.session.activate(f.key);assert.deepEqual(f.session.readFrozenRecords(f.key).map(rec=>rec.id),records.map(rec=>rec.id))
  f.session.cancel(f.key);assert.deepEqual(f.session.readFrozenRecords(f.key),[]);assert.equal(f.sends.length,0)
  f.session.activate(f.key);f.session.dispose();assert.deepEqual(f.session.readFrozenRecords(f.key),[]);assert.equal(f.sends.length,0)
 }finally{f.session.dispose()}
})
for(const result of ['public','known failure','unknown']) test(`repaired skipped target needs fresh approval after ${result} first-owner outcome`,async()=>{
 const records=[targetRecord(),{...targetRecord('skipped.2'),quality_review:{state:'changes_needed'}}],f=fixture(records,result==='known failure'?{error:'Known exact failure'}:{pending:true})
 try{await f.read();f.session.activate(f.key);assert.deepEqual(f.session.readFrozenRecords(f.key).map(rec=>rec.id),[records[0].id]);await f.session.confirm(f.key)
  if(result==='public')records[0]=receipt(records[0])
  records[1]={...records[1],plan:{...records[1].plan,title:'Current repaired target',head_sha:'c'.repeat(40),branch:'fix/current',base_branch:'release'},quality_review:{state:'all_clear',reviewed_head_sha:'c'.repeat(40)},updated_at:'2026-10-08T22:07:00Z'}
  await f.read();assert.equal(f.sends.length,1)
  if(result==='unknown'){assert.equal(f.session.canFreeze(f.key),false);assert.ok(f.states.at(-1).checkpoint)}
  else{assert.equal(f.session.canFreeze(f.key),true);f.session.activate(f.key);assert.deepEqual(f.session.readFrozenRecords(f.key).map(rec=>rec.id),['skipped.2']);await f.session.confirm(f.key)
   assert.equal(f.sends.length,2);assert.equal(f.sends[1].plan.title,'Current repaired target');assert.equal(f.sends[1].plan.head_sha,'c'.repeat(40))}
 }finally{f.session.dispose()}
})
