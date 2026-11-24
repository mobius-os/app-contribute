// A finished PR that still waits on the owner (an update that can no longer go out, a merge that never reached the default branch) is a decision:
// it is in Needs you, its card offers the owner's exits, each exit goes through the checked lifecycle writer, and the job leaves it settled.
// The records here are what the job's own planner and the app's own receipt write, never a hand-built shape.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { needsRows } from '../desk.js'
import { settleExits, settleRecord } from '../lifecycle-write.js'
import { ownerHeld } from '../lifecycle-record.js'
import { recordAfterReceipt } from '../pull-receipt.js'
import { buildContributionRun } from '../run.js'
import { settleHeld } from '../storage.js'
import { jobPasses, mergedNode, publicationOf, updateOf } from './job-probe.mjs'
import { frontendModules, renderModule } from './render-harness.mjs'

const NOW = 1800000000
const DAY = 86400
const PULL = 'https://github.com/o/r/pull/7'
const UPDATE = { id: 'upd-1', type: 'pr', status: 'prepared', title: 'Fix the thing', repo: 'o/r', url: PULL, number: 7, plan: { action: 'pr_update', repo: 'o/r' }, created_at: '2027-01-14T07:00:00Z', updated_at: '2027-01-15T07:00:00Z' }
const OPEN = { id: 'side-1', type: 'pr', status: 'open', title: 'Land the thing', repo: 'o/r', url: PULL, number: 7, plan: { action: 'pr', repo: 'o/r' }, created_at: '2027-01-01T07:00:00Z', updated_at: '2027-01-01T07:00:00Z' }
const SIDE = mergedNode('stack-parent')

// What the job stores for an update whose PR merged first, and for a merge into a branch that never landed (fifteen days on).
const strandedByJob = () => jobPasses(UPDATE, [{ node: mergedNode('main'), now: NOW }]).at(-1).record
const orphanedByJob = () => jobPasses(OPEN, [{ node: SIDE, now: NOW }, { node: SIDE, now: NOW + 15 * DAY }]).at(-1).record

const runOf = record => buildContributionRun({ records: [record] })
const rowsOf = run => needsRows({ decisions: run.decisions })

// ---- The shared cases: the JavaScript and the Python writer answer them the same way (test/test_settle_exit.py reads the same file).
const CASES = JSON.parse(readFileSync(new URL('./lifecycle-settle.cases.json', import.meta.url), 'utf8'))

for (const { name, record, exit, successor, expect } of CASES.cases) {
  test(`settling: ${name}`, () => {
    const settled = settleRecord(record, exit, { successor, now: CASES.now, iso: CASES.iso })
    if (expect === null) { assert.equal(settled, null); return }
    assert.deepEqual([settled.lifecycle.regions.publication.state, settled.lifecycle.regions.update.state], [expect.regions.publication, expect.regions.update])
    for (const [field, value] of Object.entries(expect.fields)) assert.deepEqual(settled[field] ?? null, value, field)
    assert.equal(settled.lifecycle.history.at(-1).type, exit, 'the engine’s own history says which exit was taken')
  })
}

// ---- Planner to decision: what the job stores is what Needs you lists.
test('an update whose PR merged first is a decision in Needs you, not an accepted contribution', () => {
  const stranded = strandedByJob()
  assert.deepEqual([stranded.status, updateOf(stranded), stranded.attention.type], ['merged', 'STRANDED_UPDATE', 'owner_request'])
  const run = runOf(stranded)
  assert.deepEqual(run.decisions.map(item => item.kind), ['stranded_update'])
  assert.equal(rowsOf(run).length, 1, 'one row in Needs you')
  assert.deepEqual(run.recent, [], 'and no "Accepted" line for it')
  assert.match(run.decisions[0].detail, /finished before the update was sent/)
})

test('a merge into a branch that never landed is a decision in Needs you, not an accepted contribution', () => {
  const orphaned = orphanedByJob()
  assert.deepEqual([orphaned.status, publicationOf(orphaned), orphaned.attention.type], ['merged', 'ORPHANED', 'owner_request'])
  const run = runOf(orphaned)
  assert.deepEqual(run.decisions.map(item => item.kind), ['orphaned'])
  assert.equal(rowsOf(run).length, 1)
  assert.deepEqual(run.recent, [])
})

