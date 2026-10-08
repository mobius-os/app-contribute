// Source-attributed chat-block session. Hydration is read-only; only a
// confirmed frozen approval reaches Contribute's existing guarded handlers.
import { contributeBlockTarget, validContributeRecordId } from './chat-blocks.js'
import { qualityReviewFor, reviewStateFor } from './review.js'
import { publicationStackUnit, stackIntent, stackPublicationRecords, stackReadiness } from './stack.js'

const copy = value => JSON.parse(JSON.stringify(value))
export const githubPull = record => {
  const repo = record?.plan?.repo || record?.repo || ''
  const number = Number(record?.number)
  const url = record?.url
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) && Number.isSafeInteger(number) && number > 0 &&
    url === `https://github.com/${repo}/pull/${number}` ? { label: `View PR #${number}`, url } : null
}
export const settled = record => ['draft', 'open', 'landing', 'merged', 'closed'].includes(record?.status) && githubPull(record)
export const publicationPhaseKey = unit => JSON.stringify([unit.key, unit.ready.map(rec => [rec.id, rec.plan?.action, rec.plan?.head_sha])])
export function publicationPhaseResult(phase, fresh, outcome = {}) {
  if (phase.length && phase.every(member => settled(fresh.find(record => record?.id === member.id)))) return { state: 'sent' }
  if (outcome.pending || outcome.ok || outcome.alreadyHandled || outcome.failure?.owner === 'automatic') return { state: 'checking' }
  return { state: 'failed', note: outcome.error || 'Could not confirm the result. Check Contribute before trying again.' }
}
export const pendingPhaseBlocks = (progress, item, records) => Object.values(progress).some(result => result.unitKey === item.unitKey &&
  result.state === 'checking' && result.phaseIds.some(id => item.phase.some(record => record.id === id)) &&
  !result.phaseIds.every(id => settled(records.find(record => record.id === id))))
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
// Present exactly the copied current publication phase, never a saved block's
// title/repository or a mutable ledger projection after confirmation starts.
const publicationIdentity = record => {
  const plan = record.plan || {}
  const facts = [{ label: 'Repository', value: plan.repo || record.repo },
    { label: 'Action', value: plan.action === 'pr_update'
      ? `Update pull request${record.number ? ` #${record.number}` : ''}` : 'Open pull request' }]
  for (const [label, value] of [['Branch', plan.branch], ['Target', plan.stack?.base_branch || plan.base_branch],
    ['Version', plan.head_sha], ['Reviewed diff', plan.diff_sha256]]) if (value) facts.push({ label, value })
  return { title: plan.title || record.title || record.summary || record.id, facts }
}
const currentReviewBlocker = (record, reviewStatus) => reviewStateFor(record, reviewStatus)?.state === 'ready'
  ? '' : 'This contribution still needs a current source check in Contribute.'

// This is observational ownership, not a saved approval. No record contents,
// frozen confirmation, action nonce, or publication arguments cross reloads.
const CHECKPOINT_BYTES = 32768
const checkpointId = value => typeof value === 'string' && value.length > 0 && value.length <= 128
function checkpointPhases(checkpoint) {
  if (!checkpointId(checkpoint?.id) || typeof checkpoint.data !== 'string'
    || new TextEncoder().encode(checkpoint.data).length > CHECKPOINT_BYTES) throw new Error('Invalid recovery checkpoint')
  const value = JSON.parse(checkpoint.data)
  if (value?.version !== 1 || !Array.isArray(value.phases) || !value.phases.length || value.phases.length > 256) throw new Error('Invalid recovery phases')
  const seen = new Set()
  for (const phase of value.phases) {
    if (typeof phase?.unitKey !== 'string' || !/^(record|stack):./.test(phase.unitKey) || phase.unitKey.length > 512
      || seen.has(phase.unitKey) || !Array.isArray(phase.phaseIds) || !phase.phaseIds.length || phase.phaseIds.length > 256
      || phase.phaseIds.some(id => !validContributeRecordId(id)) || new Set(phase.phaseIds).size !== phase.phaseIds.length
      || !['pending', 'failed'].includes(phase.state) || typeof phase.note !== 'string' || phase.note.length > 500) throw new Error('Invalid recovery phase')
    seen.add(phase.unitKey)
  }
  return value.phases.map(({ unitKey, phaseIds, state, note }) => ({ unitKey, phaseIds, state, note }))
}

export function createInlineSession({ sessionId, actions, checkpoint = null, retain = false, recoveryError: incomingRecoveryError = false, publish, loadExact, send, sendStack, refresh }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  const byId = new Map()
  const exactRead = new Set()
  const readFinished = new Set()
  const displayRead = new Set()
  const pendingRead = new Set()
  const readGeneration = new Map()
  const attempted = new Set()
  const busyUnits = new Set()
  const results = new Map()
  let ledger = []
  let ledgerReady = false
  let reviewStatus = null
  let confirming = null
  let requestedActivation = null
  let frozen = null
  let alive = true
  let lastSummary = ''
  let ackNonce = null
  let recoveryError = ''
  let checkpointAck = checkpointId(checkpoint?.id) ? checkpoint.id : null
  let lastCheckpoint = null
  const recoveryIds = new Set()
  try {
    if (incomingRecoveryError || retain && !checkpoint) throw new Error('Recovery ownership has no checkpoint')
    if (checkpoint) {
      for (const [index, phase] of checkpointPhases(checkpoint).entries()) {
        results.set('recovery:' + index, { ...phase, recovered: true, tone: phase.state === 'failed' ? 'danger' : 'attention' })
        phase.phaseIds.forEach(id => recoveryIds.add(id))
      }
      lastCheckpoint = { id: checkpoint.id, data: checkpoint.data }
    }
  } catch {
    recoveryError = 'The previous contribution result could not be restored. Open Contribute to check it; nothing will be sent from this block.'
  }
  const idsFor = key => {
    const target = contributeBlockTarget(key)
    return target?.kind === 'prepared' ? [target.id] : target?.kind === 'batch' ? target.ids : []
  }
  const ids = [...new Set([...advertised.flatMap(item => idsFor(item.key)), ...recoveryIds])]
  const hasBatch = advertised.some(item => contributeBlockTarget(item.key)?.kind === 'batch')
  const records = () => [...new Map([...ledger, ...byId.values()].filter(Boolean).map(rec => [rec.id, rec])).values()]
  const unitFor = id => {
    const record = byId.get(id) || ledger.find(rec => rec.id === id)
    if (!record) return { id, key: `record:${id}`, records: [], ready: [], loading: !exactRead.has(id) || !ledgerReady,
      reason: exactRead.has(id) && ledgerReady ? 'This contribution is no longer in Contribute.' : 'Reading this contribution…' }
    // A fresh exact read proves the record's content, not that it belongs to
    // the complete current ledger. Removed work cannot borrow its old review.
    const inLedger = member => ledger.some(current => current.id === member.id)
    const intent = stackIntent(record)
    if (intent.kind === 'standalone') {
      const reason = settled(record) ? '' : ledgerReady && !inLedger(record)
        ? 'This contribution is no longer in Contribute.' : blocker(record, reviewStatus) || (ledgerReady ? currentReviewBlocker(record, reviewStatus) : '')
      return { id, key: `record:${id}`, records: [record], ready: !reason && record.status === 'prepared' ? [record] : [], reason }
    }
    const unit = publicationStackUnit(record, records())
    const members = unit.records
    const state = stackReadiness(unit)
    const loading = !ledgerReady && state.code === 'incomplete'
    const reason = ledgerReady && members.some(member => !inLedger(member))
      ? 'The linked changes are no longer in Contribute.'
      : !state.ok ? (state.code === 'settled' ? '' : loading ? 'Loading the linked changes…' : state.message)
      : stackPublicationRecords(unit).map(rec => blocker(rec, reviewStatus) || (ledgerReady ? currentReviewBlocker(rec, reviewStatus) : '')).find(Boolean) || ''
    return { id, key: `stack:${unit.id}`, records: members, ready: reason ? [] : stackPublicationRecords(unit), stack: true, reason, loading }
  }
  // A batch may name two layers of one chain. It still has one publication unit.
  const unitsFor = key => [...new Map(idsFor(key).map(id => { const unit = unitFor(id); return [unit.key, unit] })).values()]
  // A new phase of one stack is a new approval; an ambiguous phase remains
  // locked, while a reviewed suffix can receive its own explicit confirmation.
  const phaseKey = publicationPhaseKey
  const reconciled = phaseIds => phaseIds.length > 0 && phaseIds.every(id => settled(byId.get(id))
    && (exactRead.has(id) || ledgerReady && ledger.some(record => record.id === id && settled(record))))
  // An uncertain prefix cannot become a newly approved suffix on reload or
  // restaging. Lock the owning unit AND the attempted record identities.
  const pendingUnit = unit => [...results.values()].some(result => (result.state === 'pending' || result.recovered)
    && (result.unitKey === unit.key || result.phaseIds.some(id => unit.records.some(record => record.id === id))))
  const reconcileResults = () => {
    for (const [key, result] of results) if (!busyUnits.has(result.unitKey) && reconciled(result.phaseIds)) results.delete(key)
  }
  const authoritative = key => ledgerReady && !['loading', 'unavailable'].includes(reviewStatus?.state) && idsFor(key).every(id => exactRead.has(id))
  const makeAction = item => {
    const units = unitsFor(item.key)
    const ready = authoritative(item.key) ? units.filter(unit => unit.ready.length && !attempted.has(phaseKey(unit)) && !pendingUnit(unit)) : []
    // Display identities are not publication units. A row links its own PR;
    // confirmation still freezes the complete parent-first stack below.
    const addressed = idsFor(item.key)
    const focused = addressed.map(id => byId.get(id) || ledger.find(rec => rec.id === id)).filter(Boolean)
    const links = [...new Map(focused.map(settled).filter(Boolean).map(link => [link.url, link])).values()]
    const readComplete = addressed.length > 0 && addressed.every(id => readFinished.has(id))
    const focusedResolved = readComplete && addressed.every(id => exactRead.has(id) || pendingRead.has(id) && displayRead.has(id)) && focused.length === addressed.length
    const publicResolved = focusedResolved && focused.every(settled)
    const reviewUnavailable = reviewStatus?.state === 'unavailable'
    const isBatch = contributeBlockTarget(item.key)?.kind === 'batch'
    // This first tap starts authoritative checks; it is not Send approval.
    const canActivate = !recoveryError && !units.some(pendingUnit) && !authoritative(item.key) && focusedResolved && focused.every(rec => rec.status === 'prepared' && stackIntent(rec).kind !== 'invalid' && !blocker(rec, reviewStatus))
    const publicStatus = focused.length === 1
      ? ({ draft: 'Draft', open: 'Open', landing: 'Open', merged: 'Merged', closed: 'Closed' }[focused[0].status] || 'Sent')
      : 'Sent'
    const checkingAuthority = requestedActivation === item.key && !authoritative(item.key) && !reviewUnavailable
    const loading = !readComplete || checkingAuthority
    const focusedReason = readComplete && !focusedResolved ? 'Could not read this contribution. Open it in Contribute to check its current state.'
      : focused.map(rec => !settled(rec) && blocker(rec, reviewStatus)).find(Boolean)
    const reason = reviewUnavailable && !publicResolved
      ? isBatch || !hasBatch ? 'Could not verify the current review. Retry check; nothing was sent.' : focusedReason || ''
      : focusedReason || (!ledgerReady && !checkingAuthority ? '' : units.map(unit => unit.reason).find(Boolean))
    const unitBusy = units.some(unit => busyUnits.has(unit.key))
    const anyBusy = busyUnits.size > 0
    const failures = [...results.values()].filter(result => units.some(unit => unit.key === result.unitKey || result.phaseIds.some(id => unit.records.some(rec => rec.id === id))) || result.phaseIds.some(id => addressed.includes(id)))
    const failure = failures.find(result => result.tone === 'danger')
    const checking = failures.some(result => result.state === 'pending') || units.some(unit => unit.records.some(rec => rec.status === 'submitting'))
    const status = recoveryError ? 'Needs attention' : unitBusy ? 'Contributing' : failure ? 'Needs attention' : checking ? 'Checking result'
      : checkingAuthority ? 'Checking' : ready.length ? 'Ready' : publicResolved ? publicStatus : reviewUnavailable && canActivate ? 'Check unavailable' : canActivate ? 'Prepared' : loading ? 'Loading' : reason ? 'Needs attention' : ''
    const note = recoveryError || failure?.note || failures.find(result => result.state === 'pending')?.note ||
      (!ledgerReady && (publicResolved || canActivate) ? '' : checkingAuthority ? '' : reviewUnavailable && hasBatch && !isBatch && canActivate ? '' : reason) ||
      (!loading && !anyBusy && !links.length && !ready.length && !canActivate ? 'Nothing is ready to contribute.' : '')
    const quality = focused.length === 1 && focusedResolved && focused[0].status === 'prepared'
      ? qualityReviewFor(focused[0]) : null
    return {
      key: item.key,
      label: checkingAuthority ? 'Checking…' : reviewUnavailable && canActivate ? 'Retry check' : unitBusy ? 'Contributing…' : item.label || 'Contribute',
      disabled: recoveryError ? true : confirming === item.key ? anyBusy : !ready.length && !canActivate || anyBusy || checking || checkingAuthority || Boolean(confirming),
      busy: unitBusy,
      confirming: confirming === item.key,
      confirmation: confirming === item.key && frozen?.key === item.key
        ? frozen.units.flatMap(unit => unit.ready.map(publicationIdentity)) : null,
      hidden: !recoveryError && !failures.length && !ready.length && !canActivate && !unitBusy && confirming !== item.key,
      note: bounded(note),
      tone: failure ? 'danger' : checking || reason && !loading ? 'attention' : 'neutral',
      status,
      statusTone: failure ? 'danger' : checking || reason && !loading ? 'attention' : status === 'Sent' ? 'success' : 'neutral',
      links,
      badges: quality?.state === 'all_clear' ? [{ label: 'All clear', tone: 'success' }]
        : quality?.state === 'changes_needed' ? [{ label: 'Changes needed', tone: 'attention' }] : [],
    }
  }
  const summary = actions => {
    const batch = advertised.find(item => contributeBlockTarget(item.key)?.kind === 'batch')
    if (!batch) return ''
    const addressed = idsFor(batch.key)
    if (!addressed.length || !addressed.every(id => readFinished.has(id)) || addressed.some(id => pendingRead.has(id))) return lastSummary || `${addressed.length} contributions`
    const found = addressed.map(id => exactRead.has(id) ? byId.get(id) || ledger.find(rec => rec.id === id) : null)
    const publicCount = found.filter(settled).length
    const preparedCount = found.filter(rec => rec?.status === 'prepared').length
    const missingCount = addressed.length - found.filter(Boolean).length
    lastSummary = reviewStatus?.state === 'unavailable' && preparedCount
      ? `${preparedCount} prepared · Current review unavailable`
      : actions.find(action => action.key === batch.key)?.busy
        ? `${publicCount ? `${publicCount} sent · ` : ''}${preparedCount} contributing`
        : publicCount && !preparedCount && !missingCount ? `${publicCount} sent`
          : publicCount ? `${publicCount} sent · ${preparedCount} prepared${missingCount ? ` · ${missingCount} unavailable` : ''}`
            : preparedCount ? `${preparedCount} prepared${missingCount ? ` · ${missingCount} unavailable` : ''}`
              : missingCount ? `${missingCount} unavailable` : ''
    return lastSummary
  }
  const ownershipCheckpoint = () => {
    if (recoveryError) return lastCheckpoint
    const units = new Map()
    for (const result of results.values()) {
      const previous = units.get(result.unitKey)
      units.set(result.unitKey, { unitKey: result.unitKey,
        phaseIds: [...new Set([...(previous?.phaseIds || []), ...result.phaseIds])],
        state: previous?.state === 'pending' || result.state === 'pending' ? 'pending' : 'failed',
        note: bounded(result.note) })
    }
    const phases = [...units.values()]
    if (!phases.length) {
      if (lastCheckpoint) checkpointAck = lastCheckpoint.id
      lastCheckpoint = null
      return null
    }
    const data = JSON.stringify({ version: 1, phases })
    try { checkpointPhases({ id: 'candidate', data }) } catch {
      recoveryError = 'The contribution recovery checkpoint is invalid or too large. Open Contribute to check this work; nothing will be sent from this block.'
      return lastCheckpoint
    }
    if (lastCheckpoint?.data !== data) {
      if (lastCheckpoint) checkpointAck = lastCheckpoint.id
      lastCheckpoint = { id: crypto.randomUUID(), data }
    }
    return lastCheckpoint
  }
  const emit = () => { if (alive) {
    const checkpoint = ownershipCheckpoint()
    const actions = advertised.map(makeAction)
    const retain = Boolean(recoveryError || checkpoint || confirming || requestedActivation || busyUnits.size || results.size
      || advertised.some(item => unitsFor(item.key).some(unit => unit.records.some(rec => rec.status === 'submitting'))))
    publish({ type: 'moebius:app-block-state', sessionId, actions, notice: '', summary: summary(actions), retain, ackNonce,
      checkpoint, checkpointAck, recoveryError: Boolean(recoveryError) })
  } }
  async function hydrate(wanted = ids) {
    await Promise.all(wanted.map(async id => {
      const generation = (readGeneration.get(id) || 0) + 1
      readGeneration.set(id, generation)
      pendingRead.add(id)
      try {
        const rec = await loadExact(id)
        if (!alive || readGeneration.get(id) !== generation) return
        if (rec?.id === id) {
          exactRead.add(id)
          displayRead.add(id)
          if (!byId.has(id) || String(rec.updated_at || '') >= String(byId.get(id).updated_at || '')) byId.set(id, rec)
        }
      } catch { /* keep read-only uncertainty visible */ }
      if (!alive || readGeneration.get(id) !== generation) return
      pendingRead.delete(id)
      readFinished.add(id)
      reconcileResults(); fulfillRequestedActivation(); emit()
    }))
  }
  function updateLedger(next, ready, reviews) {
    ledger = Array.isArray(next) ? next : []
    ledgerReady = Boolean(ready)
    reviewStatus = reviews
    if (reviews?.state === 'unavailable') requestedActivation = null
    for (const rec of ledger) if (rec?.id && (!byId.has(rec.id) || String(rec.updated_at || '') >= String(byId.get(rec.id).updated_at || ''))) byId.set(rec.id, rec)
    reconcileResults(); fulfillRequestedActivation(); emit()
  }
  function freezeActivation(key) {
    const ready = unitsFor(key).filter(unit => unit.ready.length && !attempted.has(phaseKey(unit)) && !pendingUnit(unit))
    if (!ready.length) return false
    frozen = { key, units: copy(ready) }
    confirming = key
    return true
  }
  function fulfillRequestedActivation() {
    const key = requestedActivation
    if (key && idsFor(key).some(id => readFinished.has(id) && !exactRead.has(id) && !pendingRead.has(id))) {
      requestedActivation = null
      return
    }
    if (!key || !authoritative(key) || busyUnits.size || confirming) return
    requestedActivation = null
    freezeActivation(key)
  }
  function activate(key) {
    if (!advertised.some(item => item.key === key)) return
    if (recoveryError || unitsFor(key).some(pendingUnit)) {
      void hydrate(ids)
      emit()
      return
    }
    if (busyUnits.size || !advertised.some(item => item.key === key)) return
    if (confirming && confirming !== key) { confirming = null; frozen = null }
    else if (confirming) return
    requestedActivation = null
    if (!authoritative(key)) requestedActivation = key
    else freezeActivation(key)
    if (!authoritative(key) || reviewStatus?.state === 'unavailable') {
      for (const id of idsFor(key)) exactRead.delete(id)
      void hydrate(idsFor(key))
    }
    emit()
  }
  function cancel(key) {
    if (busyUnits.size || key !== confirming && key !== requestedActivation) return
    requestedActivation = null; confirming = null; frozen = null; emit()
  }
  async function confirm(key) {
    if (recoveryError || busyUnits.size || confirming !== key || frozen?.key !== key || !frozen.units.length) return
    const approval = frozen
    if (approval.units.some(unit => attempted.has(phaseKey(unit)) || pendingUnit(unit))) return
    approval.units.forEach(unit => { attempted.add(phaseKey(unit)); busyUnits.add(unit.key) })
    // Publish the checkpoint before crossing the public handler boundary,
    // including the synchronous gap before any awaited response can arrive.
    approval.units.forEach(unit => results.set(phaseKey(unit), {
      unitKey: unit.key, phaseIds: unit.ready.map(rec => rec.id), state: 'pending', note: '', tone: 'attention',
    }))
    confirming = null; emit()
    if (recoveryError) { busyUnits.clear(); frozen = null; emit(); return }
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
          if (rec?.id === approved.id) {
            exactRead.add(rec.id)
            if (!(settled(byId.get(rec.id)) && !settled(rec))) byId.set(rec.id, rec)
          }
        } catch { /* result remains uncertain */ }
      }))
      if (reconciled(resultBase.phaseIds)) results.delete(resultKey)
      busyUnits.delete(unit.key)
      emit() // each row settles before slower siblings
    }))
    try { await refresh?.() } catch { /* read-only refresh failure keeps result visible */ }
    frozen = null; reconcileResults(); emit()
  }
  function handleEvent(event) {
    if (!advertised.some(item => item.key === event?.key)
      || !['activate', 'cancel', 'confirm'].includes(event.event)
      || typeof event.nonce !== 'string' || !event.nonce || event.nonce.length > 128) return false
    if (event.nonce !== ackNonce) {
      ackNonce = event.nonce
      if (event.event === 'activate') activate(event.key)
      else if (event.event === 'cancel') cancel(event.key)
      else void confirm(event.key)
    }
    emit()
    return true
  }
  return { sessionId, hydrate, updateLedger, activate, cancel, confirm, handleEvent, emit, dispose: () => { alive = false } }
}
