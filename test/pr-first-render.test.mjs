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
    export function render(name, props) { return renderToStaticMarkup(React.createElement({ ReviewConfirmation, PullRequestDetail, PullRequests }[name], props)) }
  `)
  return (await renderer).render(name, props)
}

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
