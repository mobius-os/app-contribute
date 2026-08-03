// Pure helpers for the Ready-for-review validity layer. The platform returns
// one local, read-only verdict per prepared record. Send still performs its
// own authoritative validation; this layer makes invalidated work visible
// before the user attempts to submit it.

export function indexReviewStatus(payload) {
  const byId = {}
  const rows = Array.isArray(payload?.records) ? payload.records : []
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) continue
    if (row.state !== 'ready' && row.state !== 'needs_refresh') continue
    byId[row.id] = {
      state: row.state,
      code: typeof row.code === 'string' ? row.code : '',
      message: typeof row.message === 'string' ? row.message : '',
    }
  }
  return {
    state: 'ready',
    byId,
    checkedAt: typeof payload?.generated_at === 'string'
      ? payload.generated_at
      : '',
  }
}

// The verdict is the platform's to give. This used to override a local-ready
// verdict by regex-matching `last_submit_error` for an upstream conflict,
// because the read-only status endpoint genuinely could not see one. It now
// recomputes mergeability itself and reports `upstream_conflict` directly, so
// reading the failure prose here would only be a second, staler opinion — it
// matched a message left by a past attempt even after the branch was fixed.
export function reviewStateFor(rec, reviewStatus) {
  return reviewStatus?.byId?.[rec?.id] || null
}

const PRE_PR_CHECK_ACTIVE = new Set([
  'dispatching', 'uncertain', 'queued', 'in_progress',
])
const PRE_PR_CHECK_SUCCESS = new Set(['success', 'neutral', 'skipped'])

export function canRunPrePrChecks(rec) {
  const plan = rec?.plan || {}
  return !!(
    rec?.status === 'prepared' &&
    rec?.type === 'pr' &&
    plan.action === 'pr' &&
    !plan.stack &&
    (plan.repo || rec.repo) === 'mobius-os/mobius'
  )
}

export function prePrCheckPhase(rec) {
  const checks = rec?.pre_pr_checks
  if (!checks || typeof checks !== 'object') return 'idle'
  if (PRE_PR_CHECK_ACTIVE.has(checks.state)) return 'running'
  if (checks.state === 'error') return 'failed'
  if (checks.state !== 'completed') return 'idle'
  return PRE_PR_CHECK_SUCCESS.has(String(checks.conclusion || '').toLowerCase())
    ? 'passed'
    : 'failed'
}

export function summarizeReviewStatus(records, reviewStatus) {
  const prepared = (Array.isArray(records) ? records : [])
    .filter((rec) => rec?.status === 'prepared')
  let ready = 0
  let needsRefresh = 0
  let unchecked = 0
  for (const rec of prepared) {
    const state = reviewStateFor(rec, reviewStatus)
    if (state?.state === 'ready') ready += 1
    else if (state?.state === 'needs_refresh') needsRefresh += 1
    else unchecked += 1
  }
  return { total: prepared.length, ready, needsRefresh, unchecked }
}

export function blockedReviewCount(records, reviewStatus) {
  return (Array.isArray(records) ? records : []).filter((rec) =>
    rec?.status === 'prepared' &&
    reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh').length
}

const ACTIVE_PR_STATUSES = new Set([
  'prepared',
  'submitting',
  'landing',
  'draft',
  'open',
])

function hasPublishedAttention(rec) {
  return rec?.needs_attention === true ||
    (typeof rec?.attention?.title === 'string' && !!rec.attention.title.trim()) ||
    (typeof rec?.attention?.message === 'string' && !!rec.attention.message.trim())
}

export function attentionReason(rec, reviewStatus) {
  const attention = rec?.attention || {}
  const review = reviewStateFor(rec, reviewStatus)
  const details = [
    typeof attention.title === 'string' ? attention.title.trim() : '',
    typeof attention.message === 'string' ? attention.message.trim() : '',
  ].filter(Boolean)
  if (details.length > 0) return details.join(' — ')
  if (review?.state === 'needs_refresh') {
    return review.message || 'This changed after it was reviewed and needs to be refreshed.'
  }
  if (prePrCheckPhase(rec) === 'failed') {
    return rec.pre_pr_checks?.message ||
      'The pre-PR GitHub checks need a fix before this is sent.'
  }
  if (typeof rec?.last_submit_error === 'string' && rec.last_submit_error.trim()) {
    return rec.last_submit_error.trim()
  }
  return 'This contribution needs another look.'
}

// The batch handoff deliberately covers only active pull requests. A stale
// attention flag on a merged, closed, superseded, or dropped record belongs in
// History and must never bring settled work back into the action queue.
export function contributionsNeedingAttention(records, reviewStatus) {
  return (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || !ACTIVE_PR_STATUSES.has(rec.status)) return false
    return hasPublishedAttention(rec) ||
      reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh' ||
      prePrCheckPhase(rec) === 'failed'
  })
}

export function addressAllAction(records, reviewStatus) {
  const attentionRecords = contributionsNeedingAttention(records, reviewStatus)
  if (attentionRecords.length === 0) return null
  const list = attentionRecords.map((rec) => {
    const title = rec.plan?.title || rec.title || rec.summary || 'Untitled pull request'
    const repo = rec.repo ? ` — ${rec.repo}` : ''
    const url = rec.attention?.url || rec.url || ''
    return [
      `- ${title}${repo}`,
      `  ${attentionReason(rec, reviewStatus)}`,
      url ? `  ${url}` : '',
    ].filter(Boolean).join('\n')
  })
  return {
    event: 'address_all_contributions',
    autoSend: true,
    count: attentionRecords.length,
    draft: [
      'Address every active Contribute pull request that needs attention:',
      '',
      ...list,
      '',
      'Inspect each blocker, explain what can be fixed privately, and prepare the required updates.',
      'Do not push, reply, publish, merge, or otherwise change GitHub without the approval required for that exact public action.',
      'If a merge conflict or owner decision is required, leave it flagged and explain the next choice.',
    ].join('\n'),
  }
}

export function partitionReviewUnits(units, reviewStatus) {
  const needsAttention = []
  const checking = []
  const readyToSend = []
  for (const unit of units || []) {
    const records = unit.records || (unit.record ? [unit.record] : [])
    if (records.some((rec) => prePrCheckPhase(rec) === 'running')) {
      checking.push(unit)
    } else if (records.some(
      (rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh',
    ) || records.some((rec) => prePrCheckPhase(rec) === 'failed')) {
      needsAttention.push(unit)
    } else {
      readyToSend.push(unit)
    }
  }
  return { needsAttention, checking, readyToSend }
}
