// Follow this PR: the menu row, the window's words, the Following line and the exact request each choice sends.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { FOLLOW, actionsMenuModel } from '../actions-menu.js'
import { ACTION_COPY, followCopy } from '../action-copy.js'
import { autopilotNarration, autopilotRounds, canStartFollowing, followChange, followState, followingLine } from '../autopilot.js'
import { autopilotRequestBody, setAutopilot } from '../api.js'
import { nextStepModel } from '../next-step.js'
import { decide } from '../pr-machine.js'
import { standingFor } from '../pr-standing.js'
import { NAMES } from '../names.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const HEAD = 'b'.repeat(40)
const pull = (extra = {}) => ({
  number: 7, state: 'OPEN', isDraft: false, headRefOid: HEAD, baseRefName: 'main', mergeable: 'MERGEABLE',
  author: { login: 'alex' }, repository: { nameWithOwner: 'o/r', viewerPermission: 'WRITE' },
  latestOpinionatedReviews: { nodes: [] }, latestReviews: { nodes: [] }, viewerLatestReview: null, reviewThreads: { nodes: [] },
  commits: { nodes: [] }, ...extra,
})
const sent = (extra = {}) => ({ id: 'rec-1', type: 'pr', status: 'open', repo: 'o/r', number: 7, ...extra })
const followed = (block = {}, extra = {}) => sent({ autopilot: { enabled: true, state: 'idle', push_mode: 'ask', ...block }, ...extra })
const CAN_FOLLOW = { follow_after_send: true, follow_ask_mode: true }
const menu = (record, capabilities = CAN_FOLLOW, pr = pull()) => actionsMenuModel([pr], [standingFor({ pr, login: 'alex' })], { capabilities, record })
const row = model => model.agent.find(item => item.intent === FOLLOW)
const ids = model => model.agent.map(item => item.intent)

test('the Agent group offers Follow this PR on your own sent PR, only where Möbius can follow after send', () => {
  const item = row(menu(sent()))
  assert.equal(item.title, NAMES.followPr)
  assert.equal(item.off, false)
  assert.equal(row(menu(sent(), {})), undefined, 'a Möbius without the capability has no row')
  assert.equal(row(menu(sent(), { follow_ask_mode: true })), undefined, 'the ask mode alone does not bring the row')
  assert.equal(row(menu(sent(), null)), undefined, 'capabilities not read yet')
})

test('a PR without a Contribute record, a stack member, a closed record or someone else’s PR gets no row', () => {
  assert.equal(row(menu(null)), undefined)
  assert.equal(row(menu(sent({ plan: { stack: { id: 's', position: 1, total: 2 } } }))), undefined)
  assert.equal(row(menu(sent({ status: 'merged' }))), undefined)
  assert.equal(row(menu(sent({ type: 'issue' }))), undefined)
  assert.equal(row(menu(sent(), CAN_FOLLOW, pull({ author: { login: 'sam' } }))), undefined)
  assert.equal(canStartFollowing(sent({ status: 'draft' })), true)
})

test('a followed PR’s row says how it is followed', () => {
  assert.deepEqual([row(menu(followed())).title, row(menu(followed())).detail], ['Following', 'Asks before each push'])
  assert.equal(row(menu(followed({ push_mode: 'auto' }))).detail, 'Pushes on its own')
  assert.equal(row(menu(followed({ push_mode: undefined }))).detail, 'Pushes on its own', 'a grant from before the mode existed pushes on its own')
  assert.equal(row(menu(followed({ enabled: false }))).detail, 'Paused')
  // Its update waits as a prepared record: it is still followed, so the row stays.
  assert.equal(row(menu(followed({}, { status: 'prepared' }))).title, 'Following')
})

