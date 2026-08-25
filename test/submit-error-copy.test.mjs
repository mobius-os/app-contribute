import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const card = readFileSync(new URL('../ui/ContributionCard.jsx', import.meta.url), 'utf8')

test('a pushed branch is never described as though nothing left the instance', () => {
  assert.match(card, /branchWasPushed[\s\S]*The reviewed branch reached GitHub, but Contribute could not confirm the pull request\./)
  assert.doesNotMatch(card, /Nothing was pushed\./)
})

test('a retryable local-ready verdict does not erase the stored send outcome', () => {
  assert.match(card, /if \(!blocked && !rec\.last_submit_error\) return null/)
  assert.doesNotMatch(card, /reviewState\?\.state === 'ready' \|\| !rec\.last_submit_error/)
})
