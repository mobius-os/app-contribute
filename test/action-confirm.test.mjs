import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTION_COPY, APPROVAL_NOTE_LIMIT, allowedMergeMethods, approvalNote, askApprovalCopy, askRereviewCopy, mergeCopy, openForReviewCopy, methodToSend, postFindingsCopy, requestReviewCopy, reviewCandidates } from '../action-copy.js'
import { isPersonalDraft } from '../domain.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const rollup = (state, count) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: count, checkRunCountsByState: [{ state, count }], statusContextCountsByState: [] } } } }] } })
const pr = (extra = {}) => ({ number: 9, title: 'Fix the thing', baseRefName: 'main', headRefOid: 'abcdef0123456789', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'team/repo' }, ...rollup('SUCCESS', 21), ...extra })

test('opening for review says what happens, what GitHub shows now, and what it cannot undo', () => {
  const copy = openForReviewCopy(pr())
  assert.equal(copy.title, 'Open #9 for review?')
  assert.deepEqual(copy.facts.map(fact => `${fact.tone}:${fact.text}`), [
    'ok:Reviewers are asked to look at it',
    'ok:21 checks passed',
    'ok:No conflicts with main',
    'ok:You can turn it back into a draft later',
  ])
  assert.match(copy.footnote, /abcdef0/)
  assert.match(copy.footnote, /Nothing merges/)
  assert.equal(ACTION_COPY.open_for_review, openForReviewCopy)
})

test('failing, running or conflicting PRs warn but still may be opened for review', () => {
  const tones = extra => openForReviewCopy(pr(extra)).facts.filter(fact => fact.tone !== 'ok').map(fact => `${fact.tone}:${fact.text}`)
  assert.ok(tones({ ...rollup('FAILURE', 2) }).includes('warn:2 checks are failing'))
  assert.ok(tones({ ...rollup('PENDING', 3) }).includes('warn:Checks are still running'))
  assert.ok(tones({ mergeable: 'CONFLICTING' }).includes('bad:It conflicts with main'))
  assert.ok(!openForReviewCopy(pr({ commits: { nodes: [] } })).facts.some(fact => /check/i.test(fact.text)), 'no checks reported, no check line')
})

test('only a draft the owner opened with their own GitHub account can be opened for review', () => {
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'github' }), true)
  assert.equal(isPersonalDraft({ status: 'draft' }), true)
  assert.equal(isPersonalDraft({ status: 'draft', submission_mode: 'mobius-bot' }), false)
  assert.equal(isPersonalDraft({ status: 'open' }), false)
  assert.equal(isPersonalDraft(null), false)
})

