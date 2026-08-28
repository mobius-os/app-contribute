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

const QUALITY_REVIEW_STATES = new Set([
  'queued', 'reviewing', 'changes_needed', 'all_clear',
])

// One exact prepared head owns one review conversation. The scope travels with
// the app-owned chat, so a second tap (or a remounted Contribute frame) can find
// the already-running review instead of starting another agent. A compact
// 64-bit digest keeps batch scopes inside the platform's bounded metadata field
// without making the UI remember a parallel registry.
export function contributionReviewScope(records, mode = 'review') {
  const identities = (Array.isArray(records) ? records : [])
    .filter((rec) => rec && typeof rec.id === 'string' && rec.id)
    .map((rec) => `${rec.id}\u0000${String(rec.plan?.head_sha || '')}`)
    .sort()
  if (identities.length === 0) return ''
  const input = `${mode}\u0000${identities.join('\u0001')}`
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `contribute-review:${hash.toString(16).padStart(16, '0')}`
}

// A quality verdict belongs to one immutable prepared head. Source freshness
// and agent review are separate claims: the platform proves the former, while
// the agent records the latter after its correctness/maintenance review.
export function qualityReviewFor(rec) {
  const raw = rec?.quality_review
  const currentHead = String(rec?.plan?.head_sha || '')
  if (!raw || typeof raw !== 'object' || !QUALITY_REVIEW_STATES.has(raw.state)) {
    return { state: 'needed', label: 'Review needed' }
  }
  if (raw.state === 'all_clear' && (!currentHead || raw.reviewed_head_sha !== currentHead)) {
    return { ...raw, state: 'needed', label: 'Review needed', stale: true }
  }
  const labels = {
    queued: 'Queued',
    reviewing: 'Reviewing',
    changes_needed: 'Changes needed',
    all_clear: 'All clear',
  }
  return { ...raw, label: labels[raw.state] }
}

export function isAllClear(rec, reviewStatus) {
  return rec?.status === 'prepared' &&
    qualityReviewFor(rec).state === 'all_clear' &&
    reviewStateFor(rec, reviewStatus)?.state === 'ready'
}

function reviewAction(records, mode = 'review') {
  const candidates = (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || rec.status !== 'prepared') return false
    const state = qualityReviewFor(rec).state
    return mode === 'fix' ? state === 'changes_needed' : state !== 'all_clear'
  })
  if (candidates.length === 0) return null
  const ids = candidates.map((rec) => rec.id)
  const fixing = mode === 'fix'
  return {
    event: fixing ? 'fix_and_review_contributions' : 'review_contributions',
    title: fixing ? 'Fix and review contributions' : 'Review contributions',
    label: fixing ? 'Fix & review again' : `Review ${candidates.length === 1 ? 'now' : 'all'}`,
    busyLabel: 'Starting…',
    startedLabel: fixing ? 'Fixing and reviewing' : 'Reviewing contributions',
    startedMessage: 'Stay in Contribute. Review verdicts will update here.',
    count: candidates.length,
    scope: contributionReviewScope(candidates, mode),
    scopeLabel: fixing ? 'Fix and review contributions' : 'Review contributions',
    draft: [
      fixing
        ? 'Fix and thoroughly re-review the prepared contributions listed below.'
        : 'Thoroughly review the prepared contributions listed below.',
      '',
      ...ids.map((id) => `- ${id}`),
      '',
      'Refresh each record and inspect its complete diff. Review correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt with expanding scope where ownership requires it.',
      fixing
        ? 'For owner-authored work, fix every sound finding privately, update the prepared record, and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.'
        : 'If a sound issue is found in owner-authored work, fix it privately and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.',
      'After every pass, CAS-update quality_review on the Contribute record. Use state reviewing while active, changes_needed when a sound finding remains, and all_clear only when the complete current head passes. Store reviewed_head_sha equal to plan.head_sha, reviewed_at, iteration, chat_id, scope, and a concise summary.',
      'Do not push, publish, comment, merge, or otherwise change GitHub. Stop once every listed record is either all_clear on its exact current head or has a precise remaining blocker.',
    ].join('\n'),
  }
}

export function reviewAllAction(records) { return reviewAction(records, 'review') }
export function fixAndReviewAction(records) { return reviewAction(records, 'fix') }

