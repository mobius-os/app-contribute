import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
const connectionSource = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
const batchActionSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
const runSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8')

test('send actions keep a visible label instead of relying on the icon alone', () => {
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /count === 1 \? 'Send' : `Send all \$\{count\}`/)
})

test('focused review actions keep one strong primary and compact phone-safe secondary controls', () => {
  assert.match(cardSource, /className="co-icon-btn co-review-btn is-primary"/)
  assert.match(themeSource, /\.co-icon-btn\.co-review-btn\.is-primary \{[\s\S]*?background: var\(--accent\); color: var\(--accent-fg\)/)
  assert.match(themeSource, /\.co-focus-view \.co-review-actions \{[\s\S]*?grid-template-columns: minmax\(112px, 1fr\) auto auto/)
  assert.match(themeSource, /\.co-focus-view \.co-secondary-action \{[\s\S]*?width: auto;[\s\S]*?padding-inline: 11px/)
  assert.match(themeSource, /\.co-technical-summary \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(themeSource, /\.co-review-changes-head span \{[\s\S]*?white-space: nowrap;[\s\S]*?border-radius: 999px/)
  assert.match(themeSource, /\.co-pr-metadata \{[^}]*align-self: stretch;[^}]*width: 100%/)
})

test('prepared work has no parallel fork-check workflow', () => {
  for (const source of [cardSource, apiSource, appSource]) {
    assert.doesNotMatch(source, /pre[_-]pr[_-]checks|pre-pr-checks|Run GitHub checks/)
  }
})

test('single and grouped sends leave the active action from durable results', () => {
  assert.match(cardSource, /setAccepted\(true\)/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.doesNotMatch(cardSource, /sendElapsed/)
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\)\)/)
  assert.match(appSource, /if \(updates\.length > 0\) \{\s*applyRecordUpdates\(updates\)/)
})

test('sending uses the shell-style label sweep instead of a rotating action spinner', () => {
  assert.doesNotMatch(cardSource, /co-action-spinner/)
  assert.match(cardSource, /co-action-label-sweep/)
  assert.match(themeSource, /@keyframes co-action-sweep/)
  assert.match(themeSource, /prefers-reduced-motion: no-preference/)
})

test('review details show the agent\'s prior-work search and decision', () => {
  assert.match(cardSource, /plan\.prior_work/)
  assert.match(cardSource, /Existing work checked/)
  assert.match(cardSource, /Search details/)
  assert.match(cardSource, /No overlapping work found/)
  assert.match(cardSource, /distinct pull request is justified after comparison/)
  assert.match(cardSource, /startsWith\('https:\/\/github\.com\/'\)/)
  assert.match(themeSource, /\.co-prior-work \{/)
})

test('review details show reviewed labels and truthful published outcomes', () => {
  assert.match(cardSource, /function PlanLabels/)
  assert.match(cardSource, /contributionLabelOutcome\(rec\)/)
  assert.match(cardSource, /aria-label="Published GitHub label outcome"/)
  assert.match(cardSource, /aria-label="Published GitHub labels"/)
  assert.match(cardSource, /label="Requested"/)
  assert.match(cardSource, /Not available/)
  assert.match(cardSource, /Not confirmed/)
  assert.match(cardSource, /do not send it again/)
  assert.match(cardSource, /Review labels on GitHub/)
  assert.match(cardSource, /<PlanLabels rec=\{rec\}/)
})

test('global app handoffs stay durable while source-linked work returns to its chat', () => {
  assert.match(appSource, /window\.mobius\?\.chat\?\.start/)
  assert.match(appSource, /scope: contributionActionScope\(action\)/)
  assert.match(batchActionSource, /function openAgentConversation\(chatId\)/)
  assert.match(batchActionSource, /type: 'moebius:open-chat',[\s\S]*chatId,[\s\S]*}, '\*'\)/)
  assert.match(batchActionSource, /openAgentConversation\(started\?\.chatId\)/)
  assert.match(appSource, /openAgentConversation\(cycle\.chatId\)/)
  assert.doesNotMatch(batchActionSource, /postMessage\([\s\S]*window\.location\.origin/)
  assert.doesNotMatch(appSource, /type: 'moebius:new-chat'/)
  assert.doesNotMatch(appSource, /type: 'moebius:open-chat', draft: action\.draft/)
  assert.doesNotMatch(sourceMapSource, /<AgentHandoffButton/)
  assert.match(sourceMapSource, /onViewReview\(rec, project\.key\)/)
  assert.match(feedSource, /function SourceChatChoices/)
  assert.match(feedSource, /Private work can be handled together/)
  assert.match(appSource, /const onFeedback = useCallback/)
  assert.match(appSource, /type: 'moebius:open-chat', chatId: rec\.chat_id, draft \},[\s\S]{0,20}'\*'\)/)
  assert.doesNotMatch(appSource, /moebius:open-chat[\s\S]{0,200}window\.location\.origin/)
  assert.doesNotMatch(connectionSource, /onAskAgent/)
})

test('pull requests and requests share one decision-first Run', () => {
  assert.doesNotMatch(appSource, /id="co-tab-prs"/)
  assert.doesNotMatch(appSource, /id="co-tab-issues"/)
  assert.match(appSource, /<ContributionRun/)
  assert.match(runSource, /REQUEST_TYPES = new Set\(\['issue', 'issue_comment', 'discussion_comment'\]\)/)
  assert.match(runSource, /decisions\.push\(decision\('request'/)
  assert.match(cardSource, /!isPr && rec\.status === 'prepared'/)
  assert.match(feedSource, /STATE_LABELS/)
})

test('focused projects and contribution decisions use the same quiet return pattern', () => {
  assert.match(sourceMapSource, /selectedProject \? <h2 className="co-visually-hidden">Project detail<\/h2>/)
  assert.match(feedSource, /Back to the run/)
  assert.match(sourceMapSource, /Back to run/)
  assert.match(appSource, /returnProjectKey: projectKey/)
  assert.match(feedSource, /setFocusReturnProject\(String\(focusTarget\.returnProjectKey \|\| ''\)\)/)
  assert.match(feedSource, /if \(returnProjectKey\) onViewProject\?\.\(returnProjectKey\)/)
  assert.match(sourceMapSource, /function closeProject\(\) \{\s*setSelected\(''\)/)
  assert.match(sourceMapSource, /rows\.map\(\(rec\)/)
  assert.doesNotMatch(sourceMapSource, /Open pull requests/)
  assert.doesNotMatch(feedSource, /<ViewHeading/)
})

test('an assigned incoming review stays recoverable until its conversation starts', () => {
  assert.match(
    appSource,
    /const started = await startAgentTask\([\s\S]*if \(!started\.ok\)[\s\S]*Assigned on GitHub[\s\S]*setIncomingReviews/,
  )
})

test('preparation runs as one cycle while every public send stays explicit', () => {
  assert.match(feedSource, /function PrivateRunAction/)
  assert.match(feedSource, /Private work can be handled together/)
  assert.match(feedSource, /Earlier private work paused/)
  assert.match(feedSource, /<PrivateRunAction/)
  assert.doesNotMatch(sourceMapSource, /<AgentHandoffButton/)
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /role="alertdialog"/)
  assert.match(feedSource, /Nothing merges\./)
  assert.match(feedSource, /Personal pull requests open ready for review/)
  assert.match(feedSource, /item\?\.unit\?\.type === 'stack'/)
  assert.match(feedSource, /outcome = await onSendStack\?\.\(runUnitRecords\(item\)\)/)
  assert.doesNotMatch(batchActionSource, /role="alertdialog"/)
  assert.doesNotMatch(batchActionSource, /Keep private/)
  assert.match(batchActionSource, /className="co-agent-handoff"/)
  assert.match(batchActionSource, /onClick=\{run\}/)
  assert.match(batchActionSource, /'Starting…'/)
  assert.match(batchActionSource, /aria-busy=\{busy\}/)
  assert.match(appSource, /resolveUncertainSubmission/)
})

test('blocked contributions have one calm recovery action', () => {
  assert.doesNotMatch(cardSource, /function fixAndReview\(\)/)
  assert.match(cardSource, /<AgentHandoffButton/)
  assert.match(cardSource, /action=\{recoveryReviewAction\(rec\)\}/)
  assert.match(cardSource, /onStart=\{onReview\}/)
  assert.doesNotMatch(cardSource, /Draft follow-up/)
  assert.match(cardSource, /'Fresh review needed'/)
  assert.match(cardSource, /This review needs a quick check before it can continue\./)
  assert.match(cardSource, /The reviewed branch reached GitHub/)
  assert.match(cardSource, /co-alert' \+ \(blocked \? ' is-follow-up'/)
  assert.match(themeSource, /\.co-section\.is-follow-up/)
  assert.match(themeSource, /\.co-alert\.is-follow-up/)
  assert.doesNotMatch(cardSource, /Sending is paused until/)
})

test('published check follow-ups use the same calm refresh treatment', () => {
  assert.match(cardSource, /className="co-icon-btn co-refresh-btn is-primary"/)
  assert.match(themeSource, /\.co-attention \{[^}]*var\(--accent\)[^}]*var\(--accent\)/)
  assert.doesNotMatch(
    themeSource,
    /\.co-attention \{[^}]*var\(--danger\)/,
  )
})

test('Möbius-bot withdrawal keeps the destructive action behind confirmation', () => {
  assert.match(cardSource, /function WithdrawAction\(\{ rec, onWithdraw \}\)/)
  assert.match(
    cardSource,
    /submission_mode === 'mobius-bot'[\s\S]*?\['draft', 'open'\]\.includes\(rec\.status\)[\s\S]*?relay_contribution_id/,
  )
  assert.match(cardSource, /onClick=\{\(\) => \{ setNote\(''\); setConfirming\(true\) \}\}/)
  assert.match(cardSource, /role="alertdialog"[\s\S]*?Confirm contribution withdrawal/)
  assert.match(cardSource, /ref=\{keepRef\}[\s\S]*?>\s*Keep open\s*<\/button>/)
  assert.match(
    cardSource,
    /className="co-btn co-btn-sm co-btn-caution"[\s\S]*?onClick=\{withdraw\}/,
  )
})

test('lost single and stacked submit responses reconcile durable state', () => {
  assert.match(apiSource, /uncertain: true/g)
  assert.match(appSource, /resolveUncertainSubmission/)
  assert.match(apiSource, /markContributionReady/)
  assert.match(apiSource, /detail\.code === 'ready_unconfirmed'/)
  assert.match(appSource, /fresh\?\.readying/)
  assert.match(appSource, /Repeating this route is read-only reconciliation/)
  assert.match(appSource, /return \{ pending: true, record: next, viaMobius \}/)
  assert.match(appSource, /summary\.state === 'publishing'/)
  assert.match(cardSource, /if \(accepted\) return null/)
  assert.doesNotMatch(apiSource, /return \{ error: String\(\(err && err\.message\)/)
})

test('the retired raw-ref Land path has no reachable client action', () => {
  assert.equal(existsSync(new URL('../ui/ContributionStack.jsx', import.meta.url)), false)
  assert.equal(existsSync(new URL('../ui/SourceOverview.jsx', import.meta.url)), false)
  assert.doesNotMatch(
    appSource,
    /\blandContributionStack\b|\bonLandStack\b|ui\/ContributionStack|SourceOverview/,
  )
  assert.doesNotMatch(apiSource, /landContributionStack|\/land-stack/)
  assert.doesNotMatch(feedSource, /Land stack|>\s*Land\s*</)
})

test('wide collection and review views share centered guides on one continuous canvas', () => {
  assert.match(themeSource, /\.co-page \{[\s\S]*?width: min\(100%, 1120px\)/)
  assert.match(themeSource, /\.co-contributions-view \{\s*width: min\(100%, 760px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-header \{[^}]*width: min\(100%, 760px\); margin-inline: auto/)
  assert.doesNotMatch(themeSource, /radial-gradient|linear-gradient\(var\(--bg\), var\(--bg\)\)/)
  assert.doesNotMatch(themeSource, /\.co-root::before/)
  assert.match(themeSource, /@media \(min-width: 900px\) \{[\s\S]*?\.co-header-shell \{ width: min\(100%, 760px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-header-shell \{\s*flex: 0 0 auto; width: 100%; background: var\(--bg\);\s*\}/)
  assert.match(appSource, /<div className="co-header-shell">[\s\S]*?<\/div>\s*<main/)
  assert.doesNotMatch(themeSource, /\.co-page\.is-sources \{\s*width:/)
})

test('cards use explicit links and detail buttons instead of a clickable container', () => {
  assert.doesNotMatch(cardSource, /handleCardClick|is-clickable/)
  assert.match(cardSource, /className="co-details-toggle"/)
  assert.match(cardSource, /className="co-card-title"/)
})

// Narration copy must not promise interactions the card no longer has: the
// whole-card tap was deliberately removed, so no status line may say "tap".
test('status narration never promises a tap', async () => {
  const { STATUS_NARRATION } = await import('../domain.js')
  for (const copy of Object.values(STATUS_NARRATION)) {
    assert.doesNotMatch(copy, /\btap\b/i)
  }
})

test('GitHub setup exposes only the device-flow connection path', () => {
  assert.doesNotMatch(connectionSource, /personal access token|connectToken|patSubmitting/)
  assert.doesNotMatch(connectionSource, /Advanced: use a token instead/)
  assert.doesNotMatch(apiSource, /connectToken|classicTokenUrl|classicWorkflowTokenUrl/)
  assert.match(connectionSource, /GitHub sign-in is not configured/)
})

test('GitHub device flow copies the code before opening the login link', () => {
  assert.match(
    connectionSource,
    /Copy the code[\s\S]*Copy code[\s\S]*Open GitHub and log in[\s\S]*Open GitHub/,
  )
  assert.match(connectionSource, /navigator\.clipboard\?\.writeText/)
  assert.match(connectionSource, /document\.execCommand\?\.\('copy'\)/)
  assert.match(themeSource, /user-select: text; -webkit-user-select: text/)
})

test('GitHub setup defaults to full PR access and migrates older connections', () => {
  assert.match(connectionSource, /workflow: true/)
  assert.match(
    connectionSource,
    /onStart=\{\(\) => startDeviceFlow\(null, \{ privateRepos: includePrivate \}\)\}/,
  )
  assert.match(
    connectionSource,
    /placement !== 'content'[\s\S]*?conn\?\.state !== 'connected'[\s\S]*?hasFullPrAccess\(conn\?\.scopes\)/,
  )
  assert.match(connectionSource, /migrateLimitedConnection\(\)/)
  assert.match(connectionSource, /Reconnect GitHub to continue/)
  assert.doesNotMatch(connectionSource, /use a token instead/)
  assert.doesNotMatch(connectionSource, /Workflow access is optional/)
})

test('Contribute settings live in the app toolbar', () => {
  assert.match(appSource, /placement="toolbar"/)
  assert.match(appSource, /placement="content"/)
  assert.match(connectionSource, /className="co-github-menu"/)
  assert.match(connectionSource, /Contribute settings/)
  assert.match(connectionSource, /className="co-autopilot-setting"/)
  assert.match(themeSource, /\.co-conn-settings \{[\s\S]*?position: absolute/)
})

test('background checks have one shared accessible toolbar indicator', () => {
  assert.match(appSource, /const checking = loading && records\.length === 0 && !sourceSnapshot/)
  assert.match(appSource, /useState\(\{ state: 'checking' \}\)/)
  assert.match(appSource, /className="co-toolbar-check" role="status" aria-live="polite"/)
  assert.match(appSource, /Updating contribution state/)
  assert.doesNotMatch(appSource, /activeChecks|whileChecking/)
})

test('GitHub connection failures stay visible and recoverable', () => {
  assert.doesNotMatch(connectionSource, /if \(state === 'unknown'\) return null/)
  assert.match(connectionSource, /GitHub status unavailable/)
  assert.match(connectionSource, /Check GitHub again/)
  assert.match(connectionSource, /Try GitHub again/)
  assert.match(connectionSource, /GitHub sign-in cancelled/)
  assert.match(connectionSource, /transport\.cancel\(\{/)
  assert.match(connectionSource, /flow === 'pending' \|\| flow === 'cancelling'/)
  assert.match(connectionSource, /Starting GitHub sign-in…/)
  assert.match(connectionSource, /disabled=\{cancelling\}/)
  assert.match(connectionSource, /existingAttempt/)
  assert.match(connectionSource, /conn\?\.activeAttempt\?\.attemptId/)
  assert.match(connectionSource, /const statusConnected = state === 'connected'/)
  assert.doesNotMatch(connectionSource, /flow === 'complete' \|\| state === 'connected'/)
  assert.match(appSource, /connectionRequestRef/)
  assert.match(appSource, /requestId !== connectionRequestRef\.current/)
  assert.match(connectionSource, /status\?\.state === 'disconnected'/)
  assert.match(connectionSource, /Stop its local poll before clearing/)
  assert.match(connectionSource, /role=\{flow === 'cancelled' \? 'status' : 'alert'\}/)
  assert.doesNotMatch(connectionSource, /setInterval/)
})

test('the Projects summary reserves its row while source checks refresh', () => {
  assert.match(appSource, /loading=\{sourceLoading\}/)
  assert.match(sourceMapSource, /function LoadingState\(\)/)
  assert.match(sourceMapSource, /className="co-source-loading" role="status"/)
  assert.match(sourceMapSource, /Checking projects…/)
  assert.match(sourceMapSource, /Nothing here/)
})
