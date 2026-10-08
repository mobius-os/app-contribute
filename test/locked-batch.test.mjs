import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildContributionRun } from '../run.js'
import { mount, nodes, text } from './mounted-hooks.mjs'
import { frontendModules } from './render-harness.mjs'

let ContributionRun, buildDir
before(async () => {
  if (!frontendModules) return
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')))
  buildDir = await mkdtemp(join(tmpdir(), 'contribute-locked-batch-'))
  const hooks = fileURLToPath(new URL('./mounted-hooks.mjs', import.meta.url))
  const leaves = new Map([
    ['./Icons.jsx', 'export const Icon = () => null'],
    ['./ProjectIcon.jsx', 'export const ProjectIcon = () => null'],
    ['./BatchAction.jsx', 'export const openAgentConversation = () => {}'],
    ['./ContributionCard.jsx', 'export const ContributionCard = () => null; export const ContributionDecision = () => null'],
  ])
  const build = await rolldown({
    input: fileURLToPath(new URL('../ui/Feed.jsx', import.meta.url)), platform: 'node', tsconfig: false,
    transform: { jsx: 'react-jsx' },
    plugins: [{ name: 'mounted-batch-doubles',
      resolveId(id) {
        if (id === 'react' || id === 'react/jsx-runtime') return { id: hooks, external: true }
        if (leaves.has(id)) return '\0' + id
      },
      load(id) { if (id.startsWith('\0')) return leaves.get(id.slice(1)) },
    }],
  })
  try { await build.write({ file: join(buildDir, 'feed.mjs'), format: 'es' }) }
  finally { await build.close() }
  ;({ ContributionRun } = await import(pathToFileURL(join(buildDir, 'feed.mjs'))))
})
after(async () => { if (buildDir) await rm(buildDir, { recursive: true, force: true }) })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const button = (h, label) => nodes(h.tree, node => node.type === 'button' && text(node) === label)[0]
const list = h => nodes(h.tree, node => node.type === 'ol' && node.props.className === 'co-run-approval-list')[0]

for (const mode of ['send', 'ready']) test(`${mode}: first-of-two ledger updates retain the exact locked batch until Done`, async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for mounted component contracts'); return }
  const head = 'a'.repeat(40)
  let records = ['First change', 'Second change'].map((title, index) => ({
    id: 'record-' + index, type: 'pr', repo: 'team/repo', title,
    status: mode === 'ready' ? 'draft' : 'prepared', number: mode === 'ready' ? index + 1 : undefined,
    plan: { action: 'pr', repo: 'team/repo', title, branch: 'fix/' + index, head_sha: head },
    quality_review: { state: 'all_clear', reviewed_head_sha: head },
  }))
  const reviewStatus = { byId: Object.fromEntries(records.map(record => [record.id, { state: 'ready' }])) }
  let run = buildContributionRun({ records, reviewStatus }), h
  const first = deferred(), second = deferred(), calls = []
  const action = async record => {
    calls.push(record.id)
    await (record.id === 'record-0' ? first.promise : second.promise)
    const oldRevision = run.revision
    records = records.map(item => item.id === record.id ? { ...item, status: 'open' } : item)
    run = buildContributionRun({ records, reviewStatus })
    assert.notEqual(run.revision, oldRevision, 'the actual ledger projection changes revision')
    h.update(props())
    return { ok: true }
  }
  const props = () => ({ run, reviewStatus, githubState: 'connected', publicationPreference: 'github',
    onSend: action, onMarkReady: action })
  h = mount(ContributionRun, props()); t.after(() => h.unmount())
  const flush = async () => { for (let i = 0; i < 20; i++) { await Promise.resolve(); h.flush() } }
  button(h, mode === 'ready' ? 'Request review' : 'Review and send 2').props.onClick(); h.flush()
  const start = button(h, mode === 'ready' ? 'Request review for 2 on GitHub' : 'Send 2 to GitHub')
  const finished = start.props.onClick(); h.flush()
  first.resolve(); await flush()
  assert.ok(list(h), 'confirmed component survives the first revision update')
  assert.match(text(list(h)), /First change/)
  assert.match(text(list(h)), /Second change/)
  assert.match(text(list(h)), mode === 'ready' ? /Review requested/ : /Sent to GitHub/)
  assert.equal(button(h, 'Working…').props.disabled, true)
  assert.equal(button(h, 'Working…').props['aria-busy'], true)
  assert.equal(button(h, 'Done'), undefined)
  second.resolve(); await finished; await flush()
  assert.deepEqual(calls, ['record-0', 'record-1'])
  assert.match(text(list(h)), /First change/)
  assert.match(text(list(h)), /Second change/)
  assert.equal(nodes(list(h), node => node.type === 'em' && node.props.className === 'is-done').length, 2)
  button(h, 'Done').props.onClick(); h.flush()
  assert.equal(list(h), undefined, 'only Done releases the retained approval/results')
})

test('before consent, changed ledger scope refreshes the enumerated batch without starting actions', async t => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for mounted component contracts'); return }
  const record = { id: 'fixture', type: 'pr', status: 'prepared', repo: 'team/repo', title: 'Old reviewed change',
    plan: { action: 'pr', repo: 'team/repo', title: 'Old reviewed change', branch: 'fix/fixture', head_sha: 'a'.repeat(40) },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) } }
  const reviewStatus = { byId: { fixture: { state: 'ready' } } }
  const calls = []
  const props = rec => ({ run: buildContributionRun({ records: [rec], reviewStatus }), reviewStatus,
    githubState: 'connected', publicationPreference: 'github', onSend: item => { calls.push(item); return { ok: true } } })
  const h = mount(ContributionRun, props(record)); t.after(() => h.unmount())
  button(h, 'Review and send').props.onClick(); h.flush()
  const fresh = { ...record, title: 'New reviewed change',
    plan: { ...record.plan, title: 'New reviewed change', head_sha: 'b'.repeat(40) },
    quality_review: { ...record.quality_review, reviewed_head_sha: 'b'.repeat(40) } }
  h.update(props(fresh))
  assert.match(text(list(h)), /New reviewed change/)
  assert.doesNotMatch(text(list(h)), /Old reviewed change/)
  assert.match(text(h.tree), /The reviewed set changed/)
  assert.equal(button(h, 'Send to GitHub').props.disabled, false)
  assert.deepEqual(calls, [], 'a refreshed confirmation is not owner consent')
})
