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

test('existing PR updates require exact public metadata without mutating it', () => {
  assert.match(prose, /For every `pr_update`/)
  assert.match(prose, /plan\.pr_metadata\.old_title/)
  assert.match(prose, /plan\.pr_metadata\.old_body/)
  assert.match(prose, /copy those same exact bytes/)
  assert.match(prose, /plan\.title/)
  assert.match(prose, /plan\.body_draft/)
  assert.match(prose, /Do not normalize, summarize, or reconstruct the text/)
  assert.match(prose, /publication precondition rather than a request to edit public metadata/)
  assert.match(prose, /exactly match `plan\.title` and `plan\.body_draft` before any branch mutation/)
  assert.match(prose, /does not PATCH the pull request's title or body/)
  assert.match(prose, /GitHub does not expose an expected-version guard/)
  assert.match(prose, /Any mismatch stops for a fresh private review/)
  assert.match(prose, /a restarted attempt must prove the same metadata precondition again/)
  assert.doesNotMatch(prose, /match either the exact recorded old values or the already-reviewed desired values/)
  assert.doesNotMatch(prose, /applies `plan\.title`\/`plan\.body_draft` once after the branch update/)
})

test('chat classifications are durable outcomes rather than prose-only exclusions', () => {
  assert.match(prose, /settle_chat_changes\.py/)
  assert.match(prose, /newest `ts` actually reviewed/)
  assert.match(prose, /A later edit to the same path becomes Unsorted again/)
  assert.match(prose, /do not substitute a prose summary for this write/)
})

test('linked private reviews are locked until verified terminal cleanup', () => {
  assert.match(prose, /worktree lock/)
  assert.match(prose, /Contribute review <record-id>/)
  assert.match(prose, /Lock every linked review immediately after creation/)
  assert.match(prose, /`git worktree prune` from stranding reviewed owner work/)
  assert.match(prose, /cleanup verifies the reciprocal Git pointer and releases that exact lock/)
})

test('verification reuses exact environments and owns exceptional installs', () => {
  for (const text of [prose, attached]) {
    assert.match(text, /scripts\.wt-pytest\.sh|scripts\/wt-pytest\.sh/)
    assert.match(text, /scripts\.wt-npm\.sh|scripts\/wt-npm\.sh/)
    assert.match(text, /exact `package-lock\.json` match|`package-lock\.json` matches exactly/)
    assert.match(text, /Do not run a direct `npm ci`/)
    assert.match(text, /checkout-local `\.venv`/)
  }
  assert.match(attached, /test machinery is not/)
})

test('mixed-action stacks advance through separately approved public phases', () => {
  assert.match(prose, /existing pull requests whose branches need an update/)
  assert.match(prose, /first confirm and update the consecutive `pr_update` prefix/)
  assert.match(prose, /separately confirm and open the `pr` suffix/)
  assert.match(prose, /full chain remains visible and is revalidated on both calls/)
  assert.match(prose, /never let one phase claim, hide, or inherit approval for the deferred phase/i)
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
