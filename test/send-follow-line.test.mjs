// The send window says, under each new PR, whether it will be followed, and after the send what the platform did (follow-note.js).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { followAtSend, followLineOf } from '../follow-note.js'
import { frontendModules, renderModule } from './render-harness.mjs'

const record = (extra = {}) => ({ id: 'r', type: 'pr', status: 'prepared', title: 'Add the thing', plan: { repo: 'o/r', action: 'pr', head_sha: 'b'.repeat(40) }, ...extra })
const before = rec => followAtSend(rec, { autopilotDefault: true, available: true })

test('before the send the line says what the send will do; during and after it says only what is known', () => {
  assert.equal(followLineOf(record(), { before }), 'It will be followed: an agent answers its reviews and checks.')
  assert.equal(followLineOf(record(), { before: rec => followAtSend(rec, { autopilotDefault: false, available: true }) }), 'It will not be followed. Follow sent PRs is off in Settings.')
  assert.equal(followLineOf(record(), { before, state: 'working' }), '', 'while it is being sent')
  assert.equal(followLineOf(record(), { before, state: { error: 'refused' } }), '', 'a failed send promises nothing')
  assert.equal(followLineOf(record(), { before, state: 'done', followed: { followed: false, why: 'stamp' } }), 'It is not followed. The grant could not be stamped, so it was not turned on.')
  assert.equal(followLineOf(record(), { before, state: 'done', followed: { followed: true, why: '' } }), 'It is followed: an agent answers its reviews and checks.')
  assert.equal(followLineOf(record(), { before, state: 'done' }), '', 'a sent PR whose result said nothing says nothing')
  assert.equal(followLineOf(record({ plan: { repo: 'o/r', action: 'pr_update' } }), { before }), '', 'an update changes nothing about following')
  assert.equal(followLineOf(record(), {}), '', 'without the answer the window is what it was')
})

test('the window hands the send result\'s `followed` to its row, and the Run passes the answer down', () => {
  const feed = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
  assert.match(feed, /if \(outcome\?\.followed && item\?\.unit\?\.type !== 'stack'\) setFollowed\(old => \(\{ \.\.\.old, \[runPrimaryRecord\(item\)\.id\]: outcome\.followed \}\)\)/)
  assert.match(feed, /followLineOf\(record, \{ before: followAtSend, state: progress\[record\.id\], followed: followed\[record\.id\] \}\)/)
  assert.match(feed, /\{follow \? <small>\{follow\}<\/small> : null\}/, 'in the secondary text style of the row')
  assert.match(feed, /followAtSend=\{followAtSend\}/)
})

let renderer
async function renderRows(t, props) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ExactActionList } from './ui/Feed.jsx'
    export function render(props) { return renderToStaticMarkup(React.createElement(ExactActionList, props)) }
  `)
  return (await renderer).render(props)
}
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim()

test('a row of the send window carries the line as a second quiet line under the repository, and none once there is nothing to say', async (t) => {
  const item = { id: 'publish:r', kind: 'publish', unit: { type: 'record', records: [record()] }, record: record() }
  const html = await renderRows(t, { items: [item], mode: 'send', publicationPreference: 'github', githubState: 'connected', stage: 'ready', followLine: rec => followLineOf(rec, { before }) })
  if (!html) return
  assert.match(html, /<small>o\/r<\/small><small>It will be followed: an agent answers its reviews and checks\.<\/small>/)
  const quiet = await renderRows(t, { items: [item], mode: 'send', publicationPreference: 'github', githubState: 'connected', stage: 'ready' })
  assert.doesNotMatch(quiet, /followed/)
  const sent = await renderRows(t, { items: [item], mode: 'send', publicationPreference: 'github', githubState: 'connected', stage: 'ready', progress: { r: 'done' }, followLine: rec => followLineOf(rec, { before, state: 'done', followed: { followed: false, why: 'stamp' } }) })
  assert.match(strip(sent), /Sent to GitHub/)
  assert.match(strip(sent), /It is not followed\. The grant could not be stamped/)
})
