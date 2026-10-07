// Source-attributed chat-block session. Hydration is read-only; only a
// confirmed frozen approval reaches Contribute's existing guarded handlers.
import { contributeBlockTarget } from './chat-blocks.js'
import { qualityReviewFor, reviewStateFor } from './review.js'
import { stackMeta, sortStackRecords, stackPublicationRecords, stackReadiness } from './stack.js'

const copy = value => JSON.parse(JSON.stringify(value))
const githubPull = record => {
  const repo = record?.plan?.repo || record?.repo || ''
  const number = Number(record?.number)
  const url = record?.url
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && Number.isSafeInteger(number) && number > 0 &&
    url === `https://github.com/${repo}/pull/${number}` ? { label: `View PR #${number}`, url } : null
}
const settled = record => ['draft', 'open', 'landing', 'merged', 'closed'].includes(record?.status) && githubPull(record)
const blocker = (record, reviewStatus) => {
  if (!record) return 'Reading this contribution…'
  if (record.status !== 'prepared') return record.status === 'abandoned' ? 'This contribution was dismissed.' : 'This contribution is not ready to send.'
  if (!['pr', 'pr_update'].includes(record.plan?.action)) return 'Only pull requests can be sent here.'
  if (record.needs_attention || reviewStateFor(record, reviewStatus)?.state === 'needs_refresh') return 'The reviewed source changed. Refresh it in Contribute.'
  if (record.last_submit_error) return 'The last send needs attention in Contribute.'
  if (qualityReviewFor(record).state !== 'all_clear') return 'This exact version needs review first.'
  return ''
}
const bounded = value => String(value || '').slice(0, 500)