test('the confirm sheet has one close affordance and one button that names the result', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render, icon } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    import { Icon } from './ui/Icons.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
    export const icon = name => renderToStaticMarkup(React.createElement(Icon, { name, size: 22 }))
  `)
  const html = render({ pr: pr(), copy: openForReviewCopy(pr()), onConfirm: () => {}, onClose: () => {} })
  assert.match(html, /<h3[^>]*>Open #9 for review\?<\/h3>/)
  assert.match(html, /#9 Fix the thing/)
  assert.match(html, />Open for review<\/button>/)
  assert.match(html, /aria-label="Close"/)
  assert.doesNotMatch(html, />Cancel</, 'the X is the only way out')
  assert.match(html, /You can turn it back into a draft later/)
  // Each action's words name their own icon, so no caller can show Merge with the arrow of Open for review.
  assert.ok(html.includes(icon('send')), 'open for review wears the send arrow')
  const merge = render({ pr: approved(), copy: mergeCopy(approved()), onConfirm: () => {}, onClose: () => {} })
  assert.ok(merge.includes(icon('merge')), 'merge wears the merge icon')
  assert.ok(!merge.includes(icon('send')), 'and not the arrow of another action')
})

import { mergePull, postFindings, previewPostedFindings, pullAction } from '../collaboration.js'
const markReadyPull = (token, appId, pr) => pullAction(token, appId, pr, 'ready')

const landable = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true }
const approved = (extra = {}) => pr({ reviewDecision: 'APPROVED', repository: { nameWithOwner: 'team/repo', ...landable }, ...extra })

const approvedBy = people => ({ standing: { approvedBy: people } })

test('Merge is never switched off for a change request that still stands, so its sheet says who holds one', () => {
  const unapproved = mergeCopy(approved(), { standing: { approvedBy: [], changesFrom: ['Sam'] } })
  assert.deepEqual(unapproved.facts.slice(0, 2).map(fact => `${fact.tone}:${fact.text}`),
    ['bad:Nobody but the author has approved this version', 'bad:Sam asked for changes and hasn’t approved since'])
  const approvedToo = mergeCopy(approved(), { standing: { approvedBy: ['sam'], changesFrom: ['Sam', 'Bob'] } })
  assert.deepEqual(approvedToo.facts.slice(0, 2).map(fact => `${fact.tone}:${fact.text}`),
    ['ok:Approved at this version by sam', 'bad:Sam, Bob asked for changes and hasn’t approved since'])
  assert.ok(!mergeCopy(approved(), approvedBy(['sam'])).facts.some(fact => /asked for changes/.test(fact.text)))
})

test('Merge names what it lands, who approved this version, and that Contribute cannot undo it', () => {
  const copy = mergeCopy(approved(), approvedBy(['sam']))
  assert.equal(copy.title, 'Merge #9 into main?')
  assert.equal(copy.confirm, 'Squash and merge', 'squash is the platform\'s first choice when the repository allows it')
  assert.deepEqual(copy.facts.map(fact => `${fact.tone}:${fact.text}`), ['ok:Approved at this version by sam', 'ok:21 checks passed', 'ok:No conflicts with main'])
  assert.match(copy.footnote, /abcdef0/)
  assert.match(copy.footnote, /nothing is merged and you are told/)
  assert.match(copy.footnote, /cannot undo a merge/)
  assert.equal(ACTION_COPY.merge, mergeCopy)
})

test('the ways to land are the ones the repository allows, in the platform\'s order, asked only when there is a choice', () => {
  assert.deepEqual(allowedMergeMethods(landable), ['squash', 'merge', 'rebase'])
  assert.deepEqual(allowedMergeMethods({ mergeCommitAllowed: true }), ['merge'])
  assert.deepEqual(allowedMergeMethods({}), [])
  const many = mergeCopy(approved())
  assert.deepEqual(many.choices.options.map(option => option.key), ['squash', 'merge', 'rebase'])
  assert.equal(many.choices.value, 'squash')
  assert.match(many.choices.options[0].detail, /one commit on main/)
  assert.equal(mergeCopy(approved(), { method: 'rebase' }).confirm, 'Rebase and merge')
  assert.equal(mergeCopy(approved(), { method: 'nonsense' }).choices.value, 'squash', 'a method the repository does not allow is not honored')
  const one = mergeCopy(approved({ repository: { nameWithOwner: 'team/repo', mergeCommitAllowed: true } }))
  assert.equal(one.choices, null)
  assert.equal(one.confirm, 'Merge')
  assert.equal(mergeCopy(pr()).choices, null, 'unknown settings ask nothing; the platform picks')
})

test('a missing approval, failing checks or a conflict show as blockers, and your own review is named for this version', () => {
  const tones = (extra, people = ['sam']) => mergeCopy(approved(extra), approvedBy(people)).facts.filter(fact => fact.tone !== 'ok').map(fact => `${fact.tone}:${fact.text}`)
  assert.deepEqual(tones({}, []), ['bad:Nobody but the author has approved this version'], 'an approval of an older version, or none, is not one')
  assert.deepEqual(tones({ reviewDecision: null }, []), ['bad:Nobody but the author has approved this version'], 'GitHub asking for no review is not an approval')
  assert.deepEqual(tones({ reviewDecision: 'REVIEW_REQUIRED' }), ['bad:GitHub still needs a review'], 'GitHub’s own gate is named even when someone approved this version')
  assert.deepEqual(tones({ reviewDecision: 'APPROVED' }), [], 'GitHub satisfied adds nothing')
  assert.deepEqual(tones({ ...rollup('FAILURE', 2) }), ['bad:2 checks are failing'])
  assert.deepEqual(tones({ mergeable: 'CONFLICTING' }), ['bad:It conflicts with main'])
  const status = (state, extra = {}) => ({ run: { state: 'complete', execution_state: 'completed' }, item: { state, ...extra } })
  const reviewLine = value => mergeCopy(approved(), { status: value }).facts.at(-1)
  assert.deepEqual(reviewLine(status('all_clear')), { tone: 'ok', text: 'Your agent’s review is clear for this version' })
  assert.deepEqual(reviewLine(status('needs_you', { summary: 'P1' })), { tone: 'warn', text: 'Your agent’s review found problems on this version' })
  const ignored = { 'o/r#1@x': { reason: 'Not a problem' } }
  const setAside = mergeCopy(approved(), { status: status('needs_you', { repo: 'o/r', number: 1, head_sha: 'x' }), ignored })
  assert.equal(setAside.facts.at(-1).text, 'No conflicts with main', 'a finding you set aside is not a warning')
})

test('the finished sheet says merged or queued, from what the platform answered', () => {
  const done = mergeCopy(approved()).done
  assert.deepEqual(done({ state: 'merged' }), { title: 'Merged', text: '#9 is now in main.' })
  assert.deepEqual(done({ state: 'queued' }), { title: 'Added to the merge queue', text: 'GitHub merges #9 into main when the queue reaches it.' })
})

test('Merge goes to the platform for this exact version and returns the outcome shapes the sheet reads', async () => {
  const sent = []
  const previous = globalThis.fetch
  const reply = (status, body) => async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: status < 400, status, json: async () => body } }
  try {
    globalThis.fetch = reply(200, { state: 'merged', merge_sha: 'c0ffee' })
    assert.deepEqual(await mergePull('t', 10, approved(), { method: 'squash' }), { ok: true, state: 'merged', mergeSha: 'c0ffee' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/merge')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', method: 'squash' })
    await mergePull('t', 10, approved())
    assert.equal('method' in sent[1].body, false, 'no choice, no method: the platform picks')
    globalThis.fetch = reply(409, { detail: 'GitHub still requires a review or has requested changes.' })
    assert.deepEqual(await mergePull('t', 10, approved()), { error: 'GitHub still requires a review or has requested changes.' })
    globalThis.fetch = reply(502, { detail: { code: 'merge_unconfirmed', message: 'GitHub may have merged it. Check the pull request before trying again.' } })
    assert.deepEqual(await mergePull('t', 10, approved()), { pending: true, error: 'GitHub may have merged it. Check the pull request before trying again.' })
    globalThis.fetch = reply(404, {})
    assert.match((await mergePull('t', 10, approved())).error, /companion Möbius update/)
    globalThis.fetch = reply(404, { detail: 'Not Found' })
    assert.match((await mergePull('t', 10, approved())).error, /companion Möbius update/, 'a missing route is still the update hint')
    globalThis.fetch = reply(404, { detail: 'This pull request could not be read from GitHub. Check that GitHub is connected and that the pull request still exists.' })
    assert.deepEqual(await mergePull('t', 10, approved()), { error: 'This pull request could not be read from GitHub. Check that GitHub is connected and that the pull request still exists.' }, 'the platform’s own 404 reason is shown as it is')
  } finally { globalThis.fetch = previous }
})

test('the open Actions menu names its two groups only when there is something of your own to do', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionsMenu } from './ui/ActionsMenu.jsx'
    import { standingFor } from './pr-standing.js'
    export const render = (props, login = 'me') => renderToStaticMarkup(React.createElement(ActionsMenu, { defaultOpen: true, onChoose() {}, decisions: props.pulls.map(pr => standingFor({ pr, login })), ...props }))
  `)
  const reviews = { latestOpinionatedReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] } }
  const draft = pr({ isDraft: true, number: 122, state: 'OPEN', author: { login: 'me' }, ...reviews })
  const withYou = render({ pulls: [draft], record: { status: 'draft', submission_mode: 'github' }, capabilities: { merge_now: true } })
  assert.match(withYou, /role="group" aria-label="You"/)
  assert.match(withYou, /co-agent-menu-scrim/, 'the phone sheet dims the page behind it')
  assert.match(withYou, /co-agent-menu-cancel[^>]*>Cancel<\/button>/, 'and has a Cancel of its own')
  assert.match(withYou, /M10\.5 8\.5 15\.5 12l-5 3\.5Z/, 'the button wears the play icon, not three dots')
  assert.match(withYou, /role="group" aria-label="Agent"/)
  assert.ok(withYou.indexOf('Open for review') < withYou.indexOf('aria-label="Agent"'), 'your own actions come first')
  assert.doesNotMatch(withYou, /Open it for review first\./, 'Merge on a draft is on offer: the platform refuses a draft in its own words')
  assert.match(withYou, /<strong>Merge<\/strong><small><\/small><\/span><\/button>/, 'and it carries no dimming or reason')
  // Close appears only where this Möbius can close for you; then it sits apart, red, after everything else of yours.
  const withClose = render({ pulls: [draft], record: { status: 'draft', submission_mode: 'github' }, capabilities: { merge_now: true, close_now: true } })
  assert.match(withClose, /co-agent-menu-apart"><button[^>]*data-danger="true"[^>]*class="[^"]*is-danger[^"]*"[^>]*><span class="co-agent-menu-tile">.*?Close pull request/, 'Close sits apart, marked destructive')
  assert.ok(withClose.indexOf('Close pull request') > withClose.indexOf('Merge'), 'and after every other choice of yours')
  assert.ok(withYou.indexOf('is-rec') > withYou.indexOf('aria-label="Agent"'), 'an unchecked draft of yours is checked first')
  const plain = render({ pulls: [pr({ state: 'OPEN', author: { login: 'sam' }, ...reviews })] })
  assert.doesNotMatch(plain, /aria-label="You"|co-agent-menu-group/, 'with nothing of your own the menu is the plain agent list')
  assert.match(plain, />Review</)
  assert.doesNotMatch(plain, /Respond to feedback|Address feedback/, 'their branch is not yours to fix')
})