test('an update stranded by an in-app Merge is a decision at once, before the job has asked, and the job’s question does not add a second row', () => {
  const merged = recordAfterReceipt(UPDATE, { ok: true, state: 'merged' }, { engine: true, now: NOW, baseRef: 'main', baseIsDefault: true })
  assert.equal(merged.stranded_announced, false, 'the job has not asked yet')
  assert.equal(rowsOf(runOf(merged)).length, 1, 'the screen already lists it')
  const [asked] = jobPasses(merged, [{ node: mergedNode('main'), now: NOW + 60 }])
  assert.equal(asked.record.attention.type, 'owner_request')
  assert.deepEqual(runOf(asked.record).decisions.map(item => item.kind), ['stranded_update'])
})

test('what the owner has settled is accepted work again: no decision, in Recent, and the job leaves it alone', () => {
  for (const [name, record, exit, successor] of [['covered', strandedByJob(), 'COVERED_BY_MERGE', ''], ['discarded', strandedByJob(), 'DISCARD_UPDATE', ''],
    ['kept as new work', strandedByJob(), 'PRESERVE_AS_NEW', 'new-1'], ['landed again', orphanedByJob(), 'OWNER_RELANDS', 'new-2']]) {
    const settled = settleRecord(record, exit, { successor, now: NOW + 20 * DAY })
    const run = runOf(settled)
    assert.deepEqual([run.decisions.length, rowsOf(run).length, run.recent.length], [0, 0, 1], name)
    assert.equal(ownerHeld(settled), null, name)
    const [pass] = jobPasses(settled, [{ node: mergedNode('main'), now: NOW + 21 * DAY }])
    assert.deepEqual([pass.record, pass.actions], [settled, []], `${name}: the job writes nothing and says nothing more`)
  }
})

test('a record that waits on nothing, and an update that is still waiting on an open PR, are not held', () => {
  const merged = jobPasses(OPEN, [{ node: mergedNode('main'), now: NOW }]).at(-1).record
  assert.equal(ownerHeld(merged), null)
  assert.equal(runOf(merged).recent.length, 1, 'accepted')
  assert.equal(ownerHeld(UPDATE), null)
  assert.deepEqual(runOf(UPDATE).decisions.map(item => item.kind), ['private_review'], 'unchanged: an update waiting to be sent')
})

// ---- The exits and the checked write.
test('the exits a card offers are the ones the record’s state accepts', () => {
  assert.deepEqual(settleExits(strandedByJob()), ['COVERED_BY_MERGE', 'PRESERVE_AS_NEW', 'DISCARD_UPDATE'])
  assert.deepEqual(settleExits(orphanedByJob()), ['OWNER_RELANDS'])
  assert.deepEqual(settleExits(OPEN), [])
})

function versionedStore(files, { beforeWrite } = {}) {
  const versions = new Map(Object.keys(files).map(path => [path, 1]))
  const writes = []
  const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict', status: 412 })
  return { files, writes, storage: {
    getWithVersion: async path => ({ value: structuredClone(files[path] ?? null), version: path in files ? String(versions.get(path)) : null }),
    durableWrite: async (path, value, options) => {
      await beforeWrite?.(path, writes.length)
      if (options?.ifMatch !== String(versions.get(path))) throw conflict()
      files[path] = structuredClone(value); versions.set(path, versions.get(path) + 1); writes.push({ path, value })
    },
    change: (path, edit) => { files[path] = edit(structuredClone(files[path])); versions.set(path, versions.get(path) + 1) },
  } }
}
const useStorage = (t, files, options) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  const store = versionedStore(files, options)
  globalThis.window = { mobius: { online: true, storage: store.storage } }
  return store
}

test('an exit is one checked write of the outcome, the lifecycle and the status word it derives', async (t) => {
  const stranded = strandedByJob()
  const store = useStorage(t, { 'contributions/upd-1.json': stranded })
  const outcome = await settleHeld({ rec: { id: 'upd-1' }, exit: 'COVERED_BY_MERGE' })
  assert.equal(store.writes.length, 1)
  assert.deepEqual([outcome.ok.lifecycle.regions.update.state, outcome.ok.status, outcome.ok.update_outcome.exit, outcome.ok.needs_attention], ['NONE', 'merged', 'COVERED_BY_MERGE', false])
  assert.deepEqual(store.files['contributions/upd-1.json'], outcome.ok)
  assert.equal(ownerHeld(outcome.ok), null)
})

