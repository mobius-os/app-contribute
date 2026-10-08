// Actual production session mount plus the exact host's presentation leaf.
// The browser runner supplies that read-only host export; no live shell/API.
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
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
  const checks = [], originalPost = window.postMessage, originalRead = window.mobius.storage.getWithVersion
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  let state, present, update, reads = [], records, calls = 0, release
  const actions = [{ key: 'chat-send:phase.1', label: 'Contribute' }, { key: 'chat-send-batch:phase.1,other.2', label: 'Contribute all' }]
  const key = actions[0].key
  const message = (event, target = key) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin: window.location.origin,
    data: { type: 'moebius:app-block-action', sessionId: 'mounted-failure', key: target, nonce: crypto.randomUUID(), event } }))
  window.postMessage = next => { if (next.type === 'moebius:app-block-state') { state = next; present?.(next) } }
  window.mobius.storage.getWithVersion = async path => {
    reads.push(path); return { value: records.find(rec => path === `contributions/${rec.id}.json`) || null, version: 'fixture' }
  }
  function Mount({ checkpoint = null }) {
    const [ledger, setLedger] = useState(records), [display, setDisplay] = useState(null)
    update = setLedger; present = setDisplay
    const action = display?.actions.find(action => action.key === key)
    return <><style>{hostCSS}</style><InlineBlockSession blockSession={{ sessionId: 'mounted-failure', actions, checkpoint, retain: !!checkpoint }}
      records={ledger} ledgerReady reviewStatus={reviews(ledger)}
      onSend={() => { calls++; return new Promise(resolve => { release = resolve }) }} onSendStack={() => { throw Error('unexpected stack') }} />
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
  } finally {
    root.unmount(); container.remove(); window.postMessage = originalPost; window.mobius.storage.getWithVersion = originalRead
  }
  return checks
}
