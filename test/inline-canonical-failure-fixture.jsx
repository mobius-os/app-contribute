// Actual production session mount plus the exact host's presentation leaf.
// The browser runner supplies that read-only host export; no live shell/API.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { targetDrifts, targetCaseRecords } from './inline-target-cases.mjs'
import { InlineBlockSession } from '../ui/InlineBlockSession.jsx'
import { PullSnapshot, hostCSS } from '@fixture/inline-shell'

const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const ensure = (value, message) => { if (!value) throw Error(message) }
async function until(test, message) {
  const end = Date.now() + 4000
  while (!test()) { if (Date.now() > end) throw Error(message); await frame() }
}
const record = id => ({ id, type: 'pr', status: 'prepared', repo: 'team/repo',
  plan: { action: 'pr', repo: 'team/repo', head_sha: 'a'.repeat(40) },
  quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) }, updated_at: '2026-10-08T22:00:00Z' })
const failed = rec => ({ ...rec, updated_at: '2026-10-08T22:02:00Z', last_submit_error: 'Branch protection rejected this exact attempt' })
const reviews = records => ({ state: 'ready', byId: Object.fromEntries(records.map(rec => [rec.id, { state: 'ready' }])) })

export async function runInlineCanonicalFailureChecks() {
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
  const checks = [], originalPost = window.postMessage, originalRead = window.mobius.storage.getWithVersion
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  let state, present, update, reads = [], records, calls = 0, release, sent, holdRead = false, heldReads = []
  const actions = [{ key: 'chat-send:phase.1', label: 'Contribute' }, { key: 'chat-send-batch:phase.1,other.2', label: 'Contribute all' }]
  const key = actions[0].key
  const message = (event, target = key) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: window.location.origin,
    data: { type: 'moebius:app-block-action', sessionId: 'mounted-failure', key: target, nonce: crypto.randomUUID(), event } }))
  window.postMessage = next => { if (next.type === 'moebius:app-block-state') { state = next; present?.(next) } }
  window.mobius.storage.getWithVersion = async path => {
    reads.push(path)
    if (holdRead && records.some(rec => path === `contributions/${rec.id}.json`)) return new Promise(resolve => heldReads.push({ path, resolve }))
    return { value: records.find(rec => path === `contributions/${rec.id}.json`) || null, version: 'fixture' }
  }
  function Mount({ checkpoint = null }) {
    const [ledger, setLedger] = useState(records), [display, setDisplay] = useState(null)
    update = setLedger; present = setDisplay
    const action = display?.actions.find(action => action.key === key)
    return <><style>{hostCSS}</style><InlineBlockSession blockSession={{ sessionId: 'mounted-failure', actions, checkpoint, retain: !!checkpoint }}
      records={ledger} ledgerReady reviewStatus={reviews(ledger)}
      onSend={rec => { calls++; sent = rec; return new Promise(resolve => { release = resolve }) }} onSendStack={recs => { calls++; sent = recs; return new Promise(resolve => { release = resolve }) }} />
      {action && PullSnapshot ? <PullSnapshot block={{ title: 'Reviewed local change' }}
        pull={{ repo: 'team/repo', repoUrl: 'https://github.com/team/repo', state: 'proposed', number: null, files: null, labels: [], badges: [] }}
        href="#" open={event => event.preventDefault()} compact session={action}
        action={<button disabled={action.disabled} onClick={() => message('activate')}>{action.label}</button>} /> : null}</>
  }
  try {
    records = [record('phase.1'), record('other.2')]
    root.render(<Mount />)
    await until(() => state?.actions[0]?.status === 'Ready', 'Actual mounted exact reads did not become ready')
    message('activate'); await until(() => state.actions[0].confirming, 'Mounted activation did not freeze approval')
    message('confirm'); message('confirm')
    await until(() => calls === 1, 'Mounted confirmed handler did not start once')
    ensure(state.checkpoint, 'Mounted handler crossed boundary without checkpoint')
    records = [failed(records[0]), records[1]]; update([...records])
    // An overlapping activation is observation, never a second approval.
    message('activate', actions[1].key); message('confirm', actions[1].key)
    await until(() => state.actions[0].status === 'Needs attention', 'Held exact failure stayed Contributing/Checking')
    ensure(state.actions[0].disabled && state.retain, 'Failure released no-repeat ownership')
    ensure(container.textContent.includes('Branch protection rejected') && container.textContent.includes('Open Contribute'), 'Actual shell presentation lost canonical error/recovery')
    ensure(container.querySelector('button')?.disabled, 'Actual shell send button was unlocked')
    ensure(container.getBoundingClientRect().width <= innerWidth + 1, 'Failure presentation overflowed viewport')
    checks.push({ name: 'actual mounted held-response canonical failure and exact host attention presentation', status: 'pass' })
    release({ pending: true, record: record('phase.1') })
    await until(() => !state.actions[0].busy, 'Held handler did not finish')
    ensure(state.actions[0].status === 'Needs attention' && calls === 1, 'Stale handler replaced newer canonical failure')
    const checkpoint = state.checkpoint
    ensure(!checkpoint.data.includes('head_sha') && !checkpoint.data.includes('plan') && !checkpoint.data.includes('nonce'), 'Checkpoint transferred approval/publication arguments')
    root.render(null); await frame(); present = null
    root.render(<Mount checkpoint={checkpoint} />)
    await until(() => state.checkpointAck === checkpoint.id && reads.length > 2 && state.actions[0].status === 'Needs attention', 'Mounted cold reload lost failed attention')
    message('confirm'); message('activate'); message('confirm'); await frame()
    ensure(calls === 1 && state.actions[0].disabled && state.retain, 'Reloaded failure replayed approval')
    checks.push({ name: 'actual mounted failed checkpoint cold reload has no Confirm/nonce transfer or repeat handler', status: 'pass' })
    // A recovered failure cannot borrow a foreign repository's public receipt.
    root.render(null); await frame(); state = null; present = null
    records = [{ ...record('phase.1'), repo: 'elsewhere/repo', plan: { ...record('phase.1').plan, repo: 'elsewhere/repo' },
      status: 'open', number: 83, url: 'https://github.com/elsewhere/repo/pull/83', updated_at: '2026-10-08T22:03:00Z' }, record('other.2')]
    root.render(<Mount checkpoint={checkpoint} />)
    await until(() => state?.checkpointAck === checkpoint.id && reads.length > 4, 'Foreign cold public read did not finish'); await frame()
    const diagnostic = () => JSON.stringify({ retain: state.retain, checkpoint: state.checkpoint, links: state.actions[0].links, calls, text: container.textContent })
    ensure(state.retain && state.checkpoint, 'Foreign public target released frozen ownership: ' + diagnostic())
    ensure(!container.textContent.includes('View PR #83') && !state.actions[0].links.length && !state.summary.includes('sent'), 'Foreign publication claimed original settlement: ' + diagnostic())
    ensure(calls === 1, 'Cold public observation repeated Send')
    checks.push({ name: 'actual cold failed checkpoint rejects foreign PR83 repository receipt and header count', status: 'pass' })

    for (const item of [...targetDrifts,
      { name: 'repository drift', mutate: recs => { recs[0].plan.repo = 'elsewhere/repo' } },
      { name: 'head drift', mutate: recs => { recs[0].plan.head_sha = 'f'.repeat(40) } },
      { name: 'public parent version drift with suffix only', stack: true, suffix: true, mutate: recs => { recs[0].plan.head_sha = 'e'.repeat(40) } },
      { name: 'success newer context versus held stale read', race: true, mutate: recs => { recs[0].plan.base_branch = 'release' } },
      { name: 'success immutable hash-before-handler snapshot', hashRace: true, mutate: recs => { recs[0].plan.branch = 'foreign' } },
      { name: 'success pre-hash changed intent', preHash: true, mutate: recs => { recs[0].plan.branch = 'foreign' } },
      { name: 'timestamp-less live target still has success proof', noDate: true, mutate: recs => { recs[0].plan.branch = 'foreign' } }]) {
      root.render(null); await frame(); state = null; present = null; calls = 0
      const opened = (rec, number = rec.number || 83) => ({ ...rec, status: 'open', number, url: `https://github.com/${rec.plan.repo}/pull/${number}`, updated_at: '2026-10-08T22:03:00Z' })
      const original = targetCaseRecords(item)
      if (item.suffix) original[0] = opened(original[0], 11)
      if (item.noDate) delete original[0].updated_at
      records = structuredClone(original); root.render(<Mount />)
      await until(() => state?.actions[0]?.status === 'Ready', 'Success identity did not mount ready: ' + item.name)
      message('activate'); await until(() => state.actions[0].confirming, 'Success identity did not freeze: ' + item.name)
      if (item.preHash) { item.mutate(records); update([...records]); await frame() }
      const hashReleases = []
      if (item.hashRace) crypto.subtle.digest = (algorithm, bytes) => new Promise(resolve => hashReleases.push(() => originalDigest(algorithm, bytes).then(resolve)))
      message('confirm'); message('confirm')
      if (item.hashRace) {
        await until(() => hashReleases.length === original.length, 'Success baseline hash not held')
        item.mutate(records); update([...records]); crypto.subtle.digest = originalDigest; hashReleases.forEach(release => release())
      }
      await until(() => calls === 1, 'Success identity did not send once: ' + item.name)
      ensure((Array.isArray(sent) ? sent[0] : sent).plan.branch === original[0].plan.branch, 'Success handler adopted foreign intent')
      release({ pending: true }); await until(() => !state.actions[0].busy, 'Success handler did not finish')
      const frozenCheckpoint = state.checkpoint
      if (item.race) { holdRead = true; heldReads = []; message('activate'); await until(() => heldReads.length === original.length, 'Success old generation not held') }
      const changed = structuredClone(original); item.mutate(changed); records = changed.map(rec => ({...opened(rec), ...(item.name === 'PR update url drift' ? {url:rec.url} : {})}))
      const before = reads.length; holdRead = false; update([...records]); await frame(); message('activate')
      await until(() => reads.length >= before + original.length, 'Success foreign target did not read'); await frame(); await frame()
      if (item.race) { for (const held of heldReads) held.resolve({ value: opened(original.find(rec => held.path === `contributions/${rec.id}.json`), 7), version: 'stale' }); await frame() }
      ensure(state.retain && state.checkpoint && !state.actions[0].links.length && !state.summary.includes('sent'), 'Live foreign success attribution: ' + item.name)
      root.render(null); await frame(); state = null; present = null
      root.render(<Mount checkpoint={frozenCheckpoint} />)
      await until(() => state?.checkpointAck === frozenCheckpoint.id && state.actions[0].status, 'Success cold reload did not read'); await frame()
      ensure(state.retain && state.checkpoint && state.actions[0].disabled && !state.actions[0].links.length && !state.summary.includes('sent'), 'Cold foreign success attribution: ' + item.name)
      ensure(!container.textContent.includes('View PR #83'), 'Host presented foreign receipt: ' + item.name)
      message('confirm'); message('activate'); message('confirm'); await frame(); ensure(calls === 1, 'Foreign receipt replayed handler')
      records = original.map(rec => opened(rec, rec.number || 7)); update([...records]); await frame(); message('activate')
      await until(() => !state.retain && !state.checkpoint && state.actions[0].status === 'Open', 'Same-target receipt did not settle: ' + item.name)
      ensure(state.actions[0].links[0].url === records[0].url && container.textContent.includes('View PR #'), 'Exact host lost valid receipt: ' + item.name)
      ensure(state.summary.includes('sent') && calls === 1, 'Valid target settlement count or handler changed')
      checks.push({ name: 'actual mounted live/cold success identity and exact receipt control: ' + item.name, status: 'pass' })
    }
    for (const item of [...targetDrifts, { name: 'pre-hash changed frozen branch', preHash: true, mutate: records => { records[0].plan.branch = 'fix/different' } },
      { name: 'held old exact generation', race: true, mutate: records => { records[0].plan.base_branch = 'release' } },
      { name: 'held hash immutable baseline', hashRace: true, mutate: records => { records[0].plan.branch = 'fix/different' } }]) {
      root.render(null); await frame(); state = null; present = null; calls = 0; sent = null
      const original = targetCaseRecords(item); records = structuredClone(original)
      root.render(<Mount />)
      await until(() => state?.actions[0]?.status === 'Ready', 'Identity case did not mount ready: ' + item.name)
      message('activate'); await until(() => state.actions[0].confirming, 'Identity case did not confirm: ' + item.name)
      if (item.preHash) { records = structuredClone(original); item.mutate(records); update([...records]); await frame() }
      const hashReleases = []
      if (item.hashRace) crypto.subtle.digest = (algorithm, bytes) => new Promise(resolve => hashReleases.push(() => originalDigest(algorithm, bytes).then(resolve)))
      message('confirm'); message('confirm')
      if (item.hashRace) {
        await until(() => hashReleases.length === original.length, 'Baseline hash was not held')
        item.mutate(records); records[0].last_submit_error = 'Injected during hash'; records[0].updated_at = '2026-10-08T22:01:00Z'
        crypto.subtle.digest = originalDigest; hashReleases.forEach(release => release())
      }
      await until(() => calls === 1, 'Identity case did not call once: ' + item.name)
      ensure((Array.isArray(sent) ? sent[0] : sent).plan.branch === original[0].plan.branch, 'Handler borrowed changed intent before hash')
      if (item.hashRace) {
        const baseline = JSON.parse(state.checkpoint.data).phases[0].observations[0]
        ensure(baseline.error === '' && baseline.at === Date.parse(original[0].updated_at), 'Hash await rebound baseline metadata')
      }
      release({ pending: true }); await until(() => !state.actions[0].busy, 'Identity handler did not finish: ' + item.name)
      if (item.race) {
        holdRead = true; heldReads = []; message('activate')
        await until(() => heldReads.length === original.length, 'Old exact generation was not held')
      }
      records = structuredClone(original); item.mutate(records)
      records = records.map(rec => rec.id === original.at(-1).id ? { ...failed(rec), last_submit_error: 'Failure from different target' } : rec)
      const before = reads.length; holdRead = false; update([...records]); await frame(); message('activate')
      await until(() => reads.length >= before + original.length, 'Changed identity did not get exact reads: ' + item.name); await frame()
      if (item.race) {
        for (const held of heldReads) held.resolve({ value: failed(original.find(rec => held.path === `contributions/${rec.id}.json`)), version: 'old' })
        await frame()
      }
      ensure(state.actions[0].status === 'Checking result', 'Another target diagnosed original phase: ' + item.name)
      ensure(!state.actions[0].note.includes('Failure from different target'), 'Foreign failure prose leaked: ' + item.name)
      ensure(state.retain && state.actions[0].disabled && calls === 1, 'Identity drift released or repeated Send: ' + item.name)
      ensure(container.textContent.includes('Checking result') && !container.textContent.includes('Failure from different target'), 'Mounted shell misdiagnosed: ' + item.name)
      records = original.map(rec => rec.id === original.at(-1).id ? { ...failed(rec), updated_at: '2026-10-08T22:03:00Z' } : rec)
      update([...records]); await frame(); message('activate')
      await until(() => state.actions[0].status === 'Needs attention', 'Later correct exact failure was not diagnosed: ' + item.name)
      ensure(calls === 1 && state.retain && state.actions[0].disabled, 'Correct failure replayed Send')
      ensure(!state.checkpoint.data.includes('fix/original') && !state.checkpoint.data.includes('base_branch') && !state.checkpoint.data.includes('target_url'), 'Publication identity bytes crossed checkpoint')
      checks.push({ name: 'actual mounted full attempt identity: ' + item.name, status: 'pass' })
    }

  } finally {
    crypto.subtle.digest = originalDigest; root.unmount(); container.remove(); window.postMessage = originalPost; window.mobius.storage.getWithVersion = originalRead
  }
  return checks
}
