import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const connectionRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionCard } from './ui/ConnectionCard.jsx'
  export function renderConnection(conn, placement = 'content') {
    return renderToStaticMarkup(React.createElement(ConnectionCard, {
      conn,
      placement,
      token: 'app-token',
      onChanged: () => {},
    }))
  }
`)

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
