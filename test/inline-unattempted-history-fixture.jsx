// Skipped rows are current observations, never historical publication owners.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InlineBatchView } from '../ui/InlinePreparedView.jsx'
import { contributeBlockTarget } from '../chat-blocks.js'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
const ensure=(value,message)=>{if(!value)throw Error(message)}
async function until(test,message){const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw Error(message);await frame()}}
const receipt=(rec,n=12)=>({...rec,status:'open',number:n,url:`https://github.com/${rec.plan.repo}/pull/${n}`,updated_at:'2026-10-08T22:07:00Z'})
const repair=records=>records.map((rec,index)=>({...rec,updated_at:'2026-10-08T22:08:00Z',plan:{...rec.plan,title:'Current skipped target '+rec.id,head_sha:(index?'d':'c').repeat(40),branch:rec.plan.stack?`stack/current/${rec.id}`:'fix/current',base_branch:'release',base_sha:index&&rec.plan.stack?'c'.repeat(40):'e'.repeat(40),draft:true,
 ...(rec.plan.stack?{stack:{...rec.plan.stack,id:'current',base_branch:index?`stack/current/${records[0].id}`:'release'}}:{})},quality_review:{state:'all_clear',reviewed_head_sha:(index?'d':'c').repeat(40)}}))
export async function runUnattemptedHistoryChecks(){
 const checks=[],container=document.createElement('div');document.body.append(container);const root=createRoot(container)
 const originalRead=window.mobius.storage.getWithVersion,originalDigest=crypto.subtle.digest.bind(crypto.subtle)
 let records,change,calls=[],readFailure='',mode='public',stage='',holdHash=false,digests=[]
 window.mobius.storage.getWithVersion=async path=>{if(readFailure&&path===`contributions/${readFailure}.json`)throw Error('Exact skipped read unavailable');return {value:structuredClone(records.find(rec=>path===`contributions/${rec.id}.json`)||null),version:'fixture'}}
 crypto.subtle.digest=(algorithm,bytes)=>holdHash?new Promise(resolve=>digests.push(async()=>resolve(await originalDigest(algorithm,bytes)))):originalDigest(algorithm,bytes)
 function Mount({ids}){
  const [ledger,set]=useState(records);change=set
  const send=approved=>{calls.push(structuredClone(approved));return Promise.resolve(mode==='known failure'&&calls.length===1?{error:'Known exact first failure'}:{pending:true})}
  return <InlineBatchView target={contributeBlockTarget('chat-send-batch:'+ids.join(','))} records={ledger} ledgerReady={true} reviewStatus={{state:'ready',byId:Object.fromEntries(ledger.map(rec=>[rec.id,{state:'ready'}]))}}
   onSend={send} onSendStack={send}/>
 }
 const button=()=>container.querySelector('.co-btn-primary')
 async function refresh(){const node=[...container.querySelectorAll('button')].find(node=>node.textContent.trim()==='Refresh');node?.click();await frame()}
 const facts=()=>JSON.stringify({stage,calls,text:container.textContent.slice(-4500),button:button()?.textContent,disabled:button()?.disabled})
 async function ready(){await until(()=>button()&&!button().disabled&&button().textContent==='Contribute all 1'&&![...container.querySelectorAll('button')].some(node=>/Refreshing/.test(node.textContent)),'Current skipped unit never became visibly confirmable: '+facts())}
 async function explicit(ids){ensure(calls.length===1,'Source repair sent or replayed work');button().click();button()?.click();await until(()=>calls.length===2,'Fresh explicit skipped approval did not start once')
  const approved=Array.isArray(calls[1])?calls[1]:[calls[1]],expected=records.filter(rec=>ids.includes(rec.id))
  const copied=approved.map(({path,...rec})=>{ensure(path===`contributions/${rec.id}.json`,'Approved storage identity changed');return rec})
  ensure(JSON.stringify(copied)===JSON.stringify(expected),'Skipped current title/head/branch/base/options or full linked context changed')}
 try{
  for(const kind of ['review blocked','unreviewed','whole linked unit','duplicate linked addresses','incomplete linked unit'])for(const outcome of ['public','known failure','unknown']){
   stage=kind+':'+outcome
   const skipped=kind.includes('linked')?targetCaseRecords({stack:true}):[targetRecord('skipped.2')]
   skipped[0].quality_review=kind==='unreviewed'?undefined:{state:'changes_needed'}
   records=[targetRecord('first.3'),...(kind==='incomplete linked unit'?[skipped[0]]:skipped)];const ids=records.map(rec=>rec.id);if(kind==='duplicate linked addresses')ids.push(skipped[0].id,skipped[1].id)
   calls=[];mode=outcome;root.render(<Mount key={`${kind}:${outcome}`} ids={ids}/>);await ready()
   button().click();await until(()=>calls.length===1&&container.textContent.includes(outcome==='known failure'?'Known exact first failure':'Checking result'),'First-only phase did not settle ownership')
   ensure(calls[0].id==='first.3','Skipped unit entered first handler')
   records=[outcome==='public'?receipt(records[0]):records[0],...repair(skipped)];change([...records]);await refresh()
   await until(()=>container.textContent.includes('Current skipped target'),'Skipped repaired source was pinned to attempted history')
   ensure(calls.length===1,'Source/review repair auto-sent skipped work')
   if(outcome==='unknown'){await frame();await frame();ensure(button().disabled&&!container.querySelector('a[href*="/pull/"]'),'Unknown first owner lent consent/link to sibling')
    records[0]=receipt(records[0]);change([...records]);await refresh()}
   await ready();await explicit(skipped.map(rec=>rec.id))
   checks.push({name:`unattempted ${kind}/${outcome}: repaired current target needs later explicit approval`,status:'pass'})
  }
  for(const gap of ['removed and reappeared','exact read failure','canonical failure']){
   stage=gap
   const skipped={...targetRecord('skipped.2'),quality_review:{state:'changes_needed'}}
   records=[targetRecord(),skipped];calls=[];mode='public';root.render(<Mount key={gap} ids={records.map(rec=>rec.id)}/>);await ready();button().click()
   await until(()=>calls.length===1&&container.textContent.includes('Checking result'),'Gap first owner not pending')
   if(gap==='removed and reappeared'){records=[receipt(records[0])];change([...records]);await refresh();await until(()=>container.querySelector('a[href$="/pull/12"]'),'Removed sibling blocked first receipt');ensure(button().disabled&&calls.length===1,'Removed skipped work became consent')}
   if(gap==='canonical failure'){records[0]={...records[0],updated_at:'2026-10-08T22:07:00Z',last_submit_error:'Exact first attempt failed'};change([...records]);await until(()=>container.textContent.includes('Exact first attempt failed'),'Canonical failure not diagnosed')}
   records=[gap==='canonical failure'?records[0]:receipt(records[0]),...repair([skipped])];if(gap==='exact read failure')readFailure=skipped.id
   change([...records]);await refresh();await until(()=>container.textContent.includes('Current skipped target'),'Gap pinned skipped record')
   ensure(calls.length===1,'Gap transferred consent')
   if(gap==='canonical failure'){ensure(button().disabled,'Failed owner allowed sibling');records[0]={...receipt(targetRecord()),updated_at:'2026-10-08T22:09:00Z'};change([...records])}
   if(gap==='exact read failure'){await frame();await frame();ensure(button().disabled,'Unavailable fresh proof borrowed readiness');readFailure=''}
   await refresh();await ready();await explicit([skipped.id])
   checks.push({name:`unattempted ${gap}: useful current observation without borrowed ownership/proof`,status:'pass'})
  }
  // Before the first handler, genuine frozen context must already be protected.
  // Deleting pre-handler history would leak this valid but foreign receipt.
  stage='held hash'
  records=[{...targetRecord(),plan:{...targetRecord().plan,title:'Original frozen owner'}},{...targetRecord('skipped.2'),quality_review:{state:'changes_needed'}}];const original=structuredClone(records[0]),skipped=structuredClone(records[1]);calls=[];mode='public'
  root.render(<Mount key="held first hash" ids={records.map(rec=>rec.id)}/>);await ready();holdHash=true;button().click()
  await until(()=>digests.length>0,'First observation hash was not held');ensure(calls.length===0,'Handler crossed held hash')
  records=[receipt({...original,plan:{...original.plan,repo:'foreign/repo',branch:'foreign',title:'Foreign owner hijack'}},83),...repair([skipped])];change([...records]);await frame();await frame()
  ensure(container.textContent.includes('Current skipped target')&&container.textContent.includes('Original frozen owner')&&!container.textContent.includes('Foreign owner hijack')&&!container.querySelector('a[href$="/pull/83"]')&&calls.length===0&&button().disabled,'Pre-handler history did not distinguish genuine owner from skipped observation')
  holdHash=false;for(const resolve of digests.splice(0))await resolve();await until(()=>calls.length===1,'Held approved first handler did not start once')
  ensure(calls[0].plan.branch==='fix/original'&&!container.querySelector('a[href$="/pull/83"]'),'Foreign first target changed approval/receipt')
  records[0]={...receipt(original,12),updated_at:'2026-10-08T22:09:00Z'};change([...records]);await refresh();await ready();await explicit([skipped.id])
  checks.push({name:'pre-handler held SHA protects actual frozen owner, not skipped sibling; exact recovery needs explicit approval',status:'pass'})
  // A disposed view cannot donate its skipped snapshot to a replacement view.
  stage='navigation'
  records=[targetRecord(),{...targetRecord('skipped.2'),quality_review:{state:'changes_needed'}}];calls=[]
  root.render(<Mount key="leave" ids={records.map(rec=>rec.id)}/>);await ready();button().click();await until(()=>calls.length===1&&container.textContent.includes('Checking result'),'Navigation first attempt missing')
  root.render(null);await frame();records=[...repair([records[1]])];root.render(<Mount key="replacement" ids={records.map(rec=>rec.id)}/>);await ready()
  ensure(calls.length===1,'Navigation donated automatic consent');await explicit([records[0].id])
  checks.push({name:'unattempted navigation/unmount follows replacement current target without latent consent',status:'pass'})
 }catch(error){throw Error(error.message+'\nUnattempted facts: '+facts(),{cause:error})}
 finally{holdHash=false;for(const resolve of digests)await resolve();root.unmount();container.remove();window.mobius.storage.getWithVersion=originalRead;crypto.subtle.digest=originalDigest}
 return checks
}