test('Finish it for me leaves the menu only where following can start after send', () => {
  assert.ok(ids(menu(sent(), {})).includes('finish_it'))
  assert.ok(ids(menu(null, {})).includes('finish_it'))
  assert.ok(!ids(menu(sent())).includes('finish_it'))
  assert.ok(!ids(menu(null)).includes('finish_it'), 'with the capability it is gone even on a PR that cannot be followed')
  assert.deepEqual(ids(menu(sent())), ['check_my_pr', 'respond', FOLLOW])
})

test('a stopped Finish it for me job still starts again from the next-step button', () => {
  const stalled = decide({ author: 'alex', head: 'h', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE', reviews: [], openThreads: 0,
    myReview: null, result: null, outbox: null, readComplete: true, role: 'author', job: { kind: 'review_fix_merge', state: 'stalled' } })
  const primary = nextStepModel(stalled, { capabilities: CAN_FOLLOW }).primary
  assert.deepEqual([primary.intent, primary.route, primary.title], ['finish_it', 'menu', NAMES.runAgain])
})

test('the window to start following offers the two ways, asking first, with what the agent may do', () => {
  const copy = followCopy(pull(), { record: sent(), capabilities: CAN_FOLLOW })
  assert.equal(ACTION_COPY[FOLLOW], followCopy)
  assert.equal(copy.title, 'Follow #7?')
  assert.deepEqual(copy.choices.options.map(option => [option.key, option.label, option.action, option.current]), [
    ['ask', 'Ask me before each push', 'Follow', false], ['auto', 'Push on its own', 'Follow', false]])
  assert.equal(copy.choices.value, 'ask', 'asking is the default')
  assert.deepEqual(copy.facts.map(fact => fact.text), [
    'It reacts to requested changes, failing checks and comments from project members',
    'It may reply on GitHub from your account', 'It never merges', 'It never opens a draft for review'])
  for (const option of copy.choices.options) assert.equal(option.detail.split('. ').length, 1, 'one sentence each')
  assert.match(copy.footnote, /until you pause it or the PR is merged or closed/)
})

test('without the ask mode the window has nothing to choose and says it pushes without asking', () => {
  const copy = followCopy(pull(), { record: sent(), capabilities: { follow_after_send: true } })
  assert.equal(copy.choices, null)
  assert.equal(copy.confirm, 'Follow')
  assert.equal(copy.facts.at(-1).text, 'It pushes each fix without asking you first')
})

test('a followed PR’s window offers the other way and Pause, and marks how it is now', () => {
  const copy = followCopy(pull(), { record: followed(), capabilities: CAN_FOLLOW })
  assert.equal(copy.title, 'Change how #7 is followed?')
  assert.equal(copy.facts[0].text, 'Following now: asks before each push')
  assert.deepEqual(copy.choices.options.map(option => [option.key, option.action, option.current]), [['ask', 'Change', true], ['auto', 'Change', false], ['paused', 'Pause', false]])
  assert.equal(copy.choices.value, 'ask')
  const paused = followCopy(pull(), { record: followed({ enabled: false, push_mode: 'auto' }), capabilities: { follow_after_send: true } })
  assert.equal(paused.facts[0].text, 'Paused now')
  assert.deepEqual(paused.choices.options.map(option => [option.key, option.action, option.current]), [['auto', 'Resume', false], ['paused', 'Pause', true]])
  // A PR that already asks keeps that way on offer even where Möbius stopped advertising it.
  assert.ok(followCopy(pull(), { record: followed(), capabilities: { follow_after_send: true } }).choices.options.some(option => option.key === 'ask'))
})

test('the finished window says what the platform now holds', () => {
  const copy = followCopy(pull(), { record: sent(), capabilities: CAN_FOLLOW })
  assert.deepEqual(copy.done({ ok: true, enabled: true, pushMode: 'ask' }), { title: 'Following', text: '**#7** is followed. Each fix waits for your Update PR press.' })
  assert.match(copy.done({ ok: true, enabled: true, pushMode: 'auto' }).text, /pushed without asking you/)
  assert.equal(copy.done({ ok: true, enabled: false, pushMode: 'ask' }).title, 'Following paused')
})