test('Merge names a method only when the owner moved off the first allowed one', () => {
  const repo = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: false }
  assert.equal(methodToSend(repo, 'squash'), '', 'the default is left to the platform, so a merge queue is never given a method')
  assert.equal(methodToSend(repo, ''), '')
  assert.equal(methodToSend(repo, 'merge'), 'merge')
  assert.equal(methodToSend({ squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true }, 'merge'), '', 'the first allowed method is the default whichever it is')
})

// A fetch that records what was sent and answers with one status and body.
async function withFetch(reply, run) {
  const sent = []
  const previous = globalThis.fetch
  globalThis.fetch = async (url, options) => { sent.push({ url, body: options?.body ? JSON.parse(options.body) : null }); const [status, body] = reply(url); return { ok: status < 400, status, json: async () => body } }
  try { await run(sent) } finally { globalThis.fetch = previous }
}

test('Open for review of a draft you wrote goes to the platform for this exact version and says what happened', async () => {
  const draft = pr({ isDraft: true })
  await withFetch(() => [200, { state: 'ready', observed_head_sha: 'abcdef0123456789' }], async sent => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { ok: true, state: 'ready', observedHead: 'abcdef0123456789' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/ready')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' })
  })
  await withFetch(() => [409, { detail: 'This pull request is not a draft any more.' }], async () => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { error: 'This pull request is not a draft any more.' })
  })
  await withFetch(() => [502, { detail: { code: 'ready_unconfirmed', message: 'GitHub may have marked it ready. Check the pull request before trying again.' } }], async () => {
    assert.deepEqual(await markReadyPull('t', 10, draft), { pending: true, error: 'GitHub may have marked it ready. Check the pull request before trying again.' })
  })
})

