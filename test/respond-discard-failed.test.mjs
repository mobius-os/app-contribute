// A stopped answer can be discarded. Discard writes the same decision it writes for a ready answer, and every reader then reads the answer
// as discarded: it is gone from the PR, holds nothing of the owner's, and cannot be posted again. What it already put on GitHub stays there.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { approveResponse, discardResponse, withdrawResponse } from '../respond-flow.js'
import { loadResponses, readFreshResult } from '../respond-store.js'
import { respondStateAt, respondStateOf, respondVectorOf, respondWaitingOn } from '../respond-lifecycle.js'
import { discardQuestion, normalizeDecision, normalizeResult, responseOutbox, responseStatus, responseView } from '../respond-result.js'
import { standingFor } from '../pr-standing.js'
import { waitingOnGroups } from '../waiting-on.js'
import { frontendModules, renderModule } from './render-harness.mjs'
import { NAMES } from '../names.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const SLUG = 'owner__repo__7'
const RESULT = `respond-results/${SLUG}.json`
const DECISION = `respond-decisions/${SLUG}.json`
const SENT = '2026-11-06T09:30:00Z'
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })
const approval = (patch = {}) => ({ version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: SENT, ...patch })
const NOTHING_OUT = { push: null, replies: [], description: null, rerequest: null }
const ONE_REPLY_OUT = { push: null, replies: [{ index: 0, url: 'https://example.test/c/1', at: '2026-11-06T09:30:20Z' }], description: null, rerequest: null }
const STOPPED = { step: 'replies', message: 'reply 2 of 2: GitHub refused the comment.' }

function fakeStorage(files = {}) {
  const calls = []
  return {
    calls, files,
    async listWithStatus(prefix) {
      return { complete: true, entries: Object.entries(files).filter(([path]) => path.startsWith(prefix)).map(([path, content]) => ({ type: 'file', name: path.slice(prefix.length), path, content: structuredClone(content) })) }
    },
    async getWithVersion(path) { calls.push(['read', path]); return { value: files[path] === undefined ? null : structuredClone(files[path]), version: 'v1', offline: false } },
    async durableWrite(path, value) { calls.push(['write', path, structuredClone(value)]); files[path] = structuredClone(value); return { durability: 'synced' } },
    async remove(path) { calls.push(['remove', path]); delete files[path] },
  }
}
const stopped = (receipts = ONE_REPLY_OUT, decision = approval()) => ({ [RESULT]: { ...example(), state: 'failed', receipts, error: STOPPED }, ...(decision ? { [DECISION]: decision } : {}) })
const writes = storage => storage.calls.filter(([kind]) => kind === 'write')

const asked = []
globalThis.window = { mobius: { ownerGrant: { request: async (...args) => { asked.push(args); return true } } } }
const delivered = []
const deliver = async (token, request) => { delivered.push(request); return { ok: true, chatId: request.chatId, outcome: 'sent' } }
const tryAgain = storage => approveResponse({ slug: SLUG, digest: example().digest, pr: pull({ headRefOid: TIP }), chat: null, token: 't', capabilities: { owner_confirm: true }, storage, deliver, again: true })

test('Discard on a stopped answer writes the decision a ready answer’s Discard writes, for exactly that answer', async () => {
  const storage = fakeStorage(stopped())
  assert.deepEqual(await discardResponse({ slug: SLUG, digest: example().digest, storage, now: () => '2026-11-06T09:45:00Z' }), { ok: true })
  assert.deepEqual(storage.files[DECISION], { version: 1, result_id: example().id, digest: example().digest, decision: 'discarded', at: '2026-11-06T09:45:00Z' })
  assert.deepEqual(storage.files[RESULT].receipts, ONE_REPLY_OUT, 'the helper’s file is not touched: what went out stays on record')
  assert.equal(writes(storage).some(([, path]) => path === RESULT), false)
  const changed = fakeStorage(stopped())
  assert.equal((await discardResponse({ slug: SLUG, digest: 'e'.repeat(64), storage: changed })).ok, false, 'not the answer on screen')
  assert.deepEqual(writes(changed), [])
})

test('Discard is still refused while a post is running or after it posted', async () => {
  const nowS = Math.floor(Date.now() / 1000)
  const running = fakeStorage({ [RESULT]: { ...example(), state: 'posting', lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: nowS - 5, deadline: nowS + 175 } }, history: [] } }, [DECISION]: approval() })
  assert.match((await discardResponse({ slug: SLUG, digest: example().digest, storage: running })).error, /being posted/)
  const posted = fakeStorage({ [RESULT]: { ...example(), state: 'posted', receipts: ONE_REPLY_OUT }, [DECISION]: approval() })
  assert.equal((await discardResponse({ slug: SLUG, digest: example().digest, storage: posted })).ok, false)
  for (const storage of [running, posted]) assert.deepEqual(writes(storage), [])
})

