// The respond region (lifecycle_tables.py RESPOND) as a saved answer stores it: the words table, the helper's stamp, and the two deadlines
// that used to be missing (an approved answer whose chat never started; a post that went quiet).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { RESPOND_WORDS, canWithdraw, respondStateAt, respondStateOf, respondVectorOf, respondWaitingOn, settleResponse, wordsOfRespond } from '../respond-lifecycle.js'
import { LIFECYCLE_TABLES as TABLES } from '../lifecycle-tables.js'
import { POSTING_SILENCE_MINUTES, RESEND_AFTER_MS, normalizeDecision, normalizeResult, responseOutbox, responseStatus } from '../respond-result.js'

const example = () => JSON.parse(readFileSync(new URL('./fixtures/respond-result.example.json', import.meta.url), 'utf8'))
const cases = JSON.parse(readFileSync(new URL('./respond-lifecycle.cases.json', import.meta.url), 'utf8'))
const HEAD = 'b'.repeat(40)
const TIP = '2'.repeat(40)
const pull = (extra = {}) => ({ number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' }, ...extra })
const SENT = '2026-11-06T09:30:00Z'
const SENT_S = Date.parse(SENT) / 1000
const decision = (patch = {}) => normalizeDecision({ version: 1, result_id: example().id, digest: example().digest, decision: 'approved', at: SENT, ...patch })
const entry = (state = 'ready', pairedDecision = null, patch = {}) => ({ slug: 'owner__repo__7', result: normalizeResult({ ...example(), state, ...patch }), decision: pairedDecision })
const stateAt = (value, now, options = {}) => respondStateAt(value, { now, ...options })

test('the words table is the one both languages keep, and every state of the region except NONE has a row', () => {
  assert.deepEqual(RESPOND_WORDS, cases.words)
  const states = Object.keys(TABLES.regions.respond.states).filter(state => state !== 'NONE')
  for (const state of states) assert.ok(wordsOfRespond(state), `${state} has stored words`)
  assert.equal(wordsOfRespond('NONE'), null, 'no answer, no file')
  assert.deepEqual(wordsOfRespond('NOT_STARTED'), wordsOfRespond('APPROVED'), 'the same words: only the clock tells them apart')
})

test('stored words read as the state they always meant, and a state read back gives the words it was stored with', () => {
  for (const { name, found, region } of cases.reads) assert.equal(respondStateOf(found), region, name)
  for (const state of ['READY', 'APPROVED', 'POSTING', 'FAILED', 'POSTED', 'DISCARDED', 'OUT_OF_DATE']) {
    const words = wordsOfRespond(state)
    assert.equal(respondStateOf({ decision: null, moved: false, ...words }), state, `${state} round-trips`)
  }
  // The state word older readers expect stays the helper's word.
  for (const [state, word] of [['READY', 'ready'], ['APPROVED', 'ready'], ['NOT_STARTED', 'ready'], ['POSTING', 'posting'], ['FAILED', 'failed'], ['POSTED', 'posted']]) {
    assert.equal(wordsOfRespond(state).state, word, state)
  }
})

test('every word the app reads today reads as the region it means, through the same answer the screens already see', () => {
  const now = SENT_S + 5 // inside the first 30 seconds
  const read = (value, pr = pull()) => [responseStatus(value, pr), stateAt(value, now, { pr })]
  assert.deepEqual(read(entry()), ['ready', 'READY'])
  assert.deepEqual(read(entry('ready', decision())), ['approved', 'APPROVED'])
  assert.deepEqual(read(entry('ready', decision({ decision: 'discarded' }))), [null, 'DISCARDED'])
  assert.deepEqual(read(entry(), pull({ headRefOid: 'c'.repeat(40) })), ['stale', 'OUT_OF_DATE'])
  assert.deepEqual(read(entry('ready', decision()), pull({ headRefOid: 'c'.repeat(40) })), ['stale', 'OUT_OF_DATE'])
  assert.deepEqual(read(entry('ready', decision({ result_id: 'r-0123456789ab' }))), ['ready', 'READY'], 'another result’s approval counts for nothing')
  assert.deepEqual(read(entry('posted', decision()), pull({ headRefOid: TIP })), ['posted', 'POSTED'])
  assert.deepEqual(read(entry('failed', decision(), { error: { step: 'replies', message: 'x' } }), pull({ headRefOid: TIP })), ['failed', 'FAILED'])
})

test('the helper’s stamp, read as the app reads it, is POSTING until its deadline and FAILED from then on', () => {
  for (const { name, result, moves, vector, reads } of cases.stamps) {
    assert.ok(moves.length, name)
    const last = moves.at(-1)[2]
    const stamped = entry(last, decision(), { lifecycle: vector, receipts: { push: null, replies: [], description: null, rerequest: null } })
    for (const { now, region } of reads) assert.equal(stateAt(stamped, now), region, `${name} at ${now}`)
    assert.equal(result.state, 'ready', name)
  }
})

test('a stamp that is not this table’s, or contradicts the words, is ignored and the words decide', () => {
  const quiet = cases.stamps[0].vector // POSTING since 100, deadline 330
  const failed = entry('failed', decision(), { lifecycle: quiet })
  assert.equal(stateAt(failed, 200), 'FAILED', 'the helper said failed: an old stamp does not bring it back')
  const other = entry('posting', decision(), { lifecycle: { ...quiet, v: 99 } })
  assert.equal(stateAt(other, SENT_S + 60), 'POSTING', 'another table version: seeded from the words')
  const broken = entry('posting', decision(), { lifecycle: { v: 1, regions: { respond: { state: 'POSTING', since: 'noon', deadline: null } } } })
  assert.equal(stateAt(broken, SENT_S + 60), 'POSTING')
  assert.equal(normalizeResult({ ...example(), lifecycle: 'text' }).lifecycle, undefined, 'a stamp that is not an object is not kept')
})

test('an approved answer whose chat never started is the owner’s move after 30 seconds, from the moment the 30 seconds passed', () => {
  assert.equal(RESEND_AFTER_MS, 30000, 'the card’s 30 seconds are the table’s')
  assert.equal(TABLES.regions.respond.states.APPROVED.deadline.seconds * 1000, RESEND_AFTER_MS)
  const approved = entry('ready', decision())
  assert.equal(stateAt(approved, SENT_S + 29), 'APPROVED')
  assert.equal(stateAt(approved, SENT_S + 30), 'NOT_STARTED')
  assert.equal(stateAt(approved, SENT_S + 86400), 'NOT_STARTED', 'a day later it is still asking, not "sending"')
  const [row] = respondWaitingOn(approved, { now: SENT_S + 3600 })
  assert.deepEqual(row, { region: 'respond', state: 'NOT_STARTED', waits: 'owner', since: SENT_S + 30, deadline: null }, 'waiting on the owner since the deadline, not since the last look')
  const [young] = respondWaitingOn(approved, { now: SENT_S + 5 })
  assert.equal(young.waits, 'platform', 'for the first 30 seconds only the chat is expected to move')
  assert.equal(canWithdraw(approved, { now: SENT_S + 5 }), false, 'no way to take it back while the chat is starting')
  assert.equal(canWithdraw(approved, { now: SENT_S + 31 }), true)
  assert.equal(canWithdraw(entry(), { now: SENT_S + 31 }), false, 'nothing approved, nothing to take back')
})

test('the PR logic reads a loaded answer that did not start as a draft for the owner, never as sending for ever', () => {
  const loaded = (now, value = entry('ready', decision())) => settleResponse(value, { now })
  assert.equal(responseOutbox(loaded(SENT_S + 5), pull()).state, 'sending', 'inside the 30 seconds it is sending')
  assert.equal(responseOutbox(loaded(SENT_S + 31), pull()).state, 'drafted')
  assert.equal(responseOutbox(loaded(SENT_S + 86400), pull()).state, 'drafted')
  assert.equal(responseOutbox(entry('ready', decision()), pull()).state, 'sending', 'an entry nobody loaded through the store reads as it always did')
  const posting = loaded(SENT_S + 86400, entry('posting', decision(), { receipts: { push: { sha: TIP, at: '2026-11-06T09:30:08Z' }, replies: [], description: null, rerequest: null } }))
  assert.equal(responseOutbox(posting, pull({ headRefOid: TIP })).state, 'unconfirmed', 'a post that went quiet needs the owner (below)')
})

test('a post with no progress for its whole deadline is FAILED, with the receipts of what went out untouched', () => {
  assert.equal(POSTING_SILENCE_MINUTES, 3)
  const receipts = { push: { sha: TIP, at: '2026-11-06T09:30:08Z' }, replies: [{ index: 0, url: 'https://example.test/c/1', at: '2026-11-06T09:30:20Z' }], description: null, rerequest: null }
  const posting = entry('posting', decision(), { receipts })
  const lastStep = Date.parse('2026-11-06T09:30:20Z') / 1000
  assert.equal(responseStatus(settleResponse(posting, { now: lastStep + 179 }), pull({ headRefOid: TIP })), 'posting', 'still inside its 3 minutes since the last step')
  const settled = settleResponse(posting, { now: lastStep + 180 })
  assert.equal(responseStatus(settled, pull({ headRefOid: TIP })), 'failed')
  assert.equal(settled.result.state, 'failed')
  assert.deepEqual(settled.result.receipts, posting.result.receipts, 'KEEP_RECEIPTS: nothing that went out is forgotten, so a second try skips it')
  assert.deepEqual(settled.result.error, { step: 'posting', message: 'Nothing new went out for 3 minutes, so the post is taken as stopped.' })
  assert.equal(posting.result.state, 'posting', 'the loaded copy is not changed: the helper owns the file')
  const [row] = respondWaitingOn(posting, { now: lastStep + 600 })
  assert.deepEqual(row, { region: 'respond', state: 'FAILED', waits: 'owner', since: lastStep + 180, deadline: null })
})

test('every step the helper completes starts the 3 minutes again, and a stamp it wrote counts before the words do', () => {
  const stamped = result => entry('posting', decision(), { lifecycle: cases.stamps[0].vector, ...result })
  const begun = stamped()
  assert.equal(stateAt(begun, 329), 'POSTING', 'PROGRESS at 150 moved the deadline to 330')
  assert.equal(stateAt(begun, 330), 'FAILED')
  const old = settleResponse(entry('posting', decision()), { now: SENT_S + 3600 })
  assert.equal(old.result.state, 'failed', 'a post of an older helper, with no stamp: dated by the owner’s press')
})

test('an answer whose age cannot be read is never made to expire on a guess', () => {
  const unreadable = entry('posting', null, { created_at: 'later' })
  assert.equal(settleResponse(unreadable, { now: 1e10 }).result.state, 'posting')
  assert.equal(settleResponse(entry('posting', null), { now: SENT_S + 100000 }).result.state, 'posting', 'no stamp, no receipt, no press: nothing to date it by')
})

test('the vector the engine reads carries the history of the stamp and no attention', () => {
  const { vector } = respondVectorOf(entry('posting', decision(), { lifecycle: cases.stamps[0].vector }), { now: 200 })
  assert.deepEqual(Object.keys(vector).sort(), ['history', 'regions', 'v'])
  assert.equal(vector.history.length, 3)
})