// A failed publication is not another GitHub mutation. One app-owned recovery
// conversation refreshes the recorded branch, reconciles a response that may
// have been lost after GitHub accepted it, and leaves any public retry on the
// existing approval surface. The exact record+head scope matches the compact
// chat card so either doorway resumes the same work.
export function recoveryReviewAction(rec) {
  if (!rec?.id) return null
  return {
    event: 'recover_contribution_review',
    title: `Fix and review ${rec.title || 'contribution'}`,
    label: 'Fix and review',
    busyLabel: 'Starting…',
    startedLabel: 'Fixing and reviewing',
    reusedLabel: 'Review already running',
    startedMessage: 'Stay in Contribute. This exact review will update here.',
    count: 1,
    scope: contributionReviewScope([rec], 'recovery'),
    scopeLabel: 'Fix and review contribution',
    draft: [
      `Fix and review contribution ${rec.id} ("${rec.title || 'untitled'}").`,
      '',
      'Refresh the recorded pull request and branch first. If the exact reviewed head already reached the pull request, reconcile the contribution record and inspect its current checks. If the branch moved, rebuild the private review on its current head and run the relevant checks.',
      '',
      'Keep any further public update behind the existing approval button.',
    ].join('\n'),
  }
}

// The Needs action queue can contain three different private jobs: a fresh
// quality review, fixes after a review, or a stale/conflicted prepared head.
// One contextual tray should own that exact mixed scope rather than choosing
// one job and silently leaving the other visible rows behind.
export function contributionsNeedingReviewAction(records, reviewStatus) {
  return (Array.isArray(records) ? records : []).filter((rec) => {
    if (rec?.type !== 'pr' || rec.status !== 'prepared') return false
    return reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh' ||
      prePrCheckPhase(rec) === 'failed' ||
      qualityReviewFor(rec).state === 'changes_needed' ||
      !isAllClear(rec, reviewStatus)
  })
}

export function progressReviewAction(records, reviewStatus) {
  const candidates = contributionsNeedingReviewAction(records, reviewStatus)
  if (candidates.length === 0) return null
  const list = candidates.map((rec) => {
    const title = rec.plan?.title || rec.title || rec.summary || 'Untitled pull request'
    const repo = rec.plan?.repo || rec.repo || 'project'
    const quality = qualityReviewFor(rec).state
    const state = reviewStateFor(rec, reviewStatus)?.state
    const step = state === 'needs_refresh'
      ? 'refresh the prepared head'
      : prePrCheckPhase(rec) === 'failed'
        ? 'fix the failed checks'
        : quality === 'changes_needed'
          ? 'fix findings and review again'
          : 'complete the quality review'
    return `- ${title} — ${repo} — ${step} (${rec.id})`
  })
  const first = candidates[0]
  const firstQuality = qualityReviewFor(first).state
  const singleLabel = reviewStateFor(first, reviewStatus)?.state === 'needs_refresh'
    ? 'Refresh'
    : prePrCheckPhase(first) === 'failed'
      ? 'Fix checks'
      : firstQuality === 'changes_needed'
        ? 'Fix & review again'
        : firstQuality === 'reviewing' || firstQuality === 'queued'
          ? 'Open review'
          : 'Review now'
  return {
    event: 'progress_contribution_reviews',
    title: 'Work through contribution reviews',
    label: candidates.length === 1 ? singleLabel : `Work through ${candidates.length}`,
    busyLabel: 'Starting…',
    startedLabel: 'Working through reviews',
    startedMessage: 'Stay in Contribute. Each item will move as its current head is resolved and reviewed.',
    count: candidates.length,
    scope: contributionReviewScope(candidates, 'progress'),
    scopeLabel: 'Work through contribution reviews',
    draft: [
      'Work through the exact Contribute review queue listed below.',
      '',
      ...list,
      '',
      'Refresh every record first. Resolve stale prepared heads and failed private checks, then thoroughly review correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt.',
      'For owner-authored work, fix every sound finding privately and repeat the full review on the new head. For work owned by someone else, prepare concrete suggestions instead of changing their branch.',
      'CAS-update quality_review throughout the loop. Mark all_clear only when reviewed_head_sha exactly matches the current plan.head_sha.',
      'Do not push, publish, comment, merge, or otherwise change GitHub. Stop with every listed item either all clear on its exact head or carrying one precise blocker.',
    ].join('\n'),
  }
}