test('a discarded stopped answer reads DISCARDED in JavaScript, with the same words in the table as a discarded ready one', async () => {
  const storage = fakeStorage(stopped())
  await discardResponse({ slug: SLUG, digest: example().digest, storage })
  const [entry] = await loadResponses(storage)
  assert.equal(entry.result.state, 'failed', 'the helper’s word is kept')
  assert.equal(responseStatus(entry, pull({ headRefOid: TIP })), null, 'it is gone from the PR')
  assert.equal(responseView([entry], pull({ headRefOid: TIP })), null)
  assert.equal(respondStateAt(entry, { pr: pull({ headRefOid: TIP }) }), 'DISCARDED')
  assert.equal(entry.lifecycle.regions.respond.state, 'DISCARDED')
  assert.deepEqual(respondWaitingOn(entry, { pr: pull({ headRefOid: TIP }) }), [], 'it waits on nobody')
  assert.equal(respondStateOf({ state: 'failed', decision: 'discarded', moved: true }), 'DISCARDED', 'a discard wins over a moved PR, as for a ready answer')
  assert.equal(respondStateOf({ state: 'failed', decision: 'approved', moved: false }), 'FAILED', 'Try again pressed: still stopped until the helper begins')
  assert.equal(respondStateOf({ state: 'failed', decision: null, moved: false }), 'FAILED')
  assert.equal(respondStateOf({ state: 'posting', decision: 'discarded', moved: false }), 'POSTING', 'a post that is running is never read as discarded')
  assert.equal(respondStateOf({ state: 'posted', decision: 'discarded', moved: false }), 'POSTED')
})

test('another answer’s discard, or one for changed content, leaves a stopped answer stopped', async () => {
  for (const decision of [approval({ decision: 'discarded', result_id: 'r-0123456789ab' }), approval({ decision: 'discarded', digest: 'f'.repeat(64) })]) {
    const [entry] = await loadResponses(fakeStorage(stopped(ONE_REPLY_OUT, decision)))
    assert.equal(responseStatus(entry, pull({ headRefOid: TIP })), 'failed')
    assert.equal(respondStateAt(entry, { pr: pull({ headRefOid: TIP }) }), 'FAILED')
  }
})

test('a stopped answer holds the PR as not confirmed and a row of the owner’s until it is discarded, and nothing after', async () => {
  const mine = pull({ headRefOid: TIP, author: { login: 'me' }, state: 'OPEN', baseRefName: 'main', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'owner/repo', viewerPermission: 'WRITE' },
    latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'sam', __typename: 'User' }, commit: { oid: TIP } }] }, reviewDecision: 'CHANGES_REQUESTED',
    viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })
  const storage = fakeStorage(stopped())
  const before = await loadResponses(storage)
  assert.equal(responseOutbox(before[0], mine).state, 'unconfirmed')
  assert.equal(standingFor({ pr: mine, login: 'me', responses: before }).state, 'unconfirmed')
  assert.equal(respondWaitingOn(before[0], { pr: mine }).length, 1)
  await discardResponse({ slug: SLUG, digest: example().digest, storage })
  const after = await loadResponses(storage)
  assert.equal(responseOutbox(after[0], mine), null, 'nothing is unconfirmed any more')
  assert.equal(standingFor({ pr: mine, login: 'me', responses: after }).state, 'author.feedback', 'the PR reads as it would with no answer')
  assert.deepEqual(respondWaitingOn(after[0], { pr: mine }), [])
})

test('Try again after Discard does nothing: no sheet, no approval, no message to the chat', async () => {
  asked.length = 0
  delivered.length = 0
  const storage = fakeStorage(stopped())
  await discardResponse({ slug: SLUG, digest: example().digest, storage })
  const out = await tryAgain(storage)
  assert.deepEqual(out, { ok: false, error: 'This answer was discarded.' })
  assert.deepEqual(asked, [])
  assert.deepEqual(delivered, [])
  assert.equal(storage.files[DECISION].decision, 'discarded', 'the decision still says discarded')
  assert.equal(writes(storage).length, 1, 'only the Discard wrote anything')
  assert.deepEqual(await withdrawResponse({ slug: SLUG, digest: example().digest, storage }), { ok: false, error: 'There is nothing to take back.' })
})

test('Try again on a stopped answer that was not discarded still asks and writes the approval', async () => {
  asked.length = 0
  delivered.length = 0
  const storage = fakeStorage(stopped(ONE_REPLY_OUT, null))
  assert.deepEqual(await tryAgain(storage), { ok: true })
  assert.equal(asked.length, 1)
  assert.equal(storage.files[DECISION].decision, 'approved')
  assert.equal(delivered.length, 1)
})

