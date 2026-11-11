import assert from 'node:assert/strict'
import test from 'node:test'
import { mergePull, pullAction, requestReviewMany } from '../collaboration.js'
import { askOwner } from '../owner-grant.js'

const HEAD = 'a'.repeat(40)
const pr = { number: 7, headRefOid: HEAD, repository: { nameWithOwner: 'owner/repo' } }
const body = { repo: 'owner/repo', number: 7, head_sha: HEAD }

test('the shell is asked first for exactly the request that is then sent; a cancel or a refusal sends nothing', async () => {
  const order = []
  const realFetch = globalThis.fetch
  const sheet = { next: true } // true: confirmed, false: the owner closed the sheet, an Error: the platform refused
  globalThis.window = { mobius: { ownerGrant: { request: async (...args) => { order.push(['shell', ...args]); if (sheet.next instanceof Error) throw sheet.next; return sheet.next } } } }
  globalThis.fetch = async (url, options) => { order.push(['fetch', url, JSON.parse(options.body)]); return new Response(JSON.stringify({ state: 'merged', merge_sha: 'abc' })) }
  const onConfirmed = () => order.push(['confirmed']) // the app's own sheet says "Merging…" only from here
  try {
    const merged = await mergePull('t', 3, pr, { method: 'squash', shellConfirm: askOwner, onConfirmed })
    assert.deepEqual(merged, { ok: true, state: 'merged', mergeSha: 'abc' })
    assert.deepEqual(order, [['shell', 'merge', {}, { ...body, method: 'squash' }], ['confirmed'], ['fetch', '/api/github/contributions/3/pulls/merge', { ...body, method: 'squash' }]])

    order.length = 0
    const note = { people: ['sam'], note: '@sam please approve.' }
    await pullAction('t', 3, pr, 'ask-approval', note, { shellConfirm: askOwner })
    assert.deepEqual(order[0], ['shell', 'ask_approval', {}, { ...body, ...note }], 'the machine’s action id, and the body the platform will get')
    assert.deepEqual(order[1].slice(1), ['/api/github/contributions/3/pulls/ask-approval', { ...body, ...note }])

    order.length = 0
    sheet.next = false
    assert.deepEqual(await mergePull('t', 3, pr, { shellConfirm: askOwner, onConfirmed }), { cancelled: true })
    sheet.next = new Error('That pull request changed. Look at it again.')
    assert.deepEqual(await pullAction('t', 3, pr, 'close', {}, { shellConfirm: askOwner, onConfirmed }), { error: 'That pull request changed. Look at it again.' })
    assert.deepEqual(order.map(call => call[0]), ['shell', 'shell'], 'nothing was sent, and the app’s sheet never said it was at work')

    // Without the shell's sheet (a Möbius that does not offer it) nothing is asked and the request goes as before.
    order.length = 0
    await mergePull('t', 3, pr)
    await pullAction('t', 3, pr, 'close')
    assert.deepEqual(order.map(call => call[0]), ['fetch', 'fetch'])
  } finally { delete globalThis.window; globalThis.fetch = realFetch }
})

test('Request review is confirmed on the shell’s sheet too: one request, or one sheet for each PR of a batch', async () => {
  const order = []
  const realFetch = globalThis.fetch
  const sheet = { answers: [] } // one answer per sheet: true confirmed, false the owner closed it
  globalThis.window = { mobius: { ownerGrant: { request: async (action, extra, sent) => { order.push(['shell', action, sent.number, sent.reviewers]); return sheet.answers.shift() ?? true } } } }
  globalThis.fetch = async (url, options) => { const sent = JSON.parse(options.body); order.push(['fetch', sent.number, sent.reviewers]); return new Response(JSON.stringify({ state: 'requested', observed_head_sha: HEAD })) }
  const other = number => ({ ...pr, number, author: { login: 'owner-login' } })
  const shell = { shellConfirm: askOwner, onConfirmed: () => order.push(['confirmed']) }
  try {
    assert.deepEqual(await pullAction('t', 3, pr, 'request-review', { reviewers: ['sam'] }, shell), { ok: true, state: 'requested', observedHead: HEAD })
    assert.deepEqual(order, [['shell', 'request_review', 7, ['sam']], ['confirmed'], ['fetch', 7, ['sam']]], 'the machine’s action id, and exactly the body that is then sent')

    order.length = 0
    const batch = await requestReviewMany('t', 3, [other(1), other(2)], ['sam'], { shell })
    assert.deepEqual(batch, { ok: true, state: 'requested', asked: [1, 2], skipped: [] })
    assert.deepEqual(order.map(call => call.join(':')), ['shell:request_review:1:sam', 'confirmed', 'fetch:1:sam', 'shell:request_review:2:sam', 'confirmed', 'fetch:2:sam'], 'each PR is confirmed before it is sent')

    // Closing the first sheet sends nothing; closing a later one stops the rest and says what was and was not asked, and a retry asks only what is left.
    order.length = 0
    sheet.answers = [false]
    const done = new Set()
    assert.deepEqual(await requestReviewMany('t', 3, [other(1), other(2)], ['sam'], { shell, done }), { cancelled: true })
    assert.deepEqual(order.map(call => call[0]), ['shell'])
    order.length = 0
    sheet.answers = [true, false, true]
    const stopped = await requestReviewMany('t', 3, [other(1), other(2), other(3)], ['sam'], { shell, done })
    assert.deepEqual(stopped, { error: 'You closed Möbius’s sheet. Not asked: #2 · #3. Asked on #1.' })
    assert.deepEqual(order.filter(call => call[0] === 'fetch').map(call => call[1]), [1], 'nothing is sent after the sheet was closed')
    order.length = 0
    const retry = await requestReviewMany('t', 3, [other(1), other(2), other(3)], ['sam'], { shell, done })
    assert.deepEqual(retry, { ok: true, state: 'requested', asked: [2, 3], skipped: [] })
    assert.deepEqual(order.filter(call => call[0] === 'fetch').map(call => call[1]), [2, 3], 'the PR already asked is not asked again')
  } finally { delete globalThis.window; globalThis.fetch = realFetch }
})