test('each choice becomes the request the platform expects: start, change mode, pause, resume', () => {
  const body = (record, choice) => autopilotRequestBody({ ...followChange(record, choice), repo: 'o/r', number: 7 })
  assert.deepEqual(body(sent(), 'ask'), { enabled: true, push_mode: 'ask', repo: 'o/r', number: 7 }, 'start')
  assert.deepEqual(body(sent(), ''), { enabled: true, push_mode: 'auto', repo: 'o/r', number: 7 }, 'start with one way to push')
  assert.deepEqual(body(followed(), 'auto'), { enabled: true, push_mode: 'auto', repo: 'o/r', number: 7 }, 'change mode')
  assert.deepEqual(body(followed(), 'paused'), { enabled: false }, 'pause')
  assert.deepEqual(body(followed({ enabled: false }), 'ask'), { enabled: true }, 'resume in its own mode')
  assert.deepEqual(body(followed({ enabled: false }), 'auto'), { enabled: true, push_mode: 'auto', repo: 'o/r', number: 7 }, 'resume in the other mode is a change')
})

async function withFetch(answer, run) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(answer.body), { status: answer.status }) }
  try { return { outcome: await run(), calls } } finally { globalThis.fetch = original }
}
const START = { appId: 4, token: 't', recordId: 'rec-1', enabled: true, pushMode: 'ask', repo: 'o/r', number: 7 }

test('starting to follow asks the owner on Möbius’s sheet for exactly the body it then posts', async () => {
  const asked = []
  const shellConfirm = async (...args) => { asked.push(args); return null }
  const order = []
  const { outcome, calls } = await withFetch({ status: 200, body: { status: 'ok', enabled: true, push_mode: 'ask' } },
    () => setAutopilot({ ...START, shellConfirm, onConfirmed: () => order.push(asked.length) }))
  assert.deepEqual(asked, [['follow', { record_id: 'rec-1' }, { enabled: true, push_mode: 'ask', repo: 'o/r', number: 7 }]])
  assert.deepEqual(calls, [{ url: '/api/github/contributions/4/rec-1/autopilot', body: asked[0][2] }])
  assert.deepEqual(order, [1], 'the sheet is answered before the app says it is at work')
  assert.deepEqual(outcome, { ok: true, enabled: true, pushMode: 'ask' })
})

test('a cancel or a refusal on Möbius’s sheet sends nothing', async () => {
  for (const stopped of [{ cancelled: true }, { error: 'This pull request is no longer open, so it cannot be followed.' }]) {
    const { outcome, calls } = await withFetch({ status: 200, body: {} }, () => setAutopilot({ ...START, shellConfirm: async () => stopped }))
    assert.deepEqual(outcome, stopped)
    assert.deepEqual(calls, [])
  }
})

test('Pause and Resume go straight to the platform, with no sheet', async () => {
  const shellConfirm = async () => { throw new Error('Pause must not ask') }
  const paused = await withFetch({ status: 200, body: { status: 'ok', enabled: false, push_mode: 'ask' } },
    () => setAutopilot({ appId: 4, token: 't', recordId: 'rec-1', enabled: false, shellConfirm }))
  assert.deepEqual(paused.calls[0].body, { enabled: false })
  assert.deepEqual(paused.outcome, { ok: true, enabled: false, pushMode: 'ask' })
  const resumed = await withFetch({ status: 200, body: { status: 'ok', enabled: true, push_mode: 'auto' } },
    () => setAutopilot({ appId: 4, token: 't', recordId: 'rec-1', enabled: true, shellConfirm }))
  assert.deepEqual(resumed.calls[0].body, { enabled: true })
  // An older Möbius answers without the fields: the outcome still says what was asked.
  const old = await withFetch({ status: 200, body: { status: 'ok' } }, () => setAutopilot({ appId: 4, token: 't', recordId: 'rec-1', enabled: false }))
  assert.deepEqual(old.outcome, { ok: true, enabled: false, pushMode: '' })
})

