import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const cardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionCard, ReviewPlan } from './ui/ContributionCard.jsx'
  export function renderCard(rec) {
    return renderToStaticMarkup(React.createElement(ContributionCard, {
      rec, onSend: () => {}, onDismiss: () => {},
      onFeedback: () => ({ ok: true }),
      onConnectApp: () => {}, onWithdraw: () => ({ ok: true }),
    }))
  }
  export function renderReview(rec) {
    return renderToStaticMarkup(React.createElement(ReviewPlan, { rec }))
  }
`)

test('open and draft cards expose durable label failures without Send controls', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  for (const status of ['open', 'draft']) {
    const html = renderCard({
      id: `published-${status}`,
      type: 'pr',
      status,
      title: 'Truthful labels',
      repo: 'mobius-os/app-demo',
      url: 'https://github.com/mobius-os/app-demo/pull/42',
      plan: { labels: ['bug', 'area: ui'] },
      last_submit_labels_requested: ['bug', 'area: ui'],
      last_submit_labels_applied: [],
      last_submit_labels_note: 'GitHub did not confirm these labels were applied.',
    })

    assert.match(html, /Labels need attention/)
    assert.match(html, /Requested/)
    assert.match(html, /Not confirmed/)
    assert.match(html, /GitHub did not confirm these labels were applied\./)
    assert.match(html, /Review labels on GitHub/)
    assert.match(html, /do not send it again/)
    assert.doesNotMatch(html, /(?:Send|Open) pull request|Send for review|Contribution actions/)
  }
})

test('a prepared request keeps its source-conversation action and note', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'request-draft', type: 'issue', status: 'prepared',
    title: 'Clarify the review flow', repo: 'mobius-os/app-demo',
    plan: { action: 'issue', title: 'Clarify the review flow' },
  })
  assert.match(html, /Open this request&#x27;s source conversation/)
  assert.match(html, /Requests stay connected to their source conversation/)
})

test('request details do not render an empty pull-request changes section', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await cardRenderer()
  const html = renderReview({
    id: 'published-request', type: 'issue', status: 'open',
    repo: 'mobius-os/mobius',
    plan: {
      action: 'issue',
      title: 'Clarify the review flow',
    },
  })
  assert.match(html, /Request details/)
  assert.doesNotMatch(html, />Changes</)
  assert.doesNotMatch(html, /co-diff/)
})

test('prepared platform cards keep one explicit public action', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'platform-check', type: 'pr', status: 'prepared',
    repo: 'mobius-os/mobius', title: 'Test before sending',
    plan: {
      action: 'pr', repo: 'mobius-os/mobius', title: 'Test before sending',
      head_sha: 'reviewed-head',
    },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'reviewed-head' },
  })
  assert.doesNotMatch(html, /Check on fork|Run GitHub checks/)
  assert.match(html, /aria-label="Send pull request"/)
  assert.match(html, />Send PR</)
})

test('a settled update target blocks another public action and leads to recovery', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'settled-update', type: 'pr', status: 'prepared',
    repo: 'mobius-os/app-contribute', title: 'Preserve the follow-up',
    number: 59, needs_attention: true,
    attention: {
      type: 'review_target_settled',
      title: 'Pull request #59 already merged',
      message: 'Preserve the remaining changes in a new reviewed contribution.',
    },
    plan: {
      action: 'pr_update', repo: 'mobius-os/app-contribute',
      title: 'Preserve the follow-up', head_sha: 'reviewed-head',
    },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'reviewed-head' },
  })
  assert.match(html, /Pull request #59 already merged/)
  assert.match(html, /Fix in chat/)
  assert.doesNotMatch(html, /Update pull request|>Update PR</)
})

test('withdrawal is offered only for a published Möbius-bot contribution', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const eligible = {
    id: 'relay-pr', type: 'pr', status: 'draft',
    title: 'Review the relay', repo: 'mobius-os/app-demo',
    submission_mode: 'mobius-bot', relay_contribution_id: 'ctr_reviewed',
  }

  const html = renderCard(eligible)
  assert.match(html, />Withdraw PR</)
  assert.doesNotMatch(html, /Confirm contribution withdrawal|Keep open/)

  for (const rec of [
    { ...eligible, submission_mode: 'personal-github' },
    { ...eligible, status: 'merged' },
    { ...eligible, relay_contribution_id: null },
  ]) {
    assert.doesNotMatch(renderCard(rec), />Withdraw PR</)
  }
})

test('prepared cards narrate running, failed, and passing pre-PR checks', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const base = {
    id: 'platform-check', type: 'pr', status: 'prepared',
    repo: 'mobius-os/mobius', title: 'Test before sending',
    plan: { action: 'pr', repo: 'mobius-os/mobius', title: 'Test before sending' },
  }
  const running = renderCard({
    ...base,
    pre_pr_checks: {
      state: 'in_progress',
      url: 'https://github.com/owner/mobius/actions/runs/7',
    },
  })
  assert.match(running, /GitHub checks running/)
  assert.match(running, /No pull request is open/)
  assert.match(running, /View run on GitHub/)

  const failed = renderCard({
    ...base,
    pre_pr_checks: {
      state: 'completed', conclusion: 'failure',
      url: 'https://github.com/owner/mobius/actions/runs/8',
    },
  })
  assert.match(failed, /GitHub checks need a fix/)
  assert.match(failed, /Fix in chat/)
  assert.doesNotMatch(failed, /Run GitHub checks on my fork again/)

  const passed = renderCard({
    ...base,
    pre_pr_checks: { state: 'completed', conclusion: 'success' },
  })
  assert.match(passed, /GitHub checks passed/)
  assert.match(passed, /exact reviewed branch passed/)
})

test('fully applied published labels stay compact', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'published-success',
    type: 'pr',
    status: 'open',
    title: 'Truthful labels',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/42',
    plan: { labels: ['bug', 'area: ui'] },
    last_submit_labels_requested: ['bug', 'area: ui'],
    last_submit_labels_applied: ['bug', 'area: ui'],
  })

  assert.match(html, /Labels applied/)
  assert.match(html, /bug/)
  assert.match(html, /area: ui/)
  assert.doesNotMatch(html, /Labels need attention|Requested|do not send it again/)
})

test('partial reconciliation evidence suggests dismissal without settling the record', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'possible-landing',
    type: 'pr',
    status: 'prepared',
    title: 'Reconcile prepared records',
    repo: 'mobius-os/app-contribute',
    plan: { action: 'pr', title: 'Reconcile prepared records' },
    reconciliation_hint: {
      type: 'already_landed',
      title: 'Looks already landed',
      message: '2 of 4 distinctive additions are already on main.',
      landing_pr: {
        url: 'https://github.com/mobius-os/app-contribute/pull/42',
      },
    },
  })

  assert.match(html, /Looks already landed/)
  assert.match(html, /2 of 4 distinctive additions are already on main\./)
  assert.match(html, /View possible landing PR/)
  assert.match(html, />Dismiss</)
  assert.match(html, /Waiting for your OK/)
})

test('a local app publication review explains the verified after-merge handoff', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderReview } = await cardRenderer()
  const html = renderReview({
    id: 'publish-maps',
    type: 'pr',
    status: 'prepared',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      repo: 'mobius-os/app-maps',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
  })

  assert.match(html, /After merge/)
  assert.match(html, /Connect this local app in place/)
  assert.match(html, /same in your workspace/)
  assert.match(html, /saved data/)
})

test('a merged app publication offers one explicit connection action', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'publish-maps',
    type: 'pr',
    status: 'merged',
    title: 'Publish Maps',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
  })

  assert.match(html, /App ready to connect/)
  assert.match(html, /Keep the local app and its published version together/)
  assert.match(html, />Connect app</)
  assert.match(html, /Saved app data stays in place/)
})

test('a completed publication connection stays visible without another button', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'publish-maps',
    type: 'pr',
    status: 'merged',
    title: 'Publish Maps',
    repo: 'mobius-os/app-maps',
    plan: {
      action: 'pr',
      after_merge: {
        action: 'connect_app',
        app_id: 101,
        manifest_url: 'https://raw.githubusercontent.com/mobius-os/app-maps/main/mobius.json',
      },
    },
    publication_connection: {
      status: 'connected',
      app_id: 101,
      slug: 'maps',
    },
  })

  assert.match(html, /App connected/)
  assert.match(html, /Future App Store updates will update this same app/)
  assert.doesNotMatch(html, />Connect app</)
})

const autopilotCardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionCard } from './ui/ContributionCard.jsx'
  export function renderCard(rec) {
    return renderToStaticMarkup(React.createElement(ContributionCard, {
      rec, onSetAutopilot: () => {},
    }))
  }
`)