test('a ready answer keeps its behaviour: a stale card’s Post after a Discard is not stopped by the new rule', async () => {
  asked.length = 0
  delivered.length = 0
  const storage = fakeStorage({ [RESULT]: { ...example() }, [DECISION]: approval({ decision: 'discarded' }) })
  const out = await approveResponse({ slug: SLUG, digest: example().digest, pr: pull(), chat: null, token: 't', capabilities: { owner_confirm: true }, storage, deliver })
  assert.deepEqual(out, { ok: true })
  assert.equal(storage.files[DECISION].decision, 'approved')
})

const CLOSING = 'Discard drops only what was not sent yet and takes this answer off the pull request in Contribute.'

test('the question names what already went out, and only a stop the helper reported with nothing sent asks none', () => {
  const read = patch => normalizeResult({ ...example(), state: 'failed', error: STOPPED, ...patch })
  assert.equal(discardQuestion(read({ receipts: NOTHING_OUT })), null, 'a refusal the helper reported, with nothing sent and nothing unconfirmed')
  const question = discardQuestion(read({ receipts: ONE_REPLY_OUT }))
  assert.equal(question.title, 'Discard this answer?')
  assert.equal(question.text, `What already went out stays on GitHub: 1 of 2 replies posted. ${CLOSING}`)
  const all = discardQuestion(read({ screenshots: [{ name: 'a.png', sha256: 'a'.repeat(64), size: 1, alt: 'a' }], receipts: {
    screenshots: { commit: TIP, at: SENT }, push: { sha: TIP, at: SENT }, replies: [{ index: 0, url: 'u', at: SENT }, { index: 1, url: 'u', at: SENT }], description: { at: SENT }, rerequest: { at: SENT, reviewers: ['alex'] } } }))
  assert.match(all.text, /^What already went out stays on GitHub: 1 screenshot uploaded, 2 commits pushed to the PR’s branch, 2 replies posted, the description updated and a new review asked for\. Discard drops only/)
  assert.doesNotMatch(discardQuestion(read({ receipts: { ...NOTHING_OUT, push: { sha: TIP, at: SENT } } })).text, /repl|description|review asked/, 'only what has a receipt is named')
})

test('a reply that was being sent when the post stopped may be on GitHub without a receipt, and the question says which', () => {
  const read = patch => normalizeResult({ ...example(), state: 'failed', error: STOPPED, ...patch })
  const unconfirmed = discardQuestion(read({ receipts: { ...NOTHING_OUT, sending: { index: 0, at: SENT } } }))
  assert.equal(unconfirmed.text, `Reply 1 of 2 was being sent when it stopped and may already be on GitHub; if it is, it stays there. ${CLOSING}`)
  assert.equal(discardQuestion(read({ receipts: { ...NOTHING_OUT, sending: { index: 1, at: SENT } } })).text.slice(0, 12), 'Reply 2 of 2', 'the step is named')
  const both = discardQuestion(read({ receipts: { ...ONE_REPLY_OUT, sending: { index: 1, at: SENT } } }))
  assert.equal(both.text, `What already went out stays on GitHub: 1 of 2 replies posted. Reply 2 of 2 was being sent when it stopped and may already be on GitHub; if it is, it stays there. ${CLOSING}`)
  const settled = discardQuestion(read({ receipts: { ...ONE_REPLY_OUT, sending: { index: 0, at: SENT } } }))
  assert.equal(settled.text, `What already went out stays on GitHub: 1 of 2 replies posted. ${CLOSING}`, 'a reply that has its receipt is not unconfirmed any more')
  assert.equal(normalizeResult({ ...example(), receipts: { ...NOTHING_OUT, sending: { index: -1, at: SENT } } }).receipts.sending, undefined, 'a note that cannot be read is no note')
  const bounded = index => normalizeResult({ ...example(), receipts: { ...NOTHING_OUT, sending: { index, at: SENT } } }).receipts.sending
  assert.deepEqual(bounded(1), { index: 1, at: SENT }, 'the last of the two replies')
  assert.equal(bounded(2), undefined, 'a note for a reply the answer does not have is no note, so the question never reads Reply 3 of 2')
  assert.deepEqual(normalizeResult({ ...example(), receipts: NOTHING_OUT }).receipts, { ...NOTHING_OUT, screenshots: null }, 'no note, no key: the receipts read as they always did')
})

