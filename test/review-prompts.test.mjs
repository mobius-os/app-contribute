import test from 'node:test'
import assert from 'node:assert/strict'
import { loadWorkflowOptions, previewWorkflow, reviewOptions, saveWorkflowOptions, workflowAgent, workflowSettings } from '../review-prompts.js'
import { reviewRunRequest } from '../collaboration.js'

const defaults = {review_prompt:'Review the full diff',fix_prompt:'Fix findings',merge_prompt:'Merge only when safe',max_rounds:null,autopilot:false,mandatory_instructions:'No unrelated scope'}
function storage(t, value=null, version=null, overrides={}) {
  const previous=globalThis.window
  globalThis.window={mobius:{storage:{getWithVersion:async()=>({value,version}),...overrides}}}
  t.after(()=>{if(previous===undefined)delete globalThis.window;else globalThis.window=previous})
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(defaults)))
}
test('new UI workflows default to autopilot without rewriting legacy presets or saved false',async t=>{
  storage(t)
  assert.equal((await loadWorkflowOptions('fixture',80)).options.autopilot,true)
  window.mobius.storage.getWithVersion=async()=>({value:{autopilot:false,max_rounds:2},version:'v7'})
  const loaded=await loadWorkflowOptions('fixture',80)
  assert.equal(loaded.options.autopilot,false)
  assert.equal(loaded.options.max_rounds,null)
  assert.equal(loaded.options.review_prompt,defaults.review_prompt)
  assert.equal(loaded.version,'v7')
  assert.equal(defaults.autopilot,false)
})
test('new work drops only legacy budget, while exact saved selections retain their frozen limit',async t=>{
  const value={review_prompt:'Owner review guidance',max_rounds:5,autopilot:false}
  storage(t,value,'v7')
  const loaded=await loadWorkflowOptions('fixture',80)
  assert.equal(loaded.options.max_rounds,null)
  assert.equal(loaded.options.review_prompt,value.review_prompt)
  assert.equal(loaded.options.autopilot,false)
  assert.equal(value.max_rounds,5)
  assert.equal(reviewOptions({max_rounds:2},loaded.options).max_rounds,2)
  assert.equal(reviewOptions({max_rounds:null},{max_rounds:5}).max_rounds,null)
})
test('settings save compares the version the owner edited, never a new version read at Save',async t=>{
  const writes=[]
  storage(t,null,null,{getWithVersion:async()=>assert.fail('Save must not adopt an unseen version'),durableWrite:async(...args)=>{writes.push(args);return {durability:'synced',version:'v8'}}})
  const result=await saveWorkflowOptions({...defaults,authority:'merge any PR'},'v7')
  assert.equal(result.version,'v8')
  assert.deepEqual(writes,[['review-workflow.json',reviewOptions(defaults),{ifMatch:'v7'}]])
  await saveWorkflowOptions(defaults,null)
  assert.deepEqual(writes[1][2],{ifNoneMatch:true})
})
test('offline reads and unconfirmed saves never claim durable prompt settings',async t=>{
  storage(t,null,null,{getWithVersion:async()=>({offline:true}),durableWrite:async()=>({durability:'queued'})})
  await assert.rejects(workflowSettings(),/Go online/)
  await assert.rejects(saveWorkflowOptions(defaults,'v7'),/not confirmed saved/)
})
test('preview and admission use the same explicit model and resolved editable instructions',async t=>{
  const agent=workflowAgent({provider:'codex',model:'model-id',effort:'high'})
  const options=reviewOptions({autopilot:false},defaults),calls=[]
  t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({options,preview_sha256:'c'.repeat(64)}))})
  const preview=await previewWorkflow('fixture',80,'review_fix_merge',options,agent)
  const request=reviewRunRequest({request_id:'fixture-1',mode:'review_fix_merge',options,agent,preview_sha256:preview.preview_sha256,pulls:[{number:7,repository:{nameWithOwner:'owner/repo'},headRefOid:'a'.repeat(40),baseRefName:'main',baseRefOid:'b'.repeat(40),baseRef:{target:{oid:'b'.repeat(40)}}}]})
  assert.deepEqual(calls[0],{mode:'review_fix_merge',options,agent})
  assert.deepEqual(request.agent,calls[0].agent)
  assert.deepEqual(request.options,calls[0].options)
  assert.equal(request.confirmation_scope,'named_pr_repairs_and_reviewed_successors')
  assert.equal(request.preview_sha256,'c'.repeat(64))
  assert.equal(workflowAgent({provider:'',model:''}),undefined)
  assert.deepEqual(workflowAgent({provider:'codex',model:'model-id',effort:''}),{provider:'codex',model:'model-id'})
})

test('served readiness capability is discovery metadata, never a prompt or saved authority',async t=>{
  storage(t)
  globalThis.fetch=async()=>new Response(JSON.stringify({presets:defaults,capabilities:{draft_takeover:true}}))
  const loaded=await loadWorkflowOptions('fixture',80)
  assert.equal(loaded.capabilities.draft_takeover,true)
  assert.equal(reviewOptions(loaded.options).draft_takeover,undefined)
  assert.equal(reviewOptions({...loaded.options,capabilities:loaded.capabilities}).capabilities,undefined)
})