export function summarizeQualityReviews(records, reviewStatus) {
  const prepared = (Array.isArray(records) ? records : [])
    .filter((rec) => rec?.type === 'pr' && rec.status === 'prepared')
  const summary = { total: prepared.length, needed: 0, reviewing: 0, changesNeeded: 0, allClear: 0 }
  for (const rec of prepared) {
    const state = qualityReviewFor(rec).state
    if (state === 'reviewing' || state === 'queued') summary.reviewing += 1
    else if (state === 'changes_needed') summary.changesNeeded += 1
    else if (isAllClear(rec, reviewStatus)) summary.allClear += 1
    else summary.needed += 1
  }
  return summary
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
    title: 'Address contribution follow-up',
    label: `Address all ${attentionRecords.length}`,
    busyLabel: 'Starting…',
    startedLabel: 'Agent is handling follow-up',
    startedMessage: 'Stay in Contribute. Refreshed reviews and any decisions will appear here.',
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

export function finishContributionCycleAction(records, reviewStatus, projectCount = 0) {
  const active = (Array.isArray(records) ? records : []).filter((rec) =>
    rec?.type === 'pr' && ACTIVE_PR_STATUSES.has(rec.status))
  const localProjects = Number.isFinite(Number(projectCount))
    ? Math.max(0, Math.floor(Number(projectCount)))
    : 0
  if (active.length === 0 && localProjects === 0) return null

  const prepared = active.filter((rec) => rec.status === 'prepared').length
  const publicCount = active.length - prepared
  const attention = contributionsNeedingAttention(active, reviewStatus).length
  const facts = [
    prepared ? `${prepared} privately prepared` : '',
    publicCount ? `${publicCount} public or publishing` : '',
    attention ? `${attention} needing attention` : '',
    localProjects ? `${localProjects} projects needing reconciliation` : '',
  ].filter(Boolean).join(' · ')

  return {
    event: 'finish_contribution_cycle',
    title: 'Finish contribution cycle',
    label: 'Run full cycle',
    busyLabel: 'Starting…',
    startedLabel: 'Working through the contribution cycle',
    startedMessage: 'Stay in Contribute. The agent will bring back ready work and decisions as the cycle moves.',
    count: active.length + localProjects,
    draft: [
      'Finish the contribution cycle for these projects.',
      '',
      `The current Contribute view indicates: ${facts}.`,
      'Refresh the complete queue and Projects/source status before acting; these counts are only a handoff.',
      '',
      'Privately prepare reusable local changes, then thoroughly review every prepared PR for correctness, maintainability, simplicity, tests, security/privacy, and avoidable technical debt.',
      'Fix sound findings in owner-authored work and repeat the review on every changed head until each item is all clear; prepare suggestions rather than changing someone else’s branch.',
      'CAS-update each record’s quality_review throughout the loop. All clear is valid only when reviewed_head_sha exactly matches plan.head_sha.',
      'Stop at one Contribute checkpoint that enumerates the exact all-clear set. Do not push, publish, comment, merge, or otherwise change GitHub before that approval.',
      'Follow approved work through CI, review, merge, closure, or supersession using durable waits whenever the chat promises to resume later.',
      'Then reconcile each local project with accepted upstream work through its reviewed project update flow.',
      'Preserve private and local-only work, route overlaps through the project’s existing resolver, and keep any activation or restart separately confirmed.',
      'Finish by classifying every remaining local difference and reporting prepared, sent, merged, blocked, aligned, and deliberately local outcomes.',
    ].join('\n'),
  }
}

export function contributionCyclePhase(runtime) {
  if (!runtime || typeof runtime !== 'object') return 'checking'
  if (runtime.running === true) return 'running'
  if (runtime.pending_question_id) return 'waiting'
  if (runtime.goal?.status === 'failed') return 'failed'
  if (runtime.goal?.status === 'paused') return 'paused'
  return 'complete'
}

export function isContributionCycleChat(chat) {
  if (!chat || typeof chat !== 'object') return false
  if (chat.scope === 'contribute-cycle') return true
  const legacyLabel = [chat.scope_label, chat.title]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return legacyLabel.includes('contribution cycle')
}

export function contributionCycleProgress(runtime) {
  const plan = runtime?.goal_plan
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : []
  const summary = plan?.summary || {}
  const completed = Number.isInteger(summary.completed)
    ? summary.completed
    : tasks.filter((task) => task?.status === 'completed').length
  const total = Number.isInteger(summary.total) ? summary.total : tasks.length
  const current = tasks.find((task) => task?.status === 'running')
    || tasks.find((task) => task?.ready === true)
  const label = current?.title
    || runtime?.active_goal_objective
    || (runtime?.pending_question_id ? 'Waiting for your decision' : 'Working through the cycle')
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : null,
    label,
  }
}

