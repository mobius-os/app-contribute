import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeCopy } from '../action-copy.js'

const pr = base => ({ number: 7, baseRefName: base, headRefOid: 'a'.repeat(40), repository: { nameWithOwner: 'o/r' } })
const status = base => ({ run: { id: 'run-1', base_ref: base }, item: { state: 'all_clear', base_ref: base, head_sha: 'a'.repeat(40) } })
const reviewLine = copy => copy.facts.find(fact => /agent’s review/.test(fact.text))

test('the merge sheet quotes the agent review only when it was made against the branch the PR targets now', () => {
  assert.equal(reviewLine(mergeCopy(pr('main'), { status: status('main') }))?.text, 'Your agent’s review is clear for this version')
  assert.equal(reviewLine(mergeCopy(pr('release'), { status: status('main') })), undefined, 'a review of another target branch is not quoted')
})
