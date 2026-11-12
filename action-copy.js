// The words on an action's confirm sheet: what it does, what GitHub shows now,
// and what it cannot undo. Pure, so the sheet states exactly what the PR's own
// data says and the tests can hold it to that.
import { checkSummary, reviewItemProgress } from './collaboration.js'
import { NAMES } from './names.js'

const names = list => list.join(', ')

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

// One line about the PR's checks, as GitHub counts them; null when GitHub has
// reported none. A failing or running check is not a blocker for opening a PR
// for review, so it is a warning there.
function checksFact(pr, { blocking = false } = {}) {
  const checks = checkSummary(pr)
  if (!checks?.total) return null
  if (checks.failed) return { tone: blocking ? 'bad' : 'warn', text: `${plural(checks.failed, 'check is', 'checks are')} failing` }
  if (checks.state === 'pending') return { tone: 'warn', text: 'Checks are still running' }
  // Like GitHub's own "21/21", skipped runs count as passed.
  return { tone: 'ok', text: `${plural(checks.passed, 'check', 'checks')} passed` }
}

function conflictFact(pr) {
  const base = pr.baseRefName || 'the target branch'
  if (pr.mergeable === 'CONFLICTING') return { tone: 'bad', text: `It conflicts with ${base}` }
  return pr.mergeable === 'MERGEABLE' ? { tone: 'ok', text: `No conflicts with ${base}` } : null
}

const short = sha => String(sha || '').slice(0, 7)

// Open a draft for review: GitHub shows it as ready. This asks nobody to review it (asking a person
// is a separate review request), and the exact version is pinned by the platform's action.
export function openForReviewCopy(pr) {
  return {
    icon: 'send',
    title: `Open #${pr.number} for review?`,
    confirm: NAMES.openForReview,
    working: 'Opening…',
    facts: [
      { tone: 'ok', text: 'It stops being a draft and is ready for review' },
      checksFact(pr),
      conflictFact(pr),
      { tone: 'ok', text: 'You can turn it back into a draft later' },
    ].filter(Boolean),
    footnote: `Opens the version you are looking at (${short(pr.headRefOid)}). It does not ask anyone to review it, unless the repository has code owners. Nothing merges.`,
    // GitHub cannot pin a version on this write, so the platform reports the head it saw afterwards.
    done: outcome => ({
      title: NAMES.openForReview,
      text: outcome?.observedHead && outcome.observedHead !== pr.headRefOid
        ? `Reviewers can see it now. It changed while you were looking: GitHub shows ${short(outcome.observedHead)} now, so check what they will read.`
        : 'Reviewers can see it now.',
    }),
  }
}

// Post what a finished private review found, as a plain comment review on the PR. The words are the
// platform's own, shown as they will appear; nothing is posted until the owner confirms here. Until the
// words have arrived (or when the platform refuses) the button stays off and the sheet says why.
export function postFindingsCopy(pr, { preview = null, error = '', own = false } = {}) {
  const base = {
    icon: 'globe',
    title: `Post this review on #${pr.number}?`,
    confirm: NAMES.postToGitHub,
    working: 'Posting…',
  }
  if (error) return { ...base, disabled: true, facts: [{ tone: 'bad', text: error }], footnote: 'Nothing was posted.', done: { title: 'Posted', text: '' } }
  if (!preview) return { ...base, disabled: true, facts: [{ tone: 'warn', text: 'Reading what it would post…' }], footnote: 'Nothing is posted until you confirm.', done: { title: 'Posted', text: '' } }
  return {
    ...base,
    facts: [
      { tone: 'ok', text: own ? 'A comment on your own PR, from your GitHub account' : 'A comment on this PR, from your GitHub account' },
      { tone: 'ok', text: 'Not an approval and not a request for changes' },
      { tone: 'warn', text: 'Anyone who can see this PR can read it' },
    ],
    says: { label: 'What it would post', markdown: preview.body },
    footnote: `Posts exactly this text, once, at the version you reviewed (${short(preview.head_sha || pr.headRefOid)}). If anyone pushes first, nothing is posted and you are told. Contribute cannot take it back: on GitHub you can edit or hide it.`,
    done: outcome => ({
      title: 'Posted on GitHub',
      text: `Your review is on #${pr.number} now.`,
      ...(outcome?.url ? { link: { href: outcome.url, label: 'View the review on GitHub' } } : {}),
    }),
  }
}

