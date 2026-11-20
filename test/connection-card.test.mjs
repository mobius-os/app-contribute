import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const connectionRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionCard, SettingsButton } from './ui/ConnectionCard.jsx'
  export function renderSettings(conn) {
    return renderToStaticMarkup(React.createElement(SettingsButton, { conn, onOpen: () => {}, className: 'co-rail-item' }, 'Settings'))
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

test('disconnected Contribute sends the owner to Settings instead of signing in itself', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderConnection, renderSettings } = await connectionRenderer()
  const conn = { state: 'disconnected', deviceFlowAvailable: true }
  const html = renderConnection(conn)
  assert.match(html, /Legacy Möbius drafts only. New contributions use GitHub/)
  assert.match(html, /Möbius Settings → Accounts → GitHub/)
  assert.equal((html.match(/>Go to Settings to connect</g) || []).length, 1)
  assert.doesNotMatch(html, /Connect with GitHub|device code|Private repositories|Disconnect/)
  const closed = renderSettings(conn)
  assert.match(closed, /Connect GitHub — Settings/)
  assert.doesNotMatch(closed, /Contribute settings/)
})

test('connected Contribute shows the account read-only with a Settings link', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderConnection } = await connectionRenderer()
  const html = renderConnection({ state: 'connected', login: 'octocat', scopes: ['repo', 'workflow'] })
  assert.match(html, /octocat/)
  assert.match(html, /This account is shared across Möbius apps/)
  assert.match(html, />Manage account</)
  assert.doesNotMatch(html, /Disconnect|Add access/)
})

test('the header shows the connected handle without claiming an unchecked connection', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderSettings } = await connectionRenderer()
  const connected = renderSettings({ state: 'connected', login: 'octocat' })
  assert.match(connected, /GitHub connected as octocat — Settings/)
  assert.match(connected, /title="GitHub connected · Settings"/)
  assert.doesNotMatch(connected, /Connect GitHub|Contribute settings/)
  for (const state of ['checking', 'unknown', 'unsupported']) {
    const html = renderSettings({ state })
    assert.match(html, /aria-label="GitHub — Settings"/)
    assert.doesNotMatch(html, /GitHub connected|Connect GitHub/)
  }
})