test('the finished Open for review sheet warns when the PR moved while you looked', () => {
  const done = openForReviewCopy(pr()).done
  assert.deepEqual(done({ ok: true, observedHead: 'abcdef0123456789' }), { title: 'Open for review', text: 'Reviewers can see it now.' })
  assert.deepEqual(done({ ok: true }), { title: 'Open for review', text: 'Reviewers can see it now.' }, 'a platform that reports nothing is not read as a change')
  assert.match(done({ ok: true, observedHead: '1234567890abcdef' }).text, /It changed while you were looking: GitHub shows 1234567 now/)
})

const run = { id: 'run 1' }
const item = { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' }

test('Post to GitHub reads the exact words first and posts them once, with the outcome shapes the sheet reads', async () => {
  const preview = { event: 'COMMENT', body: 'Three problems.', preview_sha256: 'f'.repeat(64), head_sha: 'abcdef0123456789' }
  await withFetch(() => [200, preview], async sent => {
    assert.deepEqual(await previewPostedFindings('t', 10, run, item), preview)
    assert.equal(sent[0].url, '/api/github/contributions/10/review-runs/run%201/post-preview')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789' })
  })
  await withFetch(() => [200, { state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1', review_id: 1 }], async sent => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { ok: true, state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' })
    assert.equal(sent[0].url, '/api/github/contributions/10/review-runs/run%201/post')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', preview_sha256: 'f'.repeat(64) }, 'the post names the words it was shown')
  })
  await withFetch(() => [409, { detail: 'The pull request changed since you looked. Refresh and check it again.' }], async () => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { error: 'The pull request changed since you looked. Refresh and check it again.' })
  })
  await withFetch(() => [502, { detail: { code: 'post_unconfirmed', message: 'GitHub may have posted it. Check the pull request before trying again.' } }], async () => {
    assert.deepEqual(await postFindings('t', 10, run, item, preview), { pending: true, error: 'GitHub may have posted it. Check the pull request before trying again.' })
  })
  await withFetch(() => [409, { detail: 'There is nothing to post.' }], async () => {
    await assert.rejects(previewPostedFindings('t', 10, run, item), /There is nothing to post\./, 'a refused preview says why')
  })
})

