// Source-attributed chat-block session. Hydration is read-only; only a
// confirmed frozen approval reaches Contribute's existing guarded handlers.
import { contributeBlockTarget, validContributeRecordId } from './chat-blocks.js'
import { contributionApprovalFingerprint, qualityReviewFor, reviewStateFor } from './review.js'
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
// Historical results use the same full-plan target projection as the durable
// session. The complete copied chain is evidence; today's plan cannot fill it.
export function publicationContextMatches(context, records) {
  return Array.isArray(context) && context.length > 0 && Array.isArray(records)
    && context.every(before => validContributeRecordId(before?.id) && ['pr', 'pr_update'].includes(before.plan?.action))
    && context.every(before => {
    const matches = records.filter(record => record?.id === before.id)
    const beforeAt = Date.parse(before.updated_at), currentAt = Date.parse(matches[0]?.updated_at)
    return matches.length === 1 && attemptTarget(before) === attemptTarget(matches[0])
      && (!Number.isFinite(beforeAt) || Number.isFinite(currentAt) && currentAt >= beforeAt)
  }) && context.every(before => {
    const current = records.find(record => record?.id === before.id)
    const unit = publicationStackUnit(current, records)
    const historical = publicationStackUnit(before, context)
    return !unit || unit.records.length === unit.total
      && ['ready', 'settled'].includes(stackReadiness(historical).code)
      && unit.records.every(member => context.some(record => record.id === member.id))
  })
}
export function publicationPhaseResult(phase, fresh, outcome = {}, context = phase) {
  if (!publicationContextMatches(context, fresh)) return { state: 'checking' }
  if (phase.length && phase.every(member => settled(fresh.find(record => record?.id === member.id)))) return { state: 'sent' }
  if (outcome.pending || outcome.ok || outcome.alreadyHandled || outcome.failure?.owner === 'automatic') return { state: 'checking' }
  return { state: 'failed', note: outcome.error || 'Could not confirm the result. Check Contribute before trying again.' }
}
export const pendingPhaseBlocks = (progress, item, records) => Object.values(progress).some(result =>
  (result.unitKey === item.unitKey || result.phaseIds.some(id => item.phase.some(record => record.id === id))) &&
  ['sending', 'checking'].includes(result.state) &&
  (!publicationContextMatches(result.context, records) || !result.phaseIds.every(id => settled(records.find(record => record.id === id)))))
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
// Reuse the approval schema's stable full-plan projection, excluding lifecycle
// facts. New-PR receipt fields are generated outcomes, not named update targets.
export const attemptTarget = record => contributionApprovalFingerprint(record && {
  id: record.id, type: record.type, repo: record.plan?.repo || record.repo,
  title: record.plan?.title || record.title,
  branch: record.plan?.branch || record.branch,
  ...(record.plan?.action === 'pr_update' ? { number: record.number, url: record.url,
    head_repository: record.head_repository, relay_contribution_id: record.relay_contribution_id } : {}),
  submission_mode: record.submission_mode, plan: record.plan,
})
// Only the digest crosses reload. Capture identity AND baseline metadata before
// awaiting hashing so a mutable ledger object cannot rebind the observation.
async function attemptObservation(record) {
  const identity = attemptTarget(record)
  const baseline = { id: record.id,
    at: Number.isFinite(Date.parse(record.updated_at)) ? Date.parse(record.updated_at) : null,
    error: bounded(record.last_submit_error) }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return { ...baseline, target: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') }
}
const validObservation = value => validContributeRecordId(value?.id) && typeof value.target === 'string' && /^[a-f0-9]{64}$/.test(value.target)
  && (value.at === null || Number.isSafeInteger(value.at) && value.at >= 0 && value.at <= 8640000000000000)
  && typeof value.error === 'string' && value.error.length <= 500
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
    if (phase.observations !== undefined && (!Array.isArray(phase.observations) || !phase.observations.length || phase.observations.length > 256
      || phase.observations.some(observation => !validObservation(observation))
      || new Set(phase.observations.map(observation => observation.id)).size !== phase.observations.length
      || phase.phaseIds.some(id => !phase.observations.some(observation => observation.id === id)))) throw new Error('Invalid recovery observations')
    if (phase.canonicalFailure !== undefined && typeof phase.canonicalFailure !== 'boolean') throw new Error('Invalid recovery diagnosis')
    seen.add(phase.unitKey)
  }
  return value.phases.map(({ unitKey, phaseIds, state, note, observations, canonicalFailure }) => ({ unitKey, phaseIds, state, note,
    observations: observations?.map(({ id, target, at, error }) => ({ id, target, at, error })), canonicalFailure }))
}

