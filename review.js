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
