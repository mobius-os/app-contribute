import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

const runRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import {
    ContributionRun,
    FocusedItem,
    batchFingerprint,
    publicationRouteProblem,
  } from './ui/Feed.jsx'

  const noop = () => ({ ok: true })
  export { batchFingerprint, publicationRouteProblem }
  export function renderRun(run, options = {}) {
    return renderToStaticMarkup(React.createElement(ContributionRun, {
      run,
      loading: false,
      reviewStatus: { byId: {} },
      cycle: options.cycle || { phase: 'idle' },
      publicationPreference: options.publicationPreference || 'github',
      githubState: options.githubState || 'connected',
      onStartCycle: noop,
      onStopCycle: noop,
      onOpenCycle: noop,
      onSend: noop,
      onSendStack: noop,
      onMarkReady: noop,
      onFeedback: noop,
      onDismiss: noop,
      onRestore: noop,
      onSetAutopilot: noop,
      onWithdraw: noop,
      onConnectApp: noop,
      onAssignIncomingReview: noop,
      onViewProject: noop,
      loadDiff: noop,
    }))
  }
  export function renderFocus(item) {
    return renderToStaticMarkup(React.createElement(FocusedItem, {
      item,
      reviewStatus: { byId: {} },
      onFeedback: noop,
      onDismiss: noop,
      onRestore: noop,
      onSetAutopilot: noop,
      onWithdraw: noop,
      onConnectApp: noop,
      onMarkReady: noop,
      onAssignIncomingReview: noop,
      loadDiff: noop,
    }))
  }