// How a repository lets a PR land, in the platform's own order of preference
// (squash, then a merge commit, then rebase). Only the ways the repository
// allows are offered; with none reported the platform picks and nothing is asked.
const MERGE_METHODS = {
  squash: { label: 'Squash and merge', action: 'Squash and merge', detail: base => `All commits become one commit on ${base}.` },
  merge: { label: 'Create a merge commit', action: 'Merge', detail: () => 'Keeps every commit and adds a merge commit.' },
  rebase: { label: 'Rebase and merge', action: 'Rebase and merge', detail: base => `Replays the commits on top of ${base}.` },
}
const ALLOWED = { squash: 'squashMergeAllowed', merge: 'mergeCommitAllowed', rebase: 'rebaseMergeAllowed' }
export const allowedMergeMethods = repository => Object.keys(MERGE_METHODS).filter(key => repository?.[ALLOWED[key]] === true)
// The method to name in the merge call: none while the owner stays on the first allowed one, which is
// also what the platform picks. A repository that merges through a queue chooses for itself and refuses a named method.
export const methodToSend = (repository, choice) => (choice && choice !== allowedMergeMethods(repository)[0] ? choice : '')

// Who approved this version (the PR machine's count: never the author, never a bot). An approval of an
// older commit counts only when the PR's own change was proved the same since, and the sheet says so. A change
// request that still stands is told too: Merge is never switched off for it, so this sheet is where it shows.
function approvalFacts(standing) {
  if (!standing) return []
  const approvedBy = standing.approvedBy || []
  const asking = standing.changesFrom || []
  const holding = asking.length ? [{ tone: 'bad', text: `${names(asking)} asked for changes and hasn’t approved since` }] : []
  if (!approvedBy.length) return [{ tone: 'bad', text: 'Nobody but the author has approved this version' }, ...holding]
  const carried = standing.carriedFrom || []
  const exact = approvedBy.filter(name => !carried.some(item => item.by.toLowerCase() === name.toLowerCase()))
  return [
    exact.length ? { tone: 'ok', text: `Approved at this version by ${names(exact)}` } : null,
    ...carried.map(item => ({ tone: 'ok', text: `Approved by ${item.by} on ${short(item.commit)}. The lines you added and removed have not changed since` })),
    ...holding,
  ].filter(Boolean)
}

// GitHub's own review gate (a branch rule), named only when it still stands: whether someone approved
// this version is the machine's line above, and a gate that is satisfied adds nothing.
const gateFact = pr => (pr?.reviewDecision === 'REVIEW_REQUIRED' ? { tone: 'bad', text: 'GitHub still needs a review' } : null)

// What the owner's own agent review of this exact version said, if there is one.
function reviewFact(status, ignored) {
  if (!status) return null
  const progress = reviewItemProgress(status.run, status.item, { ignored })
  if (status.item.state === 'all_clear') return { tone: 'ok', text: 'Your agent’s review is clear for this version' }
  if (progress.turn === 'owner') return { tone: 'warn', text: status.item.state === 'needs_you' ? 'Your agent’s review found problems on this version' : 'Your agent’s review is waiting on you' }
  return null
}

// Merge: lands this exact version. Contribute cannot undo it.
export function mergeCopy(pr, { status = null, ignored = null, method = '', standing = null } = {}) {
  const base = pr.baseRefName || 'the target branch'
  const allowed = allowedMergeMethods(pr.repository)
  const chosen = allowed.includes(method) ? method : allowed[0] || ''
  return {
    icon: 'merge',
    title: `Merge #${pr.number} into ${base}?`,
    confirm: chosen ? MERGE_METHODS[chosen].action : 'Merge',
    working: 'Merging…',
    facts: [...approvalFacts(standing), gateFact(pr), checksFact(pr, { blocking: true }), conflictFact(pr), reviewFact(status, ignored)].filter(Boolean),
    choices: allowed.length > 1 ? { label: 'How should it land?', value: chosen, options: allowed.map(key => ({ key, label: MERGE_METHODS[key].label, action: MERGE_METHODS[key].action, detail: MERGE_METHODS[key].detail(base) })) } : null,
    footnote: `Merges the version you are looking at (${short(pr.headRefOid)}). If anyone pushes first, nothing is merged and you are told. Contribute cannot undo a merge: to take it back you would open a revert on GitHub.`,
    done: outcome => outcome?.state === 'queued'
      ? { title: 'Added to the merge queue', text: `GitHub merges #${pr.number} into ${base} when the queue reaches it.` }
      : { title: 'Merged', text: `#${pr.number} is now in ${base}.` },
  }
}