// The three public writes (Merge, Open for review, Post to GitHub) share one rule: only a decoded
// receipt for the action is a success and only a decoded 4xx is a plain failure. A lost connection, a
// server or gateway error and a "success" nobody can read may have reached GitHub, so they are pending.
const writes = [
  { name: 'Merge', words: 'GitHub may have merged it. Check the pull request before trying again.', code: 'merge_unconfirmed', receipt: { state: 'merged', merge_sha: 'c0ffee' }, wrong: [{ state: 'ready' }, { state: 'failed' }],
    send: () => mergePull('t', 10, approved()), ok: { ok: true, state: 'merged', mergeSha: 'c0ffee' } },
  { name: 'Open for review', words: 'GitHub may have marked it ready. Check the pull request before trying again.', code: 'ready_unconfirmed', receipt: { state: 'ready', observed_head_sha: 'abcdef0123456789' }, wrong: [{ state: 'ready' }, { state: 'merged', observed_head_sha: 'abcdef0123456789' }],
    send: () => markReadyPull('t', 10, pr({ isDraft: true })), ok: { ok: true, state: 'ready', observedHead: 'abcdef0123456789' } },
  { name: 'Post to GitHub', words: 'GitHub may have posted it. Check the pull request before trying again.', code: 'post_unconfirmed', receipt: { state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' }, wrong: [{ url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' }, { state: 'pending' }],
    send: () => postFindings('t', 10, run, item, { preview_sha256: 'f'.repeat(64) }), ok: { ok: true, state: 'posted', url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' } },
]
for (const write of writes) {
  test(`${write.name}: a lost, unreadable or unrecognised answer is unresolved, never a retryable failure or a claimed success`, async () => {
    const previous = globalThis.fetch
    const answer = (status, json) => { globalThis.fetch = async () => ({ ok: status < 400, status, json }) }
    try {
      answer(200, async () => write.receipt)
      assert.deepEqual(await write.send(), write.ok, 'a decoded receipt for this action is the only success')
      globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
      assert.deepEqual(await write.send(), { pending: true, error: write.words }, 'a dropped connection may have reached GitHub')
      answer(200, async () => { throw new SyntaxError('Unexpected end of JSON input') })
      assert.deepEqual(await write.send(), { pending: true, error: write.words }, 'an unreadable success is not a receipt')
      for (const body of [{}, null, ...write.wrong]) {
        answer(200, async () => body)
        assert.deepEqual(await write.send(), { pending: true, error: write.words }, `${JSON.stringify(body)} is not this action's receipt`)
      }
      for (const status of [500, 502, 503, 504]) {
        answer(status, async () => ({ detail: 'Bad gateway' }))
        assert.deepEqual(await write.send(), { pending: true, error: write.words }, `a ${status} without the platform's own code says nothing about GitHub`)
      }
      answer(502, async () => ({ detail: { code: write.code, message: 'The platform’s own words.' } }))
      assert.deepEqual(await write.send(), { pending: true, error: 'The platform’s own words.' }, 'the platform’s coded unconfirmed answer keeps its words')
      answer(502, async () => { throw new SyntaxError('<html>') })
      assert.deepEqual(await write.send(), { pending: true, error: write.words }, 'an unreadable error body is as unresolved as an unreadable success')
      for (const status of [400, 403, 404, 409, 422]) {
        answer(status, async () => ({ detail: 'Refused for a reason.' }))
        assert.deepEqual(await write.send(), { error: 'Refused for a reason.' }, `a decoded ${status} proves nothing was written`)
        answer(status, async () => { throw new SyntaxError('Unexpected end of JSON input') })
        assert.deepEqual(await write.send(), { pending: true, error: write.words }, `an unreadable ${status} is no platform refusal: the write may still have happened`)
      }
    } finally { globalThis.fetch = previous }
  })
}

test('the post sheet names what it posts, keeps its button off until the words arrive, and says why when refused', async t => {
  const target = pr({ number: 9 })
  const preview = { body: 'Three problems in the lost-reply path.', head_sha: 'abcdef0123456789', preview_sha256: 'f'.repeat(64) }
  const ready = postFindingsCopy(target, { preview, own: false })
  assert.equal(ready.title, 'Post this review on #9?')
  assert.deepEqual(ready.facts.map(fact => `${fact.tone}:${fact.text}`), ['ok:A comment on this PR, from your GitHub account', 'ok:Not an approval and not a request for changes', 'warn:Anyone who can see this PR can read it'])
  assert.deepEqual(ready.says, { label: 'What it would post', markdown: 'Three problems in the lost-reply path.' })
  assert.match(ready.footnote, /Posts exactly this text, once, at the version you reviewed \(abcdef0\)/)
  assert.match(ready.footnote, /Contribute cannot take it back/)
  assert.equal(ready.disabled, undefined)
  assert.match(postFindingsCopy(target, { preview, own: true }).facts[0].text, /your own PR/)
  assert.deepEqual(ready.done({ ok: true, url: 'https://github.com/team/repo/pull/9#pullrequestreview-1' }), { title: 'Posted on GitHub', text: 'Your review is on #9 now.', link: { href: 'https://github.com/team/repo/pull/9#pullrequestreview-1', label: 'View the review on GitHub' } })
  assert.equal(ready.done({ ok: true }).link, undefined, 'no address, no link')
  const loading = postFindingsCopy(target)
  const refused = postFindingsCopy(target, { error: 'The pull request changed since you looked. Refresh and check it again.' })
  assert.equal(loading.disabled, true)
  assert.equal(refused.disabled, true)
  assert.deepEqual(refused.facts, [{ tone: 'bad', text: 'The pull request changed since you looked. Refresh and check it again.' }])
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
  `)
  const html = render({ pr: target, copy: ready, onConfirm() {}, onClose() {} })
  assert.match(html, /What it would post/)
  assert.match(html, /Three problems in the lost-reply path\./)
  assert.match(html, /<button[^>]*class="co-btn co-btn-primary"[^>]*>Post to GitHub<\/button>/)
  assert.doesNotMatch(html, /<button[^>]*co-btn-primary[^>]*disabled/, 'ready to post')
  assert.doesNotMatch(html, />Cancel</)
  assert.match(render({ pr: target, copy: loading, onConfirm() {}, onClose() {} }), /<button[^>]*co-btn-primary[^>]*disabled[^>]*>Post to GitHub/, 'the button waits for the words')
  assert.match(render({ pr: target, copy: refused, onConfirm() {}, onClose() {} }), /The pull request changed since you looked/)
})

test('a row that cannot run dims its title, never its reason, and the menu never starts its focus on a destructive row', () => {
  const css = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
  assert.match(css, /\.co-agent-menu-list button\.is-off \{ cursor:default; \}/)
  assert.doesNotMatch(css, /button\.is-off \{[^}]*opacity/)
  assert.match(css, /button\.is-off strong,\.co-agent-menu-list button\.is-off \.co-agent-menu-tile \{ opacity:\.6; \}/)
  const menu = readFileSync(new URL('../ui/useDismissableMenu.js', import.meta.url), 'utf8')
  assert.match(menu, /:not\(\[aria-disabled=true\]\):not\(\[data-danger\]\)/)
  assert.match(menu, /querySelector\('\[role=menu\]'\)/, 'a menu with only a destructive choice focuses the menu, not the choice')
})

test('the lock and globe in a window head, and the files toggle, keep their own colour over the quiet button\'s', () => {
  const css = ['workspace-theme.js', 'theme.js', 'button-theme.js'].map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n')
  // Same specificity as `.co-btn-quiet` loses to the later sheet, so these name `.co-btn` as well.
  // The quiet button reads its tone from a hook, so no rule overrides its colour or fill.
  assert.match(css, /\.co-rw-seen \{ --co-btn-tone:var\(--seen\); --co-btn-tone-fill:/)
  assert.match(css, /\.co-btn-quiet \{[^}]*color: var\(--co-btn-tone, var\(--muted\)\)/)
  assert.doesNotMatch(css, /\.co-rw-seen-btn[^{]*\{[^}]*(?:color|background):/)
  assert.match(css, /\.co-btn\.co-project-files-toggle \{ color: var\(--accent\); \}/)
})

test('Merge says plainly when an approval is of an older commit whose work is the same', () => {
  const carried = [{ by: 'sam', commit: 'a1b2c3d4e5f6' }]
  assert.deepEqual(mergeCopy(approved(), { standing: { approvedBy: ['sam'], carriedFrom: carried } }).facts.slice(0, 1).map(fact => `${fact.tone}:${fact.text}`),
    ['ok:Approved by sam on a1b2c3d. The lines you added and removed have not changed since'])
  const mixed = mergeCopy(approved(), { standing: { approvedBy: ['kim', 'sam'], carriedFrom: carried } }).facts.slice(0, 2).map(fact => fact.text)
  assert.deepEqual(mixed, ['Approved at this version by kim', 'Approved by sam on a1b2c3d. The lines you added and removed have not changed since'])
})

const askable = [
  { by: 'ReviewerOne', reason: 'commented_here', commit: 'abcdef0123456789' },
  { by: 'Kim', reason: 'looked_again', commit: 'a1b2c3d4e5f6a7b8' },
  { by: 'Bob', reason: 'approved_older', commit: 'a1b2c3d4e5f6a7b8' },
]
const standing = { askable, approvalFrom: ['ReviewerOne', 'Kim'], rereviewFrom: ['Bob'] }

test('Ask for approval lists everyone who can be asked, ticks the people it is meant for, and shows the exact note for whoever is ticked', () => {
  const copy = askApprovalCopy(pr(), { standing })
  assert.deepEqual(copy.people.options.map(option => [option.key, option.ticked]), [['ReviewerOne', true], ['Kim', true], ['Bob', false]])
  assert.equal(copy.people.options[2].detail, 'Approved a1b2c3d; this version has new commits')
  assert.equal(copy.title, 'Ask ReviewerOne, Kim to approve #9?')
  assert.equal(copy.says.markdown, approvalNote(pr(), [askable[0], askable[1]]))
  assert.match(copy.says.markdown, /\(`abcdef0`\)/)
  assert.match(copy.says.markdown, /- @ReviewerOne you left a comment on this version but have not approved it\./)
  assert.match(copy.says.markdown, /- @Kim you left a comment on this version, but GitHub still holds your earlier change request until you approve or dismiss it\./, 'only a standing change request is explained')
  assert.deepEqual(copy.says.markdown.match(/@[A-Za-z0-9-]+/g), ['@ReviewerOne', '@Kim', '@ReviewerOne', '@Kim'], 'it names only the people asked')
  assert.doesNotMatch(approvalNote(pr(), [askable[0]]), /change request/, 'a plain comment holds nothing, so the note does not say it does')
  assert.equal(copy.disabled, false)
  assert.equal(ACTION_COPY.ask_approval, askApprovalCopy)
})

test('the Ask sheets follow the ticks: a person ticked later is worded for what is true of them, and nobody ticked turns the button off', () => {
  const copy = askApprovalCopy(pr(), { standing })
  const bobOnly = copy.forPicked(['Bob'])
  assert.equal(bobOnly.title, 'Ask Bob to approve #9?')
  assert.match(bobOnly.says.markdown, /- @Bob you approved an earlier version \(`a1b2c3d`\); this one has new commits\./)
  assert.deepEqual(bobOnly.says.markdown.match(/@[A-Za-z0-9-]+/g), ['@Bob', '@Bob'])
  assert.doesNotMatch(bobOnly.footnote, /dismissing their request/, 'no change request here, so the footnote does not talk about one')
  assert.match(copy.forPicked(['Kim']).footnote, /dismissing their request/)
  const nobody = copy.forPicked([])
  assert.equal(nobody.disabled, true)
  assert.equal(nobody.says, null)
  assert.deepEqual(nobody.facts.map(fact => fact.text), ['Pick at least one person', 'The note is public on the PR, from your GitHub account'])
  assert.equal(askApprovalCopy(pr(), { standing: { approvalFrom: [], lookedAgain: [] } }).disabled, true, 'with nobody to name it cannot be sent')
})

test('Ask for approval turns itself off before the tap when the note would be longer than the platform accepts', () => {
  const crowd = Array.from({ length: 12 }, (_, index) => ({ by: `a-reviewer-with-a-long-login-name-${String(index).padStart(2, '0')}`, reason: 'changes_older', commit: 'a1b2c3d4e5f6a7b8' }))
  const copy = askApprovalCopy(pr(), { standing: { askable: crowd, approvalFrom: crowd.map(item => item.by), rereviewFrom: [] } })
  assert.ok(approvalNote(pr(), crowd).length > APPROVAL_NOTE_LIMIT)
  assert.equal(copy.disabled, true)
  assert.ok(copy.facts.some(fact => fact.tone === 'bad' && /too long/.test(fact.text)))
  assert.equal(copy.forPicked([crowd[0].by]).disabled, false, 'fewer people fit')
})

test('Ask for re-review lists the same people, ticks those whose review is of an older version, and sends GitHub’s usual request', () => {
  const copy = askRereviewCopy(pr(), { standing })
  assert.deepEqual(copy.people.options.map(option => [option.key, option.ticked]), [['ReviewerOne', false], ['Kim', false], ['Bob', true]])
  assert.equal(copy.title, 'Ask Bob to review #9 again?')
  assert.equal(copy.disabled, false)
  assert.equal(copy.forPicked(['Kim', 'Bob']).title, 'Ask Kim, Bob to review #9 again?')
  assert.equal(copy.forPicked([]).disabled, true)
  assert.match(copy.footnote, /Nothing is posted in the conversation/)
  assert.equal(ACTION_COPY.ask_rereview, askRereviewCopy)
})

test('the Ask sheet renders its people as real checkboxes, the ticked ones checked, with the note for them below', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
  `)
  const html = render({ pr: pr(), copy: askApprovalCopy(pr(), { standing }), onConfirm: () => {}, onClose: () => {} })
  assert.match(html, /<h4 class="co-rw-label">Who should I ask\?<\/h4>/)
  assert.match(html, /aria-label="Who should I ask\?"/)
  const boxes = html.match(/<input type="checkbox"[^>]*>/g)
  assert.equal(boxes.length, 3)
  assert.deepEqual(boxes.map(box => /checked=""/.test(box)), [true, true, false], 'the people this ask is meant for start ticked')
  assert.match(html, /<strong>Bob<\/strong><small>Approved a1b2c3d; this version has new commits<\/small>/)
  assert.match(html, /The note that will be posted/)
  assert.match(html, /there is a new version of this PR/)
  assert.match(html, />Ask for approval<\/button>/)
  const rereview = render({ pr: pr(), copy: askRereviewCopy(pr(), { standing }), onConfirm: () => {}, onClose: () => {} })
  assert.doesNotMatch(rereview, /The note that will be posted/, 'a re-review request posts no note')
  assert.match(rereview, />Ask for re-review<\/button>/)
})

