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