// Back to draft: reviewers stop being asked; it can be opened again later.
export function backToDraftCopy(pr) {
  return {
    icon: 'draft', title: `Turn #${pr.number} back into a draft?`, confirm: NAMES.backToDraft, working: 'Turning it into a draft…',
    facts: [{ tone: 'ok', text: 'Nothing merges, and no code changes' }, { tone: 'warn', text: 'GitHub shows it as a draft until you open it for review again' }],
    footnote: `For the version you are looking at (${short(pr.headRefOid)}).`,
    done: () => ({ title: NAMES.backToDraft, text: `#${pr.number} is a draft again.` }),
  }
}

// What is true of each person an Ask can name: a line under their name on the sheet, and a line of the public note.
// `commit` is the version their review was of; a review of a commit that is gone (a force-push) has none, and the line then
// says "an earlier version" without a hash.
const at = item => (item.commit ? ` (\`${short(item.commit)}\`)` : '')
const WHY = {
  changes_here: { detail: () => 'Asked for changes on this version', note: () => 'your change request on this version is still open. GitHub holds it until you approve or dismiss it.' },
  looked_again: { detail: () => 'Asked for changes earlier, then commented on this version; GitHub still holds the request', note: () => 'you left a comment on this version, but GitHub still holds your earlier change request until you approve or dismiss it.' },
  commented_here: { detail: () => 'Commented on this version, has not approved', note: () => 'you left a comment on this version but have not approved it.' },
  changes_older: { detail: item => `Asked for changes on ${item.commit ? short(item.commit) : 'an earlier version'}, has not looked since`, note: item => `your change request is on an earlier version${at(item)}. GitHub holds it until you approve or dismiss it.` },
  approved_older: { detail: item => `Approved ${item.commit ? short(item.commit) : 'an earlier version'}; this version has new commits`, note: item => `you approved an earlier version${at(item)}; this one has new commits.` },
  commented_older: { detail: item => `Commented on ${item.commit ? `${short(item.commit)}, ` : ''}an earlier version`, note: item => `you left a comment on an earlier version${at(item)}.` },
}
const HOLDS_A_REQUEST = ['changes_here', 'looked_again', 'changes_older']

// The platform takes at most this many people in one ask (ReviewerRequest and ApprovalRequest); the sheet says so before the tap.
export const MAX_ASKED = 15
const TOO_MANY = { tone: 'bad', text: `Ask at most ${MAX_ASKED} people at once` }

// The sheet for an Ask. Everyone the machine says may be asked and `pool` allows is listed with what is true of them, the people
// this ask is meant for ticked. `build(picked)` words the sheet for whoever is ticked (askable people, in list order); the sheet
// calls `forPicked` as the ticks change.
function askSheet(standing, meantFor, build, pool = () => true) {
  const askable = (standing?.askable || []).filter(pool)
  const pick = logins => askable.filter(item => logins.some(login => login.toLowerCase() === item.by.toLowerCase()))
  const ticked = pick(meantFor)
  const people = { label: 'Who should I ask?', options: askable.map(item => ({ key: item.by, label: item.by, detail: WHY[item.reason].detail(item), ticked: ticked.includes(item) })) }
  return { ...build(ticked), people, forPicked: logins => build(pick(logins)) }
}