export function createInlineSession({ sessionId, actions, publish, loadExact, send, sendStack, refresh }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  const byId = new Map()
  const exactRead = new Set()
  const attempted = new Set()
  const busyUnits = new Set()
  const results = new Map()
  let ledger = []
  let ledgerReady = false
  let reviewStatus = null
  let confirming = null
  let requestedActivation = null
  let frozen = null
  let notice = ''
  let alive = true
  const idsFor = key => {
    const target = contributeBlockTarget(key)
    return target?.kind === 'prepared' ? [target.id] : target?.kind === 'batch' ? target.ids : []
  }
  const ids = [...new Set(advertised.flatMap(item => idsFor(item.key)))]
  const records = () => [...new Map([...ledger, ...byId.values()].filter(Boolean).map(rec => [rec.id, rec])).values()]
  const unitFor = id => {
    const record = byId.get(id) || ledger.find(rec => rec.id === id)
    if (!record) return { id, key: `record:${id}`, records: [], ready: [], loading: !exactRead.has(id) || !ledgerReady,
      reason: exactRead.has(id) && ledgerReady ? 'This contribution is no longer in Contribute.' : 'Reading this contribution…' }
    const meta = stackMeta(record)
    if (!meta) {
      const reason = settled(record) ? '' : blocker(record, reviewStatus)
      return { id, key: `record:${id}`, records: [record], ready: !reason && record.status === 'prepared' ? [record] : [], reason }
    }
    const members = sortStackRecords(records().filter(rec => stackMeta(rec)?.id === meta.id))
    const unit = { type: 'stack', records: members, total: meta.total }
    const state = stackReadiness(unit)
    const loading = !ledgerReady && state.code === 'incomplete'
    const reason = !state.ok ? (state.code === 'settled' ? '' : loading ? 'Loading the linked changes…' : state.message)
      : stackPublicationRecords(unit).map(rec => blocker(rec, reviewStatus)).find(Boolean) || ''
    return { id, key: `stack:${meta.id}`, records: members, ready: reason ? [] : stackPublicationRecords(unit), stack: true, reason, loading }
  }
  // A batch may name two layers of one chain. It still has one publication unit.
  const unitsFor = key => [...new Map(idsFor(key).map(id => { const unit = unitFor(id); return [unit.key, unit] })).values()]
  // A new phase of one stack is a new approval; an ambiguous phase remains
  // locked, while a reviewed suffix can receive its own explicit confirmation.
  const phaseKey = unit => JSON.stringify([unit.key, unit.ready.map(rec => [rec.id, rec.plan?.action, rec.plan?.head_sha])])
  const reconciled = phaseIds => phaseIds.length > 0 && phaseIds.every(id => settled(byId.get(id)))
  const reconcileResults = () => {
    for (const [key, result] of results) if (reconciled(result.phaseIds)) results.delete(key)
  }
  const authoritative = key => ledgerReady && idsFor(key).every(id => exactRead.has(id))
  const makeAction = item => {
    const units = unitsFor(item.key)
    const ready = units.filter(unit => unit.ready.length && !attempted.has(phaseKey(unit)))
    const links = [...new Map(units.flatMap(unit => unit.records.map(settled).filter(Boolean)).map(link => [link.url, link])).values()].slice(0, 12)
    const loading = !authoritative(item.key) || units.some(unit => unit.loading)
    const reason = units.map(unit => unit.reason).find(Boolean)
    const unitBusy = units.some(unit => busyUnits.has(unit.key))
    const anyBusy = busyUnits.size > 0
    const failures = [...results.values()].filter(result => units.some(unit => unit.key === result.unitKey))
    const failure = failures.find(result => result.tone === 'danger')
    const checking = failures.some(result => result.state === 'pending') || units.some(unit => unit.records.some(rec => rec.status === 'submitting'))
    const status = unitBusy ? 'Contributing' : failure ? 'Needs attention' : checking ? 'Checking result'
      : ready.length ? 'Ready' : loading ? 'Loading' : reason ? 'Needs attention' : links.length ? 'Sent' : ''
    const note = failure?.note || failures.find(result => result.state === 'pending')?.note ||
      (!ready.length ? reason || (loading ? 'Reading this contribution…' : links.length ? 'Contribution settled.' : 'Nothing is ready to contribute.') : reason || '')
    return {
      key: item.key,
      label: item.label || 'Contribute',
      disabled: confirming === item.key ? anyBusy : !ready.length || anyBusy || checking || Boolean(confirming),
      busy: unitBusy,
      confirming: confirming === item.key,
      hidden: !ready.length && !unitBusy && confirming !== item.key,
      note: bounded(note),
      tone: failure ? 'danger' : checking || reason && !loading ? 'attention' : 'neutral',
      status,
      statusTone: failure ? 'danger' : checking || reason && !loading ? 'attention' : status === 'Sent' ? 'success' : 'neutral',
      links,
    }
  }
  const emit = () => { if (alive) publish({ type: 'moebius:app-block-state', sessionId, actions: advertised.map(makeAction), notice }) }
  async function hydrate() {
    await Promise.all(ids.map(async id => {
      try {
        const rec = await loadExact(id)
        if (rec?.id === id && (!byId.has(id) || String(rec.updated_at || '') >= String(byId.get(id).updated_at || ''))) byId.set(id, rec)
      } catch { /* keep read-only uncertainty visible */ }
      exactRead.add(id)
      reconcileResults(); fulfillRequestedActivation(); emit()
    }))
  }
  function updateLedger(next, ready, reviews) {
    ledger = Array.isArray(next) ? next : []
    ledgerReady = Boolean(ready)
    reviewStatus = reviews
    for (const rec of ledger) if (rec?.id && (!byId.has(rec.id) || String(rec.updated_at || '') >= String(byId.get(rec.id).updated_at || ''))) byId.set(rec.id, rec)
    reconcileResults(); fulfillRequestedActivation(); emit()
  }
  function freezeActivation(key) {
    const ready = unitsFor(key).filter(unit => unit.ready.length && !attempted.has(phaseKey(unit)))
    if (!ready.length) return false
    frozen = { key, units: copy(ready) }
    confirming = key
    notice = `Contribute ${ready.length} ${ready.length === 1 ? 'change' : 'changes'} publicly from your GitHub account? Nothing merges.`
    return true
  }
  function fulfillRequestedActivation() {
    const key = requestedActivation
    if (!key || !authoritative(key) || busyUnits.size || confirming) return
    requestedActivation = null
    freezeActivation(key)
  }
  function activate(key) {
    if (busyUnits.size || !advertised.some(item => item.key === key)) return
    if (confirming && confirming !== key) { confirming = null; frozen = null; notice = '' }
    else if (confirming) return
    requestedActivation = null
    if (!authoritative(key)) requestedActivation = key
    else freezeActivation(key)
    emit()
  }
  function cancel(key) {
    if (busyUnits.size || key !== confirming && key !== requestedActivation) return
    requestedActivation = null; confirming = null; frozen = null; notice = ''; emit()
  }
  async function confirm(key) {
    if (busyUnits.size || confirming !== key || frozen?.key !== key || !frozen.units.length) return
    const approval = frozen
    if (approval.units.some(unit => attempted.has(phaseKey(unit)))) return
    approval.units.forEach(unit => { attempted.add(phaseKey(unit)); busyUnits.add(unit.key) })
    confirming = null; notice = ''; emit()
    await Promise.all(approval.units.map(async unit => {
      let outcome
      try { outcome = (unit.stack ? await sendStack(unit.records) : await send(unit.records[0])) || {} }
      catch { outcome = { uncertain: true } }
      for (const rec of [outcome.record, ...(outcome.records || []), ...(Array.isArray(outcome.ok) ? outcome.ok : [])]) {
        if (rec?.id) byId.set(rec.id, rec)
      }
      const resultKey = phaseKey(unit)
      const resultBase = { unitKey: unit.key, phaseIds: unit.ready.map(rec => rec.id) }
      if (outcome.pending) results.set(resultKey, { ...resultBase, state: 'pending', note: 'Checking the contribution result. Do not retry yet.', tone: 'attention' })
      else if (outcome.uncertain || outcome.failure?.owner === 'automatic' && !outcome.ok) results.set(resultKey, { ...resultBase, state: 'pending', note: 'The result could not be confirmed. Check Contribute before trying again.', tone: 'attention' })
      else if (!outcome.ok && !outcome.alreadyHandled) results.set(resultKey, { ...resultBase, state: 'failed', note: outcome.error || 'Some changes were not sent. Check Contribute for the remainder.', tone: 'danger' })
      else results.set(resultKey, { ...resultBase, state: 'pending', note: 'Checking the saved result before marking this sent.', tone: 'attention' })
      // Stack handlers return counts on success; canonical records provide links.
      await Promise.all(unit.records.map(async approved => {
        try {
          const rec = await loadExact(approved.id)
          if (rec?.id === approved.id && !(settled(byId.get(rec.id)) && !settled(rec))) byId.set(rec.id, rec)
        } catch { /* result remains uncertain */ }
      }))
      if (reconciled(resultBase.phaseIds)) results.delete(resultKey)
      busyUnits.delete(unit.key)
      emit() // each row settles before slower siblings
    }))
    try { await refresh?.() } catch { /* read-only refresh failure keeps result visible */ }
    frozen = null; reconcileResults(); emit()
  }
  return { sessionId, hydrate, updateLedger, activate, cancel, confirm, emit, dispose: () => { alive = false } }
}
