import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  actionQueueDefaultAction,
  addressAllAction,
  contributionActionScope,
  contributionFailureOwner,
  contributionReviewTargetFromIntent,
  contributionReviewScope,
  focusedContributionNavigationReady,
  focusedContributionReady,
  contributionCyclePhase,
  contributionCycleProgress,
  isAllClear,
  locateContributionReview,
  organizePrivateWorkAction,
  partitionReviewUnits,
  progressReviewAction,
  qualityReviewFor,
  recoveryReviewAction,
  reviewAllAction,
} from '../review.js'
import { upsertRecord } from '../domain.js'
import { contributionRecordPaths } from '../storage.js'

const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const batchSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const stackSource = readFileSync(new URL('../ui/ContributionStack.jsx', import.meta.url), 'utf8')
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

test('review queues own compact defaults and one grouped action', () => {
  assert.match(feedSource, /className=\{'co-review-default/)
  assert.match(feedSource, /actionQueueDefaultAction\(unitRecords\(unit\), reviewStatus\)/)
  assert.match(feedSource, /<StageDefaultAction/)
  assert.match(feedSource, /Send all \{prepared\.length\}/)
  assert.match(feedSource, /unit\.type !== 'stack'/)
  assert.match(feedSource, /className="co-stage-batch-list"/)
  assert.match(feedSource, /record\.plan\?\.action === 'pr_update' \? 'Update pull request' : 'Open pull request'/)
  assert.doesNotMatch(feedSource, /One public approval/)
  assert.doesNotMatch(feedSource, /One private review/)
})

test('prepared decisions retain dismissal and private reviews retain re-entry', () => {
  assert.match(cardSource, /\{hasPreparedAction \? \([\s\S]*?<ReviewActions/)
  assert.doesNotMatch(cardSource, /hasPreparedAction\s*&&\s*!hasSubmitAlert/)
  assert.match(feedSource, /if \(!privateAction\) setAccepted\(true\)[\s\S]*?await onSend\?\.\(record\)/)
  assert.match(feedSource, /privateAction && outcome\?\.ok[\s\S]*?setStartedChatId/)
  assert.match(feedSource, /startedChatId \? 'Open review'/)
})

test('batch recovery always releases its confirmation state', () => {
  assert.match(feedSource, /async function publishAll\(\)[\s\S]*?try \{[\s\S]*?await onStartAgent\?\.\(fixAndReviewAction\(failedRecords\)\)[\s\S]*?\} catch \{[\s\S]*?\} finally \{[\s\S]*?setBusy\(false\)[\s\S]*?setConfirming\(false\)/)
})

test('the active cycle presents opening its conversation as a bordered action', () => {
  assert.match(overviewSource, /className="co-btn co-btn-sm"[^>]*>Open conversation<\/button>/)
})

test('the app navigation and supporting screens follow the owner task instead of internal stages', () => {
  assert.match(appSource, />\s*To do\s*</)
  assert.match(appSource, />\s*Pull requests\s*</)
  assert.match(appSource, />\s*Issues\s*</)
  assert.match(overviewSource, /idle: 'Organize private work'/)
  assert.match(overviewSource, /Status and reconciliation are automatic/)
  assert.match(overviewSource, /Earlier work paused/)
  assert.match(overviewSource, /Organize latest work/)
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
    id: 'focus', path: 'contributions/focus.json', status: 'prepared',
  }], {
    id: 'focus', status: 'open',
  }), [{
    id: 'focus', path: 'contributions/focus.json', status: 'open',
  }])
})

test('prepared card actions use one small, plain-language vocabulary', () => {
  assert.doesNotMatch(cardSource, /Run the full GitHub checks on your fork/)
  assert.doesNotMatch(cardSource, /Check on fork/)
  assert.match(cardSource, /<span>Chat<\/span>/)
  assert.match(cardSource, /<span>Dismiss<\/span>/)
  assert.match(cardSource, /can be restored from Past/)
  assert.doesNotMatch(cardSource, /Move to History/)
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
  assert.match(appSource, /window\.mobius\.chat\.start\(\{[\s\S]*scope: contributionActionScope\(action\)/)
  assert.match(appSource, /reused: started\.reused === true/)
  assert.match(appSource, /outcome: started\.outcome/)
})

test('all private handoffs use changed-work scopes instead of permanent one-shot chats', () => {
  const action = { event: 'prepare', title: 'Prepare work', draft: 'Current source A' }
  const scope = contributionActionScope(action)
  assert.match(scope, /^contribute-task:[0-9a-f]{16}$/)
  assert.equal(contributionActionScope({ ...action }), scope)
  assert.notEqual(contributionActionScope({ ...action, draft: 'Current source B' }), scope)
  assert.equal(contributionActionScope({ ...action, scope: 'exact-head' }), 'exact-head')
  assert.doesNotMatch(appSource, /scope: 'contribute-cycle'/)
})

test('a reviewed existing-PR update stays distinct from opening a new PR', () => {
  assert.match(appSource, /refreshed\.plan\?\.action === 'pr_update'/)
  assert.match(appSource, /updateContribution\(\{ appId, token, rec: refreshed \}\)/)
  assert.match(appSource, /Connect GitHub before updating this pull request/)
  assert.match(cardSource, /pr_update: 'Update PR'/)
  assert.match(cardSource, /isUpdate \? 'Send update' : 'Send PR'/)
  assert.match(appSource, /\? updateContributionStack\s*: submitContributionStack/)
})

test('existing pull-request stacks expose one exact update action', () => {
  assert.match(stackSource, /rec\?\.plan\?\.action === 'pr_update'/)
  assert.match(stackSource, /ready\.length === 1 \? 'Update PR' : 'Update PRs'/)
  assert.match(stackSource, /fast-forward the linked pull/)
})

test('sending a pull request stays concise instead of repeating publication narration', () => {
  assert.match(cardSource, /sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)/)
  assert.doesNotMatch(cardSource, /Opening pull request/)
  assert.doesNotMatch(cardSource, /Pull request opened on GitHub for review/)
  assert.doesNotMatch(cardSource, /sendElapsed/)
  assert.match(cardSource, /setAccepted\(true\)[\s\S]*await onSend\(rec\)/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.match(cardSource, /await onReview\?\.\(recoveryReviewAction\(rec\)\)/)
  assert.match(feedSource, /setAccepted\(true\)[\s\S]*await onSend\?\.\(record\)/)
  assert.doesNotMatch(feedSource, /setNote\(outcome\.pending \? 'Publishing…'/)
  assert.match(batchSource, /collapseOnStart = true/)
  assert.match(batchSource, /if \(collapseOnStart\) return null/)
  assert.match(stackSource, /repairAction[\s\S]*<AgentHandoffButton/)
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
  assert.equal(action.label, 'Review all')
  assert.match(action.draft, /Fresh review/)
  assert.match(action.draft, /Needs a fix/)
  assert.match(action.draft, /Stale head/)
  assert.doesNotMatch(action.draft, /Already clear/)
  assert.match(action.draft, /Do not push, publish, comment, merge/)
})

test('the Needs-you default covers mixed private review and public attention', () => {
  const records = [
    { id: 'review', type: 'pr', status: 'prepared', title: 'Review me' },
    { id: 'attention', type: 'pr', status: 'open', title: 'Fix checks', needs_attention: true },
  ]
  const action = actionQueueDefaultAction(records, { byId: {} })
  assert.equal(action.label, 'Organize all')
  assert.equal(action.count, 2)
  assert.match(action.draft, /Do not push, publish, update a pull request, comment, merge/)
  assert.match(feedSource, /actionQueueDefaultAction\(unitRecords\(unit\), reviewStatus\)/)
  assert.doesNotMatch(feedSource, /privateAction\.count === 1 \? 'Review'/)
  assert.equal(actionQueueDefaultAction([records[0]], { byId: {} }).label, 'Review')
  assert.equal(actionQueueDefaultAction([records[1]], { byId: {} }).label, 'Fix')
  assert.equal(actionQueueDefaultAction([{
    ...records[0], needs_attention: true,
  }], { byId: {} }).label, 'Fix and review')
})

test('a focused active review reuses the queue scope instead of starting a second review', () => {
  const record = {
    id: 'active', type: 'pr', status: 'prepared',
    plan: { head_sha: 'd'.repeat(40) },
    quality_review: { state: 'reviewing', reviewed_head_sha: 'd'.repeat(40) },
  }
  const action = progressReviewAction([record], { byId: { active: { state: 'ready' } } })

  assert.equal(action.label, 'Open chat')
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

test('private work excludes healthy public PRs and delegates only judgment', () => {
  const action = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared' },
    { id: 'two', type: 'pr', status: 'open', needs_attention: true },
    { id: 'healthy', type: 'pr', status: 'open' },
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, [{ name: 'Notes' }, { name: 'Voice' }])

  assert.equal(action.label, 'Organize all')
  assert.equal(action.count, 4)
  assert.match(action.draft, /^Organize the current private contribution work/)
  assert.match(action.draft, /Notes/)
  assert.match(action.draft, /Voice/)
  assert.match(action.draft, /deterministic reconciliation helpers/)
  assert.match(action.draft, /Use agent judgment only where it is actually required/)
  assert.doesNotMatch(action.draft, /healthy/)
  assert.doesNotMatch(action.draft, /durable waits/)
  assert.match(action.startedMessage, /approval buttons update/)
})

test('private work starts a fresh scoped task only when represented work changes', () => {
  const first = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'first' } },
  ], { byId: {} }, [])
  const same = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'first' } },
  ], { byId: {} }, [])
  const changed = organizePrivateWorkAction([
    { id: 'one', type: 'pr', status: 'prepared', plan: { head_sha: 'second' } },
  ], { byId: {} }, [])

  assert.equal(contributionActionScope(first), contributionActionScope(same))
  assert.notEqual(contributionActionScope(first), contributionActionScope(changed))
})

