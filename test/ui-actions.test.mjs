import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const cardSource = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')
const stackSource = readFileSync(new URL('../ui/ContributionStack.jsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
const apiSource = readFileSync(new URL('../api.js', import.meta.url), 'utf8')
const connectionSource = readFileSync(new URL('../ui/ConnectionCard.jsx', import.meta.url), 'utf8')
const sourceMapSource = readFileSync(new URL('../ui/SourceMap.jsx', import.meta.url), 'utf8')
const sourceOverviewSource = readFileSync(new URL('../ui/SourceOverview.jsx', import.meta.url), 'utf8')
const batchActionSource = readFileSync(new URL('../ui/BatchAction.jsx', import.meta.url), 'utf8')
const feedSource = readFileSync(new URL('../ui/Feed.jsx', import.meta.url), 'utf8')
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')

test('send actions keep a visible label instead of relying on the icon alone', () => {
  assert.match(cardSource, /<span>\{checksActive \? 'Checking' : 'Open PR'\}<\/span>/)
  assert.match(
    stackSource,
    /<span>\{isLandingAction \? 'Land stack' : 'Send for review'\}<\/span>/,
  )
  assert.match(
    stackSource,
    /<span>\{canRecoverLanding \? 'Check' : isLandingAction \? 'Land' : 'Send'\}<\/span>/,
  )
})

test('prepared platform checks stay a separate confirmed no-PR action', () => {
  assert.match(cardSource, /Run GitHub checks/)
  assert.match(cardSource, /Run on my fork/)
  assert.match(cardSource, /does not[\s\S]*open a pull request or email the organization/)
  assert.match(apiSource, /\/pre-pr-checks/)
  assert.match(apiSource, /\/pre-pr-checks\/refresh/)
  assert.match(appSource, /pre_pr_checks_started/)
})

test('single and stacked sends expose elapsed progress to assistive technology', () => {
  for (const source of [cardSource, stackSource]) {
    assert.match(source, /role="status" aria-live="polite"/)
    assert.match(source, /sendElapsed/)
  }
})

test('sending uses the shell-style label sweep instead of a rotating action spinner', () => {
  assert.doesNotMatch(cardSource, /co-action-spinner/)
  assert.match(cardSource, /co-action-label-sweep/)
  assert.match(stackSource, /co-action-label-sweep/)
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

test('agent handoffs start one durable project chat and open only its accepted conversation', () => {
  assert.match(appSource, /window\.mobius\?\.chat\?\.start/)
  assert.match(appSource, /scope: action\.scope/)
  assert.match(batchActionSource, /type: 'moebius:open-chat',[\s\S]*chatId: started\.chatId/)
  assert.doesNotMatch(appSource, /type: 'moebius:new-chat'/)
  assert.doesNotMatch(appSource, /type: 'moebius:open-chat', draft: action\.draft/)
  assert.match(sourceMapSource, /<AgentHandoffButton action=\{detailAction\}/)
  assert.match(sourceMapSource, /label: 'Sort & prepare'/)
  assert.match(sourceOverviewSource, /Opening one agent conversation while you stay here\./)
  assert.doesNotMatch(connectionSource, /onAskAgent/)
  assert.match(appSource, /No pull requests to review/)
  assert.match(appSource, /No issues or comments yet/)
})

test('pull requests and requests have distinct top-level rooms', () => {
  assert.match(appSource, /id="co-tab-prs"[\s\S]*?>\s*Reviews\s*<\/button>/)
  assert.match(appSource, /id="co-tab-issues"[\s\S]*?>\s*Requests\s*<\/button>/)
  assert.match(appSource, /ISSUE_TYPES\.has\(rec\.type\)/)
  assert.match(appSource, /aria-labelledby=\{view === 'issues' \? 'co-tab-issues' : 'co-tab-prs'\}/)
  assert.match(cardSource, /!isPr && rec\.status === 'prepared'/)
  assert.match(feedSource, /STATUS_LABELS\[records\[0\]\?\.status\] \|\| 'History'/)
  assert.match(appSource, /isEmpty \? \(\s*<EmptyState view=\{view\} \/>/)
})

test('an assigned incoming review stays recoverable until its conversation starts', () => {
  assert.match(
    appSource,
    /const started = await startAgentTask\([\s\S]*if \(!started\.ok\)[\s\S]*Assigned on GitHub[\s\S]*setIncomingReviews/,
  )
})

test('preparation runs as one cycle while every public send stays explicit', () => {
  assert.match(sourceOverviewSource, /Run contribution cycle/)
  assert.match(sourceOverviewSource, /Nothing goes public without your approval\./)
  assert.match(sourceOverviewSource, /<CycleCard/)
  assert.match(sourceMapSource, /<AgentHandoffButton action=\{detailAction\}/)
  assert.match(cardSource, /<span>\{checksActive \? 'Checking' : 'Open PR'\}<\/span>/)
  assert.doesNotMatch(batchActionSource, /role="alertdialog"/)
  assert.doesNotMatch(batchActionSource, /Keep private/)
  assert.match(batchActionSource, /className="co-agent-handoff"/)
  assert.match(batchActionSource, /onClick=\{run\}/)
  assert.match(batchActionSource, /'Starting…'/)
  assert.match(batchActionSource, /aria-busy=\{busy\}/)
  assert.match(appSource, /resolveUncertainSubmission/)
})

test('blocked contributions have one calm full-width recovery action', () => {
  assert.match(cardSource, /className="co-action-block"/)
  assert.match(cardSource, /<span>Refresh<\/span>/)
  assert.match(cardSource, /aria-label="Refresh contribution in chat"/)
  assert.doesNotMatch(cardSource, /Draft follow-up/)
  assert.match(cardSource, /'Fresh review needed'/)
  assert.match(cardSource, /Your agent can update it safely\./)
  assert.match(cardSource, /Nothing was published/)
  assert.match(cardSource, /The reviewed branch was pushed/)
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

test('lost single and stacked submit responses reconcile durable state', () => {
  assert.match(apiSource, /uncertain: true/g)
  assert.match(appSource, /resolveUncertainSubmission/)
  assert.match(appSource, /resolveUncertainLanding/)
  assert.match(apiSource, /landContributionStack/)
  assert.match(apiSource, /detail\.code === 'landing_unconfirmed'/)
  assert.match(stackSource, /Check landing status/)
  assert.match(stackSource, /canRecoverLanding \? 'Check'/)
  assert.match(appSource, /return \{ pending: true, record: next, viaMobius \}/)
  assert.match(appSource, /summary\.state === 'publishing'/)
  assert.match(cardSource, /Publishing is still in progress/)
  assert.match(stackSource, /Publishing is still in progress for this chain/)
  assert.doesNotMatch(apiSource, /return \{ error: String\(\(err && err\.message\)/)
})

test('top-level tabs share one stable page width', () => {
  assert.match(themeSource, /\.co-page \{[\s\S]*?width: min\(100%, 1120px\)/)
  assert.match(themeSource, /\.co-header,\s*\.co-tabs,\s*\.co-contributions-view \{\s*width: min\(100%, 760px\)/)
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
  assert.match(sourceOverviewSource, /className="co-workspace-loading" role="status" aria-live="polite"/)
  assert.match(sourceOverviewSource, /Checking projects…/)
  assert.match(sourceOverviewSource, /No local changes/)
})
