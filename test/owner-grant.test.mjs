import assert from 'node:assert/strict'
import test from 'node:test'
import { mergePull, pullAction, startReviewRun } from '../collaboration.js'
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
  try {
    const merged = await mergePull('t', 3, pr, { method: 'squash', shellConfirm: askOwner })
    assert.deepEqual(merged, { ok: true, state: 'merged', mergeSha: 'abc' })
    assert.deepEqual(order, [['shell', 'merge', {}, { ...body, method: 'squash' }], ['fetch', '/api/github/contributions/3/pulls/merge', { ...body, method: 'squash' }]])

    order.length = 0
    const note = { people: ['sam'], note: '@sam please approve.' }
    await pullAction('t', 3, pr, 'ask-approval', note, askOwner)
    assert.deepEqual(order[0], ['shell', 'ask_approval', {}, { ...body, ...note }], 'the machine’s action id, and the body the platform will get')
    assert.deepEqual(order[1].slice(1), ['/api/github/contributions/3/pulls/ask-approval', { ...body, ...note }])

    order.length = 0
    sheet.next = false
    assert.deepEqual(await mergePull('t', 3, pr, { shellConfirm: askOwner }), { cancelled: true })
    sheet.next = new Error('That pull request changed. Look at it again.')
    assert.deepEqual(await pullAction('t', 3, pr, 'close', {}, askOwner), { error: 'That pull request changed. Look at it again.' })
    assert.equal(order.filter(call => call[0] === 'fetch').length, 0, 'nothing was sent')

    // A review start is confirmed only when its agent may act in public.
    order.length = 0
    sheet.next = true
    const start = options => startReviewRun('t', 3, { request_id: 'r'.repeat(8), mode: 'review', options, items: [] }, askOwner)
    await start({ post_review: false })
    assert.deepEqual(order.map(call => call[0]), ['fetch'], 'a private review is one tap')
    order.length = 0
    await start({ post_review: true })
    assert.deepEqual(order.map(call => call[0]), ['shell', 'fetch'])
    assert.equal(order[0][1], 'review_start')
    sheet.next = false
    assert.equal(await start({ propose_verdict: true }), null)

    // Without the shell's sheet (a Möbius that does not offer it) nothing is asked and the request goes as before.
    order.length = 0
    await mergePull('t', 3, pr)
    await pullAction('t', 3, pr, 'close')
    assert.deepEqual(order.map(call => call[0]), ['fetch', 'fetch'])
  } finally { delete globalThis.window; globalThis.fetch = realFetch }
})
