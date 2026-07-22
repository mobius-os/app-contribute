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
const themeSource = readFileSync(new URL('../theme.js', import.meta.url), 'utf8')

test('send actions keep a visible label instead of relying on the icon alone', () => {
  assert.match(cardSource, /sending \? 'Sending…' : 'Send'/)
  assert.match(stackSource, /isLandingAction \? 'Land' : 'Send'/)
  assert.match(stackSource, /Land stack/)
})

test('single and stacked sends expose elapsed progress to assistive technology', () => {
  for (const source of [cardSource, stackSource]) {
    assert.match(source, /role="status" aria-live="polite"/)
    assert.match(source, /sendElapsed/)
  }
})

test('agent handoffs use a new project-specific chat instead of an invalid open-chat event', () => {
  assert.match(appSource, /type: 'moebius:new-chat'/)
  assert.doesNotMatch(appSource, /type: 'moebius:open-chat', draft: action\.draft/)
  assert.match(sourceMapSource, /A new chat opens with this project already identified\./)
  assert.match(sourceOverviewSource, /Review local and shared source updates in Projects/)
  assert.doesNotMatch(connectionSource, /onAskAgent/)
  assert.match(appSource, /No contributions to review/)
})

test('blocked contributions have one calm full-width recovery action', () => {
  assert.match(cardSource, /className="co-action-block"/)
  assert.match(cardSource, /Refresh in chat/)
  assert.match(cardSource, /Nothing was pushed/)
  assert.doesNotMatch(cardSource, /Sending is paused until/)
})

test('lost single and stacked submit responses reconcile durable state', () => {
  assert.match(apiSource, /uncertain: true/g)
  assert.match(appSource, /resolveUncertainSubmission/)
  assert.match(appSource, /resolveUncertainLanding/)
  assert.match(apiSource, /landContributionStack/)
  assert.match(appSource, /return \{ pending: true, record: next \}/)
  assert.match(appSource, /summary\.state === 'publishing'/)
  assert.match(cardSource, /Publishing is still in progress/)
  assert.match(stackSource, /Publishing is still in progress for this chain/)
  assert.doesNotMatch(apiSource, /return \{ error: String\(\(err && err\.message\)/)
})

test('top-level tabs share one stable page width', () => {
  assert.match(themeSource, /\.co-page \{[\s\S]*?width: min\(100%, 1120px\)/)
  assert.match(themeSource, /\.co-header,[\s\S]*?\.co-contributions-view[\s\S]*?width: min\(100%, 680px\)/)
  assert.doesNotMatch(themeSource, /\.co-page\.is-sources \{\s*width:/)
})

test('cards use explicit links and detail buttons instead of a clickable container', () => {
  assert.doesNotMatch(cardSource, /handleCardClick|is-clickable/)
  assert.match(cardSource, /className="co-details-toggle"/)
  assert.match(cardSource, /className="co-card-title"/)
})

test('the token form explains an empty submit instead of silently doing nothing', () => {
  assert.match(connectionSource, /Enter a GitHub personal access token\./)
  assert.match(connectionSource, /disabled=\{patSubmitting\}/)
  assert.match(connectionSource, /aria-invalid=\{!!patError\}/)
})

test('GitHub account settings live in the app toolbar', () => {
  assert.match(appSource, /placement="toolbar"/)
  assert.match(appSource, /placement="content"/)
  assert.match(connectionSource, /className="co-github-menu"/)
  assert.match(connectionSource, /GitHub account and settings/)
  assert.match(themeSource, /\.co-conn-settings \{[\s\S]*?position: absolute/)
})

test('background checks have one shared accessible toolbar indicator', () => {
  assert.match(appSource, /const checking = loading \|\| conn\.state === 'unknown'/)
  assert.match(appSource, /className="co-toolbar-check" role="status" aria-live="polite"/)
  assert.match(appSource, /Checking…/)
  assert.doesNotMatch(appSource, /activeChecks|whileChecking/)
})

test('the Projects summary reserves its row while source checks refresh', () => {
  assert.match(appSource, /loading=\{sourceLoading\}/)
  assert.match(sourceOverviewSource, /className="co-overview is-loading" role="status" aria-live="polite"/)
  assert.match(sourceOverviewSource, /Refreshing projects…/)
  assert.match(sourceOverviewSource, /if \(!count\) return null/)
})
