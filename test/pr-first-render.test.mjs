import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const pr = { number: 42, title: 'Keep PR actions stable', repository: { nameWithOwner:'team/repo', viewerPermission:'WRITE' }, headRefOid:'a'.repeat(40), baseRefOid:'b'.repeat(40), baseRefName:'main', url:'https://github.com/team/repo/pull/42', author:{ login:'maker' } }
let renderer
async function render(t, name, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ReviewConfirmation, PullRequests } from './ui/PullRequests.jsx'
    import { PullRequestDetail } from './ui/PullRequestDetail.jsx'
    export { draftCapabilityBlocker } from './ui/PullRequests.jsx'
    export function render(name, props) { return renderToStaticMarkup(React.createElement({ ReviewConfirmation, PullRequestDetail, PullRequests }[name], props)) }
  `)
  return (await renderer).render(name, props)
}
async function renderModuleExports(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return {} }
  await render(t, 'ReviewConfirmation', { choice:null })
  return await renderer
}

test('agent setup presents separate review-only and scoped takeover modes', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', request_id:'fixed' }, busy:false, disabled:true, onModeChange:() => {} })
  if (!html) return
  assert.match(html, /Take on #42 with an agent/)
  assert.match(html, /<strong>Review<\/strong>/)
  assert.match(html, /Review, fix &amp; merge/)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /Exact versions covered by this approval/)
  assert.match(html, /disabled=""/)
})

test('no automatic-continuation option is offered, because the platform does not support it', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review' }, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!html) return
  assert.match(html, /Review, fix &amp; merge/)
  assert.doesNotMatch(html, /Continue private review automatically|autopilot/i)
})

test('drafts explain the unavailable takeover without hiding the workflow', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[{...pr,isDraft:true}], mode:'review' }, busy:false, onModeChange:() => {} })
  if (!html) return
  assert.match(html, /Review, fix &amp; merge/)
  // Initial render is the loading state: it must say so, not claim a missing update.
  assert.match(html, /Checking what this Möbius supports…/)
  assert.doesNotMatch(html, /needs the Möbius update/)
  assert.match(html, /disabled=""/)
})

test('draft capability copy separates loading, unsupported and supported', async t => {
  const { draftCapabilityBlocker } = await renderModuleExports(t)
  if (!draftCapabilityBlocker) return
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:null, saved:false, allowDraft:false }), 'Checking draft support…')
  assert.match(draftCapabilityBlocker({ drafts:true, capabilities:{}, saved:false, allowDraft:false }), /needs the Möbius update/)
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:{ draft_takeover:true }, saved:false, allowDraft:true }), '')
  assert.equal(draftCapabilityBlocker({ drafts:false, capabilities:null, saved:false, allowDraft:false }), '')
  assert.equal(draftCapabilityBlocker({ drafts:true, capabilities:null, saved:true, allowDraft:false }), '')
})

test('compact takeover preserves every public-scope and Stop condition', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review_fix_merge' }, busy:false, disabled:true, onModeChange:() => {} })
  if (!html) return
  for (const phrase of ['independent review', 'required checks', 'scoped fixes may be pushed', 'No public comments or unrelated edits', 'Stop prevents new actions']) assert.ok(html.includes(phrase), phrase)
})

test('phone search has a named expandable action while the field stays available', async t => {
  const html = await render(t, 'PullRequests', { conn:{state:'connected',login:'owner'}, project:{canonical_repo:'team/repo'}, records:[] })
  if (html === null) return
  assert.ok(html.length > 0, 'The actual component must render before checking its controls')
  assert.match(html, /aria-label="Search pull requests" aria-expanded="false"/)
  assert.match(html, /aria-label="Find a pull request"/)
})

test('detail keeps actions and tabs outside reserved independently loaded context', async t => {
  const html = await render(t, 'PullRequestDetail', { pr, canAssign:true, canMerge:true })
  if (html === null) return
  assert.ok(html.length > 0, 'The actual component must render before checking its controls')
  const actions = html.indexOf('co-pr-detail-actions')
  const tabs = html.indexOf('co-detail-tabs')
  const body = html.indexOf('co-pr-detail-body')
  assert.ok(actions > 0 && tabs > actions && body > tabs)
  assert.match(html, /Take on with agent/)
 assert.match(html, / Assign<\/button>/)
  assert.match(html, /Loading description/)
  assert.doesNotMatch(html, /Take over review &amp; merge/)
})


test('live-list approval discloses current same-target binding while saved selections stay base-pinned', async t => {
  const choice={mode:'review_merge',pulls:[{...pr,baseRef:{target:{oid:pr.baseRefOid}}}]}
  const live=await render(t,'ReviewConfirmation',{choice,bindCurrentTarget:true})
  if(live===null)return
  assert.match(live,/current tip of the same target branch/)
  assert.match(live,/fresh review of the combined code/)
  assert.match(live,/last seen bbbbbbb/)
  assert.doesNotMatch(live,/Exact versions covered by this approval/)
  const pinned=await render(t,'ReviewConfirmation',{choice})
  assert.match(pinned,/Exact versions covered by this approval/)
  assert.match(pinned,/aaaaaaa → main \(bbbbbbb\)/)
  assert.doesNotMatch(pinned,/current tip of the same target branch|last seen/)
})

test('unwritable source forks explain why repair-and-merge is unavailable', async t => {
  const html = await render(t, 'ReviewConfirmation', { choice:{ pulls:[{...pr, headRepository:{ nameWithOwner:'fork/repo', viewerPermission:'READ' }}], mode:'review' }, onModeChange:()=>{} })
  if (!html) return
  assert.match(html, /Requires push access/)
  assert.match(html, /<strong>Review<\/strong>/)
})


test('draft-ready launch explicitly names marking ready without adding routine scope clutter', async t => {
  const html=await render(t,'ReviewConfirmation',{choice:{pulls:[{...pr,isDraft:true}],mode:'review_fix_merge',confirmation_scope:'named_pr_repairs_ready_and_reviewed_successors'},onModeChange:()=>{}})
  if(!html)return
  assert.match(html,/drafts marked ready.*independent review and required checks/)
  assert.match(html,/Marking ready may notify reviewers/)
})

test('posting a review on GitHub is an opt-in inside Review only, shown only when the server supports it', async t => {
  const source = await import('node:fs').then(fs => fs.readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8'))
  assert.match(source, /choice\.mode === 'review' && onOptionsChange && capabilities\?\.post_review === true \? <label/)
  assert.match(source, /Allow posting the review on GitHub<small>The agent may post one comment review with a verdict it marks as public\. Questions to you stay private\. It never approves or requests changes\./)
  const unresolved = await render(t, 'ReviewConfirmation', { choice:{ pulls:[pr], mode:'review', request_id:'fixed' }, onModeChange:()=>{}, onOptionsChange:()=>{} })
  if (!unresolved) return
  assert.doesNotMatch(unresolved, /posting the review on GitHub/, 'hidden until the served capability is known')
})