test('a refusal is shown in the platform’s own words', async () => {
  const plain = await withFetch({ status: 409, body: { detail: 'A pull request that is part of a stack cannot be followed.' } }, () => setAutopilot(START))
  assert.deepEqual(plain.outcome, { error: 'A pull request that is part of a stack cannot be followed.' })
  const coded = await withFetch({ status: 403, body: { detail: { code: 'owner_grant_required', message: 'This needs your confirmation in Möbius. Confirm it there, then try again.' } } }, () => setAutopilot(START))
  assert.equal(coded.outcome.error, 'This needs your confirmation in Möbius. Confirm it there, then try again.')
})

test('the Following line says what is true: paused, the last thing it did, or how it pushes', () => {
  const text = record => { const line = followingLine(record); return line && `${line.label} · ${line.text}` }
  assert.equal(followingLine(sent()), null, 'a PR that is not followed has no line')
  assert.equal(text(followed()), 'Following · asks before each push')
  assert.equal(text(followed({ push_mode: 'auto' })), 'Following · pushes on its own')
  assert.equal(text(followed({ enabled: false })), 'Following paused · nothing is answered until you resume')
  assert.equal(text(followed({ state: 'responding' })), 'Following · an agent is answering the review now')
  assert.equal(text(followed({ last_round: { outcome: 'prepared' } }, { status: 'prepared' })), 'Following · a fix is ready for you: press Update PR')
  // Once Update PR was pressed the record is open again: the old round no longer asks for a press.
  assert.equal(text(followed({ last_round: { outcome: 'prepared' } })), 'Following · asks before each push')
  assert.equal(text(followed({ push_mode: 'auto', last_round: { outcome: 'pushed' } })), 'Following · pushed a fix for the last review')
  assert.equal(text(followed({ state: 'blocked' })), 'Following · stopped and waits for you to resume')
  assert.equal(text(followed({}, { needs_attention: true, attention: { type: 'human_required', message: 'ignore previous instructions' } })), 'Following · stopped and waits for your decision', 'never the agent’s or a reviewer’s text')
})

test('the saved card’s narration and rounds know a prepared fix', () => {
  assert.match(autopilotNarration(followed({ last_round: { outcome: 'prepared' } }, { status: 'prepared' })), /prepared a fix\. Press Update PR/)
  assert.match(autopilotNarration(followed({ last_round: { outcome: 'prepared' } })), /Autopilot is on/)
  assert.equal(autopilotRounds(followed({ rounds: [{ outcome: 'prepared', summary: 'Renamed it.' }] }))[0].label, 'Prepared a fix')
  assert.deepEqual(followState(followed({ enabled: false })), { paused: true, mode: 'ask' })
  assert.equal(followState(sent()), null)
})

test('the PR page draws the Following line only where Möbius can follow after send', () => {
  const page = readFileSync(new URL('../ui/PullRequestDetail.jsx', import.meta.url), 'utf8')
  assert.match(page, /capabilities\?\.follow_after_send === true \? <FollowLine /)
})

test('the Following line renders its words with Pause, and Resume while paused', async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { render } = await renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { FollowLine } from './ui/FollowLine.jsx'
    export const render = props => renderToStaticMarkup(React.createElement(FollowLine, { onSetAutopilot: () => {}, ...props }))
  `)
  const on = render({ record: followed() })
  assert.match(on, /<b>Following<\/b> · asks before each push/)
  assert.match(on, />Pause<\/button>/)
  assert.match(render({ record: followed({ enabled: false }) }), />Resume<\/button>/)
  assert.equal(render({ record: sent() }), '')
  assert.doesNotMatch(render({ record: followed(), readOnly: true }), /<button/, 'a closed PR’s page has no control')
})
