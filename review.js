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

export function reviewStateFor(rec, reviewStatus) {
  const direct = reviewStatus?.byId?.[rec?.id]

  // Only a durable remote blocker may override a fresh local-ready verdict.
  // The read-only status endpoint cannot see an upstream merge conflict, but
  // retryable submit failures (fork inspection, transient 500s, and similar)
  // do not invalidate the reviewed source and must not permanently disable
  // Send after the local verifier says it is ready.
  if (rec?.status === 'prepared' && rec?.last_submit_error) {
    const upstreamConflict = /no longer merges cleanly|merge conflict/i
      .test(rec.last_submit_error)
    if (upstreamConflict) {
      return {
        state: 'needs_refresh',
        code: 'upstream_conflict',
        message: rec.last_submit_error,
      }
    }
  }
  if (direct) return direct
  return null
}

const EARLY_CHECK_ACTIVE = new Set([
  'dispatching', 'uncertain', 'queued', 'in_progress',
])
const EARLY_CHECK_SUCCESS = new Set(['success', 'neutral', 'skipped'])

export function canRunEarlyChecks(rec) {
  const plan = rec?.plan || {}
  return !!(
    rec?.status === 'prepared' &&
    rec?.type === 'pr' &&
    plan.action === 'pr' &&
    !plan.stack &&
    (plan.repo || rec.repo) === 'mobius-os/mobius'
  )
}

export function earlyChecksActive(rec) {
  return EARLY_CHECK_ACTIVE.has(rec?.early_checks?.state)
}

export function earlyChecksFailed(rec) {
  const checks = rec?.early_checks
  if (!checks || typeof checks !== 'object') return false
  if (checks.state === 'error') return true
  return checks.state === 'completed' &&
    !EARLY_CHECK_SUCCESS.has(String(checks.conclusion || '').toLowerCase())
}

export function earlyChecksPassed(rec) {
  const checks = rec?.early_checks
  return checks?.state === 'completed' &&
    EARLY_CHECK_SUCCESS.has(String(checks.conclusion || '').toLowerCase())
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
  if (earlyChecksFailed(rec)) {
    return rec.early_checks?.message ||
      'The early GitHub checks need a fix before this is sent.'
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
      earlyChecksFailed(rec)
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
    if (records.some(earlyChecksActive)) {
      checking.push(unit)
    } else if (records.some(
      (rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh',
    ) || records.some(earlyChecksFailed)) {
      needsAttention.push(unit)
    } else {
      readyToSend.push(unit)
    }
  }
  return { needsAttention, checking, readyToSend }
}
