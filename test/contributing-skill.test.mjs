import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skill = readFileSync(new URL('../contributing.md', import.meta.url), 'utf8')
const prose = skill.replace(/\s+/g, ' ')
const attached = readFileSync(new URL('../attached-work.md', import.meta.url), 'utf8').replace(/\s+/g, ' ')

test('explicit exact chat approval does not need a second Contribute approval', () => {
  assert.match(prose, /An explicit, unambiguous instruction in chat is a valid yes/)
  assert.match(prose, /The partner does not need to repeat that same approval in Contribute/)
  assert.match(prose, /Proceed without requiring the matching Contribute press/)
  assert.match(prose, /chat approval changes the approval surface, not the safety preflight/)
  assert.match(prose, /do not require both approval surfaces/)
  assert.match(prose, /After chat approval, the agent may call the same guarded endpoint/)
})

test('chat approval stays bound to the exact current public action', () => {
  assert.match(prose, /If the target, diff, head, or proposed public text changes, the old yes no longer applies/)
  assert.match(prose, /The broad cycle request alone still does not authorize an unenumerated push/)
  assert.match(prose, /Preparing is still private/)
})

test('existing PR metadata updates preserve exact reviewed compare-and-swap witnesses', () => {
  assert.match(prose, /For every `pr_update`/)
  assert.match(prose, /plan\.pr_metadata\.old_title/)
  assert.match(prose, /plan\.pr_metadata\.old_body/)
  assert.match(prose, /even when the reviewed text is unchanged/)
  assert.match(prose, /plan\.title/)
  assert.match(prose, /plan\.body_draft/)
  assert.match(prose, /Do not normalize, summarize, or reconstruct the old text/)
  assert.match(prose, /match either the exact recorded old values or the already-reviewed desired values before any push/)
  assert.match(prose, /applies `plan\.title`\/`plan\.body_draft` once after the branch update/)
  assert.match(prose, /does not edit already-visible reviewed text a second time/)
})

test('chat classifications are durable outcomes rather than prose-only exclusions', () => {
  assert.match(prose, /settle_chat_changes\.py/)
  assert.match(prose, /newest `ts` actually reviewed/)
  assert.match(prose, /A later edit to the same path becomes Unsorted again/)
  assert.match(prose, /do not substitute a prose summary for this write/)
})

test('attached helpers use one private bounded playbook', () => {
  assert.match(attached, /Nothing public/)
  assert.match(attached, /agent_snapshot\.py/)
  assert.match(attached, /--work-json/)
  assert.match(attached, /do not enumerate/)
  assert.match(attached, /manifest's `source_chat_id` owns provenance/)
  assert.match(attached, /Public actions: none/)
  assert.doesNotMatch(attached, /Read and follow .*contributing/)
})
