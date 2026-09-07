import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const connectionRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionCard, ConnectionSettings } from './ui/ConnectionCard.jsx'
  export function renderSettings(conn) {
    return renderToStaticMarkup(React.createElement(ConnectionSettings, { conn }))
  }
  export function renderConnection(conn, props = {}) {
    return renderToStaticMarkup(React.createElement(ConnectionCard, {
      conn,
      token: 'app-token',
      onChanged: () => {},
      onChooseSubmissionMethod: () => {},
      ...props,
    }))
  }
`)

test('Möbius is implicit while optional GitHub setup has one real connection action', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderConnection, renderSettings } = await connectionRenderer()
  const conn = { state: 'disconnected', deviceFlowAvailable: true }
  const html = renderConnection(conn)
  assert.match(html, /For Möbius projects. No GitHub needed/)
  assert.match(html, /Collaborate on community projects and send as yourself/)
  assert.equal((html.match(/>Connect with GitHub</g) || []).length, 1)
  assert.doesNotMatch(html, /Use Möbius|Choose changes to prepare|Möbius selected/)
  assert.match(html, /<details class="co-account-advanced"/)
  const closed = renderSettings(conn)
  assert.match(closed, /Contribute settings/)
  assert.match(closed, /Connect GitHub/)
  assert.doesNotMatch(closed, /co-settings-panel|Connect with GitHub|Private repositories/)
})

test('disconnected setup renders one GitHub device-flow action', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderConnection } = await connectionRenderer()
  const html = renderConnection({
    state: 'disconnected',
    deviceFlowAvailable: true,
  })

  assert.match(html, />Connect with GitHub</)
  assert.doesNotMatch(html, /token|Advanced/)
})

test('unconfigured device flow explains the unavailable sign-in', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderConnection } = await connectionRenderer()
  const html = renderConnection({
    state: 'disconnected',
    deviceFlowAvailable: false,
  })

  assert.match(html, /GitHub sign-in is not configured/)
  assert.doesNotMatch(html, />Connect with GitHub</)
})

test('reduced access shows the reconnect migration state', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderConnection } = await connectionRenderer()
  const html = renderConnection({
    state: 'connected',
    login: 'octocat',
    scopes: ['public_repo'],
  })

  assert.match(html, /Updating GitHub access/)
  assert.match(html, /being signed out/)
})


test('the header keeps GitHub visible without claiming an unchecked connection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderSettings } = await connectionRenderer()
  const connected = renderSettings({ state: 'connected', login: 'octocat' })
  assert.match(connected, /<span>GitHub<\/span>/)
  assert.match(connected, /GitHub connected — Contribute settings/)
  assert.doesNotMatch(connected, /Connect GitHub|co-settings-panel/)
  for (const state of ['checking', 'unknown', 'unsupported']) {
    const html = renderSettings({ state })
    assert.match(html, /<span>GitHub<\/span>/)
    assert.doesNotMatch(html, /GitHub connected|Connect GitHub|co-settings-panel/)
  }
})
