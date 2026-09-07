import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
const connectionSource = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
const controlsSource = readFileSync(new URL('../ui/ProjectControls.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
const fileDiffListSource = readFileSync(new URL('../ui/FileDiffList.jsx', import.meta.url), 'utf8')
const batchActionSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')
const cycleSource = readFileSync(new URL('../ui/useProjectCycle.js', import.meta.url), 'utf8')
const workspaceTheme = readFileSync(new URL('../workspace-theme.js', import.meta.url), 'utf8')
const runSource = readFileSync(new URL('../run.js', import.meta.url), 'utf8')

test('choosing a contribution route stays a preference, not preparation or publication', () => {
  const choose = appSource.slice(appSource.indexOf('const onChooseSubmissionMethod ='), appSource.indexOf('const onAssignIncomingReview ='))
  assert.doesNotMatch(choose, /onSend|startAgentTask|onStartCycle|submitContribution/)
  assert.match(choose, /if \(!saved\) setSubmissionError/)
  assert.equal((appSource.match(/<ConnectionSettings/g) || []).length, 1)
  assert.doesNotMatch(connectionSource, /onChooseChanges|onOpenSetup/)
})

test('send actions keep a visible label instead of relying on the icon alone', () => {
  assert.match(cardSource, /<span>\{sending \? 'Sending…' : \(isUpdate \? 'Send update' : 'Send PR'\)\}<\/span>/)
  assert.match(feedSource, /count === 1 \? 'Review and send' : `Review and send \$\{count\}`/)
  assert.match(feedSource, /count === 1 \? 'Send to GitHub' : `Send \$\{count\} to GitHub`/)
  assert.doesNotMatch(feedSource, /Send all|Prepare latest/)
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
  assert.match(cycleSource, /openAgentConversation\(cycle\.chatId\)/)
  assert.doesNotMatch(batchActionSource, /postMessage\([\s\S]*window\.location\.origin/)
  assert.doesNotMatch(appSource, /type: 'moebius:new-chat'/)
  assert.doesNotMatch(appSource, /type: 'moebius:open-chat', draft: action\.draft/)
  assert.doesNotMatch(sourceMapSource, /<AgentHandoffButton/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(feedSource, /function SourceChatChoices/)
  assert.match(controlsSource, /Prepare changes/)
  assert.match(controlsSource, /Open conversation/)
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

test('one mounted project workspace owns both reversible Back levels', () => {
  assert.match(sourceMapSource, /window\.mobius\.nav\.open\('contribute-project'/)
  assert.match(sourceMapSource, /window\.mobius\.nav\.open\('contribute-review'/)
  assert.doesNotMatch(appSource + feedSource, /window\.mobius\.nav\.open/)
  assert.doesNotMatch(appSource, /showProjects|View all reviews|contribute-reviews/)
  assert.match(sourceMapSource, /onBack:[\s\S]*?setSelectedWorkId\(''\)/)
  assert.match(sourceMapSource, /onForward:[\s\S]*?setSelected\(projectKey\)[\s\S]*?showWork\(itemId\)/)
  assert.match(sourceMapSource, /onForward:[\s\S]*?setSelected\(key\)/)
  assert.match(sourceMapSource, /function closeProject\(\) \{\s*closeWork\(\)/)
  assert.match(sourceMapSource, /outcome\?\.status !== 'owned'/)
  assert.match(sourceMapSource, /Back to \{project.name\}/)
  assert.match(sourceMapSource, /top: workScrollRef.current/)
  assert.match(sourceMapSource, /Could not open this contribution. Try again/)
})

test('an assigned incoming review stays recoverable until its conversation starts', () => {
  assert.match(
    appSource,
    /const started = await startAgentTask\([\s\S]*if \(!started\.ok\)[\s\S]*Assigned on GitHub[\s\S]*setIncomingReviews/,
  )
})

test('contribution details retain their project parent and refresh only source diffs', () => {
  assert.equal((appSource.match(/<SourceMap/g) || []).length, 1)
  assert.match(sourceMapSource, /const projectKey = selected/)
  assert.match(sourceMapSource, /\? projects\.find\(\(project\) => project\.key === selected\)/)
  assert.match(sourceMapSource, /<ProjectFileChanges key=\{sourceRevision\}/)
  assert.match(sourceMapSource, /sourceRevision=\{snapshot\?\.generated_at\}/)
  assert.match(sourceMapSource, /renderActivity\?\.\(project, navigation\)/)
  assert.match(appSource, /selectedId=\{navigation.selectedId\}/)
})

test('preparation runs as one cycle while every public send stays explicit', () => {
  assert.doesNotMatch(feedSource, /PrivateRunAction|<AgentHandoffButton/)
  assert.match(controlsSource, /start\(merge && fullCycle \? fullCycle : run.privateAction\)/)
  assert.match(controlsSource, /organize and review this project/)
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

test('diffs stay collapsed until the owner opens a file', () => {
  assert.doesNotMatch(sourceMapSource, /initiallyOpenFirst/)
  assert.doesNotMatch(fileDiffListSource, /initiallyOpenFirst/)
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
  assert.match(themeSource, /\.co-page \{[\s\S]*?width: min\(100%, 1040px\)/)
  assert.match(themeSource, /\.co-contributions-view \{\s*width: 100%; margin-inline: auto/)
  assert.match(themeSource, /\.co-header \{[^}]*width: min\(100%, 1040px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-github-menu \{[^}]*max-width: 520px/)
  assert.doesNotMatch(themeSource, /radial-gradient|linear-gradient\(var\(--bg\), var\(--bg\)\)/)
  assert.doesNotMatch(themeSource, /\.co-root::before/)
  assert.match(themeSource, /@media \(min-width: 900px\) \{[\s\S]*?\.co-header-shell \{ width: min\(100%, 1040px\); margin-inline: auto/)
  assert.match(themeSource, /\.co-header-shell \{\s*flex: 0 0 auto; width: 100%; background: var\(--bg\);\s*\}/)
  assert.match(appSource, /<div className="co-header-shell">[\s\S]*?<\/div>\s*<main/)
  assert.doesNotMatch(themeSource, /\.co-page\.is-sources \{\s*width:/)
})

test('Projects owns vertical scrolling and makes every row visibly navigable', () => {
  assert.match(themeSource, /\.co-page\.is-sources \{[\s\S]*?overflow-y: auto/)
  assert.match(sourceMapSource, /aria-label=\{`Open \$\{project\.name\}: \$\{next\}`\}/)
  assert.match(sourceMapSource, /className="co-source-row-cue"/)
  assert.match(sourceMapSource, /<Icon name="right" size=\{15\}/)
  assert.match(themeSource, /\.co-source-row \{[\s\S]*?cursor: pointer/)
  assert.match(themeSource, /\.co-source-row-facts > small \{ display: block; \}/)
  assert.doesNotMatch(themeSource, /\.co-source-row-facts > span \{[^}]*-webkit-line-clamp/)
})

test('one scoped control surface starts private preparation without leaving the project', () => {
  assert.match(sourceMapSource, /renderControls\?\.\(project\)/)
  assert.match(controlsSource, /start\(merge && fullCycle \? fullCycle : run.privateAction\)/)
  assert.match(controlsSource, /organize and review this project/)
  assert.match(appSource, /recordsForProject\(records, project\)/)
  assert.match(appSource, /onStart=\{startAgentTask\}/)
  assert.match(themeSource, /\.co-project-controls \{/)
})

test('published-app handoffs finish automatically without a second owner action', () => {
  assert.doesNotMatch(feedSource, /function PublishedAppLinks/)
  assert.match(feedSource, /Finishing publication/)
  assert.doesNotMatch(feedSource, /Connect app|ready to connect|Link \$\{items\.length\} apps/)
  assert.doesNotMatch(themeSource, /co-published-links/)
  assert.match(cardSource, /Attaching the published identity to this local app/)
  assert.doesNotMatch(cardSource, />Link app</)
  assert.match(runSource, /decision\('connecting'/)
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
    /conn\?\.state !== 'connected'[\s\S]*?hasFullPrAccess\(conn\?\.scopes\)/,
  )
  assert.match(connectionSource, /migrateLimitedConnection\(\)/)
  assert.match(connectionSource, /Updating GitHub access/)
  assert.doesNotMatch(connectionSource, /use a token instead/)
  assert.doesNotMatch(connectionSource, /Workflow access is optional/)
})

test('one on-demand settings surface owns account setup in the toolbar', () => {
  assert.equal((appSource.match(/<ConnectionSettings/g) || []).length, 1)
  assert.match(connectionSource, /open \? <div className="co-settings-panel"/)
  assert.match(connectionSource, /Contribute settings/)
  assert.match(connectionSource, /className="co-autopilot-setting"/)
  assert.match(themeSource, /\.co-settings-panel \{[\s\S]*?position: absolute/)
})

test('Follow sent PRs help opens as an anchored dismissible popover', () => {
  assert.match(connectionSource, /className="co-setting-help" ref=\{autopilotHelpRef\}/)
  assert.match(connectionSource, /role="tooltip"/)
  assert.match(connectionSource, /aria-describedby=\{autopilotHelpOpen/)
  assert.match(connectionSource, /document\.addEventListener\('pointerdown', dismissOutside\)/)
  assert.match(connectionSource, /event\.key !== 'Escape'/)
  assert.match(connectionSource, /autopilotInfoRef\.current\?\.focus\(\)/)
  assert.match(themeSource, /\.co-setting-help \{ position: relative/)
  assert.match(themeSource, /\.co-setting-popover \{[\s\S]*?position: absolute/)
  assert.doesNotMatch(connectionSource, /className="co-autopilot-help"/)
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
  assert.match(sourceMapSource, /No local work to prepare/)
})

test('project status and essential controls remain visible with a readable type floor', () => {
  assert.doesNotMatch(controlsSource, /More actions|View reviews/)
  assert.match(controlsSource, /className="co-btn co-btn-primary co-task-primary"/)
  assert.match(sourceMapSource, /Get up to date/)
  assert.match(sourceMapSource, /<span>\{facts.work\}<\/span>/)
  assert.match(sourceMapSource, /className="co-source-shared">\{facts.shared\}/)
  const sizes = [...(themeSource + workspaceTheme).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(match => Number(match[1]))
  assert.ok(sizes.every(size => size === 0 || size >= 14))
})