export function createInlineSession({ sessionId, actions, checkpoint = null, retain = false, recoveryError: incomingRecoveryError = false, publish, loadExact, send, sendStack, refresh }) {
  const advertised = [...new Map((actions || []).filter(item => typeof item?.key === 'string').map(item => [item.key, item])).values()]
  const byId = new Map()
  const exactObservations = new Map()
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
        results.set('recovery:' + index, { ...phase, recovered: true, tone: phase.state === 'failed' || phase.canonicalFailure ? 'danger' : 'attention' })
        phase.phaseIds.forEach(id => recoveryIds.add(id))
        phase.observations?.forEach(observation => recoveryIds.add(observation.id))
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
  // One historical target proof owns both diagnosis and successful receipts.
  // Newer same-target ledger receipts may settle; failure additionally needs a
  // fresh exact timestamp. Legacy ID-only ownership remains unknown, not consent.
  const matchesContext = (result, fresh = false) => Boolean(result.observations?.length)
    && result.phaseIds.every(id => unitFor(id).records.every(member => result.observations.some(before => before.id === member.id)))
    && result.observations.every(before => {
      const current = exactObservations.get(before.id)
      return !pendingRead.has(before.id) && ledgerReady && ledger.some(record => record.id === before.id)
        && current?.target === before.target && current.identity === attemptTarget(byId.get(before.id))
        && (fresh ? current.at !== null && current.at >= Date.parse(byId.get(before.id)?.updated_at)
          : current.status === 'prepared' || Boolean(current.receipt))
    })
  const reconciled = result => matchesContext(result) && result.phaseIds.length > 0
    && result.phaseIds.every(id => settled(byId.get(id))
      && (exactRead.has(id) || ledgerReady && ledger.some(record => record.id === id && settled(record))))
  // A partial valid prefix may link its own receipt, but a foreign member or
  // parent cannot contribute links/status/counts to an unresolved frozen phase.
  const publicReceipt = record => {
    const link = settled(record)
    return link && [...results.values()].every(result =>
      result.unitKey !== unitFor(record.id).key && !result.phaseIds.includes(record.id)
        && !result.observations?.some(before => before.id === record.id)
        || matchesContext(result)) ? link : null
  }
  // An uncertain prefix cannot become a newly approved suffix on reload or
  // restaging. Lock the owning unit AND the attempted record identities.
  const pendingUnit = unit => [...results.values()].some(result => (result.state === 'pending' || result.recovered)
    && (result.unitKey === unit.key || result.phaseIds.some(id => unit.records.some(record => record.id === id))))
  // Only a new exact observation of an attempted target can diagnose failure;
  // complete-ledger membership and monotonic observations exclude stale errors.
  const reconcileResults = () => {
    for (const [key, result] of results) {
      if (!busyUnits.has(result.unitKey) && reconciled(result)) { results.delete(key); continue }
      const sameContext = matchesContext(result, true)
      const failed = sameContext && result.observations.find(before => {
        const current = exactObservations.get(before.id)
        return result.phaseIds.includes(before.id) && current?.status === 'prepared'
          && before.at !== null && current.at !== null && current.at > before.at
          && current.error && current.error !== before.error
      })
      if (failed) {
        // Diagnosis never settles ownership. Even during a held response,
        // stale handler output cannot erase the newer exact failure.
        result.canonicalFailure = true
        result.state = 'pending'
        result.tone = 'danger'
        result.note = `${exactObservations.get(failed.id).error.slice(0, 380)}. Open Contribute to check this attempt before trying again.`
      }
    }
  }
  const authoritative = key => ledgerReady && !['loading', 'unavailable'].includes(reviewStatus?.state) && idsFor(key).every(id => exactRead.has(id))
  const readyUnitsFor = key => authoritative(key) ? unitsFor(key).filter(unit => unit.ready.length && !attempted.has(phaseKey(unit)) && !pendingUnit(unit)) : []
  // A fallback publication click is not the passive protocol's read activation.
  // Expose that distinction without changing the host action/checkpoint schema.
  const canFreeze = key => alive && !recoveryError && !busyUnits.size && !confirming && !requestedActivation
    && readyUnitsFor(key).length > 0 && readyUnitsFor(key).every(unit => unit.records.every(record =>
      !pendingRead.has(record.id) && exactObservations.get(record.id)?.identity === attemptTarget(record)))
  const makeAction = item => {
    const units = unitsFor(item.key)
    const ready = readyUnitsFor(item.key)
    // Display identities are not publication units. A row links its own PR;
    // confirmation still freezes the complete parent-first stack below.
    const addressed = idsFor(item.key)
    const focused = addressed.map(id => byId.get(id) || ledger.find(rec => rec.id === id)).filter(Boolean)
    const links = [...new Map(focused.map(publicReceipt).filter(Boolean).map(link => [link.url, link])).values()]
    const readComplete = addressed.length > 0 && addressed.every(id => readFinished.has(id))
    const focusedResolved = readComplete && addressed.every(id => exactRead.has(id) || pendingRead.has(id) && displayRead.has(id)) && focused.length === addressed.length
    const publicResolved = focusedResolved && focused.every(publicReceipt)
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
    const status = recoveryError ? 'Needs attention' : failure ? 'Needs attention' : unitBusy ? 'Contributing' : checking ? 'Checking result'
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
    const publicCount = found.filter(publicReceipt).length
    const preparedCount = found.filter(rec => rec?.status === 'prepared').length
    const checkingCount = found.filter(rec => settled(rec) && !publicReceipt(rec)).length
    const missingCount = addressed.length - found.filter(Boolean).length
    lastSummary = checkingCount
      ? [publicCount && `${publicCount} sent`, preparedCount && `${preparedCount} prepared`, `${checkingCount} checking`, missingCount && `${missingCount} unavailable`].filter(Boolean).join(' · ')
      : reviewStatus?.state === 'unavailable' && preparedCount
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
      const phaseIds = [...new Set([...(previous?.phaseIds || []), ...result.phaseIds])]
      const observations = new Map([...(result.observations || []), ...(previous?.observations || [])].map(value => [value.id, value]))
      units.set(result.unitKey, { unitKey: result.unitKey, phaseIds,
        state: previous?.state === 'pending' || result.state === 'pending' ? 'pending' : 'failed',
        note: bounded(previous?.canonicalFailure ? previous.note : result.note),
        ...(phaseIds.every(id => observations.has(id)) ? { observations: [...observations.values()] } : {}),
        ...(previous?.canonicalFailure || result.canonicalFailure ? { canonicalFailure: true } : {}) })
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
  async function observeExact(id, rec, generation) {
    if (rec?.id !== id) return
    rec = copy(rec)
    const identity = attemptTarget(rec)
    const observation = await attemptObservation(rec)
    if (!alive || readGeneration.get(id) !== generation) return
    exactRead.add(id); displayRead.add(id)
    exactObservations.set(id, { ...observation, status: rec.status, receipt: settled(rec), identity })
    if ((!byId.has(id) || String(rec.updated_at || '') >= String(byId.get(id).updated_at || ''))
      && !(settled(byId.get(id)) && !settled(rec) && String(rec.updated_at || '') <= String(byId.get(id).updated_at || ''))) byId.set(id, rec)
  }
  async function hydrate(wanted) {
    const addressed = wanted || [...new Set([...ids, ...[...results.values()]
      .flatMap(result => result.observations?.map(observation => observation.id) || [])])]
    await Promise.all(addressed.map(async id => {
      const generation = (readGeneration.get(id) || 0) + 1
      readGeneration.set(id, generation)
      pendingRead.add(id)
      exactObservations.delete(id) // an unavailable latest read cannot lend an older target hash
      try {
        const rec = await loadExact(id)
        if (!alive || readGeneration.get(id) !== generation) return
        await observeExact(id, rec, generation)
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
    const ready = readyUnitsFor(key)
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
      void hydrate()
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
    // Every live attempt records its complete target before the handler. A
    // missing timestamp cannot diagnose failure, but never omits target proof.
    try {
      await Promise.all(approval.units.map(async unit => {
        const observations = await Promise.all(unit.records.map(async approved => {
          const current = byId.get(approved.id)
          const sameTarget = attemptTarget(current) === attemptTarget(approved)
          return attemptObservation(copy(sameTarget ? current : approved))
        }))
        results.get(phaseKey(unit)).observations = observations
      }))
    } catch {
      recoveryError = 'The contribution recovery observation could not be saved. Open Contribute; nothing was sent.'
    }
    reconcileResults(); emit()
    if (recoveryError) { busyUnits.clear(); frozen = null; emit(); return }
    await Promise.all(approval.units.map(async unit => {
      let outcome
      try { outcome = (unit.stack ? await sendStack(unit.records) : await send(unit.records[0])) || {} }
      catch { outcome = { uncertain: true } }
      for (const rec of [outcome.record, ...(outcome.records || []), ...(Array.isArray(outcome.ok) ? outcome.ok : [])]) {
        if (unit.records.some(approved => approved.id === rec?.id)
          && (!byId.has(rec.id) || String(rec.updated_at || '') >= String(byId.get(rec.id).updated_at || ''))
          && !(settled(byId.get(rec.id)) && !settled(rec))) byId.set(rec.id, rec)
      }
      const resultKey = phaseKey(unit)
      const resultBase = results.get(resultKey)
      if (!resultBase.canonicalFailure) {
        if (outcome.pending) results.set(resultKey, { ...resultBase, state: 'pending', note: 'Checking the contribution result. Do not retry yet.', tone: 'attention' })
        else if (outcome.uncertain || outcome.failure?.owner === 'automatic' && !outcome.ok) results.set(resultKey, { ...resultBase, state: 'pending', note: 'The result could not be confirmed. Check Contribute before trying again.', tone: 'attention' })
        else if (!outcome.ok && !outcome.alreadyHandled) results.set(resultKey, { ...resultBase, state: 'failed', note: outcome.error || 'Some changes were not sent. Check Contribute for the remainder.', tone: 'danger' })
        else results.set(resultKey, { ...resultBase, state: 'pending', note: 'Checking the saved result before marking this sent.', tone: 'attention' })
      }
      // Stack handlers return counts on success; canonical records provide links.
      await hydrate(unit.records.map(approved => approved.id))
      busyUnits.delete(unit.key)
      reconcileResults()
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
  return { sessionId, hydrate, updateLedger, activate, cancel, confirm, handleEvent, emit,
    canFreeze, readUnit: id => copy(unitFor(id)),
    readAction: id => makeAction({ key: `chat-send:${id}`, label: 'Contribute' }), dispose: () => { alive = false } }
}
