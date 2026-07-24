import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const frontendModules = process.env.MOBIUS_FRONTEND_NODE_MODULES

async function connectionRenderer() {
  const esbuildUrl = pathToFileURL(
    join(frontendModules, 'esbuild', 'lib', 'main.js'),
  ).href
  const { build } = await import(esbuildUrl)
  const projectRoot = dirname(
    fileURLToPath(new URL('../package.json', import.meta.url)),
  )
  const result = await build({
    stdin: {
      contents: `
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
      `,
      loader: 'jsx',
      resolveDir: projectRoot,
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    nodePaths: [frontendModules],
    write: false,
  })
  const bundledModule = { exports: {} }
  const evaluate = new Function(
    'module',
    'exports',
    'require',
    result.outputFiles[0].text,
  )
  evaluate(
    bundledModule,
    bundledModule.exports,
    createRequire(import.meta.url),
  )
  return bundledModule.exports
}

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
