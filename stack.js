// Pure PR-stack helpers shared by the review feed and Sources visualization.
// Stack metadata is intentionally additive: older contribution records remain
// standalone, while a complete plan.stack object opts into ordered rendering
// and the batch submit endpoint.

export function stackMeta(rec) {
  const stack = rec?.plan?.stack
  if (!stack || typeof stack !== 'object') return null
  const id = typeof stack.id === 'string' ? stack.id.trim() : ''
  const position = Number(stack.position)
  const total = Number(stack.total)
  const baseBranch = typeof stack.base_branch === 'string'
    ? stack.base_branch.trim()
    : ''
  if (!id || !Number.isInteger(position) || !Number.isInteger(total)) return null
  if (total < 2 || position < 1 || position > total || !baseBranch) return null
  return {
    id,
    name: typeof stack.name === 'string' && stack.name.trim()
      ? stack.name.trim()
      : id,
    position,
    total,
    baseBranch,
    parentRecordId: typeof stack.parent_record_id === 'string'
      ? stack.parent_record_id
      : '',
  }
}

export function sortStackRecords(records) {
  return [...(records || [])].sort((a, b) => {
    const left = stackMeta(a)?.position || Number.MAX_SAFE_INTEGER
    const right = stackMeta(b)?.position || Number.MAX_SAFE_INTEGER
    return left - right
  })
}

export function groupContributionUnits(records) {
  const units = []
  const stacks = new Map()
  for (const rec of records || []) {
    const meta = stackMeta(rec)
    if (!meta) {
      units.push({ type: 'record', id: rec.id, record: rec, records: [rec] })
      continue
    }
    let unit = stacks.get(meta.id)
    if (!unit) {
      unit = {
        type: 'stack',
        id: meta.id,
        name: meta.name,
        total: meta.total,
        records: [],
      }
      stacks.set(meta.id, unit)
      units.push(unit)
    }
    unit.records.push(rec)
    unit.total = Math.max(unit.total, meta.total)
  }
  for (const unit of units) {
    if (unit.type === 'stack') unit.records = sortStackRecords(unit.records)
  }
  return units
}

// Ready stacks may have an already-open parent after a durable partial retry.
// Include every known layer in that stack so the confirmation still names the
// complete chain, while standalone prepared records remain individual cards.
export function preparedContributionUnits(ready, allRecords) {
  const readyStackIds = new Set(
    (ready || []).map(stackMeta).filter(Boolean).map((meta) => meta.id)
  )
  const stackRecords = (allRecords || []).filter((rec) => {
    const meta = stackMeta(rec)
    return meta && readyStackIds.has(meta.id) &&
      ['prepared', 'draft', 'open', 'merged'].includes(rec.status)
  })
  const stackUnits = groupContributionUnits(stackRecords)
    .filter((unit) => unit.type === 'stack')
  const invalidStackUnits = (ready || [])
    .filter((rec) => rec?.plan?.stack && !stackMeta(rec))
    .map((rec) => ({
      type: 'stack',
      id: `invalid:${rec.id}`,
      name: [rec.plan.stack.name, rec.plan.stack.id]
        .find((value) => typeof value === 'string' && value.trim()) || 'Invalid PR chain',
      total: Number(rec.plan.stack.total) || 2,
      records: [rec],
    }))
  const standalone = (ready || [])
    .filter((rec) => !rec?.plan?.stack)
    .map((rec) => ({ type: 'record', id: rec.id, record: rec, records: [rec] }))
  return [...stackUnits, ...invalidStackUnits, ...standalone].sort((a, b) => {
    const aRec = a.records.find((rec) => rec.status === 'prepared') || a.records[0]
    const bRec = b.records.find((rec) => rec.status === 'prepared') || b.records[0]
    return String(bRec?.updated_at || bRec?.created_at || '').localeCompare(
      String(aRec?.updated_at || aRec?.created_at || ''))
  })
}

// Public stacks stay grouped after Send so CI and the final atomic landing are
// reviewed as one unit instead of becoming unrelated cards in Open. Include a
// just-landed layer while any sibling is still live, which keeps a recovered
// partial ledger write understandable rather than scattering the chain.
export function publicContributionUnits(live, allRecords) {
  const liveStackIds = new Set(
    (live || []).map(stackMeta).filter(Boolean).map((meta) => meta.id)
  )
  const stackRecords = (allRecords || []).filter((rec) => {
    const meta = stackMeta(rec)
    return meta && liveStackIds.has(meta.id) &&
      ['draft', 'open', 'landing', 'merged'].includes(rec.status)
  })
  const stackUnits = groupContributionUnits(stackRecords)
    .filter((unit) => unit.type === 'stack')
  const standalone = (live || [])
    .filter((rec) => !rec?.plan?.stack)
    .map((rec) => ({ type: 'record', id: rec.id, record: rec, records: [rec] }))
  return [...stackUnits, ...standalone].sort((a, b) => {
    const aRec = a.records.find((rec) => ['open', 'landing'].includes(rec.status)) || a.records[0]
    const bRec = b.records.find((rec) => ['open', 'landing'].includes(rec.status)) || b.records[0]
    return String(bRec?.updated_at || bRec?.created_at || '').localeCompare(
      String(aRec?.updated_at || aRec?.created_at || ''))
  })
}