export function partitionReviewUnits(units, reviewStatus) {
  const needsAttention = []
  const checking = []
  const readyToSend = []
  const needsReview = []
  const reviewing = []
  for (const unit of units || []) {
    const records = unit.records || (unit.record ? [unit.record] : [])
    // A prepared child can remain grouped with already-public or merged stack
    // parents. Only the still-private layers need an exact-head quality verdict;
    // requiring an open parent to become `prepared` again makes the child
    // permanently impossible to review or send.
    const privateRecords = records.filter((rec) => rec.status === 'prepared')
    const reviewRecords = privateRecords.length > 0 ? privateRecords : records
    if (reviewRecords.some((rec) => prePrCheckPhase(rec) === 'running')) {
      checking.push(unit)
    } else if (reviewRecords.some((rec) => hasPublishedAttention(rec)) || reviewRecords.some(
      (rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh',
    ) || reviewRecords.some((rec) => prePrCheckPhase(rec) === 'failed') ||
      reviewRecords.some((rec) => qualityReviewFor(rec).state === 'changes_needed')) {
      needsAttention.push(unit)
    } else if (reviewRecords.some((rec) => ['queued', 'reviewing'].includes(qualityReviewFor(rec).state))) {
      reviewing.push(unit)
    } else if (!reviewRecords.every((rec) => isAllClear(rec, reviewStatus))) {
      needsReview.push(unit)
    } else {
      readyToSend.push(unit)
    }
  }
  return { needsAttention, checking, needsReview, reviewing, readyToSend }
}

const REVIEW_INTENT = /^review:([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/
const REVIEW_QUEUE_INTENT = 'reviews:queue'

// Shell cards address one immutable ledger identity. The record's current
// stage and stack membership remain Contribute's decision, so a stale card can
// still open the truthful current review instead of encoding a tab/filter that
// may have changed since the card rendered.
export function contributionReviewTargetFromIntent(intent) {
  if (typeof intent !== 'string') return null
  const normalized = intent.trim()
  if (normalized === REVIEW_QUEUE_INTENT) return { queue: true }
  const match = REVIEW_INTENT.exec(normalized)
  return match ? { recordId: match[1] } : null
}

function focusedStackMeta(record) {
  const raw = record?.plan?.stack || record?.stack
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const total = Number(raw.total)
  const position = Number(raw.position)
  if (!id || !Number.isInteger(total) || total < 1) return null
  return {
    id,
    repo: String(record?.plan?.repo || record?.repo || ''),
    total,
    position: Number.isInteger(position) ? position : 0,
  }
}

// A shell handoff may arrive while the authoritative ledger is still paging.
// The cached snapshot deliberately contains every active record, so a complete
// stack there is enough to render immediately. Publication still fresh-reads
// every exact record; this only removes an avoidable navigation wait.
export function focusedContributionReady(records, recordId) {
  const list = Array.isArray(records) ? records : []
  const focused = list.find((record) => record?.id === recordId)
  if (!focused) return false
  const stack = focusedStackMeta(focused)
  if (!stack) return true
  const positions = new Set(list.flatMap((record) => {
    const candidate = focusedStackMeta(record)
    return candidate
      && candidate.id === stack.id
      && candidate.repo === stack.repo
      && candidate.total === stack.total
      && candidate.position >= 1
      && candidate.position <= stack.total
      ? [candidate.position]
      : []
  }))
  return positions.size === stack.total
}

// Opening the same record twice can reuse a previously settled lookup, while
// an already-mounted app can have a globally complete but now-stale ledger.
// Bind readiness to the exact intent nonce, then let a later ledger refresh
// satisfy an incomplete stack without ever treating global ledger readiness
// as proof that this named review is absent.
export function focusedContributionNavigationReady(focusTarget, lookup, records) {
  if (!focusTarget) return true
  if (focusTarget.queue) {
    return lookup?.nonce === focusTarget.nonce
      && lookup?.queue === true
      && lookup?.ready === true
  }
  const recordId = typeof focusTarget.recordId === 'string'
    ? focusTarget.recordId
    : ''
  if (
    !recordId
    || lookup?.nonce !== focusTarget.nonce
    || lookup?.recordId !== recordId
  ) {
    return false
  }
  return lookup.ready === true || focusedContributionReady(records, recordId)
}

export function locateContributionReview(phaseUnits, recordId) {
  const wanted = typeof recordId === 'string' ? recordId : ''
  if (!wanted) return null
  for (const [phase, units] of Object.entries(phaseUnits || {})) {
    for (const unit of units || []) {
      const records = unit?.records || (unit?.record ? [unit.record] : [])
      if (records.some((record) => record?.id === wanted)) {
        return { phase, unit }
      }
    }
  }
  return null
}