test('a post the app took as stopped after 3 minutes asks too: the chat may still be sending one step', async () => {
  const nothingLeft = 'The chat may still be sending one step; it stops before the next.'
  const storage = fakeStorage({ [RESULT]: { ...example(), state: 'posting', receipts: NOTHING_OUT }, [DECISION]: approval() })
  const [quiet] = await loadResponses(storage)
  assert.equal(quiet.result.state, 'failed')
  assert.equal(quiet.result.error.step, 'posting', 'the app’s own stop, not one the helper reported')
  assert.equal(discardQuestion(quiet.result).text, `${nothingLeft} ${CLOSING}`)
  const sent = fakeStorage({ [RESULT]: { ...example(), state: 'posting', receipts: ONE_REPLY_OUT }, [DECISION]: approval() })
  assert.equal(discardQuestion((await loadResponses(sent))[0].result).text, `What already went out stays on GitHub: 1 of 2 replies posted. ${nothingLeft} ${CLOSING}`)
  const reported = normalizeResult({ ...example(), state: 'failed', receipts: NOTHING_OUT, error: { step: 'replies', message: 'GitHub refused the comment.' } })
  assert.equal(discardQuestion(reported), null, 'a stop the helper reported is not the app’s timeout')
})

test('an answer left as posting on disk and long quiet, then discarded, reads DISCARDED in every reader', async () => {
  const mine = pull({ headRefOid: TIP, author: { login: 'me' }, state: 'OPEN', baseRefName: 'main', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'owner/repo', viewerPermission: 'WRITE' },
    latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'sam', __typename: 'User' }, commit: { oid: TIP } }] }, reviewDecision: 'CHANGES_REQUESTED',
    viewerLatestReview: null, reviewThreads: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })
  const ownerStates = responses => waitingOnGroups({ pulls: [mine], login: 'me', responses }).owner.map(row => row.state)
  const onDisk = decision => fakeStorage({ [RESULT]: { ...example(), state: 'posting', receipts: ONE_REPLY_OUT }, ...(decision ? { [DECISION]: decision } : {}) })
  const [before] = await loadResponses(onDisk(approval()))
  assert.equal(before.result.state, 'failed', 'the file says posting; the lazy tick reads it as stopped')
  assert.equal(responseStatus(before, mine), 'failed')
  assert.deepEqual(ownerStates([before]), ['unconfirmed'], 'a stopped answer is a Not confirmed row of the owner’s')
  const [after] = await loadResponses(onDisk(approval({ decision: 'discarded', at: '2026-11-06T09:45:00Z' })))
  assert.equal(after.result.state, 'failed')
  assert.equal(responseStatus(after, mine), null, 'the PR page and the card')
  assert.equal(responseView([after], mine), null)
  assert.equal(responseOutbox(after, mine), null, 'the PR logic')
  assert.equal(respondStateAt(after, { pr: mine }), 'DISCARDED')
  assert.deepEqual(respondWaitingOn(after, { pr: mine }), [])
  assert.deepEqual(ownerStates([after]), ['author.feedback'], 'the Desk and Needs you: no Not confirmed row, only the feedback the PR really has')
  assert.equal(standingFor({ pr: mine, login: 'me', responses: [after] }).state, 'author.feedback')
})

test('the card offers Discard beside Try again on a stopped answer, never while it posts or after it posted', async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR'); return }
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ResponseCard } from './ui/ResponseCard.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ResponseCard, props))
  `)
  const view = (state, decision = approval()) => responseView([{ slug: SLUG, result: normalizeResult({ ...example(), state, receipts: ONE_REPLY_OUT, error: state === 'failed' ? STOPPED : null }), decision: normalizeDecision(decision) }], pull({ headRefOid: TIP }))
  const labels = html => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(match => match[1].replace(/<[^>]+>/g, '')).filter(label => [NAMES.tryAgain, NAMES.discard, NAMES.openChat].includes(label))
  const props = response => ({ pr: pull({ headRefOid: TIP }), response, ownerGrant: true, onPost() {}, onDiscard() {} })
  assert.deepEqual(labels(render(props(view('failed')))), [NAMES.tryAgain, NAMES.openChat, NAMES.discard])
  assert.deepEqual(labels(render({ ...props(view('failed')), busy: true })), [NAMES.openChat, NAMES.discard], 'Try again says Working…')
  assert.match(render({ ...props(view('failed')), busy: true }), new RegExp(`co-btn-quiet" disabled="">${NAMES.discard}<`), 'busy: it cannot be pressed twice')
  const off = render({ ...props(view('failed')), ownerGrant: false })
  assert.match(off, new RegExp(`co-btn-primary" disabled="">${NAMES.tryAgain}<`), 'where Möbius does not confirm Post, Try again is off')
  assert.match(off, new RegExp(`co-btn-quiet">${NAMES.discard}<`), 'and Discard, which publishes nothing, stays on')
  assert.deepEqual(labels(render(props(view('posting')))), [NAMES.openChat])
  assert.deepEqual(labels(render(props(view('posted')))), [])
  assert.deepEqual(labels(render({ ...props(view('failed')), readOnly: true })), [])
})
