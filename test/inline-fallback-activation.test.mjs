import test from 'node:test'
import assert from 'node:assert/strict'
import { createInlineSession } from '../inline-session.js'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
async function until(test) { const end=Date.now()+3000; while(!test()) { assert.ok(Date.now()<end,'Observable session boundary did not arrive'); await new Promise(resolve=>setImmediate(resolve)) } }
const reviews = records => ({state:'ready',byId:Object.fromEntries(records.map(rec=>[rec.id,{state:'ready'}]))})
function fixture(records, options={}) {
 const states=[],sends=[]
 const keys=['chat-send:'+records.at(-1).id,'chat-send-batch:'+records.map(rec=>rec.id).join(',')]
 const session=createInlineSession({sessionId:'readiness',actions:keys.map(key=>({key,label:'Contribute'})),publish:state=>states.push(state),
  loadExact:options.loadExact|| (async id=>records.find(rec=>rec.id===id)),send:rec=>{sends.push(rec);return {pending:true}},sendStack:recs=>{sends.push(recs);return {pending:true}}})
 return {session,states,sends,keys,records}
}
test('fallback publication readiness differs from passive read activation and preserves its cancel/confirm protocol',async()=>{
 const f=fixture([targetRecord()]);const key=f.keys[1]
 try{
  f.session.updateLedger(f.records,false,reviews(f.records));await f.session.hydrate()
  assert.equal(f.states.at(-1).actions.find(action=>action.key===key).disabled,false,'Passive read activation remains useful')
  assert.equal(f.session.canFreeze(key),false,'Enabled passive read action is not publication readiness')
  f.session.activate(key);assert.equal(f.states.at(-1).actions.find(action=>action.key===key).confirming,false)
  f.session.updateLedger(f.records,true,reviews(f.records))
  await until(()=>f.states.at(-1).actions.find(action=>action.key===key).confirming)
  assert.equal(f.states.at(-1).actions.find(action=>action.key===key).confirming,true,'Passive delayed confirmation remains intact')
  assert.equal(f.session.canFreeze(key),false,'Frozen confirmation cannot become another publication click')
  assert.deepEqual(f.sends,[])
  f.session.cancel(key);assert.equal(f.session.canFreeze(key),true)
  f.session.activate(key);await f.session.confirm(key)
  assert.equal(f.sends.length,1);assert.equal(f.session.canFreeze(key),false,'Unknown attempt never reoffers publication')
 }finally{f.session.dispose()}
 assert.equal(f.session.canFreeze(key),false,'Disposed source cannot approve')
})
test('fallback current authority waits for the exact hash, unavailable review and current read boundary',async()=>{
 let release;const f=fixture([targetRecord()],{loadExact:id=>new Promise(resolve=>{release=()=>resolve(targetRecord(id))})});const key=f.keys[0]
 try{
  f.session.updateLedger(f.records,true,reviews(f.records));const reading=f.session.hydrate()
  assert.equal(f.session.canFreeze(key),false);assert.deepEqual(f.sends,[])
  release();await reading;assert.equal(f.session.canFreeze(key),true)
  f.session.updateLedger(f.records,true,{state:'unavailable',byId:{}});assert.equal(f.session.canFreeze(key),false)
  f.session.updateLedger(f.records,true,reviews(f.records));const reread=f.session.hydrate()
  assert.equal(f.session.canFreeze(key),false,'An older exact observation cannot lend current-read readiness')
  release();await reread;assert.equal(f.session.canFreeze(key),true);assert.deepEqual(f.sends,[])
 }finally{f.session.dispose()}
})
test('linked fallback readiness requires complete current parent/member review while independent units freeze together',async()=>{
 const records=targetCaseRecords({stack:true}),f=fixture(records),key=f.keys[1]
 try{
  f.session.updateLedger(records,false,reviews(records));await f.session.hydrate();assert.equal(f.session.canFreeze(key),false)
  f.session.updateLedger(records,true,{state:'ready',byId:{[records[1].id]:{state:'ready'}}});assert.equal(f.session.canFreeze(key),false)
  f.session.updateLedger(records,true,reviews(records));assert.equal(f.session.canFreeze(key),true)
  f.session.activate(key);await f.session.confirm(key)
  assert.equal(f.sends.length,1);assert.deepEqual(f.sends[0].map(rec=>rec.id),records.map(rec=>rec.id))
 }finally{f.session.dispose()}
})

test('fallback current-read failure or wrong target cannot borrow earlier readiness; explicit retry recovers without sending',async()=>{
 let observed=targetRecord(),failed=false
 const f=fixture([targetRecord()],{loadExact:async()=>{if(failed)throw Error('Unavailable');return observed}}),key=f.keys[0]
 try{
  f.session.updateLedger(f.records,true,reviews(f.records));await f.session.hydrate();assert.equal(f.session.canFreeze(key),true)
  failed=true;await f.session.hydrate();assert.equal(f.session.canFreeze(key),false)
  failed=false;observed=targetRecord('foreign.9')
  await f.session.hydrate();assert.equal(f.session.canFreeze(key),false)
  observed=targetRecord();await f.session.hydrate();assert.equal(f.session.canFreeze(key),true);assert.deepEqual(f.sends,[])
 }finally{f.session.dispose()}
})