test('Ask for approval goes to the platform with who and the exact note, and reads an unconfirmed post back', async () => {
  const sent = []
  const previous = globalThis.fetch
  const reply = (status, body) => async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: status < 400, status, json: async () => body } }
  const note = approvalNote(pr(), [{ by: 'sam', reason: 'commented_here', commit: 'abcdef0123456789' }])
  try {
    globalThis.fetch = reply(200, { state: 'asked', observed_head_sha: 'abcdef0123456789' })
    assert.deepEqual(await pullAction('t', 10, pr(), 'ask-approval', { people: ['sam'], note }), { ok: true, state: 'asked', observedHead: 'abcdef0123456789' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/ask-approval')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', people: ['sam'], note })
    globalThis.fetch = reply(502, { detail: { code: 'approval_unconfirmed', message: 'GitHub may have posted the note. Check the pull request before trying again.' } })
    assert.deepEqual(await pullAction('t', 10, pr(), 'ask-approval', { people: ['sam'], note }), { pending: true, error: 'GitHub may have posted the note. Check the pull request before trying again.' })
    globalThis.fetch = reply(409, { detail: 'Ask only people who looked again without approving: nobody.' })
    assert.deepEqual(await pullAction('t', 10, pr(), 'ask-approval', { people: ['sam'], note }), { error: 'Ask only people who looked again without approving: nobody.' })
  } finally { globalThis.fetch = previous }
})

