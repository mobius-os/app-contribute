// The app calls an approval stale for the platform's approval fields (PUBLICATION_APPROVAL_FIELDS in
// github_contributions.py) plus `revision` (bound since before the platform, pinned by review.test.mjs), and
// for `status`, `needs_attention`, `attention` and `last_submit_error`, which the platform does not bind but
// whose change between approval and Send the app alone must catch. Pure noise never makes it stale.
import assert from 'node:assert/strict'
import test from 'node:test'

import { contributionApprovalIsCurrent, contributionPhaseApprovalIsCurrent } from '../review.js'

const HEAD = 'b'.repeat(40)
const approved = {
  id: 'exact', type: 'pr', status: 'prepared', repo: 'owner/project', branch: 'fix/exact', title: 'Reviewed title',
  url: 'https://github.com/owner/project/pull/9', number: 9, head_repository: 'me/project', submission_mode: 'personal',
  publication_stage: 'ready', revision: 7, updated_at: '2026-11-18T00:00:00Z', summary: 'What improves',
  quality_review: { state: 'all_clear', reviewed_head_sha: HEAD },
  plan: { action: 'pr_update', repo: 'owner/project', branch: 'fix/exact', base_sha: 'a'.repeat(40), head_sha: HEAD, diff_sha256: 'c'.repeat(64), title: 'Reviewed title', body_draft: 'Body' },
}

test('a change only in noise keeps the approval current', () => {
  const noise = [
    { updated_at: '2026-11-18T05:00:00Z' },
    { summary: 'A rewritten summary' },
    { last_submit_push_sha: 'a'.repeat(40) },
    { readying: { started_at: '2026-11-18T05:00:00Z' }, last_ready_error_code: 'ready_failed' },
    { relay_contribution_id: 'relay-1' },
  ]
  for (const change of noise) assert.equal(contributionApprovalIsCurrent(approved, { ...approved, ...change }), true, JSON.stringify(change))
  assert.equal(contributionPhaseApprovalIsCurrent([approved], [{ ...approved, updated_at: '2026-11-18T05:00:00Z', summary: 'Other' }]), true)
})

test('an attention flag, a send error or another status after approval makes it stale', () => {
  const held = [
    { needs_attention: true },
    { attention: { type: 'checks_failed', key: 'checks_failed:abc', detected_at: '2026-11-18T05:00:00Z' } },
    { status: 'submitting' },
    { status: 'abandoned' },
    { last_submit_error: 'Nothing was pushed.' },
  ]
  for (const change of held) assert.equal(contributionApprovalIsCurrent(approved, { ...approved, ...change }), false, JSON.stringify(change))
  assert.equal(contributionApprovalIsCurrent({ ...approved, needs_attention: true }, { ...approved, needs_attention: true }), true, 'the same flag is the same approval')
  assert.equal(contributionApprovalIsCurrent(approved, { ...approved, needs_attention: false }), true, 'an explicit false is no flag')
})

test('a change in a field the platform binds, or in revision, makes the approval stale', () => {
  const changed = [
    { publication_stage: 'draft' },
    { revision: 8 },
    { id: 'other' }, { type: 'issue' }, { repo: 'owner/other' }, { branch: 'fix/other' }, { title: 'Another title' },
    { url: 'https://github.com/owner/project/pull/10' }, { number: 10 }, { head_repository: 'me/other' }, { submission_mode: 'mobius-bot' },
    { plan: { ...approved.plan, head_sha: 'd'.repeat(40) } },
    { plan: { ...approved.plan, body_draft: 'Changed body' } },
    { quality_review: { ...approved.quality_review, state: 'changes_needed' } },
  ]
  for (const change of changed) assert.equal(contributionApprovalIsCurrent(approved, { ...approved, ...change }), false, JSON.stringify(change))
  assert.equal(contributionApprovalIsCurrent(approved, { ...approved, publication_stage: undefined }), false, 'a removed stage is a change too')
})

test('an absent field and a null one are the same, and a record with nothing is never current', () => {
  const bare = { id: 'bare', type: 'pr' }
  assert.equal(contributionApprovalIsCurrent(bare, { ...bare, plan: null, quality_review: null, publication_stage: null, attention: null }), true)
  assert.equal(contributionApprovalIsCurrent(null, bare), false)
  assert.equal(contributionApprovalIsCurrent(bare, undefined), false)
})
