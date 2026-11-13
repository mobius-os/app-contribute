import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skill = readFileSync(new URL('../review-followup.md', import.meta.url), 'utf8')
const prose = skill.replace(/\s+/g, ' ')

test('Autopilot settles exact no-change reviews without public noise', () => {
  assert.match(prose, /Use `"handled"` only when the exact claimed event needs no code change and no useful public reply/)
  assert.match(prose, /an all-clear review or duplicate feedback already satisfied by the current head/)
  assert.match(prose, /Do not post a reply merely to make an all-clear or duplicate event look productive/)
  assert.match(prose, /skip the public reply and `\/complete` with `outcome: "handled"`/)
})

test('autopilot rounds restage in place instead of hand-writing the record', () => {
  assert.match(skill, /"autopilot_run_id": "<run_id>"/)
  assert.match(prose, /Never write the record or its diff through storage/)
  assert.doesNotMatch(prose, /CAS storage write/)
})

test('ask-before-push rounds prepare the update for the owner instead of pushing', () => {
  const section = prose.slice(prose.indexOf('## Ask-before-push mode'), prose.indexOf('## When to escalate'))
  assert.match(section, /the round \*\*never pushes\*\*/)
  assert.match(section, /`POST <base>\/stage` with an empty JSON body \(no `autopilot_run_id`\)/)
  assert.match(section, /`POST <base>\/review` with the staged `head_sha` and `diff_sha256`/)
  assert.match(section, /`POST <base>\/complete` with `outcome: "prepared"`/)
  assert.match(section, /only for a point that needs \*\*no code change\*\*/)
  assert.match(section, /Never announce a fix in public before the owner has published it/)
})
