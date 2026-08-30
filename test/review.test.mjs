import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  addressAllAction,
  canRunPrePrChecks,
  contributionReviewScope,
  contributionReviewTargetFromIntent,
  contributionsNeedingAttention,
  finishContributionCycleAction,
  focusedContributionNavigationReady,
  focusedContributionReady,
  contributionCyclePhase,
  contributionCycleProgress,
  isContributionCycleChat,
  isAllClear,
  locateContributionReview,
  progressReviewAction,
  qualityReviewFor,
  recoveryReviewAction,
  reviewAllAction,
  prePrCheckPhase,
  blockedReviewCount,
  indexReviewStatus,
  partitionReviewUnits,
  reviewStateFor,
  summarizeReviewStatus,
} from '../review.js'
import { upsertRecord } from '../domain.js'
import { contributionRecordPaths } from '../storage.js'

const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const overviewSource = readFileSync(new URL('../ui/SourceOverview.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')

test('shell review intents name one ledger record without encoding presentation state', () => {
  assert.deepEqual(contributionReviewTargetFromIntent('review:record.1-ready'), {
    recordId: 'record.1-ready',
  })
  assert.deepEqual(contributionReviewTargetFromIntent('  review:record_2  '), {
    recordId: 'record_2',
  })
  assert.equal(contributionReviewTargetFromIntent('review:../escape'), null)
  assert.equal(contributionReviewTargetFromIntent('reviews:record'), null)
  assert.equal(contributionReviewTargetFromIntent(null), null)
  assert.deepEqual(contributionReviewTargetFromIntent('reviews:queue'), {
    queue: true,
  })
})

test('a record intent resolves its current phase and enclosing stack', () => {
  const stack = {
    id: 'stack:demo',
    records: [{ id: 'layer-1' }, { id: 'layer-2' }],
  }
  const single = { id: 'single-unit', record: { id: 'single' } }
  const phases = { action: [single], clear: [stack], history: [] }

  assert.deepEqual(locateContributionReview(phases, 'layer-2'), {
    phase: 'clear',
    unit: stack,
  })
  assert.deepEqual(locateContributionReview(phases, 'single'), {
    phase: 'action',
    unit: single,
  })
  assert.equal(locateContributionReview(phases, 'missing'), null)
})

test('the app resolves trusted focused intents without waiting for the full ledger', () => {
  assert.match(appSource, /event\.origin !== window\.location\.origin/)
  assert.match(appSource, /event\.source !== window\.parent/)
  assert.match(appSource, /contributionReviewTargetFromIntent\(event\.data\.intent\)/)
  assert.match(appSource, /setView\('prs'\)/)
  assert.match(appSource, /loadContributionRecord\(recordId\)/)
  assert.match(appSource, /upsertRecord\(recordsRef\.current, record\)/)
  assert.match(appSource, /focusedContributionReady\(next, recordId\)/)
  assert.match(appSource, /focusTarget=\{reviewFocus\}/)
  assert.match(appSource, /focusReady=\{focusedReviewReady\}/)
  assert.match(appSource, /loading \|\| !focusedReviewReady/)
  assert.match(feedSource, /if \(!focusTarget \|\| !focusReady\) return/)
  assert.match(feedSource, /if \(focusTarget\.queue\)/)
  assert.match(feedSource, /locateContributionReview\(phaseUnits, focusTarget\.recordId\)/)
  assert.match(feedSource, /setSelectedKey\(unitKey\(located\.unit\)\)/)
  assert.match(feedSource, /Review no longer available/)
  assert.match(feedSource, /<h2 className="co-visually-hidden">Contribution review<\/h2>/)
  assert.doesNotMatch(feedSource, /<ViewHeading title="Reviews" description="Inspect the complete change before you act\."/)
})

test('a focused review waits for its exact refresh instead of trusting a stale ledger', () => {
  const focus = { recordId: 'layer-1', nonce: 'new-intent' }
  const pending = { recordId: 'layer-1', nonce: 'new-intent', ready: false }
  const staleLookup = { recordId: 'layer-1', nonce: 'old-intent', ready: true }
  const stack = {
    id: 'review-stack', name: 'Review stack', position: 1, total: 2,
  }
  const first = { id: 'layer-1', plan: { repo: 'mobius-os/mobius', stack } }
  const second = {
    id: 'layer-2',
    plan: {
      repo: 'mobius-os/mobius',
      stack: { ...stack, position: 2 },
    },
  }

  assert.equal(focusedContributionNavigationReady(null, pending, []), true)
  assert.equal(focusedContributionNavigationReady(
    { queue: true, nonce: 'queue-intent' },
    { queue: true, nonce: 'old-intent', ready: true },
    [],
  ), false)
  assert.equal(focusedContributionNavigationReady(
    { queue: true, nonce: 'queue-intent' },
    { queue: true, nonce: 'queue-intent', ready: true },
    [],
  ), true)
  assert.equal(focusedContributionNavigationReady(focus, staleLookup, [first, second]), false)
  assert.equal(focusedContributionNavigationReady(focus, pending, [first]), false)
  assert.equal(focusedContributionNavigationReady(focus, pending, [first, second]), true)
  assert.equal(focusedContributionNavigationReady(
    focus,
    { ...pending, ready: true },
    [],
  ), true)
})

test('review-facing refreshes reject stale async settlements', () => {
  assert.match(appSource, /const reviewStatusRequestRef = useRef\(0\)/)
  assert.match(appSource, /requestId !== reviewStatusRequestRef\.current/)
  assert.match(appSource, /const incomingReviewsRequestRef = useRef\(0\)/)
  assert.match(appSource, /requestId !== incomingReviewsRequestRef\.current/)
  assert.match(appSource, /connRef\.current\.state !== 'connected'/)
  assert.match(appSource, /incomingReviewsRequestRef\.current \+= 1/)
  assert.match(appSource, /refreshMountedLedger: ledgerReadyRef\.current/)
  assert.match(appSource, /await refreshCoordinatorRef\.current\(\)/)
  assert.match(appSource, /document\.addEventListener\('visibilitychange', resolveIncompleteStack\)/)
  assert.match(appSource, /window\.mobius\?\.online === false/)
})

test('mount-time live state reconciles with newer focused and action results', () => {
  assert.match(appSource, /replaceFeed\(reconcileLedgerSnapshot\(recordsRef\.current, next\)\)/)
  assert.match(appSource, /slower startup work cannot overwrite it/)
})

test('a complete active stack can open from the fast snapshot', () => {
  const stack = (id, position, total = 3) => ({
    id,
    repo: 'mobius-os/mobius',
    plan: { repo: 'mobius-os/mobius', stack: { id: 'drawer', position, total } },
  })
  const records = [stack('one', 1), stack('two', 2), stack('three', 3)]
  assert.equal(focusedContributionReady(records, 'one'), true)
  assert.equal(focusedContributionReady(records.slice(0, 2), 'one'), false)
  assert.equal(focusedContributionReady([{ id: 'single' }], 'single'), true)
  assert.equal(focusedContributionReady(records, 'missing'), false)
})

test('review queues own compact defaults and one grouped action', () => {
  assert.match(feedSource, /className=\{'co-review-default/)
  assert.match(feedSource, /progressReviewAction\(unitRecords\(unit\), reviewStatus\)/)
  assert.match(feedSource, /<StageDefaultAction/)
  assert.match(feedSource, /Send all \{prepared\.length\}/)
  assert.match(feedSource, /unit\.type !== 'stack'/)
  assert.match(feedSource, /className="co-stage-batch-list"/)
  assert.match(feedSource, /record\.plan\?\.action === 'pr_update' \? 'Update pull request' : 'Open pull request'/)
  assert.doesNotMatch(feedSource, /One public approval/)
  assert.doesNotMatch(feedSource, /One private review/)
})

test('the active cycle presents opening its conversation as a bordered action', () => {
  assert.match(overviewSource, /className="co-btn co-btn-sm"[^>]*>Open conversation<\/button>/)
})

test('the app navigation and supporting screens follow the owner task instead of internal stages', () => {
  assert.match(appSource, />\s*To do\s*</)
  assert.match(appSource, />\s*Pull requests\s*</)
  assert.match(appSource, />\s*Issues\s*</)
  assert.match(overviewSource, /idle: 'Handle everything'/)
  assert.match(overviewSource, /title="Needs you"/)
  assert.doesNotMatch(overviewSource, /Review queue/)
  assert.match(sourceMapSource, /\['attention', 'Needs attention'\]/)
  assert.equal((sourceMapSource.match(/\['all', 'All projects'\]/g) || []).length, 1)
  assert.doesNotMatch(sourceMapSource, /\['sorting', 'Needs sorting'\]/)
  assert.match(feedSource, /\['history', 'Past'\]/)
  assert.match(feedSource, /key === 'history' \? ' is-secondary'/)
})

test('focused attention is separate from the contribution information card', () => {
  assert.match(feedSource, /<ContributionDecision[\s\S]*<ContributionCard/)
  assert.match(feedSource, /showDecision=\{false\}/)
  assert.match(cardSource, /export function ContributionDecision/)
  assert.match(cardSource, /className="co-decision-surface"/)
})

test('only mount and foreground freshness enumerate the complete history', () => {
  assert.equal(appSource.match(/loadLedger\(\)/g)?.length, 2)
  assert.match(appSource, /if \(!ledgerReadyRef\.current\) return/)
  assert.match(appSource, /loadContributionRecord\(recordId\)/)
  assert.match(appSource, /loadFreshContributionRecord\(rec\.id\)/)
  assert.match(appSource, /loadFreshContributionRecords\(/)
})

test('focused record paths are bounded and reject unsafe ids', () => {
  assert.deepEqual(contributionRecordPaths('record.1-ready'), [
    'contributions/record.1-ready.json',
    'contributions/record.1-ready.record.json',
  ])
  assert.deepEqual(contributionRecordPaths('../escape'), [])
  assert.deepEqual(contributionRecordPaths(''), [])
})

test('a focused record is inserted or refreshed without losing its storage path', () => {
  assert.deepEqual(upsertRecord([{ id: 'other', path: 'contributions/other.json' }], {
    id: 'focus', path: 'contributions/focus.json', status: 'prepared',
  }).map((record) => record.id), ['focus', 'other'])
  assert.deepEqual(upsertRecord([{
    id: 'focus', path: 'contributions/focus.record.json', status: 'prepared',
  }], {
    id: 'focus', status: 'open',
  }), [{
    id: 'focus', path: 'contributions/focus.record.json', status: 'open',
  }])
})

test('indexes only recognized review verdicts', () => {
  const indexed = indexReviewStatus({
    generated_at: '2026-07-15T02:00:00Z',
    records: [
      { id: 'good', state: 'ready', code: 'ready', message: 'Exact.' },
      { id: 'stale', state: 'needs_refresh', code: 'branch_moved', message: 'Moved.' },
      { id: 'future', state: 'maybe' },
      null,
    ],
  })
  assert.deepEqual(Object.keys(indexed.byId), ['good', 'stale'])
  assert.equal(indexed.checkedAt, '2026-07-15T02:00:00Z')
})

test('an unchecked retryable failure does not bounce a review into attention', () => {
  const state = reviewStateFor({
    id: 'old', status: 'prepared', last_submit_error: 'Branch changed.',
  }, { state: 'unavailable', byId: {} })
  assert.equal(state, null)
})

test('the failure message never overrides the verdict the platform gave', () => {
  // The platform reports upstream_conflict itself now, recomputed from the
  // branch. A message left by an earlier attempt describes a branch that may
  // already have been refreshed, so it must not outrank a fresh verdict.
  const ready = { state: 'ready', code: 'ready', message: 'Local checkout matches.' }
  const state = reviewStateFor({
    id: 'stale',
    status: 'prepared',
    last_submit_error: 'This PR no longer merges cleanly with upstream main.',
  }, { state: 'ready', byId: { stale: ready } })
  assert.deepEqual(state, ready)
})

test('a conflict the platform reports is passed through untouched', () => {
  const blocked = {
    state: 'needs_refresh',
    code: 'upstream_conflict',
    message: 'This no longer merges cleanly with the branch it targets.',
  }
  const state = reviewStateFor(
    { id: 'conflicted', status: 'prepared' },
    { state: 'ready', byId: { conflicted: blocked } },
  )
  assert.deepEqual(state, blocked)
})

test('a fresh ready verdict wins over retryable persisted submit failures', () => {
  for (const lastSubmitError of [
    'Could not inspect fork state. Try Send again.',
    'Could not submit this PR (500). Try Send again.',
  ]) {
    const ready = { state: 'ready', code: 'ready', message: 'Local checkout matches.' }
    const state = reviewStateFor({
      id: 'retryable', status: 'prepared', last_submit_error: lastSubmitError,
    }, { state: 'ready', byId: { retryable: ready } })
    assert.deepEqual(state, ready)
  }
})

test('summarizes ready, blocked, and unchecked reviews', () => {
  const records = [
    { id: 'a', status: 'prepared' },
    { id: 'b', status: 'prepared' },
    { id: 'c', status: 'prepared' },
    { id: 'open', status: 'open' },
  ]
  const review = indexReviewStatus({ records: [
    { id: 'a', state: 'ready' },
    { id: 'b', state: 'needs_refresh', message: 'Moved.' },
  ] })
  assert.deepEqual(summarizeReviewStatus(records, review), {
    total: 3, ready: 1, needsRefresh: 1, unchecked: 1,
  })
  assert.equal(blockedReviewCount(records, review), 1)
})

test('batch and feed share the same needs-attention partition', () => {
  const clear = (id) => ({
    id, status: 'prepared', plan: { head_sha: `${id}-head` },
    quality_review: { state: 'all_clear', reviewed_head_sha: `${id}-head` },
  })
  const units = [
    {
      type: 'record', id: 'ready',
      record: clear('ready'),
      records: [clear('ready')],
    },
    {
      type: 'record', id: 'blocked',
      record: { id: 'blocked', status: 'prepared' },
      records: [{ id: 'blocked', status: 'prepared' }],
    },
    {
      type: 'record', id: 'attention',
      record: { ...clear('attention'), needs_attention: true },
      records: [{ ...clear('attention'), needs_attention: true }],
    },
    {
      type: 'stack', id: 'stack',
      records: [
        { id: 'stack-1', status: 'open' },
        clear('stack-2'),
      ],
    },
  ]
  const partition = partitionReviewUnits(units, {
    byId: {
      ready: { state: 'ready' },
      blocked: { state: 'needs_refresh' },
      attention: { state: 'ready' },
      'stack-2': { state: 'ready' },
    },
  })
  assert.deepEqual(partition.needsAttention.map((unit) => unit.id), ['blocked', 'attention'])
  assert.deepEqual(partition.checking, [])
  assert.deepEqual(partition.readyToSend.map((unit) => unit.id), ['ready', 'stack'])
})

test('prepared platform checks have explicit active, pass, and failure states', () => {
  const base = {
    id: 'platform', type: 'pr', status: 'prepared', repo: 'mobius-os/mobius',
    plan: { action: 'pr', repo: 'mobius-os/mobius' },
  }
  assert.equal(canRunPrePrChecks(base), true)
  assert.equal(canRunPrePrChecks({ ...base, plan: { ...base.plan, stack: {} } }), false)
  assert.equal(canRunPrePrChecks({ ...base, repo: 'mobius-os/app-demo', plan: {
    action: 'pr', repo: 'mobius-os/app-demo',
  } }), false)

  assert.equal(prePrCheckPhase({
    ...base, pre_pr_checks: { state: 'in_progress' },
  }), 'running')
  assert.equal(prePrCheckPhase({
    ...base, pre_pr_checks: { state: 'completed', conclusion: 'success' },
  }), 'passed')
  assert.equal(prePrCheckPhase({
    ...base, pre_pr_checks: { state: 'completed', conclusion: 'failure' },
  }), 'failed')
  assert.equal(prePrCheckPhase({
    ...base, pre_pr_checks: { state: 'error', message: 'Could not start.' },
  }), 'failed')
})

test('running pre-PR checks leave the send batch and failures enter follow-up', () => {
  const record = (id, pre_pr_checks) => ({
    id, type: 'pr', status: 'prepared', repo: 'mobius-os/mobius',
    plan: {
      action: 'pr', repo: 'mobius-os/mobius', title: id,
      head_sha: `${id}-head`,
    },
    quality_review: { state: 'all_clear', reviewed_head_sha: `${id}-head` },
    pre_pr_checks,
  })
  const units = [
    { type: 'record', id: 'running', record: record('running', { state: 'queued' }), records: [record('running', { state: 'queued' })] },
    { type: 'record', id: 'failed', record: record('failed', { state: 'completed', conclusion: 'failure' }), records: [record('failed', { state: 'completed', conclusion: 'failure' })] },
    { type: 'record', id: 'passed', record: record('passed', { state: 'completed', conclusion: 'success' }), records: [record('passed', { state: 'completed', conclusion: 'success' })] },
  ]
  const partition = partitionReviewUnits(units, { byId: {
    running: { state: 'ready' },
    failed: { state: 'ready' },
    passed: { state: 'ready' },
  } })
  assert.deepEqual(partition.checking.map((unit) => unit.id), ['running'])
  assert.deepEqual(partition.needsAttention.map((unit) => unit.id), ['failed'])
  assert.deepEqual(partition.readyToSend.map((unit) => unit.id), ['passed'])

  const action = addressAllAction(units.flatMap((unit) => unit.records), { byId: {} })
  assert.equal(action.count, 1)
  assert.match(action.draft, /failed/)
  assert.match(action.draft, /pre-PR GitHub checks need a fix/i)
})

test('address all collects active local and published blockers but not history', () => {
  const records = [
    {
      id: 'local', type: 'pr', status: 'prepared', repo: 'mobius-os/app-local',
      plan: { title: 'Refresh local change' },
    },
    {
      id: 'live', type: 'pr', status: 'open', repo: 'mobius-os/app-live',
      title: 'Fix live checks', url: 'https://github.com/mobius-os/app-live/pull/8',
      needs_attention: true,
      attention: { title: 'Checks failed', message: 'One test is red.' },
    },
    {
      id: 'history', type: 'pr', status: 'merged', title: 'Already merged',
      needs_attention: true,
    },
    {
      id: 'issue', type: 'issue', status: 'open', title: 'An issue',
      needs_attention: true,
    },
    { id: 'clean', type: 'pr', status: 'open', title: 'Clean PR' },
  ]
  const review = {
    byId: {
      local: {
        state: 'needs_refresh',
        message: 'The source branch moved.',
      },
    },
  }

  assert.deepEqual(
    contributionsNeedingAttention(records, review).map((rec) => rec.id),
    ['local', 'live'],
  )
  const action = addressAllAction(records, review)
  assert.equal(action.count, 2)
  assert.match(action.draft, /Refresh local change — mobius-os\/app-local/)
  assert.match(action.draft, /The source branch moved\./)
  assert.match(action.draft, /Checks failed — One test is red\./)
  assert.match(action.draft, /Do not push, reply, publish, merge/)
  assert.doesNotMatch(action.draft, /Already merged|An issue|Clean PR/)
})
test('the optional fork preflight is named as checks rather than an ambiguous test', () => {
  assert.match(cardSource, />\{rec\.pre_pr_checks \? 'Check fork again' : 'Check on fork'\}<\/span>/)
  assert.match(cardSource, /Run the full GitHub checks on your fork/)
  assert.doesNotMatch(cardSource, /<span>Test<\/span>/)
  assert.match(cardSource, /<span>Move to history<\/span>/)
  assert.match(cardSource, /It does not\s+open a pull request/)
})

test('prepared decisions keep their private escape hatch when attention is present', () => {
  assert.match(cardSource, /\{hasPreparedAction \? \([\s\S]*?<ReviewActions/)
  assert.doesNotMatch(cardSource, /hasPreparedAction\s*&&\s*!hasSubmitAlert/)
  assert.match(cardSource, /<span>Move to history<\/span>/)
})

test('compact public actions disappear only after the accepted send', () => {
  assert.match(feedSource, /!privateAction && \(outcome\?\.ok \|\| outcome\?\.pending \|\| outcome\?\.alreadyHandled\)[\s\S]*?setAccepted\(true\)/)
  assert.match(feedSource, /if \(accepted\) return null/)
  assert.match(feedSource, /privateAction && outcome\?\.ok[\s\S]*?setStartedChatId/)
})

test('all clear belongs to the exact prepared head', () => {
  const record = {
    id: 'reviewed', type: 'pr', status: 'prepared',
    plan: { head_sha: 'a'.repeat(40) },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'a'.repeat(40) },
  }
  const source = { byId: { reviewed: { state: 'ready' } } }
  assert.equal(isAllClear(record, source), true)
  assert.equal(qualityReviewFor({
    ...record, plan: { head_sha: 'b'.repeat(40) },
  }).state, 'needed')
})

test('prepared work stays out of send until a thorough review is all clear', () => {
  const needed = { id: 'needed', type: 'pr', status: 'prepared', plan: { head_sha: 'a'.repeat(40) } }
  const clear = {
    id: 'clear', type: 'pr', status: 'prepared', plan: { head_sha: 'b'.repeat(40) },
    quality_review: { state: 'all_clear', reviewed_head_sha: 'b'.repeat(40) },
  }
  const source = { byId: { needed: { state: 'ready' }, clear: { state: 'ready' } } }
  const parts = partitionReviewUnits([
    { id: 'needed', record: needed }, { id: 'clear', record: clear },
  ], source)
  assert.deepEqual(parts.needsReview.map((unit) => unit.id), ['needed'])
  assert.deepEqual(parts.readyToSend.map((unit) => unit.id), ['clear'])
  assert.match(reviewAllAction([needed]).draft, /correctness, maintainability, simplicity/)
  assert.match(reviewAllAction([needed]).draft, /Do not push, publish, comment, merge/)
  assert.equal(reviewAllAction([needed]).scope, contributionReviewScope([needed]))
})

test('one exact prepared head has one stable review conversation scope', () => {
  const first = { id: 'first', plan: { head_sha: 'a'.repeat(40) } }
  const second = { id: 'second', plan: { head_sha: 'b'.repeat(40) } }
  const scope = contributionReviewScope([first, second])

  assert.match(scope, /^contribute-review:[0-9a-f]{16}$/)
  assert.equal(contributionReviewScope([second, first]), scope)
  assert.notEqual(
    contributionReviewScope([first, { ...second, plan: { head_sha: 'c'.repeat(40) } }]),
    scope,
  )
  assert.notEqual(contributionReviewScope([first, second], 'fix'), scope)
})

test('the card review action exposes launch progress and the started conversation', () => {
  assert.match(cardSource, /<AgentHandoffButton/)
  assert.match(cardSource, /action=\{reviewAction \|\| reviewAllAction\(\[rec\]\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.doesNotMatch(cardSource, /onClick=\{\(\) => onReview\(rec\)\}/)
  assert.match(feedSource, /onReview=\{onStartAgent\}/)
  assert.match(feedSource, /reviewAction=\{progressReviewAction\(\[rec\], reviewStatus\)\}/)
})

test('a scoped review delegates exactly-once admission to chat.start', () => {
  assert.doesNotMatch(appSource, /chat\.list\(\{ scope: action\.scope \}\)/)
  assert.match(appSource, /window\.mobius\.chat\.start\(\{[\s\S]*scope: action\.scope/)
  assert.match(appSource, /reused: started\.reused === true/)
  assert.match(appSource, /outcome: started\.outcome/)
})

test('a reviewed existing-PR update stays distinct from opening a new PR', () => {
  assert.match(appSource, /refreshed\.plan\?\.action === 'pr_update'/)
  assert.match(appSource, /updateContribution\(\{ appId, token, rec: refreshed \}\)/)
  assert.match(appSource, /Connect GitHub before updating this pull request/)
  assert.match(cardSource, /pr_update: 'Update PR'/)
  assert.match(cardSource, /isUpdate \? 'Update PR' : 'Open PR'/)
  assert.match(cardSource, /Pull request updated on GitHub/)
  assert.match(appSource, /\? updateContributionStack\s*: submitContributionStack/)
})

test('submit failures lead back to private agent recovery without overstating a stale push', () => {
  const record = {
    id: 'existing-pr', title: 'Refine the existing contribution',
    plan: { head_sha: 'a'.repeat(40) },
  }
  const action = recoveryReviewAction(record)
  assert.equal(action.scope, 'contribute-review:b0661670f342e064')
  assert.equal(action.reusedLabel, 'Review already running')
  assert.match(action.draft, /reconcile the contribution record/)
  assert.match(action.draft, /existing approval button/)
  assert.match(cardSource, /rec\.last_submit_stage === 'pushed'/)
  assert.match(cardSource, /rec\.last_submit_push_sha/)
  assert.match(cardSource, /rec\.plan\?\.head_sha/)
  assert.match(cardSource, /action=\{recoveryReviewAction\(rec\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.match(cardSource, /Review needs refreshing/)
  assert.match(cardSource, /<summary>Technical details<\/summary>/)
  assert.match(cardSource, /const submitFailed = Boolean\(rec\.last_submit_error\)/)
  assert.match(cardSource, /!reviewIncomplete && !submitFailed/)
})

test('one queue handoff owns every visible private review job', () => {
  const records = [
    { id: 'fresh', type: 'pr', status: 'prepared', title: 'Fresh review' },
    {
      id: 'fix', type: 'pr', status: 'prepared', title: 'Needs a fix',
      quality_review: { state: 'changes_needed' },
    },
    { id: 'stale', type: 'pr', status: 'prepared', title: 'Stale head' },
    {
      id: 'clear', type: 'pr', status: 'prepared', title: 'Already clear',
      plan: { head_sha: 'c'.repeat(40) },
      quality_review: { state: 'all_clear', reviewed_head_sha: 'c'.repeat(40) },
    },
  ]
  const source = { byId: {
    stale: { state: 'needs_refresh' },
    clear: { state: 'ready' },
  } }
  const action = progressReviewAction(records, source)
  assert.equal(action.count, 3)
  assert.equal(action.scope, contributionReviewScope(records.slice(0, 3), 'progress'))
  assert.equal(action.label, 'Work through 3')
  assert.match(action.draft, /Fresh review/)
  assert.match(action.draft, /Needs a fix/)
  assert.match(action.draft, /Stale head/)
  assert.doesNotMatch(action.draft, /Already clear/)
  assert.match(action.draft, /Do not push, publish, comment, merge/)
})

test('a focused active review reuses the queue scope instead of starting a second review', () => {
  const record = {
    id: 'active', type: 'pr', status: 'prepared',
    plan: { head_sha: 'd'.repeat(40) },
    quality_review: { state: 'reviewing', reviewed_head_sha: 'd'.repeat(40) },
  }
  const action = progressReviewAction([record], { byId: { active: { state: 'ready' } } })

  assert.equal(action.label, 'Open review')
  assert.equal(action.scope, contributionReviewScope([record], 'progress'))
  assert.match(cardSource, /reviewInProgress[\s\S]*'Review in progress'/)
})

test('address all handoff stays private and names every active blocker', () => {
  const records = [
    {
      id: 'prepared', type: 'pr', status: 'prepared', repo: 'mobius-os/mobius',
      title: 'Refresh prepared branch',
    },
    {
      id: 'open', type: 'pr', status: 'open', repo: 'mobius-os/app-demo',
      title: 'Handle review feedback', needs_attention: true,
      attention: { message: 'A reviewer requested a focused test.' },
      url: 'https://github.com/mobius-os/app-demo/pull/7',
    },
    {
      id: 'merged', type: 'pr', status: 'merged', needs_attention: true,
      title: 'Settled work',
    },
  ]
  const reviewStatus = {
    byId: {
      prepared: {
        state: 'needs_refresh',
        message: 'The reviewed branch moved.',
      },
    },
  }

  const action = addressAllAction(records, reviewStatus)
  assert.equal(action.count, 2)
  assert.equal(action.label, 'Address all 2')
  assert.match(action.draft, /Refresh prepared branch/)
  assert.match(action.draft, /Handle review feedback/)
  assert.doesNotMatch(action.draft, /Settled work/)
  assert.match(action.draft, /Do not push, reply, publish, merge/)
})

test('finish cycle handoff spans review, durable waiting, and local alignment', () => {
  const action = finishContributionCycleAction([
    { id: 'one', type: 'pr', status: 'prepared' },
    { id: 'two', type: 'pr', status: 'open', needs_attention: true },
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, 3)

  assert.equal(action.label, 'Run full cycle')
  assert.equal(action.count, 5)
  assert.match(action.draft, /^Finish the contribution cycle for these projects\./)
  assert.match(action.draft, /1 privately prepared/)
  assert.match(action.draft, /1 public or publishing/)
  assert.match(action.draft, /3 projects needing reconciliation/)
  assert.match(action.draft, /durable waits/)
  assert.match(action.draft, /reconcile each local project/)
  assert.match(action.draft, /activation or restart separately confirmed/)
  assert.match(action.startedMessage, /Stay in Contribute/)
})

test('finish cycle handoff is absent when there is no active work', () => {
  assert.equal(finishContributionCycleAction([
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, 0), null)
})

test('cycle lifecycle distinguishes running, waiting, paused, and settled work', () => {
  assert.equal(contributionCyclePhase({ running: true }), 'running')
  assert.equal(contributionCyclePhase({ running: false, pending_question_id: 'q1' }), 'waiting')
  assert.equal(contributionCyclePhase({ running: false, goal: { status: 'paused' } }), 'paused')
  assert.equal(contributionCyclePhase({ running: false, goal: { status: 'completed' } }), 'complete')
})

test('cycle recovery survives an auto-renamed legacy conversation', () => {
  assert.equal(isContributionCycleChat({ scope: 'contribute-cycle', title: 'Anything' }), true)
  assert.equal(isContributionCycleChat({ title: 'Finishing the contribution cycle' }), true)
  assert.equal(isContributionCycleChat({ scope_label: 'Contribution cycle' }), true)
  assert.equal(isContributionCycleChat({ title: 'Review Contribute changes' }), false)
})

test('cycle progress uses the durable plan and current task', () => {
  assert.deepEqual(contributionCycleProgress({
    running: true,
    goal_plan: {
      tasks: [
        { id: 'prepare', title: 'Prepare local work', status: 'completed' },
        { id: 'review', title: 'Review prepared changes', status: 'running' },
      ],
      summary: { completed: 1, total: 2 },
    },
  }), {
    completed: 1,
    total: 2,
    percent: 50,
    label: 'Review prepared changes',
  })
})
