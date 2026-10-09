import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession } from '../inline-session.js'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
const reviews = records => ({state:'ready',byId:Object.fromEntries(records.map(rec=>[rec.id,{state:'ready'}]))})
const receipt = rec => ({...rec,status:'open',number:12,url:`https://github.com/${rec.plan.repo}/pull/12`,updated_at:'2026-10-08T22:03:00Z'})
function fixture(records, options={}) {
 const states=[],sends=[],key='chat-send-batch:'+records.map(rec=>rec.id).join(',')
 let current=records
 const session=createInlineSession({sessionId:'mixed',actions:[...records.map(rec=>({key:'chat-send:'+rec.id})),{key}],...options,
  publish:state=>states.push(state),loadExact:async id=>current.find(rec=>rec.id===id),
  send:async rec=>{sends.push(rec);return options.outcome||{pending:true}},sendStack:async recs=>{sends.push(recs);return options.outcome||{pending:true}}})
 async function update(next=current, review=reviews(next)) {current=next;session.updateLedger(next,true,review);await session.hydrate()}
 return {session,states,sends,key,update,action:()=>states.at(-1).actions.find(action=>action.key===key)}
}
for(const stack of [false,true]) test(`mixed ${stack?'linked owned unit':'submitting record'} and ready unit never contradict the owning disabled action`,async()=>{
 const owned=stack?targetCaseRecords({stack:true}):[targetRecord()];owned[0].status='submitting'
 const f=fixture([...owned,targetRecord('ready.3')])
 try{await f.update();assert.equal(f.action().disabled,true);assert.equal(f.action().status,'Checking result');assert.equal(f.session.canFreeze(f.key),false);assert.deepEqual(f.sends,[])}finally{f.session.dispose()}
})
for(const kind of ['all ready','unreviewed skipped','settled skipped','deduplicated stack']) test(`mixed eligibility preserves explicit usable ${kind} subset`,async()=>{
 let records=kind==='deduplicated stack'?targetCaseRecords({stack:true}):[targetRecord(),targetRecord('ready.3')]
 if(kind==='unreviewed skipped')records[0].quality_review={state:'changes_needed'}
 if(kind==='settled skipped')records[0]=receipt(records[0])
 const f=fixture(records)
 try{await f.update();assert.equal(f.action().disabled,false);assert.equal(f.session.canFreeze(f.key),true);f.session.activate(f.key);await f.session.confirm(f.key)
  assert.equal(f.sends.length,kind==='all ready'?2:1)
  if(kind==='deduplicated stack')assert.deepEqual(f.sends[0].map(rec=>rec.id),records.map(rec=>rec.id))
  else if(kind!=='all ready')assert.equal(f.sends[0].id,'ready.3')
 }finally{f.session.dispose()}
})
for(const stack of [false,true]) for(const boundary of ['live unknown','restored unknown','canonical failure']) test(`mixed ${stack?'stack':'single'} ${boundary} ownership blocks the batch without lending ready sibling consent`,async()=>{
 const records=[...(stack?targetCaseRecords({stack:true}):[targetRecord()]),targetRecord('ready.3')],review=reviews(records.slice(0,-1))
 const f=fixture(records);let recovered
 try{
  await f.update(records,review);assert.equal(f.session.canFreeze(f.key),true);f.session.activate(f.key);await f.session.confirm(f.key);assert.equal(f.sends.length,1)
  if(boundary==='canonical failure'){records[0]={...records[0],updated_at:'2026-10-08T22:05:00Z',last_submit_error:'Exact original attempt failed'};await f.update(records)}
  else await f.update()
  const checkpoint=f.states.at(-1).checkpoint;assert.ok(checkpoint)
  const subject=boundary==='restored unknown'?(recovered=fixture(records,{checkpoint,retain:true})):f
  if(recovered)await recovered.update()
  assert.equal(subject.action().disabled,true);assert.equal(subject.session.canFreeze(subject.key),false)
  assert.equal(subject.states.at(-1).retain,true);assert.ok(subject.states.at(-1).checkpoint)
  if(boundary==='canonical failure')assert.match(subject.action().note,/Exact original attempt failed/)
  assert.equal(f.sends.length,1);if(recovered)assert.equal(recovered.sends.length,0)
 }finally{f.session.dispose();recovered?.session.dispose()}
})
test('known exact partial stack preserves parent receipt and separately confirmed suffix eligibility',async()=>{
 const records=targetCaseRecords({stack:true}),f=fixture(records,{outcome:{error:'Known exact partial failure'}})
 try{await f.update();f.session.activate(f.key);await f.session.confirm(f.key);assert.equal(f.sends.length,1)
  records[0]=receipt(records[0]);await f.update(records);assert.equal(f.action().disabled,false);assert.equal(f.session.canFreeze(f.key),true)
  assert.equal(f.action().links.length,1);f.session.activate(f.key);await f.session.confirm(f.key)
  assert.equal(f.sends.length,2);assert.deepEqual(f.sends[1].map(rec=>rec.id),records.map(rec=>rec.id));assert.deepEqual(f.sends[1].filter(rec=>rec.status==='prepared').map(rec=>rec.id),[records[1].id])
 }finally{f.session.dispose()}
})
