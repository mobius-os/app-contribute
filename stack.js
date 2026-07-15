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
      ['prepared', 'open', 'merged'].includes(rec.status)
  })
  const stackUnits = groupContributionUnits(stackRecords)
    .filter((unit) => unit.type === 'stack')
  const standalone = (ready || [])
    .filter((rec) => !stackMeta(rec))
    .map((rec) => ({ type: 'record', id: rec.id, record: rec, records: [rec] }))
  return [...stackUnits, ...standalone].sort((a, b) => {
    const aRec = a.records.find((rec) => rec.status === 'prepared') || a.records[0]
    const bRec = b.records.find((rec) => rec.status === 'prepared') || b.records[0]
    return String(bRec?.updated_at || bRec?.created_at || '').localeCompare(
      String(aRec?.updated_at || aRec?.created_at || ''))
  })
}

export function stackProgress(unit) {
  const records = unit?.records || []
  return {
    ready: records.filter((rec) => rec.status === 'prepared').length,
    open: records.filter((rec) => ['submitting', 'draft', 'open'].includes(rec.status)).length,
    merged: records.filter((rec) => rec.status === 'merged').length,
    total: unit?.total || records.length,
  }
}