export function stackProgress(unit) {
  const records = unit?.records || []
  return {
    ready: records.filter((rec) => rec.status === 'prepared').length,
    open: records.filter((rec) => ['submitting', 'draft', 'open', 'landing'].includes(rec.status)).length,
    landing: records.filter((rec) => rec.status === 'landing').length,
    merged: records.filter((rec) => rec.status === 'merged').length,
    total: unit?.total || records.length,
  }
}

export function stackLandingReadiness(unit) {
  const records = sortStackRecords(unit?.records || [])
  const total = Number(unit?.total || records.length)
  const fail = (code, message) => ({ ok: false, code, message })
  if (!Number.isInteger(total) || total < 2 || records.length !== total) {
    return fail('incomplete', `This chain is incomplete: ${records.length} of ${total || '?'} layers are available.`)
  }
  if (records.some((rec) => rec.status === 'landing')) {
    return fail('landing', 'Landing is already in progress.')
  }
  if (records.some((rec) => rec.status === 'draft')) {
    return fail('draft', 'Every pull request must be ready for review before the stack can land.')
  }
  if (records.some((rec) => rec.status !== 'open')) {
    return fail('settled', 'This stack is no longer entirely open.')
  }
  const states = records.map((rec) => rec.live_checks_state || '')
  if (states.some((state) => ['FAILURE', 'ERROR'].includes(state))) {
    return fail('failed', 'At least one automated check is failing.')
  }
  if (states.every((state) => state === 'SUCCESS')) {
    return { ok: true, code: 'ready', message: '' }
  }
  if (states.some((state) => state === 'NONE')) {
    return fail('none', 'At least one pull request has no CI result yet.')
  }
  return fail('pending', 'Waiting for every pull request to finish its automated checks.')
}

function recordBranch(rec) {
  return rec?.plan?.branch || rec?.branch || ''
}

// Client-side review guard. The platform remains authoritative, but catching
// an incomplete or stale chain here avoids presenting a publish button that is
// guaranteed to fail after confirmation.
export function stackReadiness(unit) {
  const records = sortStackRecords(unit?.records || [])
  const total = Number(unit?.total || records.length)
  const ready = records.filter((rec) => rec.status === 'prepared')
  const fail = (code, message) => ({ ok: false, code, message, ready })
  if (!Number.isInteger(total) || total < 2 || records.length !== total) {
    return fail(
      'incomplete',
      `This chain is incomplete: ${records.length} of ${total || '?'} layers are available.`,
    )
  }
  const metas = records.map(stackMeta)
  if (metas.some((meta) => !meta)) {
    return fail('invalid', 'This chain has invalid layer metadata.')
  }
  if (metas.some((meta, index) => (
    meta.id !== metas[0].id || meta.total !== total || meta.position !== index + 1
  ))) {
    return fail('invalid', 'This chain has duplicate, missing, or mismatched layer positions.')
  }
  const repo = records[0]?.plan?.repo || records[0]?.repo || ''
  for (let index = 0; index < records.length; index += 1) {
    const rec = records[index]
    const meta = metas[index]
    const recRepo = rec?.plan?.repo || rec?.repo || ''
    if (rec.type !== 'pr' || rec?.plan?.action !== 'pr' || recRepo !== repo) {
      return fail('invalid', 'Every layer must be a pull request for the same repository.')
    }
    if (!['prepared', 'draft', 'open', 'merged'].includes(rec.status)) {
      return fail('invalid', 'One layer is not in a publishable stack state.')
    }
    if (!recordBranch(rec).startsWith(`stack/${meta.id}/`)) {
      return fail('invalid', 'A layer branch does not belong to this chain.')
    }
    if (index === 0) {
      if (meta.parentRecordId) {
        return fail('invalid', 'The first layer points at an unexpected parent.')
      }
      continue
    }
    const previous = records[index - 1]
    if (
      meta.parentRecordId !== previous.id ||
      meta.baseBranch !== recordBranch(previous) ||
      (
        rec.status === 'prepared' &&
        String(rec?.plan?.base_sha || '') !== String(previous?.plan?.head_sha || '')
      )
    ) {
      return fail('invalid', 'A layer no longer matches its reviewed parent.')
    }
    if (rec.status === 'prepared' && previous.status === 'merged') {
      return fail(
        'refresh',
        'A parent PR has merged. Refresh the remaining layers on the repository’s main branch before publishing.',
      )
    }
  }
  if (ready.length === 0) {
    return fail('settled', 'Every layer in this chain is already public or merged.')
  }
  return { ok: true, code: 'ready', message: '', ready }
}
