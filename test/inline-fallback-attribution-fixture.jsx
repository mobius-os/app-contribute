// Real click-open fallback components. All handlers/storage are fixture-owned.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { InlineBatchView, InlinePreparedView } from '../ui/InlinePreparedView.jsx'
import { targetDrifts, targetCaseRecords, targetRecord } from './inline-target-cases.mjs'
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const ensure = (value, message) => { if (!value) throw Error(message) }
async function until(test, message) { const end = Date.now() + 5000; while (!test()) { if (Date.now() > end) throw Error(message); await frame() } }
const reviews = records => ({ state:'ready', byId:Object.fromEntries(records.map(rec=>[rec.id,{state:'ready'}])) })
const publicRecord = (rec, number=83) => ({...rec,status:'open',number:rec.plan.action==='pr_update'?rec.number:number,
  url:rec.plan.action==='pr_update'?rec.url:`https://github.com/${rec.plan.repo}/pull/${number}`,updated_at:'2026-10-08T22:03:00Z'})
export async function runFallbackAttributionChecks() {
  const checks=[], originalRead=window.mobius.storage.getWithVersion
  const container=document.createElement('div');document.body.append(container)
  const root=createRoot(container)
  let records, update, release, calls, approved, sendBehaviour, readBehaviour
  const originalDigest=crypto.subtle.digest.bind(crypto.subtle)
  window.mobius.storage.getWithVersion=async path=>readBehaviour ? readBehaviour(path) : ({value:structuredClone(records.find(rec=>path===`contributions/${rec.id}.json`)||null),version:'fixture'})
  function Mount({kind,ids}) {
    const [ledger,setLedger]=useState(records);update=setLedger
    const props={records:ledger,ledgerReady:true,reviewStatus:reviews(ledger),appId:'fixture-app',loadDiff:async()=>'',onDismiss:async()=>{},
      onSend:rec=>{calls++;approved=rec;if(sendBehaviour)return sendBehaviour(rec);return new Promise(resolve=>{release=resolve})},
      onSendStack:recs=>{calls++;approved=recs;if(sendBehaviour)return sendBehaviour(recs);return new Promise(resolve=>{release=resolve})}}
    return kind==='batch'?<InlineBatchView {...props} target={{kind,ids}}/>:<InlinePreparedView {...props} target={{kind:'prepared',id:ids.at(-1),confirm:kind==='confirm'}}/>
  }
  const sendButton=()=>[...container.querySelectorAll('button')].find(node=>/^Contribut(?:e(?: all| update| \d|$)|ing)/.test(node.textContent.trim()))
  const driftCases=[{name:'repository and head drift',mutate:recs=>{recs[0].repo='elsewhere/repo';recs[0].plan.repo='elsewhere/repo';recs[0].plan.head_sha='f'.repeat(40)}},...targetDrifts]
  try {
    for(const kind of ['batch','confirm','card']) for(const item of driftCases) {
      records=targetCaseRecords(item);const ids=records.map(rec=>rec.id);calls=0;release=null;approved=null
      root.render(<Mount key={`${kind}:${item.name}`} kind={kind} ids={ids}/> )
      await until(()=>sendButton()&&!sendButton().disabled && container.querySelector('[aria-label="Prepared contribution"]')?.getAttribute('aria-busy')!=='true',`${kind} ${item.name}: send never ready`)
      sendButton().click();sendButton()?.click()
      await until(()=>calls===1,`${kind} ${item.name}: handler not once`)
      const frozen=structuredClone(records)
      records=records.map((rec,index)=>publicRecord(rec,83+index));item.mutate(records)
      // Rebuild generated links after repository drift, so the foreign receipt
      // is itself valid; target attribution, not URL syntax, must reject it.
      records=records.map(rec=>rec.plan.action==='pr'?{...rec,url:`https://github.com/${rec.plan.repo}/pull/${rec.number}`}:rec)
      update([...records]);await frame()
      release({pending:true})
      await until(()=>container.textContent.includes('Checking'),`${kind} ${item.name}: foreign receipt claimed success`)
      ensure(calls===1 && !sendButton() || calls===1 && sendButton().disabled,`${kind} ${item.name}: unknown attempt reoffered`)
      ensure([...container.querySelectorAll('a[href*="/pull/"]')].every(link=>frozen.some(rec=>rec.plan.action==='pr_update' && rec.url===link.href)),`${kind} ${item.name}: foreign receipt link leaked`)
      ensure(!/Already sent|\bSent\b/.test(container.querySelector('.co-batch-status')?.textContent||''),`${kind} ${item.name}: false sent status`)
      ensure(JSON.stringify(Array.isArray(approved)?approved.map(({path,...rec})=>rec):(({path,...rec})=>rec)(approved))===JSON.stringify(item.stack?frozen:frozen[0]),`${kind} ${item.name}: approved copy changed`)
      ensure(container.getBoundingClientRect().width<=innerWidth+1,'Fallback overflowed viewport')
      checks.push({name:`fallback ${kind}: ${item.name} keeps original attempt unknown`,status:'pass'})
      // Exact original context later settles without another publication.
      records=frozen.map((rec,index)=>publicRecord(rec,10+index));update([...records])
      const refresh=[...container.querySelectorAll('button')].find(node=>node.textContent.trim()==='Refresh');refresh?.click()
      await until(()=>container.querySelector('a[href*="/pull/"]'),`${kind} ${item.name}: exact success did not settle`)
      ensure(calls===1,`${kind} ${item.name}: settlement retried`)
    }
    // Independent results keep useful links while a foreign sibling stays owned.
    records=[targetRecord(),targetRecord('other.2')];const originals=structuredClone(records)
    const responses=new Map();calls=0
    sendBehaviour=rec=>new Promise(resolve=>responses.set(rec.id,resolve))
    root.render(<Mount key="partial-batch" kind="batch" ids={records.map(rec=>rec.id)}/> )
    await until(()=>sendButton()&&!sendButton().disabled,'Partial batch never ready')
    sendButton().click();await until(()=>responses.size===2,'Independent batch did not start both once')
    records=[publicRecord(records[0],12),publicRecord({...records[1],plan:{...records[1].plan,branch:'foreign'}},13)]
    update([...records]);for(const resolve of responses.values())resolve({pending:true})
    await until(()=>container.textContent.includes('Checking result')&&container.querySelector('a[href$="/pull/12"]'),'Partial batch lost correct link/unknown sibling')
    ensure(!container.querySelector('a[href$="/pull/13"]')&&sendButton()?.disabled&&calls===2,'Foreign sibling settled or batch replayed')
    records=[records[0],{...originals[1],updated_at:'2026-10-08T22:05:00Z',last_submit_error:'Exact suffix rejected'}];update([...records])
    await until(()=>container.textContent.includes('Exact suffix rejected'),'New exact partial failure was not diagnosed')
    ensure(container.querySelector('a[href$="/pull/12"]')&&sendButton()?.disabled&&calls===2,'Exact failure erased partial progress or ownership')
    checks.push({name:'fallback independent partial batch preserves only valid link, diagnoses exact failure without replay',status:'pass'})
    sendBehaviour=null
    // A stale callback cannot overwrite newer exact success; held exact reads
    // keep ownership until their digest/generation boundary really completes.
    records=[targetRecord()];const stale=structuredClone(records[0]);calls=0;release=null
    root.render(<Mount key="stale-success" kind="batch" ids={[stale.id]}/> )
    await until(()=>sendButton()&&!sendButton().disabled,'Stale callback control never ready')
    sendButton().click();await until(()=>release,'Stale callback handler missing')
    records=[publicRecord(records[0],17)];update([...records]);await frame()
    ensure(calls===1&&sendButton()?.disabled,'Held success response released send')
    release({pending:true,record:stale})
    await until(()=>container.querySelector('a[href$="/pull/17"]'),'Stale callback hid newer exact success')
    ensure(calls===1,'Stale callback retried publication')
    checks.push({name:'fallback held handler keeps no-repeat; newer exact success wins stale callback',status:'pass'})
    for(const evidence of ['missing','wrong-ID','failed']) {
      records=[targetRecord()];calls=0;release=null
      root.render(<Mount key={`unavailable:${evidence}`} kind="batch" ids={[records[0].id]}/> )
      await until(()=>sendButton()&&!sendButton().disabled,'Unavailable-read control never ready')
      sendButton().click();await until(()=>release,'Unavailable-read handler missing')
      readBehaviour=async()=>{if(evidence==='failed')throw Error('Fixture unavailable');return {value:evidence==='wrong-ID'?{...publicRecord(records[0],31),id:'other.3'}:null,version:'fixture'}}
      records=[publicRecord(records[0],31)];update([...records]);release({pending:true})
      await until(()=>container.textContent.includes('Checking result'),'Unavailable exact read falsely settled')
      ensure(!container.querySelector('a[href$="/pull/31"]')&&sendButton()?.disabled&&calls===1,'Unavailable proof exposed receipt or replay')
      readBehaviour=null
      const refresh=[...container.querySelectorAll('button')].find(node=>node.textContent.trim()==='Refresh');refresh.click()
      await until(()=>container.querySelector('a[href$="/pull/31"]'),'Restored exact receipt did not settle')
      checks.push({name:`fallback ${evidence} exact proof keeps ownership until restored read`,status:'pass'})
    }
    records=[targetRecord()];const digestOriginal=structuredClone(records[0]);calls=0;release=null
    root.render(<Mount key="held-digest" kind="batch" ids={[digestOriginal.id]}/> )
    await until(()=>sendButton()&&!sendButton().disabled,'Held digest control never ready')
    sendButton().click();await until(()=>release,'Held digest handler missing')
    let heldDigest
    crypto.subtle.digest=(algorithm,bytes)=>new TextDecoder().decode(bytes).includes('foreign-held')
      ?new Promise(resolve=>{heldDigest=async()=>resolve(await originalDigest(algorithm,bytes))}) :originalDigest(algorithm,bytes)
    records=[publicRecord({...digestOriginal,plan:{...digestOriginal.plan,branch:'foreign-held'}},41)];update([...records])
    await until(()=>heldDigest,'Foreign observation digest was not held')
    ensure(!container.querySelector('a[href$="/pull/41"]')&&calls===1,'Held foreign hash lent authority')
    records=[publicRecord(digestOriginal,42)];update([...records]);release({pending:true,record:digestOriginal})
    await until(()=>container.querySelector('a[href$="/pull/42"]'),'Newer exact read failed to beat held old hash')
    await heldDigest();await frame();await frame()
    ensure(container.querySelector('a[href$="/pull/42"]')&&!container.querySelector('a[href$="/pull/41"]')&&calls===1,'Late old digest rebound the receipt')
    crypto.subtle.digest=originalDigest
    checks.push({name:'fallback newer exact generation wins held foreign SHA and stale callback',status:'pass'})
    // Known partial failure allows a separately confirmed exact next phase,
    // unlike an unknown prefix. Parent receipts remain attached to that chain.
    records=targetCaseRecords({stack:true});calls=0;release=null
    root.render(<Mount key="partial-stack" kind="batch" ids={records.map(rec=>rec.id)}/> )
    await until(()=>sendButton()&&!sendButton().disabled,'Partial stack never ready')
    sendButton().click();await until(()=>release,'Partial stack handler missing')
    records=[publicRecord(records[0],21),records[1]];update([...records]);release({error:'Known exact partial failure'})
    await until(()=>container.querySelector('a[href$="/pull/21"]')&&sendButton()&&!sendButton().disabled,'Known partial stack lost receipt or next explicit phase')
    ensure(calls===1,'Known failure automatically retried suffix')
    sendButton().click();await until(()=>calls===2,'Explicit suffix did not start')
    records=[records[0],publicRecord(records[1],22)];update([...records]);release({ok:true})
    await until(()=>container.querySelector('a[href$="/pull/22"]'),'Exact linked suffix did not settle')
    ensure(calls===2,'Linked suffix duplicated')
    checks.push({name:'fallback known exact linked partial keeps receipt and requires new explicit suffix approval',status:'pass'})
    // A refreshed owning exact projection must be visible before a new
    // approval; the adapter cannot silently send a newer unseen target.
    records=[targetRecord()];calls=0;release=null
    root.render(<Mount key="visible-target" kind="batch" ids={[records[0].id]}/> )
    await until(()=>sendButton()&&!sendButton().disabled,'Visible-target control never ready')
    const newer={...records[0],repo:'visible/repo',plan:{...records[0].plan,repo:'visible/repo',branch:'fix/visible'},updated_at:'2026-10-08T22:06:00Z'}
    readBehaviour=async path=>({value:path===`contributions/${newer.id}.json`?newer:null,version:'fixture'})
    const refresh=[...container.querySelectorAll('button')].find(node=>node.textContent.trim()==='Refresh');refresh.click()
    await until(()=>container.textContent.includes('visible/repo')&&sendButton()&&!sendButton().disabled,'Refreshed exact target was not visibly projected')
    ensure(calls===0,'Read-only target refresh transferred approval')
    sendButton().click();await until(()=>release,'New visible target explicit approval did not start')
    ensure(approved.plan.repo==='visible/repo'&&approved.plan.branch==='fix/visible'&&calls===1,'Sent target differed from visible confirmed target')
    records=[{...publicRecord(newer,51),updated_at:'2026-10-08T22:07:00Z'}];update([...records]);readBehaviour=null;release({ok:true})
    await until(()=>container.querySelector('a[href="https://github.com/visible/repo/pull/51"]'),'New explicitly visible target did not settle')
    checks.push({name:'fallback exact refresh is observation; sends only the subsequently visible target on explicit click',status:'pass'})
    for(const kind of ['batch','confirm','card']) {
      records=[targetRecord()];calls=0;release=null
      root.render(<Mount key={`control:${kind}`} kind={kind} ids={[records[0].id]}/> )
      await until(()=>sendButton()&&!sendButton().disabled && container.querySelector('[aria-label="Prepared contribution"]')?.getAttribute('aria-busy')!=='true',`${kind}: control not ready`)
      sendButton().click();await until(()=>release,`${kind}: control handler absent`)
      records=records.map(rec=>publicRecord(rec,12));update([...records]);release({ok:true})
      await until(()=>container.querySelector('a[href="https://github.com/team/repo/pull/12"]'),`${kind}: valid success missing`)
      ensure(calls===1,`${kind}: success duplicated`)
      checks.push({name:`fallback ${kind}: exact generated public receipt`,status:'pass'})
    }
  } catch(error) {
    throw Error(error.message+'\nFallback facts: '+JSON.stringify({calls,text:container.textContent.slice(0,4000),links:[...container.querySelectorAll('a')].map(link=>link.href)}),{cause:error})
  } finally {root.unmount();container.remove();window.mobius.storage.getWithVersion=originalRead;crypto.subtle.digest=originalDigest}
  return checks
}
