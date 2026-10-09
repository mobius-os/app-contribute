import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationContextMatches, publicationPhaseResult, pendingPhaseBlocks } from '../inline-session.js'
import { targetDrifts, targetCaseRecords } from './inline-target-cases.mjs'
const receipt = (record,number=83) => ({...record,status:'open',number:record.plan.action==='pr_update'?record.number:number,
  url:record.plan.action==='pr_update'?record.url:`https://github.com/${record.plan.repo}/pull/${number}`})
for (const drift of [{name:'repository',mutate:records=>{records[0].repo='other/repo';records[0].plan.repo='other/repo'}},
  {name:'head',mutate:records=>{records[0].plan.head_sha='f'.repeat(40)}},...targetDrifts]) {
  test(`fallback full historical receipt context rejects ${drift.name}`,()=>{
    const before=targetCaseRecords(drift),phase=drift.stack?[before[1]]:before
    const fresh=structuredClone(before).map(record=>receipt(record));drift.mutate(fresh)
    assert.equal(publicationContextMatches(before,fresh),false)
    assert.deepEqual(publicationPhaseResult(phase,fresh,{pending:true},before),{state:'checking'})
    const result={state:'checking',unitKey:'stack:s',phaseIds:phase.map(rec=>rec.id),context:before}
    assert.equal(pendingPhaseBlocks({attempt:result},{unitKey:'stack:foreign',phase},fresh),true)
    const exact=before.map(record=>receipt(record))
    assert.equal(publicationContextMatches(before,exact),true)
    assert.deepEqual(publicationPhaseResult(phase,exact,{pending:true},before),{state:'sent'})
  })
}
test('ID-only historical phase, missing, duplicate and malformed receipts cannot settle',()=>{
  const before=targetCaseRecords({}),current=before.map(record=>receipt(record))
  assert.equal(pendingPhaseBlocks({attempt:{state:'checking',unitKey:'record:phase.1',phaseIds:['phase.1']}},{unitKey:'record:phase.1',phase:before},current),true)
  assert.deepEqual(publicationPhaseResult(before,[],{error:'Failure'}),{state:'checking'})
  assert.deepEqual(publicationPhaseResult(before,[...current,...current],{ok:true}),{state:'checking'})
  assert.deepEqual(publicationPhaseResult(before,[{...current[0],url:'https://github.com/foreign/repo/pull/83'}],{ok:true}),{state:'checking'})
  assert.equal(publicationPhaseResult(before,before,{error:'Exact failed attempt'}).state,'failed')
})
test('complete historical parent is mandatory for a linked suffix and valid partial remains checking',()=>{
  const before=targetCaseRecords({stack:true}),phase=[before[1]],current=before.map(record=>receipt(record))
  assert.deepEqual(publicationPhaseResult(phase,current,{ok:true}),{state:'checking'})
  assert.deepEqual(publicationPhaseResult(phase,current,{ok:true},before),{state:'sent'})
  assert.deepEqual(publicationPhaseResult(before,[current[0],before[1]],{pending:true},before),{state:'checking'})
})

test('dated historical phase cannot borrow an older or undated public receipt',()=>{
  const before=targetCaseRecords({}),current=before.map(record=>receipt(record))
  assert.deepEqual(publicationPhaseResult(before,[{...current[0],updated_at:'2026-10-08T21:00:00Z'}],{pending:true}),{state:'checking'})
  assert.deepEqual(publicationPhaseResult(before,[{...current[0],updated_at:undefined}],{pending:true}),{state:'checking'})
  assert.deepEqual(publicationPhaseResult([null],current,{pending:true}),{state:'checking'})
})
