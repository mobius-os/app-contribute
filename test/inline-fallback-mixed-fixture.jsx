// Ordinary fallback actions must honor the owning session's unknown-result lock.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InlineBatchView } from '../ui/InlinePreparedView.jsx'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const ensure = (value,message) => {if(!value)throw Error(message)}
async function until(test,message) {const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw Error(message);await frame()}}
const receipt = rec => ({...rec,status:'open',number:12,url:`https://github.com/${rec.plan.repo}/pull/12`,updated_at:'2026-10-08T22:03:00Z'})
export async function runFallbackMixedChecks() {
 const checks=[],originalRead=window.mobius.storage.getWithVersion,container=document.createElement('div');document.body.append(container)
 const root=createRoot(container);let records,reviewed,change,calls=[],responses=[],reads=0
 window.mobius.storage.getWithVersion=async path=>{reads++;return {value:structuredClone(records.find(rec=>path===`contributions/${rec.id}.json`)||null),version:'fixture'}}
 function Mount({ids}) {
  const [data,setData]=useState({ledger:records,reviewed});change=setData
  return <InlineBatchView target={{kind:'batch',ids}} records={data.ledger} ledgerReady={true}
   reviewStatus={{state:'ready',byId:Object.fromEntries(data.reviewed.map(id=>[id,{state:'ready'}]))}}
   onSend={rec=>{calls.push(structuredClone(rec));return new Promise(resolve=>responses.push(resolve))}}
   onSendStack={recs=>{calls.push(structuredClone(recs));return new Promise(resolve=>responses.push(resolve))}}/>
 }
 const button=()=>container.querySelector('.co-btn-primary')
 const facts=()=>JSON.stringify({calls,reads,button:button()?.textContent,disabled:button()?.disabled,text:container.textContent.slice(-3200)})
 const settle=async()=>{for(const resolve of responses.splice(0))resolve({pending:true});await frame()}
 try {
  for(const kind of ['submitting','owned stack','all ready','review skipped','settled skipped','deduplicated stack']) {
   records=kind.includes('stack')?targetCaseRecords({stack:true}):[targetRecord(),targetRecord('ready.3')]
   if(kind==='owned stack')records.push(targetRecord('ready.3'))
   if(['submitting','owned stack'].includes(kind))records[0].status='submitting'
   if(kind==='review skipped')records[0].quality_review={state:'changes_needed'}
   if(kind==='settled skipped')records[0]=receipt(records[0])
   reviewed=records.map(rec=>rec.id);calls=[];responses=[];reads=0
   root.render(<Mount key={kind} ids={records.map(rec=>rec.id)}/> )
   await until(()=>reads>=records.length*2&&button(),'Mixed view did not mount/read');await frame();await frame()
   if(['submitting','owned stack'].includes(kind)) {
    ensure(button().disabled&&button().textContent==='Checking…','Mixed unknown must be honestly blocked: '+facts())
    ensure(container.textContent.includes('Checking contributions')&&container.textContent.includes('Checking result'),'Submitting row/header hides actual ownership: '+facts())
    button().click();await frame();ensure(calls.length===0&&!container.textContent.includes('Contribution results'),'Blocked mixed action became consent/results')
    // Only canonical public progress makes the unowned ready sibling usable.
    records=records.map(rec=>rec.status==='submitting'?receipt(rec):rec)
    if(kind==='owned stack')records[1]=receipt(records[1])
    change({ledger:[...records],reviewed})
   }
   const expected=kind==='all ready'?2:1
   await until(()=>button()&&!button().disabled&&button().textContent===`Contribute all ${expected}`,'Exact mixed ready count did not become usable: '+facts())
   ensure(calls.length===0,'Read/progress silently confirmed mixed subset')
   if(kind==='settled skipped')ensure(container.querySelector('a[href$="/pull/12"]'),'Valid preexisting receipt lost')
   button().click();button()?.click();await until(()=>calls.length===expected,'Visible eligible subset did not start once: '+facts())
   if(kind==='deduplicated stack')ensure(calls[0].map(rec=>rec.id).join(',')===records.map(rec=>rec.id).join(','),'Named chain sent twice or lost parent context')
   else if(kind!=='all ready')ensure(calls[0].id==='ready.3','Blocked/public sibling replayed')
   await settle();await until(()=>container.textContent.includes('Checking result'),'Actual unknown lost result ownership')
   ensure(button().disabled&&calls.length===expected,'Unknown subset became usable publication')
   checks.push({name:`fallback mixed ${kind}: owning lock and explicit eligible count agree`,status:'pass'})
  }
  for(const boundary of ['live unknown','owned stack unknown','canonical failure']) {
   records=[...(boundary==='owned stack unknown'?targetCaseRecords({stack:true}):[targetRecord()]),targetRecord('ready.3')];reviewed=records.slice(0,-1).map(rec=>rec.id);calls=[];responses=[];reads=0
   root.render(<Mount key={boundary} ids={records.map(rec=>rec.id)}/> )
   await until(()=>button()&&!button().disabled&&button().textContent==='Contribute all 1','Initial reviewed subset not usable')
   button().click();await until(()=>calls.length===1,'First mixed owner did not start')
   reviewed=records.map(rec=>rec.id);change({ledger:[...records],reviewed});await frame()
   ensure(button().disabled&&calls.length===1,'Held owner allowed second subset')
   await settle();await until(()=>container.textContent.includes('Checking result'),'Pending callback did not retain first owner')
   if(boundary==='canonical failure') {
    records[0]={...records[0],updated_at:'2026-10-08T22:05:00Z',last_submit_error:'Exact original attempt failed'};change({ledger:[...records],reviewed})
    await until(()=>container.textContent.includes('Exact original attempt failed'),'Exact failed attempt not diagnosed')
   }
   ensure(button().disabled&&button().textContent==='Contribute all 1','Unknown/failure made unowned sibling appear confirmable: '+facts())
   button().click();await frame();ensure(calls.length===1,'Owned mixed batch replayed or approved sibling')
   checks.push({name:`fallback mixed ${boundary} plus ready: explicit ownership blocks silent subset approval`,status:'pass'})
  }
 }catch(error){throw Error(error.message+'\nMixed fallback facts: '+facts(),{cause:error})}
 finally{for(const resolve of responses)resolve({pending:true});root.unmount();container.remove();window.mobius.storage.getWithVersion=originalRead}
 return checks
}
