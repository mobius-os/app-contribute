import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

let renderer
async function render(t, conn) {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required'); return null }
  renderer ||= renderModule(`
    import React from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { GithubPullsUnavailable } from './index.jsx'
    import { TaskContext } from './ui/TaskPane.jsx'
    export const render = conn => renderToStaticMarkup(React.createElement(TaskContext.Provider, { value: { activeId: '' } }, React.createElement(GithubPullsUnavailable, { conn, onRetry: () => {} })))
  `)
  return (await renderer).render(conn)
}

test('only a confirmed disconnect asks the owner to connect GitHub', async t => {
  const html = await render(t, { state: 'disconnected' })
  if (html === null) return
  assert.match(html, /connect GitHub/)
  assert.doesNotMatch(html, /Check GitHub again/)
})

test('an unreachable status read is retryable and never asks to reconnect', async t => {
  const html = await render(t, { state: 'unknown', message: 'The GitHub connection check timed out.' })
  if (html === null) return
  assert.match(html, /timed out/)
  assert.match(html, /Check GitHub again/)
  assert.doesNotMatch(html, /connect GitHub/)
})

test('the initial check and a connected account render nothing', async t => {
  assert.equal(await render(t, { state: 'checking' }) ?? '', '')
  assert.equal(await render(t, { state: 'connected', login: 'owner' }) ?? '', '')
})
