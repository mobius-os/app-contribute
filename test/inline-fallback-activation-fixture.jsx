// Actual fallback components under deliberately incomplete authority. An early
// read is never publication consent and never a Contribution results state.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InlineBatchView, InlinePreparedView } from '../ui/InlinePreparedView.jsx'
import { targetRecord, targetCaseRecords } from './inline-target-cases.mjs'
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const ensure = (value,message) => { if(!value) throw Error(message) }
async function until(test,message) {const end=Date.now()+5000;while(!test()){if(Date.now()>end)throw Error(message);await frame()}}
const reviews = records => ({state:'ready',byId:Object.fromEntries(records.map(rec=>[rec.id,{state:'ready'}]))})
export async function runFallbackActivationChecks() {
  const checks=[],originalRead=window.mobius.storage.getWithVersion,originalDigest=crypto.subtle.digest.bind(crypto.subtle)
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
  let records,change,ledgerReady,reviewState,calls=[],responses=[],holdRead=false,holdHash=false,readFailure=false,reads=[],digests=[],readCount=0
  window.mobius.storage.getWithVersion=async path=>{
    readCount++;if(readFailure)throw Error('Exact read temporarily unavailable');const value=structuredClone(records.find(rec=>path===`contributions/${rec.id}.json`)||null)
    if(holdRead)return new Promise(resolve=>reads.push(()=>resolve({value,version:'fixture'})))
    return {value,version:'fixture'}
  }
  crypto.subtle.digest=(algorithm,bytes)=>holdHash ? new Promise(resolve=>digests.push(async()=>resolve(await originalDigest(algorithm,bytes)))) : originalDigest(algorithm,bytes)
  function Mount({kind,ids}) {
    const [data,setData]=useState({ledger:records,ready:ledgerReady,review:reviewState});change=setData
    const props={records:data.ledger,ledgerReady:data.ready,reviewStatus:data.review==='ready'?reviews(data.ledger):{state:data.review,byId:{}},appId:'fixture-app',loadDiff:async()=>'',onDismiss:async()=>{},
      onRefresh:async()=>{change(previous=>({...previous,review:'ready'}))},
      onSend:rec=>{calls.push(structuredClone(rec));return new Promise(resolve=>responses.push(resolve))},
      onSendStack:recs=>{calls.push(structuredClone(recs));return new Promise(resolve=>responses.push(resolve))}}
    return kind==='batch'?<InlineBatchView {...props} target={{kind,ids}}/>:<InlinePreparedView {...props} target={{kind:'prepared',id:ids.at(-1),confirm:kind==='confirm'||kind==='stack'}}/>
  }
  const sends=()=>[...container.querySelectorAll('button')].filter(node=>/^Contribut(?:e|ing)/.test(node.textContent.trim()))
  const enabled=()=>sends().find(node=>!node.disabled)
  const settle=async()=>{for(const resolve of responses.splice(0))resolve({pending:true});await frame()}
  try {
    for(const kind of ['batch','confirm','card','stack']) for(const delay of ['none','read','hash','unavailable','readfail']) {
      records=kind==='stack'?targetCaseRecords({stack:true}):kind==='batch'?[targetRecord(),targetRecord('other.2')]:[targetRecord()]
      const ids=records.map(rec=>rec.id);ledgerReady=false;reviewState=delay==='unavailable'?'unavailable':'ready';calls=[];responses=[];reads=[];digests=[];readCount=0;holdRead=delay==='read';holdHash=delay==='hash';readFailure=delay==='readfail'
      root.render(<Mount key={`${kind}:${delay}`} kind={kind} ids={ids}/> )
      await until(()=>readCount>0 && container.querySelector('.co-inline-view'),'Cold fallback did not read/mount')
      await frame();await frame()
      ensure(!enabled(),`${kind}/${delay}: cold authority exposed enabled publication`)
      for(const button of sends())button.click()
      ensure(calls.length===0&&!container.textContent.includes('Contribution results'),`${kind}/${delay}: read became consent/results`)
      ensure(/Checking|current source check|verify the current review|Loading/.test(container.textContent),`${kind}/${delay}: no honest authority explanation`)
      // Review may finish while the paged ledger is still missing. Neither is
      // consent. Change every visible target in this gap, including chain bases.
      records=records.map((rec,index)=>({...rec,repo:'visible/repo',updated_at:'2026-10-08T22:06:00Z',plan:{...rec.plan,repo:'visible/repo',head_sha:(index?'f':'e').repeat(40),branch:kind==='stack'?`stack/current/${rec.id}`:'fix/current',base_branch:'release',base_sha:kind==='stack'&&index?'e'.repeat(40):'c'.repeat(40),...(rec.plan.stack?{stack:{...rec.plan.stack,id:'current',base_branch:index?`stack/current/${records[0].id}`:'release'}}:{})},quality_review:{state:'all_clear',reviewed_head_sha:(index?'f':'e').repeat(40)}}))
      change({ledger:[...records],ready:false,review:'ready'});await frame()
      ensure(!enabled()&&calls.length===0&&!container.textContent.includes('Contribution results'),`${kind}/${delay}: review completion transferred consent`)
      holdRead=false;holdHash=false;readFailure=false
      for(const resolve of reads.splice(0))resolve()
      for(const resolve of digests.splice(0))await resolve()
      change({ledger:[...records],ready:true,review:'ready'})
      const refresh=[...container.querySelectorAll('button')].find(node=>node.textContent.trim()==='Refresh');refresh?.click()
      await until(()=>enabled()&&container.textContent.includes('visible/repo'),`${kind}/${delay}: authority did not recover to current visible confirmation`)
      ensure(calls.length===0&&!container.textContent.includes('Contribution results'),`${kind}/${delay}: late authority auto-confirmed`)
      enabled().click();enabled()?.click()
      const expected=kind==='batch'?2:1
      await until(()=>calls.length===expected,`${kind}/${delay}: explicit confirmed handlers did not start once`)
      ensure(calls.flat().every(rec=>rec.plan.repo==='visible/repo'&&rec.plan.head_sha===records.find(item=>item.id===rec.id).plan.head_sha),`${kind}/${delay}: approved stale target`)
      if(kind==='stack')ensure(calls[0].map(rec=>rec.id).join(',')===ids.join(','),'Chain lost parent-first copied context')
      await settle();await until(()=>container.textContent.includes('Checking result'),`${kind}/${delay}: real unknown attempt lost ownership`)
      ensure(!enabled()&&calls.length===expected,`${kind}/${delay}: unknown attempt reoffered`)
      checks.push({name:`cold fallback ${kind}/${delay}: authority and changed visible context need one explicit confirmation`,status:'pass'})
    }
    // Dispose a cold source view before delayed reads arrive. A replacement
    // target cannot inherit requested activation, snapshots, or late consent.
    for(const kind of ['batch','confirm','card','stack']) {
      records=kind==='stack'?targetCaseRecords({stack:true}):[targetRecord()];calls=[];responses=[];reads=[];digests=[];ledgerReady=false;reviewState='ready';holdRead=true
      root.render(<Mount key={`leave:${kind}`} kind={kind} ids={records.map(rec=>rec.id)}/> )
      await until(()=>reads.length>0,'Navigation control did not hold source read')
      for(const button of sends())button.click()
      root.render(null);await frame();holdRead=false
      const abandoned=reads.splice(0);records=[{...targetRecord('replacement.3'),plan:{...targetRecord().plan,title:'Replacement visible target'}}]
      root.render(<Mount key={`replacement:${kind}`} kind={kind==='stack'?'confirm':kind} ids={[records[0].id]}/> )
      for(const resolve of abandoned)resolve();await frame();await frame()
      ensure(calls.length===0&&!enabled()&&!container.textContent.includes('Contribution results'),'Late abandoned read contaminated replacement confirmation')
      change({ledger:[...records],ready:true,review:'ready'})
      await until(()=>enabled(),'Replacement did not become usable')
      ensure(calls.length===0,'Navigation completion auto-confirmed')
      enabled().click();await until(()=>calls.length===1,'Replacement explicit confirmation not once')
      ensure(calls[0].id==='replacement.3','Replacement sent abandoned identity')
      await settle()
      checks.push({name:`cold ${kind} navigation/unmount and late read cannot transfer approval`,status:'pass'})
    }
  } catch(error) {throw Error(error.message+'\nCold fallback facts: '+JSON.stringify({calls,text:container.textContent.slice(-3500)}),{cause:error})}
  finally {holdRead=false;holdHash=false;readFailure=false;for(const resolve of reads)resolve();for(const resolve of digests)await resolve();root.unmount();container.remove();window.mobius.storage.getWithVersion=originalRead;crypto.subtle.digest=originalDigest}
  return checks
}
