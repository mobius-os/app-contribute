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