test('healthy public work stays automatic instead of creating an agent task', () => {
  assert.equal(organizePrivateWorkAction([
    { id: 'open', type: 'pr', status: 'open' },
    { id: 'old', type: 'pr', status: 'merged' },
  ], { byId: {} }, []), null)
})

test('public action failures have one truthful owner', () => {
  assert.equal(contributionFailureOwner({ failure: { owner: 'automatic' } }), 'automatic')
  assert.equal(contributionFailureOwner({ failure: { status: 403 } }), 'owner')
  assert.equal(contributionFailureOwner({ failure: { code: 'github_not_connected' } }), 'owner')
  assert.equal(contributionFailureOwner({ failure: { code: 'review_refresh_needed' } }), 'agent')
  assert.match(cardSource, /contributionFailureOwner\(outcome\) === 'agent'/)
  assert.match(feedSource, /contributionFailureOwner\(outcome\) === 'agent'/)
  assert.match(stackSource, /contributionFailureOwner\(outcome\) === 'agent'/)
  assert.match(appSource, /Related PR stacks still use your personal GitHub connection[\s\S]*?failure: \{ owner: 'owner', code: 'github_not_connected' \}/)
})

test('cycle lifecycle distinguishes running, waiting, paused, and settled work', () => {
  assert.equal(contributionCyclePhase({ running: true }), 'running')
  assert.equal(contributionCyclePhase({ running: false, pending_question_id: 'q1' }), 'waiting')
  assert.equal(contributionCyclePhase({ running: false, goal: { status: 'paused' } }), 'paused')
  assert.equal(contributionCyclePhase({ running: false, goal: { status: 'completed' } }), 'complete')
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
