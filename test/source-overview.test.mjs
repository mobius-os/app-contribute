import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const overviewRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionOverview } from './ui/SourceOverview.jsx'
  export function renderOverview(reviewSummary) {
    return renderToStaticMarkup(React.createElement(ContributionOverview, {
      projects: [],
      loading: false,
      reviewSummary,
      incomingReviews: [],
      cycleAction: null,
      cycle: { phase: 'idle' },
      omittedCount: 0,
    }))
  }
`)

test('a running review never appears as an empty contribution inbox', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderOverview } = await overviewRenderer()
  const html = renderOverview({ reviewing: 1 })

  assert.match(html, /1 review is already in progress/)
  assert.doesNotMatch(html, /You’re caught up/)
})
