import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'
let renderer
async function load(t) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { InlineBatchView, InlinePreparedView, newerRecord } from './ui/InlinePreparedView.jsx'
    export { newerRecord }
    export function render(props) { return renderToStaticMarkup(React.createElement(InlinePreparedView, props)) }
    export function renderBatch(props) { return renderToStaticMarkup(React.createElement(InlineBatchView, props)) }
  `)
  return renderer
}
async function render(t, props) {
  const module = await load(t)
  return module ? (await module).render(props) : null
}
const plan = { action: 'pr', repo: 'team/repo', title: 'Fix the thing', branch: 'fix/thing', head_sha: 'a'.repeat(40), diff_sha256: 'b'.repeat(64) }
const reviewed = { id: 'rec-1', type: 'pr', status: 'prepared', repo: 'team/repo', title: 'Fix the thing', plan,
  quality_review: { state: 'all_clear', reviewed_head_sha: plan.head_sha } }
const base = { target: { kind: 'prepared', id: 'rec-1', embedded: true }, appId: 1, ledgerReady: true,
  reviewStatus: { state: 'ready', byId: { 'rec-1': { state: 'ready' } } }, onSend() {}, onSendStack() {}, onDismiss() {}, onFeedback() {}, loadDiff: async () => '' }

test('a cached reviewed card waits for mounted exact authority before offering publication', async t => {
  const html = await render(t, { ...base, records: [reviewed] })
  if (!html) return
  assert.match(html, /Fix the thing/)
  assert.match(html, /Checking this contribution/)
  assert.doesNotMatch(html, />Contribute</)
  assert.match(html, /Open in Contribute/)
})

test('malformed stack intent is visible but offers no single or batch publication action', async t => {
  const module = await load(t)
  if (!module) return
  const broken = { ...reviewed, plan: { ...plan, stack: { id: 'chain', total: 2 } } }
  const single = (await module).render({ ...base, records: [broken], target: { ...base.target, confirm: true } })
  assert.match(single, /Fix the thing/)
  assert.match(single, /invalid layer metadata/i)
  assert.doesNotMatch(single, />Contribute</)
  const batch = (await module).renderBatch({ ...base, records: [broken], target: { kind: 'batch', ids: ['rec-1'], embedded: true } })
  assert.match(batch, /invalid layer metadata/i)
  assert.match(batch, /disabled=""[^>]*>Contribute all 0</)
})

test('an unreviewed record offers no Send', async t => {
  const html = await render(t, { ...base, records: [{ ...reviewed, quality_review: { state: 'changes_needed' } }] })
  if (!html) return
  assert.doesNotMatch(html, />Contribute</)
})

test('a record not yet in the feed waits for its exact read instead of claiming it is gone', async t => {
  const html = await render(t, { ...base, records: [] })
  if (!html) return
  assert.match(html, /Reading this contribution/)
  assert.doesNotMatch(html, /no longer in Contribute|>Contribute</)
})

test('a linked stack still loading its layers says so instead of calling the chain incomplete', async t => {
  const stack = { id: 'chain', name: 'Chain', position: 1, total: 2, base_branch: 'main' }
  const first = { ...reviewed, plan: { ...plan, branch: 'stack/chain/01-a', stack } }
  const html = await render(t, { ...base, ledgerReady: false, records: [first] })
  if (!html) return
  assert.match(html, /Loading the linked changes/)
  assert.doesNotMatch(html, /incomplete|Contribute 1 linked/)
})

test('the Send view keeps whichever copy of the record is newer', async t => {
  const module = await load(t)
  if (!module) return
  const { newerRecord } = await module
  const cached = { id: 'r', updated_at: '2026-10-05T10:00:00Z', status: 'prepared' }
  const fresh = { id: 'r', updated_at: '2026-10-05T11:00:00Z', status: 'open' }
  assert.equal(newerRecord(cached, fresh), fresh)
  assert.equal(newerRecord(fresh, cached), fresh)
  assert.equal(newerRecord(undefined, fresh), fresh)
  assert.equal(newerRecord(undefined, null), null)
})

test('opened from the block Send button, the view confirms once with the target repository linked', async t => {
  const html = await render(t, { ...base, target: { ...base.target, confirm: true }, records: [reviewed] })
  if (!html) return
  assert.match(html, /Contribute this pull request to <a class="co-repo-link" href="https:\/\/github\.com\/team\/repo"/)
  assert.equal((html.match(/>Contribute</g) || []).length, 1)
  assert.match(html, />Not now</)
  // The reader is already in a chat, so the view offers no source-chat button.
  assert.doesNotMatch(html, /Open source chat|>Chat</)
})

test('the confirmation explains instead of sending when the version is not reviewed', async t => {
  const html = await render(t, { ...base, target: { ...base.target, confirm: true }, records: [{ ...reviewed, quality_review: { state: 'changes_needed' } }] })
  if (!html) return
  assert.match(html, /still needs a review before it can be sent/)
  assert.doesNotMatch(html, />Contribute</)
})

test('the confirmation requires a current per-record source verdict, not an empty response', async t => {
  const html = await render(t, { ...base, target: { ...base.target, confirm: true }, records: [reviewed], reviewStatus: { state: 'ready', byId: {} } })
  if (!html) return
  assert.match(html, /current source check/)
  assert.doesNotMatch(html, />Contribute</)
})

test('the confirmation explains that All clear is a private review, not CI, with the reviewer note', async t => {
  const html = await render(t, { ...base, target: { ...base.target, confirm: true },
    records: [{ ...reviewed, quality_review: { ...reviewed.quality_review, summary: 'Ran the focused tests.' } }] })
  if (!html) return
  assert.match(html, /What “All clear” means/)
  assert.match(html, /It is not GitHub CI/)
  assert.match(html, /Ran the focused tests\./)
})

test('an unhydrated batch lists every named record and waits truthfully while preserving skip reasons', async t => {
  const module = await load(t)
  if (!module) return
  const unreviewed = { ...reviewed, id: 'rec-2', title: 'Not reviewed yet', plan: { ...plan, title: 'Not reviewed yet' }, quality_review: { state: 'changes_needed' } }
  const sent = { ...reviewed, id: 'rec-3', status: 'open', number: 3, url: 'https://github.com/team/repo/pull/3', plan: { ...plan, title: 'Already out' } }
  const html = (await module).renderBatch({ ...base, target: { kind: 'batch', ids: ['rec-1', 'rec-2', 'rec-3'], embedded: true }, records: [reviewed, unreviewed, sent] })
  assert.match(html, /Checking contributions/)
  assert.match(html, /disabled=""[^>]*>Checking…</)
  assert.match(html, /Fix the thing/)
  assert.match(html, /still needs a review before it can be sent/)
  assert.match(html, /Already sent/)
  assert.match(html, /What “All clear” means/)
})


test('an open record without a verified PR link is not called sent', async t => {
  const module = await load(t)
  if (!module) return
  const unverified = { ...reviewed, id: 'rec-4', status: 'open' }
  const html = (await module).renderBatch({ ...base, target: { kind: 'batch', ids: ['rec-1', 'rec-4'], embedded: true }, records: [reviewed, unverified] })
  assert.match(html, /Not ready/)
  assert.doesNotMatch(html, /Already sent/)
})
