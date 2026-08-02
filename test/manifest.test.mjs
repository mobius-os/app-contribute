import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../mobius.json', import.meta.url), 'utf8'))
const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('package metadata matches the install manifest version', () => {
  assert.equal(packageMetadata.version, manifest.version)
})

test('install manifest ships the refresh coordinator imported by the entry point', () => {
  assert.ok(manifest.source_files.includes('refresh.js'))
})

test('install manifest ships the prepared-record reconciliation pass', () => {
  assert.ok(manifest.source_files.includes('prepared_reconcile.py'))
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /prepared_reconcile\.py/)
})

test('scheduled refresh retries cleanup for every terminal staging checkout', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /TERMINAL_STAGING_STATUSES = frozenset/)
  for (const status of [
    'merged', 'closed', 'superseded', 'commented', 'abandoned',
  ]) {
    assert.match(source, new RegExp(`"${status}"`))
  }
  assert.match(source, /cleanup-staging/)
  assert.ok(
    source.indexOf('_reconcile_terminal_staging()') < source.indexOf('if not targets:'),
    'cleanup must still run when there are no live GitHub records to refresh',
  )
})

test('install manifest ships the one-call agent contribution snapshot', () => {
  assert.ok(manifest.source_files.includes('agent_snapshot.py'))
})

test('install manifest ships the label outcome helper imported by the review card', () => {
  assert.ok(manifest.source_files.includes('labels.js'))
})

test('install manifest ships the shared batch action used by Projects and PRs', () => {
  assert.ok(manifest.source_files.includes('ui/BatchAction.jsx'))
})

test('install manifest ships the GitHub connection-attempt controller', () => {
  assert.ok(manifest.source_files.includes('github-connection.js'))
})

test('GitHub data and credential management are separately reviewable grants', () => {
  assert.equal(manifest.permissions.github_access, true)
  assert.equal(manifest.permissions.github_connect, true)
})

test('install manifest ships the autopilot module imported by the card', () => {
  assert.ok(manifest.source_files.includes('autopilot.js'))
})

test('install manifest ships the review-followup skill for the background loop', () => {
  assert.ok(manifest.skills.includes('review-followup.md'))
  assert.ok(manifest.source_files.includes('review-followup.md'))
})

test('schedule runs often enough for a responsive review loop', () => {
  // The autopilot loop keys off this cadence to detect + respond to reviews.
  assert.equal(manifest.schedule.default, '*/15 * * * *')
})

test('scheduled refresh follows prepared GitHub runs without opening a PR', () => {
  const job = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  const source = readFileSync(new URL('../index.jsx', import.meta.url), 'utf8')
  assert.match(job, /prepared-checks\/refresh/)
  assert.match(source, /refreshPreparedChecks/)
  assert.match(source, /runPreparedChecks/)
})

test('scheduled autopilot retries durable attention after a lost respond call', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /A prior pass may have durably written the attention/)
  assert.match(source, /_respond_autopilot\(rec, pending\)/)
  assert.match(source, /result\.get\("status"\) == "not_granted"/)
  assert.match(source, /400 <= exc\.code < 500 and exc\.code not in \(409, 429\)/)
})

test('scheduled autopilot ignores exact own replies, not all owner activity', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  assert.match(source, /ignored_event_urls/)
  assert.match(source, /comment\.get\("url"\) in ignored/)
  assert.doesNotMatch(source, /gh", "api", "user"/)
  assert.doesNotMatch(source, /ignore_login/)
})

test('merge conflicts remain a human handoff, not an authorized rewrite', () => {
  const source = readFileSync(new URL('../job.sh', import.meta.url), 'utf8')
  const actionable = source.match(
    /ACTIONABLE_ATTENTION = frozenset\(\(([^]*?)\)\)/,
  )?.[1] || ''
  assert.doesNotMatch(actionable, /merge_conflict/)
  const skill = readFileSync(
    new URL('../review-followup.md', import.meta.url), 'utf8',
  )
  assert.doesNotMatch(skill, /"rewrite"/)
  assert.doesNotMatch(skill, /re_request_review/)
  assert.match(skill, /merge conflict[\s\S]*escalate it/)
})
