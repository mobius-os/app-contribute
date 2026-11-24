// The card of an approved answer whose chat never started, and the words of a post that may go quiet.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { frontendModules, renderModule } from './render-harness.mjs'
import { TAKE_BACK, normalizeDecision, normalizeResult, responseView } from '../respond-result.js'
import { NAMES } from '../names.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const pr = { number: 7, title: 'Add the thing', headRefOid: HEAD, baseRefOid: 'c'.repeat(40), baseRefName: 'main', url: 'https://github.com/owner/repo/pull/7', repository: { nameWithOwner: 'owner/repo' } }
const SENT = Date.parse('2026-11-06T09:30:00Z')

let renderer
async function render(t, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ResponseCard } from './ui/ResponseCard.jsx'
    export function render(props) { return renderToStaticMarkup(React.createElement(ResponseCard, props)) }
  `)
  return (await renderer).render(props)
}
const approval = normalizeDecision({ version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: '2026-11-06T09:30:00Z' })
const response = (state = 'ready', patch = {}, prPatch = {}) => responseView([{ slug: 'owner__repo__7', result: normalizeResult({ ...example(), state, ...patch }), decision: approval }], { ...pr, ...prPatch })
const card = (t, view, props = {}) => render(t, { pr, response: view, ownerGrant: true, onPost() {}, onDiscard() {}, onRespondAgain() {}, ...props })
const texts = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const buttons = html => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(match => texts(match[1])).filter(Boolean)

test('for the first 30 seconds only the waiting state shows, with no recovery button, even where Take back Post is wired', async t => {
  const html = await card(t, response(), { now: SENT + 3000, onWithdraw() {} })
  if (!html) return
  assert.match(texts(html), /Sent to the chat/)
  assert.match(html, /class="co-arc"/, 'a spinner')
  assert.deepEqual(buttons(html).filter(label => [NAMES.sendAgain, TAKE_BACK, NAMES.postAnswer].includes(label)), [])
})

test('once the chat did not start, the owner can send again or take Post back, in words that say what each does', async t => {
  const html = await card(t, response(), { now: SENT + 31000, onWithdraw() {} })
  if (!html) return
  assert.match(texts(html), /Not started yet/)
  assert.match(texts(html), /The chat has not started yet\. Send it again, take Post back, or open the chat\./)
  assert.deepEqual(buttons(html).filter(label => [NAMES.sendAgain, NAMES.openChat, TAKE_BACK].includes(label)), [NAMES.sendAgain, NAMES.openChat, TAKE_BACK])
  assert.match(html, new RegExp(`<button type="button" class="co-btn co-btn-quiet">${TAKE_BACK}</button>`), 'a quiet button: Send again stays the primary one')
  assert.equal(TAKE_BACK, 'Take back Post')
})

test('where Take back Post is not wired the card is what it was, word for word', async t => {
  const html = await card(t, response(), { now: SENT + 31000 })
  if (!html) return
  assert.match(texts(html), /The chat has not started yet\. Send it again, or open the chat\./)
  assert.ok(!buttons(html).includes(TAKE_BACK))
})

test('Take back Post is on even where Post is off, because it publishes nothing', async t => {
  const html = await card(t, response(), { now: SENT + 31000, onWithdraw() {}, ownerGrant: false })
  if (!html) return
  assert.ok(buttons(html).includes(TAKE_BACK))
})

test('while it is busy the button waits, and a closed PR offers nothing', async t => {
  const busy = await card(t, response(), { now: SENT + 31000, onWithdraw() {}, busy: true })
  if (!busy) return
  assert.match(busy, new RegExp(`class="co-btn co-btn-quiet" disabled="">${TAKE_BACK}<`))
  const closed = await card(t, response(), { now: SENT + 31000, onWithdraw() {}, readOnly: true })
  assert.ok(!buttons(closed).includes(TAKE_BACK))
})

test('a post that is going says when it will show as stopped, and a stopped one is tried again', async t => {
  const receipts = { push: { sha: TIP, at: '2026-11-06T09:31:00Z' }, replies: [], description: null, rerequest: null }
  const going = await card(t, response('posting', { receipts }, { headRefOid: TIP }), { pr: { ...pr, headRefOid: TIP } })
  if (!going) return
  assert.match(texts(going), /The chat is posting this now\. Each step is ticked as it is done\. If no step goes out for 3 minutes, it shows as stopped and you can try again\./)
  const stopped = await card(t, response('failed', { receipts, error: { step: 'posting', message: 'Nothing new went out for 3 minutes, so the post is taken as stopped.' } }, { headRefOid: TIP }), { pr: { ...pr, headRefOid: TIP } })
  assert.match(texts(stopped), /Posting stopped/)
  assert.match(texts(stopped), /Stopped at posting: Nothing new went out for 3 minutes, so the post is taken as stopped\. The ticked steps went out and a second try skips them\./)
  assert.deepEqual(buttons(stopped).filter(label => [NAMES.tryAgain, NAMES.openChat].includes(label)), [NAMES.tryAgain, NAMES.openChat])
})
