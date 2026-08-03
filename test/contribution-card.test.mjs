import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'

const frontendModules = process.env.MOBIUS_FRONTEND_NODE_MODULES

async function cardRenderer() {
  const esbuildUrl = pathToFileURL(join(frontendModules, 'esbuild', 'lib', 'main.js')).href
  const { build } = await import(esbuildUrl)
  const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const result = await build({
    stdin: {
      contents: `
        import React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ContributionCard, ReviewPlan } from './ui/ContributionCard.jsx'
        export function renderCard(rec) {
          return renderToStaticMarkup(React.createElement(ContributionCard, {
            rec, onSend: () => {}, onDismiss: () => {},
            onRunPrePrChecks: () => {}, onFeedback: () => ({ ok: true }),
            onConnectApp: () => {},
          }))
        }
        export function renderReview(rec) {
          return renderToStaticMarkup(React.createElement(ReviewPlan, { rec }))
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
  const evaluate = new Function('module', 'exports', 'require', result.outputFiles[0].text)
  evaluate(bundledModule, bundledModule.exports, createRequire(import.meta.url))
  return bundledModule.exports
}

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
    assert.doesNotMatch(html, /Send pull request|Send for review|Contribution actions/)
  }
})

test('prepared platform cards offer a confirmed pre-PR check action', async (t) => {
  if (!frontendModules) {
    t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering')
    return
  }
  const { renderCard } = await cardRenderer()
  const html = renderCard({
    id: 'platform-check', type: 'pr', status: 'prepared',
    repo: 'mobius-os/mobius', title: 'Test before sending',
    plan: { action: 'pr', repo: 'mobius-os/mobius', title: 'Test before sending' },
  })
  assert.match(html, /aria-label="Run GitHub checks"/)
  assert.match(html, />Test</)
  assert.match(html, /Send pull request for review/)
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
  assert.match(running, /GitHub checks are still running/)

  const failed = renderCard({
    ...base,
    pre_pr_checks: {
      state: 'completed', conclusion: 'failure',
      url: 'https://github.com/owner/mobius/actions/runs/8',
    },
  })
  assert.match(failed, /GitHub checks need a fix/)
  assert.match(failed, /Fix in chat/)
  assert.match(failed, /Run GitHub checks again/)

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

async function autopilotCardRenderer() {
  const esbuildUrl = pathToFileURL(join(frontendModules, 'esbuild', 'lib', 'main.js')).href
  const { build } = await import(esbuildUrl)
  const projectRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
  const result = await build({
    stdin: {
      contents: `
        import React from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { ContributionCard } from './ui/ContributionCard.jsx'
        export function renderCard(rec) {
          return renderToStaticMarkup(React.createElement(ContributionCard, {
            rec, onSetAutopilot: () => {},
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
  const evaluate = new Function('module', 'exports', 'require', result.outputFiles[0].text)
  evaluate(bundledModule, bundledModule.exports, createRequire(import.meta.url))
  return bundledModule.exports
}

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
