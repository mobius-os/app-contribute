import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { frontendModules } from './render-harness.mjs'
import { mount, nodes, text } from './mounted-hooks.mjs'

test('the final discussion page retains a path back to earlier threads', async t => {
  if (!frontendModules) return t.skip('MOBIUS_FRONTEND_NODE_MODULES is required')
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Cached discussion pages must not fetch') })
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')))
  const dir = await mkdtemp(join(tmpdir(), 'contribute-thread-pages-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const hooks = fileURLToPath(new URL('./mounted-hooks.mjs', import.meta.url))
  const leaves = new Map([
    ['./Icons.jsx', 'export const Icon = () => null'],
    ['./MarkdownView.jsx', 'export const MarkdownView = () => null'],
    ['./diff/DiffView.jsx', 'export default () => null'],
    ['./GithubParts.jsx', 'export const ChecksBadge = () => null; export const GithubLabel = () => null; export const PullStateBadge = () => null; export const REVIEW_DECISION = {}'],
  ])
  const build = await rolldown({
    input: fileURLToPath(new URL('../ui/PullRequestDetail.jsx', import.meta.url)), platform: 'node', tsconfig: false,
    transform: { jsx: 'react-jsx' },
    plugins: [{ name: 'thread-page-doubles', resolveId(id) {
      if (id === 'react' || id === 'react/jsx-runtime') return { id: hooks, external: true }
      if (leaves.has(id)) return '\0' + id
    }, load(id) { if (id.startsWith('\0')) return leaves.get(id.slice(1)) } }],
  })
  try { await build.write({ file: join(dir, 'detail.mjs'), format: 'es' }) } finally { await build.close() }
  const { PullRequestDetail } = await import(pathToFileURL(join(dir, 'detail.mjs')))
  const page = (id, hasMore, nextCursor) => ({ data: { threads: [{ id, path: id, comments: { nodes: [] } }], hasMore, nextCursor } })
  const h = mount(PullRequestDetail, {
    pr: { number: 7, repository: { nameWithOwner: 'team/repo' }, headRefOid: 'head', baseRefOid: 'base', baseRefName: 'main' },
    cacheStore: { entries: { 'description:1': { data: {} }, 'activity:1': { data: { items: [] } }, related: { data: { items: [] } },
      'threads:': page('first-page.js', true, 'last'), 'threads:last': page('last-page.js', false, null) } },
  })
  t.after(() => h.unmount())
  const button = label => nodes(h.tree, node => node.type === 'button' && text(node) === label)[0]
  button('More discussions').props.onClick(); h.flush()
  assert.match(text(h.tree), /last-page.js/)
  assert.equal(button('More discussions'), undefined)
  assert.ok(button('Previous discussions'), 'the final page must not strand the owner')
  button('Previous discussions').props.onClick(); h.flush()
  assert.match(text(h.tree), /first-page.js/)
  assert.doesNotMatch(text(h.tree), /last-page.js/)
})
