import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const render = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ProjectRow } from './ui/SourceMap.jsx'
  export const row = (project, check = null) => renderToStaticMarkup(React.createElement(ProjectRow, { project, selected: false, onSelect: () => {}, check }))
`)

const base = { available: true, canonical_repo: 'owner/thing', origin: { sha: 'a'.repeat(40) }, base_sha: 'a'.repeat(40) }
const platform = { ...base, key: 'platform', name: 'Möbius', kind: 'platform', incomingFiles: 2 }
const app = { ...base, key: 'app:contribute', name: 'Contribute', kind: 'app', base_sha: 'b'.repeat(40), sourceComparisonRequired: true }

test('a repository with a GitHub update or no comparison links to where it is dealt with, beside its button', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { row } = await render()
  const moved = row(platform)
  assert.match(moved, /GitHub has updates for this project\./)
  assert.match(moved, /<div class="co-source-row-link"><button type="button" class="co-btn co-btn-quiet">Open Settings</, 'Möbius updates are applied in Settings')
  assert.ok(moved.indexOf('</button><div class="co-source-row-link">') > 0, 'the link is beside the row\'s button, never inside it')
  const notCompared = row(app)
  assert.match(notCompared, /Not compared with GitHub yet\./)
  assert.match(notCompared, /co-source-row-link"><button type="button" class="co-btn co-btn-quiet">Open App Store</, 'an app is updated in the App Store')
  assert.match(row({ ...app, kind: 'app' }, { newCommits: 3 }), /3 new commits on GitHub since the last check\.[\s\S]*Open App Store/)
})

test('a quiet repository, or one that cannot be updated from here, shows no link', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { row } = await render()
  assert.doesNotMatch(row({ ...base, key: 'quiet', name: 'Quiet', kind: 'app' }), /co-source-row-link/)
  assert.doesNotMatch(row({ ...platform, builtHere: true, canonical_repo: '' }), /co-source-row-link/, 'a project that only lives on this Möbius has nothing to update from')
  assert.doesNotMatch(row({ ...platform, available: false }), /co-source-row-link/)
})