`)

function record(id, extra = {}) {
  const plan = {
    action: 'pr', repo: 'mobius-os/mobius', title: id,
    branch: 'fix/' + id, head_sha: 'a'.repeat(40),
    ...(extra.plan || {}),
  }
  return {
    id, type: 'pr', repo: plan.repo, status: 'prepared', title: id,
    quality_review: { state: 'all_clear', reviewed_head_sha: plan.head_sha },
    ...extra, plan,
  }
}

test('the Run renders one batch action without a duplicate publish row', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('One reviewed change')
  const item = {
    id: 'publish:one', kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: rec.repo,
  }
  const html = renderRun({
    decisions: [item], working: [], recent: [], archive: [], projects: [],
    privateAction: null,
  })

  assert.equal((html.match(/co-run-primary is-send/g) || []).length, 1)
  assert.doesNotMatch(html, /co-run-row is-publish/)
  assert.match(html, /Send/)
  assert.match(html, /Needs you<\/h3><span>0<\/span>/)
})

test('exact publication copy is truthful per record in a mixed route batch', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const relay = record('Möbius change')
  const external = record('External change', { plan: { repo: 'owner/project' }, repo: 'owner/project' })
  const update = record('Existing PR update', { plan: { action: 'pr_update' } })
  const items = [relay, external, update].map((rec, index) => ({
    id: `publish:${index}`, kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: rec.repo,
  }))
  const html = renderRun({
    decisions: items, working: [], recent: [], archive: [], projects: [],
    privateAction: null,
  }, { publicationPreference: 'mobius', githubState: 'connected' })

  assert.match(html, /Open as a draft through Möbius/)
  assert.match(html, /Open ready for review/)
  assert.match(html, /Update the existing pull request/)
})

test('known route failures leave the public batch before approval', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { publicationRouteProblem } = await runRenderer()
  const external = record('External', { plan: { repo: 'owner/project' }, repo: 'owner/project' })
  const standalone = {
    id: 'publish:external', kind: 'publish', record: external,
    unit: { type: 'record', id: external.id, record: external, records: [external] },
  }
  const update = record('Update', { plan: { action: 'pr_update' } })
  const updateItem = {
    id: 'publish:update', kind: 'publish', record: update,
    unit: { type: 'record', id: update.id, record: update, records: [update] },
  }
  const draft = { ...record('Draft'), status: 'draft' }
  const readyItem = {
    id: 'mark_ready:draft', kind: 'mark_ready', record: draft,
    unit: { type: 'record', id: draft.id, record: draft, records: [draft] },
  }

  assert.match(publicationRouteProblem(standalone, 'mobius', 'disconnected'), /outside mobius-os/)
  assert.match(publicationRouteProblem(updateItem, 'mobius', 'disconnected'), /Connect Personal GitHub/)
  assert.match(publicationRouteProblem(readyItem, 'github', 'disconnected'), /Reconnect Personal GitHub/)

  const common = { id: 'stack', name: 'Stack', total: 2 }
  const layers = [1, 2].map(position => record(`Layer ${position}`, { plan: {
    branch: `stack/stack/${position}`,
    stack: {
      ...common, position, base_branch: position === 1 ? 'main' : 'stack/stack/1',
      parent_record_id: position === 1 ? '' : 'Layer 1',
    },
  } }))
  const stack = {
    id: 'publish:stack', kind: 'publish',
    unit: { type: 'stack', id: 'stack', records: layers }, record: layers[0],
  }
  assert.match(publicationRouteProblem(stack, 'mobius', 'connected'), /relay supports standalone/)
})

test('an exact approval fingerprint changes with code, public text, route, and review stage', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { batchFingerprint } = await runRenderer()
  const rec = record('Approved head')
  const item = {
    id: 'publish:head', kind: 'publish', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
  }
  const approved = batchFingerprint([item], 'send', 'github', 'connected')
  const changedHead = {
    ...item,
    record: { ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } },
    unit: {
      ...item.unit,
      record: { ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } },
      records: [{ ...rec, plan: { ...rec.plan, head_sha: 'b'.repeat(40) } }],
    },
  }

  assert.notEqual(batchFingerprint([changedHead], 'send', 'github', 'connected'), approved)
  for (const planChange of [
    { base_sha: 'c'.repeat(40) },
    { diff_sha256: 'd'.repeat(64) },
    { title: 'Changed title' },
    { body_draft: 'Changed public body' },
    { labels: ['bug'] },
  ]) {
    const changed = { ...rec, plan: { ...rec.plan, ...planChange } }
    const changedItem = {
      ...item,
      record: changed,
      unit: { ...item.unit, record: changed, records: [changed] },
    }
    assert.notEqual(batchFingerprint([changedItem], 'send', 'github', 'connected'), approved)
  }
  assert.notEqual(batchFingerprint([item], 'send', 'mobius', 'connected'), approved)
  assert.notEqual(batchFingerprint([item], 'ready', 'github', 'connected'), approved)
})

test('the Run stays global while project identity remains visible', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const projects = [
    { key: 'one', name: 'One', canonical_repo: 'owner/one' },
    { key: 'two', name: 'Two', canonical_repo: 'owner/two' },
  ]
  const records = projects.map((project) => record(project.name, {
    repo: project.canonical_repo,
    plan: { repo: project.canonical_repo },
  }))
  const decisions = records.map((rec, index) => ({
    id: `private_review:${rec.id}`,
    kind: 'private_review',
    record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    project: projects[index],
    label: rec.title,
    detail: `Private review needed · ${rec.repo}`,
  }))
  const run = {
    decisions, working: [], recent: [], archive: [],
    projects: projects.map(project => ({
      id: `project:${project.key}`, project, label: project.name, detail: 'Local work',
    })),
    privateAction: { label: 'Prepare all', count: 2, draft: 'Prepare both projects' },
  }
  const html = renderRun(run)

  assert.match(html, /Private work can be handled together/)
  assert.match(html, /co-run-private-items/)
  assert.match(html, /owner\/one/)
  assert.match(html, /owner\/two/)
  assert.match(html, /Needs you<\/h3><span>0<\/span>/)
  assert.doesNotMatch(html, /co-run-row is-private_review/)
  assert.match(html, /2 projects represented in this snapshot/)
  assert.match(html, /Browse projects/)
  assert.doesNotMatch(html, /<select|Filter by project|All projects/)
  assert.doesNotMatch(html, /You’re caught up/)
})

test('private review groups move from the one Private Run into Working while it runs', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun } = await runRenderer()
  const rec = record('Private fix')
  const item = {
    id: `private_review:${rec.id}`, kind: 'private_review', record: rec,
    unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
    label: rec.title, detail: `Private fixes needed · ${rec.repo}`,
  }
  const html = renderRun({
    decisions: [item], working: [], recent: [], archive: [], projects: [],
    privateAction: { label: 'Fix', count: 1, draft: 'Fix private work' },
  }, { cycle: { phase: 'running', runtime: { running: true } } })

  assert.match(html, /Preparing private work/)
  assert.match(html, /<b>1<\/b> moving/)
  assert.match(html, /Moving quietly<\/span><b>1<\/b>/)
  assert.match(html, /is-review_in_progress/)
  assert.match(html, /Private run in progress/)
  assert.match(html, /Needs you<\/h3><span>0<\/span>/)
  assert.doesNotMatch(html, /co-run-private-items/)
  assert.doesNotMatch(html, /co-run-row is-private_review/)
})

test('focused batch and private items are inspectable but cannot bypass their one owner', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const rec = record('Reviewed detail', { chat_id: 'source-a' })
  for (const kind of ['publish', 'private_review']) {
    const html = renderFocus({
      id: `${kind}:detail`, kind, record: rec,
      unit: { type: 'record', id: rec.id, record: rec, records: [rec] },
      label: rec.title, detail: rec.repo,
    })
    assert.doesNotMatch(html, />Send PR</)
    assert.match(html, /Open source chat/)
    assert.match(html, /Dismiss prepared pull request/)
  }
})

test('focused stacks preserve every source chat and never expose an unreviewed send', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const first = record('First', { chat_id: 'chat-a' })
  const second = record('Second', { chat_id: 'chat-b' })
  const html = renderFocus({
    id: 'private_review:stack', kind: 'private_review',
    unit: { type: 'stack', id: 'stack', records: [first, second] },
    record: first, label: 'Related changes', detail: 'Private review needed',
  })

  assert.match(html, /Open source chat 1/)
  assert.match(html, /Open source chat 2/)
  assert.doesNotMatch(html, />Send PRs?</)
})

test('focused public-attention stacks expose every affected record and its next action', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const first = record('Review comment', {
    status: 'open', chat_id: 'chat-a', needs_attention: true,
    attention: {
      type: 'human_required', message: 'Choose the response to the reviewer.',
      url: 'https://github.com/mobius-os/mobius/pull/1#issuecomment-1',
    },
  })
  const second = record('Failed checks', {
    status: 'open', chat_id: 'chat-b', needs_attention: true,
    url: 'https://github.com/mobius-os/mobius/pull/2',
    attention: {
      type: 'checks_failed', message: 'The browser test is failing.',
    },
  })
  const html = renderFocus({
    id: 'public_attention:stack', kind: 'public_attention', record: first,
    unit: { type: 'stack', id: 'stack', records: [first, second] },
    label: 'Public follow-up', detail: 'Two records need attention',
  })

  assert.equal((html.match(/class="co-decision-surface"/g) || []).length, 2)
  assert.equal((html.match(/class="co-attention"/g) || []).length, 2)
  assert.equal((html.match(/View activity on GitHub/g) || []).length, 2)
  assert.match(html, /Choose the response to the reviewer/)
  assert.match(html, /The browser test is failing/)
  assert.match(html, /Fix in chat/)
})

test('a stack-owned merged app handoff exposes one connection action', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const merged = record('Connect app', {
    status: 'merged',
    plan: { after_merge: { action: 'connect_app' } },
  })
  const open = { ...record('Open sibling'), status: 'open' }
  const html = renderFocus({
    id: 'connect:stack', kind: 'connect', record: merged,
    unit: { type: 'stack', id: 'stack', records: [merged, open] },
    label: merged.title, detail: 'Merged app ready to connect',
  })

  assert.equal((html.match(/class="co-publication-action"/g) || []).length, 1)
  assert.match(html, /<button[^>]*co-btn-primary[^>]*>Connect app<\/button>/)
  assert.doesNotMatch(html, />Send PRs?</)
})

test('durable Ready errors stay visible with only deliberate safe recovery', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderFocus } = await runRenderer()
  const draft = {
    ...record('Ready recovery'), status: 'draft',
    last_ready_error: 'Auto-merge is enabled on this pull request.',
    last_ready_error_code: 'ready_auto_merge_enabled',
    url: 'https://github.com/mobius-os/mobius/pull/1',
  }
  const html = renderFocus({
    id: 'ready_attention:draft', kind: 'ready_attention', record: draft,
    unit: { type: 'record', id: draft.id, record: draft, records: [draft] },
    label: draft.title, detail: draft.last_ready_error,
  })

  assert.match(html, /Auto-merge is enabled/)
  assert.match(html, /I disabled auto-merge — request review/)
  assert.match(html, /Open pull request/)
})

test('dismissed work remains discoverable and focused history can restore it', async (t) => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  const { renderRun, renderFocus } = await runRenderer()
  const archived = { ...record('Restore me'), status: 'abandoned' }
  const item = {
    id: 'archived:restore', kind: 'archived', record: archived,
    unit: { type: 'record', id: archived.id, record: archived, records: [archived] },
    label: archived.title, detail: 'Dismissed',
  }
  const runHtml = renderRun({
    decisions: [], working: [], recent: [], archive: [item], projects: [],
    privateAction: null,
  })
  const focusHtml = renderFocus(item)

  assert.match(runHtml, /Dismissed<\/span><b>1<\/b>/)
  assert.match(focusHtml, />Restore</)
})
