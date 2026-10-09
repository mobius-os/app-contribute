import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { frontendModules } from './render-harness.mjs'
import { reviewOptions, workflowAgent } from '../review-prompts.js'

const options = { review_prompt:'Exact review', fix_prompt:'Exact fix', merge_prompt:'Exact merge', max_rounds:null, autopilot:false }
const agent = { provider:'codex', model:'pinned-fixture-model', effort:'high' }
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const deferred = () => { let resolve; return { promise:new Promise(done => { resolve=done }), resolve:value => resolve(value) } }
let component
async function load() {
  if (component) return component
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  // Execute the real component effect, with deterministic hook scheduling and
  // observational dependencies. No browser, saved storage, or public transport.
  const build = await rolldown({ input:new URL('../ui/ReviewPromptSettings.jsx', import.meta.url).pathname,
    platform:'node', tsconfig:false, transform:{jsx:'react-jsx'}, resolve:{modules:[frontendModules,'node_modules']},
    plugins:[{ name:'preview-effect-fixture',
      resolveId(id) { if(id === 'react') return '\0preview-hooks'; if(id === '../review-prompts.js') return '\0preview-dependencies' },
      load(id) {
        if(id === '\0preview-hooks') return `export const useState = value => {const fixture=globalThis.previewEffectFixture;return [value,next=>fixture.states.push(next)]}; export const useEffect = effect => {globalThis.previewEffectFixture.cleanup=effect()}`
        if(id === '\0preview-dependencies') return `export const reviewOptions=(...args)=>globalThis.previewEffectFixture.reviewOptions(...args), workflowAgent=(...args)=>globalThis.previewEffectFixture.workflowAgent(...args), loadWorkflowOptions=(...args)=>globalThis.previewEffectFixture.loadWorkflowOptions(...args), previewWorkflow=(...args)=>globalThis.previewEffectFixture.previewWorkflow(...args), saveWorkflowOptions=()=>{throw new Error('Preview cannot save settings')}`
      },
    }],
  })
  try {
    const { output } = await build.generate({format:'cjs'}), module = {exports:{}}
    new Function('module','exports','require',output[0].code)(module,module.exports,require)
    component = module.exports.ReviewPromptPreview
    return component
  } finally { await build.close() }
}
async function fixture(t, choice, dependencies = {}) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for the native component bundler'); return null }
  const render = await load(), states=[], resolved=[], previews=[]
  const value = { states, resolved, previews, reviewOptions, workflowAgent,
    loadWorkflowOptions:async()=>({options:{...options,review_prompt:'New default',autopilot:true},capabilities:{draft_takeover:true}}),
    previewWorkflow:async(token,appId,mode,sent,model)=>{previews.push({token,appId,mode,options:sent,agent:model});return {preview_sha256:digest(sent)}},
    ...dependencies,
  }
  const previous=globalThis.previewEffectFixture;globalThis.previewEffectFixture=value
  t.after(()=>{value.cleanup?.(); if(previous === undefined) delete globalThis.previewEffectFixture;else globalThis.previewEffectFixture=previous})
  render({token:'fixture',appId:'fixture-app',choice,onResolved:next=>resolved.push(next)})
  // Drain only known promise continuations; no timing retry or background work.
  value.flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve()}
  return value
}
for(const autopilot of [false,true]) test(`frozen takeover preview preserves saved autopilot ${autopilot} and resolves the equivalent hash without admission`, async t=>{
  const frozen={...options,autopilot}, f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options:frozen,agent,preview_sha256:digest(frozen)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews,[{token:'fixture',appId:'fixture-app',mode:'review_fix_merge',options:frozen,agent}])
  assert.equal(f.resolved.length,2);assert.equal(f.resolved[0],null)
  assert.deepEqual(f.resolved[1].options,frozen);assert.equal(f.resolved[1].preview.preview_sha256,digest(frozen))
  assert.deepEqual(f.states.at(-1),f.resolved[1]);assert.deepEqual(frozen,{...options,autopilot})
})
for(const autopilot of [false,true]) for(const post_review of [false,true]) test(`frozen takeover preserves exact autopilot ${autopilot} and post_review ${post_review} without admission`,async t=>{
  const frozen={...options,autopilot,post_review}, f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options:frozen,agent,preview_sha256:digest(frozen)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,frozen);assert.deepEqual(f.resolved[1].options,frozen)
  assert.equal(f.resolved[1].preview.preview_sha256,digest(frozen))
})
test('new takeover still defaults to autopilot and resolves editable defaults without admission',async t=>{
  const f=await fixture(t,{request_id:'new-fixture',mode:'review_fix_merge',options:{autopilot:false,post_review:true},agent})
  if(!f)return;await f.flush()
  assert.equal(f.previews[0].options.autopilot,true);assert.equal(f.previews[0].options.post_review,undefined);assert.equal(f.previews[0].options.review_prompt,'New default')
  assert.equal(f.resolved[1].preview.preview_sha256,digest(f.previews[0].options))
})
test('frozen options never import newly added defaults into their preview identity',async t=>{
  const frozen={autopilot:false}, f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options:frozen,agent,preview_sha256:digest(frozen)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.previews[0].options,frozen);assert.deepEqual(f.resolved[1].options,frozen)
})
test('drifted frozen preview stays unresolved without overriding the expected hash or starting work',async t=>{
  const f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options,agent,preview_sha256:'f'.repeat(64)})
  if(!f)return;await f.flush()
  assert.deepEqual(f.resolved,[null]);assert.match(f.states.at(-1).error,/saved instructions or model changed/)
  assert.equal(f.previews.length,1)
})
for(const outcome of ['success','drift']) test(`cancelled preview ignores late ${outcome} rather than resolving another approval`,async t=>{
  const pending=deferred(), f=await fixture(t,{request_id:'selection-fixture',mode:'review_fix_merge',options,agent,preview_sha256:digest(options)},
    {previewWorkflow:async(...args)=>{globalThis.previewEffectFixture.previews.push(args);return pending.promise}})
  if(!f)return;await f.flush();assert.equal(f.previews.length,1)
  f.cleanup();pending.resolve({preview_sha256:outcome==='success'?digest(options):'f'.repeat(64)});await f.flush()
  assert.deepEqual(f.resolved,[null]);assert.deepEqual(f.states,[{loading:true}])
})
