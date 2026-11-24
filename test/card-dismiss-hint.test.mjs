// "Looks already landed" can be dismissed on its own, with the card's quiet button, without discarding the PR.
import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const cardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionCard } from './ui/ContributionCard.jsx'
  export function renderCard(rec) {
    return renderToStaticMarkup(React.createElement(ContributionCard, {
      rec, reviewState: null, onSend: () => {}, onDismiss: () => {}, onFeedback: () => ({ ok: true }),
      onConnectApp: () => {}, onWithdraw: () => ({ ok: true }),
    }))
  }
`)

const hinted = (more = {}) => ({
  id: 'possible-landing', type: 'pr', status: 'prepared', title: 'Reconcile prepared records', repo: 'mobius-os/app-contribute',
  plan: { action: 'pr', title: 'Reconcile prepared records' },
  reconciliation_hint: { type: 'already_landed', title: 'Looks already landed', message: '2 of 4 distinctive additions are already on main.' },
  ...more,
})

test('a landed hint offers a quiet Dismiss hint beside the Discard it always had', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { renderCard } = await cardRenderer()
  const html = renderCard(hinted())
  assert.match(html, /<button type="button" class="co-btn co-btn-quiet">Dismiss hint<\/button>/)
  assert.match(html, />Discard</, 'the way out through Discard is unchanged')
  assert.equal((html.match(/co-btn-quiet">Dismiss hint/g) || []).length, 1)
})

test('without a hint, or with another kind of hint, the card shows no Dismiss hint', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { renderCard } = await cardRenderer()
  assert.doesNotMatch(renderCard(hinted({ reconciliation_hint: null })), /Dismiss hint/)
  assert.doesNotMatch(renderCard(hinted({ reconciliation_hint: { type: 'something_else' } })), /Dismiss hint/)
})