// Request review: anyone the repository lets be asked, whether or not they reviewed before.
const people = ['alex', 'Bob', 'Kim', 'sam', 'new-person', 'dependabot[bot]', 'ReviewerOne']
const readSheet = (extra = {}, from = { people, pending: ['sam'] }) => requestReviewCopy(pr({ author: { login: 'alex' }, ...extra }), { standing: { ...standing, approvedBy: ['Kim'] }, candidates: from })

test('Request review offers everyone but the author, a bot, who approved this version and who is already asked', () => {
  const copy = readSheet()
  assert.deepEqual(copy.people.options.map(option => option.key), ['Bob', 'new-person', 'ReviewerOne'])
  assert.deepEqual(reviewCandidates(pr({ author: { login: 'ALEX' } }), { approvedBy: ['kim'] }, { people, pending: ['SAM'] }), ['Bob', 'new-person', 'ReviewerOne'], 'whatever the case of a login')
  assert.ok(copy.facts.some(fact => fact.text === 'Already asked: sam'), 'a pending request is named, not offered again')
  assert.ok(copy.people.options.every(option => option.ticked === false), 'nobody is ticked for you')
})

test('Request review says what is true of someone who reviewed before, and nothing of a new person', () => {
  const copy = readSheet()
  const detail = key => copy.people.options.find(option => option.key === key).detail
  assert.equal(detail('Bob'), 'Approved a1b2c3d; this version has new commits')
  assert.equal(detail('ReviewerOne'), 'Commented on this version, has not approved')
  assert.equal(detail('new-person'), '')
})

