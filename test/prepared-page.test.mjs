import assert from 'node:assert/strict'
import test from 'node:test'
import { frontendModules, renderModule } from './render-harness.mjs'

// The page of a prepared PR, drawn inside its tab (owner's choice, 2026-11-23; DESIGN.md "The Prepared PR page"): its
// description is read in sections, and the page keeps every part the card had.

const modules = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { markdownHtml } from './ui/MarkdownView.jsx'
  import { FocusedCard } from './ui/PreparedPage.jsx'
  import { ProjectTabs } from './ui/ProjectTabs.jsx'
  export { markdownHtml }
  export const renderPage = props => renderToStaticMarkup(React.createElement(FocusedCard, props))
  export const renderTabs = props => renderToStaticMarkup(React.createElement(ProjectTabs, props))
`)
const sections = async text => (await modules()).markdownHtml(text, null, { sections: true })
const count = (html, pattern) => (html.match(pattern) || []).length

const DESCRIPTION = [
  '## Why', '', 'Opening a report took ten seconds.', '', '- the list was read twice;', '- nothing was cached.', '',
  '## What changes', '',
  '- **Reader** (`reader.py`, route `GET /reports`): reads each report once.',
  '- **Cache.** Keeps the last answer for a minute.',
  '- **Sending**: nothing new is sent.', '',
  '### Before and after', '', 'Same report, two sizes.', '',
  '## Tests', '', 'New tests cover the cache.',
].join('\n')

test('a description is read in sections: each heading opens one, and sub-headings stay inside it', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const html = await sections(DESCRIPTION)
  assert.equal(count(html, /<section class="co-doc-section">/g), 3)
  assert.equal(count(html, /<h2>/g), 3)
  assert.match(html, /<section class="co-doc-section"><h2>What changes<\/h2>[\s\S]*<h3>Before and after<\/h3>[\s\S]*<\/section><section class="co-doc-section"><h2>Tests/)
  const intro = await sections('Text before any heading.\n\n## Why\n\nBecause.')
  assert.match(intro, /^<section class="co-doc-section"><p>Text before any heading\.<\/p>\s*<\/section><section class="co-doc-section"><h2>Why/)
})

test('a list of bold terms reads as term and text rows, with a file or route on a quiet line', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const html = await sections(DESCRIPTION)
  assert.equal(count(html, /<div class="co-doc-term-row">/g), 3)
  assert.match(html, /<dt>Reader<span class="co-doc-reference"><code>reader\.py<\/code>, route <code>GET \/reports<\/code><\/span><\/dt><dd>reads each report once\.<\/dd>/)
  assert.match(html, /<dt>Cache<\/dt><dd><strong>|<dt>Cache<\/dt><dd>Keeps the last answer for a minute\.<\/dd>/, 'a trailing full stop is not part of the term')
  assert.match(html, /<dt>Sending<\/dt><dd>nothing new is sent\.<\/dd>/, 'a colon after the term is not part of the text')
  assert.equal(count(html, /<ul>/g), 1, 'the plain list of the first section stays a list')
})

test('only a list where every item starts with a short bold term becomes rows', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const mixed = await sections('## A\n\n- **Term**: text\n- plain item\n')
  assert.equal(count(mixed, /co-doc-term-row/g), 0, 'one plain item keeps the whole list a list')
  const sentence = await sections('## A\n\n- **A bold lead-in that is really a whole sentence of its own.** More.\n')
  assert.equal(count(sentence, /co-doc-term-row/g), 0, 'a long bold lead-in is a sentence, not a term')
  const numbered = await sections('## A\n\n1. **Term**: text\n2. **Other**: text\n')
  assert.equal(count(numbered, /co-doc-term-row/g), 0, 'a numbered list keeps its numbers')
  const nested = await sections('## A\n\n- **Term**: text\n  - detail\n')
  assert.equal(count(nested, /co-doc-term-row/g), 0, 'an item with a list inside keeps it')
})

test('reading in sections is off unless asked for, and keeps pictures and code as they were', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { markdownHtml } = await modules()
  const source = '## Why\n\n- **Term**: text\n\n![Shot](screenshot:one.png)\n\n```\ncode\n```\n'
  const plain = markdownHtml(source)
  assert.doesNotMatch(plain, /co-doc/, 'the same text without sections is exactly what it was')
  const read = markdownHtml(source, null, { sections: true })
  assert.match(read, /co-markdown-shot-pending/, 'a staged picture is still a placeholder until its image is read')
  assert.match(read, /<pre><code>code\n<\/code><\/pre>/)
})

const record = (overrides = {}) => ({
  id: 'one', type: 'pr', status: 'prepared', repo: 'owner/project', title: 'Keep reports fast', summary: 'Reports open in a second.',
  updated_at: new Date().toISOString(),
  plan: { action: 'pr', repo: 'owner/project', branch: 'fix/fast-reports', title: 'Keep reports fast', body_draft: DESCRIPTION,
    labels: ['bug', 'area: ui'], diff_stat: '10 files changed, 692 insertions(+), 23 deletions(-)', head_sha: 'a'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) },
  ...overrides,
})

test('a prepared PR page keeps every part of the card in a page order, with one All clear', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { renderPage } = await modules()
  const html = renderPage({ rec: record(), chats: '<b data-chats>Open chat</b>', loadDiff: async () => '' })
  assert.match(html, /<h3 class="co-pr-page-title">Keep reports fast<\/h3>/)
  assert.equal(count(html, /All clear/g), 1, 'the review result is said once')
  assert.match(html, /co-chip is-all_clear/)
  assert.doesNotMatch(html, /co-quality-pill|class="co-card/, 'no second All clear and no card around the page')
  assert.match(html, /fix\/fast-reports[\s\S]*10 files[\s\S]*\+692[\s\S]*−23/, 'the branch and the size of the change are in the facts')
  assert.match(html, /area: ui/, 'the labels are in the facts')
  const order = ['co-pr-page-title', 'co-pr-page-facts', 'co-pr-page-line', '&lt;b data-chats&gt;', 'co-pr-page-next', 'co-details-toggle', 'co-detail-tabs']
    .map(part => html.indexOf(part))
  assert.ok(order.every((index, i) => index > -1 && (i === 0 || index > order[i - 1])), `title, facts, line, chats, state, Hide details, tabs: ${order}`)
  assert.match(html, /Waiting for your OK|Ready for you|Private/, 'the state sits in the panel with the summary')
  assert.match(html, /<p>Reports open in a second\.<\/p>/)
  assert.match(html, /aria-expanded="true"[^>]*><span>Hide details<\/span>/)
  assert.match(html, />Description<[\s\S]*>Files<span class="co-tab-count">10<\/span>[\s\S]*>Activity</, 'Files carries its count')
})

test('a record that is not a prepared plan keeps its card, with the source chats above it', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { renderPage } = await modules()
  const published = renderPage({ rec: record({ status: 'open', url: 'https://github.com/owner/project/pull/7', number: 7 }), chats: '<b data-chats>Open chat</b>', loadDiff: async () => '' })
  assert.match(published, /class="co-card/)
  assert.doesNotMatch(published, /co-pr-page/)
  assert.ok(published.indexOf('data-chats') < published.indexOf('class="co-card'))
})

test('a PR opened from another tab brings its own tab to the front, and the list is not drawn under it', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for real React SSR')
  const { renderTabs } = await modules()
  const props = { renderPullRequests: () => 'PR-LIST', inventory: 'SAVED-WORK', myJobs: 'JOBS', myWork: 'FINISHED', preparedCount: 1, prepared: 'PREPARED-PAGE' }
  const opened = renderTabs({ ...props, defaultTab: 'all', openTab: 'prepared', openKey: 'one' })
  assert.match(opened, /aria-selected="true"[^>]*>Prepared PRs/)
  assert.match(opened, /PREPARED-PAGE/)
  assert.doesNotMatch(opened, /SAVED-WORK/)
  const closed = renderTabs({ ...props, defaultTab: 'all' })
  assert.match(closed, /aria-selected="true"[^>]*>All PRs/, 'with nothing open the project stays on the tab it was on')
})
