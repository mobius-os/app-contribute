// Whether Open for review may be offered for a draft the app sent: the platform refuses it unless ALL of these hold, so a button for a
// record that fails one only ever ends in a refusal after the owner's tap. One pure rule, with the sentence for the first that fails.
//   - the draft is the owner's own (a PR sent from Möbius's own account, a relay record, cannot be opened for review from this connection);
//   - an agent check is all clear for the exact version on GitHub (`quality_review.reviewed_head_sha` is the plan's head, or the commit
//     it was normalised from);
//   - the version on GitHub is the version that was reviewed (`plan.head_sha` is `last_submit_push_sha`);
//   - the record knows its PR (url and number) and the branch it was sent to (`last_submit_base_branch`).
// Only a record that names its version (`plan.head_sha`) is judged on the last four. One that does not (a sparse copy, a record this app did not
// write) is left to the platform to answer, and the app shows the platform's own reason, so a rule that is stricter than the platform's can never
// hide a button the platform would have honoured.
const sha = value => String(value ?? '').trim().toLowerCase()

const OWN_DRAFT = 'This draft cannot be opened for review from this connection.'
const RULES = [
  [record => Boolean(record.url) && Boolean(record.number), 'This draft has no pull request on GitHub recorded yet.'],
  [record => {
    const review = record.quality_review
    const head = sha(record.plan.head_sha)
    return review?.state === 'all_clear' && [head, sha(record.plan.attribution_normalized_from)].filter(Boolean).includes(sha(review.reviewed_head_sha))
  }, 'Its agent check must be all clear for this exact version first.'],
  [record => sha(record.plan.head_sha) === sha(record.last_submit_push_sha), 'The version on GitHub is not the version that was checked.'],
  [record => Boolean(sha(record.last_submit_base_branch)), 'The branch this draft targets is not recorded.'],
]

// '' when the record can be opened for review (or the app cannot tell), otherwise why not, in a sentence.
export function openForReviewRefusal(record) {
  if (!record || record.submission_mode === 'mobius-bot') return OWN_DRAFT
  if (!sha(record.plan?.head_sha)) return ''
  return RULES.find(([holds]) => !holds(record))?.[1] ?? ''
}

export const canOpenForReview = record => openForReviewRefusal(record) === ''