test('Request review words the sheet for whoever is ticked and refuses an empty pick', () => {
  const copy = readSheet()
  assert.equal(copy.title, 'Ask people to review #9?')
  assert.equal(copy.disabled, true)
  assert.deepEqual(copy.facts.map(fact => fact.text), ['Pick at least one person', 'Already asked: sam'])
  const picked = copy.forPicked(['new-person', 'Bob'])
  assert.equal(picked.title, 'Ask Bob, new-person to review #9?')
  assert.equal(picked.disabled, false)
  assert.equal(picked.facts[0].text, 'GitHub asks Bob, new-person to review')
  assert.deepEqual(picked.done(), { title: 'Review requested', text: 'Bob, new-person are asked to review it.' })
  assert.match(copy.footnote, /does not assign the PR to them/)
  assert.equal(copy.confirm, 'Request review')
  assert.equal(ACTION_COPY.request_review, requestReviewCopy)
})

test('Request review waits for the people list, shows why it failed, and says when nobody else can be asked', () => {
  const loading = requestReviewCopy(pr(), { standing, candidates: { loading: true } })
  assert.deepEqual([loading.disabled, loading.facts.map(fact => fact.text)], [true, ['Loading people…']])
  assert.equal(requestReviewCopy(pr(), { standing, candidates: null }).disabled, true)
  const failed = requestReviewCopy(pr(), { standing, candidates: { error: 'Could not load the people. Try again.' } })
  assert.deepEqual([failed.disabled, failed.facts.map(fact => `${fact.tone}:${fact.text}`)], [true, ['bad:Could not load the people. Try again.']])
  const alone = readSheet({}, { people: ['alex'], pending: [] })
  assert.deepEqual([alone.people.options, alone.facts.map(fact => fact.text)], [[], ['Nobody else can be asked']])
})

test('the Request review sheet renders its people as unticked checkboxes with Request review as the button', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ActionConfirm } from './ui/ActionConfirm.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(ActionConfirm, props))
  `)
  const html = render({ pr: pr(), copy: readSheet(), onConfirm: () => {}, onClose: () => {} })
  assert.match(html, /<h4 class="co-rw-label">Who should review it\?<\/h4>/)
  const boxes = html.match(/<input type="checkbox"[^>]*>/g)
  assert.equal(boxes.length, 3)
  assert.ok(boxes.every(box => !/checked=""/.test(box)))
  assert.match(html, /<strong>new-person<\/strong>/)
  assert.match(html, />Request review<\/button>/)
})

test('Request review goes to its own platform route with who is asked, and reads an unconfirmed write back', async () => {
  const sent = []
  const previous = globalThis.fetch
  const reply = (status, body) => async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: status < 400, status, json: async () => body } }
  try {
    globalThis.fetch = reply(200, { state: 'requested', observed_head_sha: 'abcdef0123456789' })
    assert.deepEqual(await pullAction('t', 10, pr(), 'request-review', { reviewers: ['new-person'] }), { ok: true, state: 'requested', observedHead: 'abcdef0123456789' })
    assert.equal(sent[0].url, '/api/github/contributions/10/pulls/request-review')
    assert.deepEqual(sent[0].body, { repo: 'team/repo', number: 9, head_sha: 'abcdef0123456789', reviewers: ['new-person'] })
    globalThis.fetch = reply(502, { detail: { code: 'reviewers_unconfirmed', message: 'GitHub may have asked for another review. Check the pull request before trying again.' } })
    assert.deepEqual(await pullAction('t', 10, pr(), 'request-review', { reviewers: ['new-person'] }), { pending: true, error: 'GitHub may have asked for another review. Check the pull request before trying again.' })
    globalThis.fetch = reply(409, { detail: 'The author of a pull request cannot be asked to review it.' })
    assert.deepEqual(await pullAction('t', 10, pr(), 'request-review', { reviewers: ['alex'] }), { error: 'The author of a pull request cannot be asked to review it.' })
  } finally { globalThis.fetch = previous }
})