test('an exit the record no longer accepts is a conflict that carries the record, and writes nothing', async (t) => {
  const store = useStorage(t, { 'contributions/upd-1.json': strandedByJob() })
  assert.equal((await settleHeld({ rec: { id: 'upd-1' }, exit: 'DISCARD_UPDATE' })).ok.lifecycle.regions.update.state, 'NONE')
  const again = await settleHeld({ rec: { id: 'upd-1' }, exit: 'DISCARD_UPDATE' })
  assert.equal(again.conflict.id, 'upd-1', 'settled elsewhere: nothing to do twice')
  assert.equal(store.writes.length, 1)
  assert.equal((await settleHeld({ rec: { id: 'upd-1' }, exit: 'PRESERVE_AS_NEW' })).conflict.id, 'upd-1', 'a successor is needed')
})

test('a record that changed between the read and the write is settled on top of the other writer’s change', async (t) => {
  const store = useStorage(t, { 'contributions/upd-1.json': strandedByJob() }, { beforeWrite: (path, count) => { if (count === 0 && !store.raced) { store.raced = true; store.storage.change(path, record => ({ ...record, title: 'renamed' })) } } })
  const outcome = await settleHeld({ rec: { id: 'upd-1' }, exit: 'DISCARD_UPDATE' })
  assert.deepEqual([outcome.ok.update_outcome.exit, store.files['contributions/upd-1.json'].title], ['DISCARD_UPDATE', 'renamed'])
})

// ---- The card.
const cardRenderer = () => renderModule(`
  import React from 'react'
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ContributionDecision } from './ui/ContributionCard.jsx'
  export const decisionOf = (rec, props = {}) => renderToStaticMarkup(React.createElement(ContributionDecision, { rec, onFeedback: () => ({ ok: true }), ...props }))
`)

test('opening a stranded update offers Discard, and the exits that need no new record, beside the job’s own question', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { decisionOf } = await cardRenderer()
  const html = decisionOf(strandedByJob(), { onSettle: async () => ({}) })
  for (const word of ['The update can no longer go out', 'Already in the merge', 'Keep as new work', 'Discard']) assert.match(html, new RegExp(word), word)
  assert.doesNotMatch(html, /Land it again/, 'that exit is for a merge that never landed')
  const orphaned = decisionOf(orphanedByJob(), { onSettle: async () => ({}) })
  assert.match(orphaned, /Land it again/)
  assert.doesNotMatch(orphaned, /Discard|Already in the merge/)
})

test('without a way to save, the card offers no exit; a record that is not held offers none either', async (t) => {
  if (!frontendModules) { t.skip('MOBIUS_FRONTEND_NODE_MODULES is required for component rendering'); return }
  const { decisionOf } = await cardRenderer()
  assert.doesNotMatch(decisionOf(strandedByJob()), /Already in the merge/)
  assert.doesNotMatch(decisionOf({ ...OPEN, status: 'merged' }, { onSettle: async () => ({}) }), /Already in the merge|Land it again/)
})

// ---- The screens hand the exit to the checked write, and the Needs you row opens the record where the exits are.
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

test('the app saves an exit through the checked write and passes it to every card that can offer it', () => {
  assert.match(read('index.jsx'), /const onSettle = useCallback\(async \(rec, exit\) => \{\s*const outcome = await settleHeld\(\{ rec, exit \}\)/)
  assert.match(read('index.jsx'), /onRestore=\{onRestore\} onSettle=\{onSettle\}/)
  assert.match(read('ui/Feed.jsx'), /onWithdraw=\{onWithdraw\}\s*onSettle=\{onSettle\}/)
  assert.match(read('ui/ContributionCard.jsx'), /\{hasHeld \? <HeldAction rec=\{rec\} onSettle=\{onSettle\} onFeedback=\{onFeedback\} \/> : null\}/)
})

test('the exits that hand the work to a new record say exactly how the exit is recorded afterwards', () => {
  const card = read('ui/ContributionCard.jsx')
  assert.match(card, /const SETTLE_COMMAND = 'python3 \/data\/apps\/contribute\/settle_exit\.py'/)
  for (const exit of ['PRESERVE_AS_NEW', 'OWNER_RELANDS']) assert.match(card, new RegExp(`\\$\\{SETTLE_COMMAND\\} \\$\\{rec\\.id\\} ${exit} --successor <the new record id>`))
})
