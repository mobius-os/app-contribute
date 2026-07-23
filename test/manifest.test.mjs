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

test('install manifest ships the label outcome helper imported by the review card', () => {
  assert.ok(manifest.source_files.includes('labels.js'))
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