test('an open autopilot PR shows the autopilot panel with pause + rounds', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await autopilotCardRenderer()
  const html = renderCard({
    id: 'ap-open',
    type: 'pr',
    status: 'open',
    title: 'Autopiloted fix',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/9',
    autopilot: {
      enabled: true,
      state: 'idle',
      rounds_used: 1,
      max_rounds: 5,
      last_round: { outcome: 'pushed', summary: 'Addressed the review.' },
      rounds: [{ outcome: 'pushed', summary: 'Addressed the review.',
                 finished_at: '2026-07-02T00:00:00Z' }],
    },
  })
  assert.match(html, /Autopilot on/)
  assert.match(html, /Pause/)
  assert.match(html, /Pushed a fix/)
  assert.match(html, /Addressed the review\./)
})

test('an escalated autopilot PR surfaces the human_required callout', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await autopilotCardRenderer()
  const html = renderCard({
    id: 'ap-escalated',
    type: 'pr',
    status: 'open',
    title: 'Needs a decision',
    repo: 'mobius-os/app-demo',
    url: 'https://github.com/mobius-os/app-demo/pull/9',
    needs_attention: true,
    attention: { type: 'human_required', message: 'A reviewer asked for a redesign.' },
    autopilot: { enabled: true, state: 'idle', rounds: [] },
  })
  assert.match(html, /A reviewer asked for a redesign\./)
})