// Ask for re-review: whoever you tick is asked to look again, with GitHub's usual review request.
export function askRereviewCopy(pr, { standing = null } = {}) {
  return askSheet(standing, standing?.rereviewFrom || [], picked => {
    const who = names(picked.map(item => item.by))
    return {
      icon: 'person', title: `Ask ${picked.length ? who : 'reviewers'} to review #${pr.number} again?`, confirm: NAMES.askRereview, working: 'Asking…',
      facts: [picked.length ? { tone: 'ok', text: `GitHub asks ${who} for a review of the new version` } : { tone: 'bad', text: 'Pick at least one person' },
        ...(picked.length > MAX_ASKED ? [TOO_MANY] : [])],
      footnote: 'They get GitHub’s usual review request. Nothing is posted in the conversation.',
      disabled: !picked.length || picked.length > MAX_ASKED,
      done: () => ({ title: 'Asked to look again', text: `${who} ${picked.length === 1 ? 'is' : 'are'} asked to look again.` }),
    }
  // GitHub takes a review request only for someone with access to the repository: the people the machine read from GitHub's
  // writers-only opinions (`requestable`). Someone who only commented may have none, and Ask for approval reaches them.
  }, item => item.requestable)
}

// The platform refuses a longer note (ApprovalRequest.note); the sheet says so before the tap instead of after it.
export const APPROVAL_NOTE_LIMIT = 1000

// The one note Ask for approval posts. Shown on the sheet and sent as it is, so it names only the people asked,
// each with what is true of them (a reviewer who only commented, one whose request is of an earlier version, and so on).
export function approvalNote(pr, people) {
  const mentions = people.map(person => `@${person.by}`).join(' ')
  const lines = people.map(person => `- @${person.by} ${WHY[person.reason].note(person)}`)
  return [`${mentions} there is a new version of this PR (\`${short(pr.headRefOid)}\`) that is not approved yet.`, lines.join('\n'),
    'If your points are resolved, please approve. Sent from Contribute.'].join('\n\n')
}

// Ask for approval: a note on the PR, in public from your account, to whoever you tick. A change request that still stands
// lifts only when they approve or dismiss it, and the note says so for those people.
export function askApprovalCopy(pr, { standing = null } = {}) {
  return askSheet(standing, standing?.approvalFrom || [], picked => {
    const who = names(picked.map(item => item.by))
    const note = approvalNote(pr, picked)
    const tooLong = note.length > APPROVAL_NOTE_LIMIT
    return {
      icon: 'person', title: `Ask ${picked.length ? who : 'reviewers'} to approve #${pr.number}?`, confirm: NAMES.askApproval, working: 'Posting…',
      facts: [
        picked.length ? { tone: 'ok', text: `${plural(picked.length, 'person', 'people')} will be asked` } : { tone: 'bad', text: 'Pick at least one person' },
        ...(tooLong ? [{ tone: 'bad', text: 'The note is too long: ask fewer people' }] : []),
        ...(picked.length > MAX_ASKED ? [TOO_MANY] : []),
        { tone: 'warn', text: 'The note is public on the PR, from your GitHub account' },
      ],
      says: picked.length ? { label: 'The note that will be posted', markdown: note } : null,
      footnote: picked.some(item => HOLDS_A_REQUEST.includes(item.reason)) ? 'Posts exactly this note, once. Nothing else changes: only their approval, or dismissing their request, lifts it.' : 'Posts exactly this note, once. Nothing else changes.',
      disabled: !picked.length || tooLong || picked.length > MAX_ASKED,
      done: () => ({ title: 'Note posted', text: `${who} ${picked.length === 1 ? 'is' : 'are'} asked to approve.` }),
    }
  })
}

// Close without merging. It can be reopened on GitHub.
export function closeCopy(pr) {
  return {
    icon: 'close', title: `Close #${pr.number} without merging?`, confirm: NAMES.closePr, working: 'Closing…',
    facts: [{ tone: 'warn', text: 'Nothing merges. Reviewers stop being asked' }, { tone: 'ok', text: 'It can be reopened on GitHub' }],
    footnote: `For the version you are looking at (${short(pr.headRefOid)}).`,
    done: () => ({ title: 'Closed', text: `#${pr.number} is closed.` }),
  }
}

// The sheet's words for each of the owner's own actions, by the PR machine's action id.
export const ACTION_COPY = { open_for_review: openForReviewCopy, merge: mergeCopy, back_to_draft: backToDraftCopy, ask_rereview: askRereviewCopy, ask_approval: askApprovalCopy, close: closeCopy }
