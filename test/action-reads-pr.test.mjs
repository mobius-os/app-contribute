// A list shows a PR as last known, and the owner's actions start from that row. Each one reads the PR again as it
// starts (collaboration.js liveSelection, which refuses a PR whose head, target, draft state or openness changed),
// so nothing is merged, assigned, asked or opened on the strength of a copy. Behaviour: test/workspace-browser.mjs
// runRepositoryListChecks; liveSelection itself: test/live-selection.test.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../ui/PullRequests.jsx', import.meta.url), 'utf8')

test('every action of the confirm sheet (merge, ready, draft, close, request review, ask, follow) reads its PR as it starts', () => {
  assert.match(source, /onConfirm=\{async \(\{ choice, people, note, onConfirmed \}\) => \(await staleOutcome\(acting\.pulls \|\| \[acting\.pr\]\)\) \|\| actionHandlers\[acting\.intent\]\(/)
  assert.match(source, /async function staleOutcome\(pulls\) \{\n\s+try \{ await liveSelection\(token, pulls\) \}/)
  // The handlers are the only way an intent reaches GitHub from this sheet.
  const handlers = source.match(/const actionHandlers = \{[\s\S]*?\n  \}\n/)[0]
  for (const intent of ['open_for_review', 'merge', 'back_to_draft', 'close', 'request_review', 'ask_rereview', 'ask_approval', '\\[FOLLOW\\]']) assert.match(handlers, new RegExp(`\\n    (// .*\\n    )*${intent}:`), intent)
})

test('assigning reads the PRs as they are before anyone is assigned', () => {
  const assign = source.match(/async function assign\(login\) \{[\s\S]*?\n  \}\n/)[0]
  assert.ok(assign.indexOf('liveSelection(token, pending)') > 0 && assign.indexOf('liveSelection(token, pending)') < assign.indexOf('assignPulls('))
  assert.match(assign, /if \(error\.code === 'changed'\) onStale\(\)/, 'a changed PR reads the list again')
})

test('starting a review reads its PRs as they are, and a changed one reads the list again', () => {
  const start = source.match(/async function start\(\) \{[\s\S]*?\n  \}\n/)[0]
  assert.match(start, /const pulls = await liveSelection\(token, choice\.pulls\)/)
  assert.match(start, /if \(error\.code === 'changed'\) void load\(\)/)
})

test('an answer the owner confirmed is never sent from a refused read: the refusal is the outcome', () => {
  const stale = source.match(/async function staleOutcome\(pulls\) \{[\s\S]*?\n  \}\n/)[0]
  assert.match(stale, /return \{ error: error\.message \}/)
  assert.match(stale, /if \(error\.code === 'changed'\) void load\(\)/)
})
