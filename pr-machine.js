// The PR machine: the one place that decides where a PR stands for you and what
// you may do next. Every screen renders `decide(facts)`; the platform runs the
// same table (contribution_pr_machine.py) before every effect it performs, and
// both are held to the same cases (test/pr-machine.cases.json).
//
// Facts come from pr-facts.js. A fact that could not be read is 'unknown' and
// never enables anything that needs it.
//
// The rules, in plain words:
//   - Your role decides everything: your PR (author) or theirs (reviewer). An
//     author never gets a public review action; an agent's check of your PR is private.
//   - Ready to merge is an approval of this exact version by someone other than the
//     author (bots never count), no change request still standing, checks that
//     pass (or none exist), no conflicts, and nothing unconfirmed on its way out.
//     An approval of an older commit still counts when the fact reader proved the PR's own
//     change the same (`sameWork`, see same-work.js): a merge of the base is a new commit, not new work.
//     That words the PR's standing and its highlighted next step (notReadyToMerge); it does not switch your own
//     Merge off, and GitHub's merge rules refuse what cannot land. The agent's own unattended merge has no tap
//     behind it, so the platform still asks it (not_ready_to_merge).
//   - Only four things stop an action of yours: the PR cannot be read, it is closed or merged, an agent is already
//     working on it, or something sent to GitHub is not confirmed. An action tied to a thing waits for that thing
//     (a draft to send, a person to ask, a result to set aside). Asking works for anyone who reviewed or commented
//     and has not approved this version; the sheet ticks the people each ask is meant for. Taking over someone
//     else's PR stays for maintainers: it is Contribute's own rule, GitHub would let any writer push.
//   - Only new commits bring their PR back for re-review; replies never do. A reviewer who only commented
//     has not approved, however long they looked: a plain comment never lifts a change request on GitHub, and
//     a PR that needs an approval does not get one from it. Anyone who commented on this version can be
//     asked to approve; the comment itself is feedback to answer until you reply (that is pr-facts.js).
//   - One agent job per PR at a time.
//   - A draft that deals with the open findings (a prepared fix, a ready answer built on them, a verdict
//     drafted from them) owns them while it waits or is on its way: no agent job starts and the findings are
//     not set aside until you send it or throw it away. The app marks such a draft `covers`.
// Pure: no DOM, no network.
import { NAMES, rerunName } from './names.js'

const WRITE = ['WRITE', 'MAINTAIN', 'ADMIN']
const MAINTAINER = ['MAINTAIN', 'ADMIN']
export const mayWrite = permission => WRITE.includes(permission)

// The few values every rule below is written in.
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

function derive(facts) {
  const people = (facts.reviews || []).filter(review => !review.bot && !same(review.by, facts.author))
  const atHead = review => review.commit === facts.head
  const names = test => [...new Map(people.filter(test).map(review => [String(review.by).toLowerCase(), review.by])).values()]
  // An approval is of this version when it is of this commit, or of the same work (the reader's proof, never guessed here).
  const approvedHere = review => review.state === 'APPROVED' && (atHead(review) || review.sameWork === true)
  const result = facts.result?.head === facts.head ? facts.result : null
  // A draft belongs to the version it was written for and goes stale with it. Something sent to GitHub
  // whose outcome is not known does not: a new head neither confirms nor refutes it, so it holds
  // (and blocks the next job or Merge) until it is reconciled.
  const outbox = facts.outbox && (facts.outbox.state !== 'drafted' || facts.outbox.head === facts.head) ? facts.outbox : null
  const changesOlder = names(review => review.state === 'CHANGES_REQUESTED' && !atHead(review))
  const commentedAtHead = names(review => review.state === 'COMMENTED' && atHead(review))
  // Whose change request is of an older version, but who has looked at this one since and only commented.
  const lookedAgain = changesOlder.filter(name => commentedAtHead.some(other => same(other, name)))
  const approvedAtHead = names(approvedHere)
  const changesAtHead = names(review => review.state === 'CHANGES_REQUESTED' && atHead(review))
  // Who commented on this version without approving it, and holds no change request: they looked and gave no verdict.
  const commentedOnly = commentedAtHead.filter(name => ![...approvedAtHead, ...changesAtHead, ...changesOlder].some(other => same(other, name)))
  const carried = people.filter(review => approvedHere(review) && !atHead(review)).map(review => ({ by: review.by, commit: review.commit }))
  const approvedOlder = names(review => review.state === 'APPROVED' && !approvedHere(review))
  const standing = {
    approvedAtHead,
    approvedOlder,
    carried,
    carriedOnly: approvedAtHead.length > 0 && approvedAtHead.every(name => carried.some(item => same(item.by, name))),
    changesAtHead,
    changesOlder,
    lookedAgain,
    commentedOnly,
    // Who Ask for approval can ask: everyone who commented on this version and has not approved it.
    approvalFrom: [...lookedAgain, ...commentedOnly],
    // Who a re-review request can still ask: an older review of theirs that they have not looked past.
    rereview: [...new Set([...changesOlder, ...approvedOlder])].filter(name => !lookedAgain.includes(name) && !commentedOnly.includes(name)),
    mine: facts.myReview || null,
    mineAtHead: !!facts.myReview && facts.myReview.commit === facts.head,
    result,
    earlier: facts.earlier && facts.earlier.head !== facts.head ? facts.earlier : null,
    openFindings: result?.outcome === 'findings' && !result.setAside,
    outbox,
    coveredBy: outbox?.covers ? outbox.kind : '',
  }
  return { ...standing, askable: askablePeople(facts, people, standing) }
}

// Who could be asked to look at this version: everyone who reviewed or commented, except those whose approval already
// counts for it. `reason` is what is true of them (it words the public note), `commit` the version their review was of.
// The merge standing above reads only writers' opinions; people it does not read (a reviewer without write access) come
// from `participants`, GitHub's newest review of everyone, and are worded from that review alone.
function askablePeople(facts, people, standing) {
  const has = (list, name) => list.some(other => same(other, name))
  const REASONS = [['changes_here', 'CHANGES_REQUESTED', standing.changesAtHead], ['looked_again', 'CHANGES_REQUESTED', standing.lookedAgain],
    ['commented_here', 'COMMENTED', standing.commentedOnly], ['changes_older', 'CHANGES_REQUESTED', standing.changesOlder], ['approved_older', 'APPROVED', standing.approvedOlder]]
  const outside = (facts.participants || []).filter(review => !review.bot && !same(review.by, facts.author) && !people.some(other => same(other.by, review.by)))
    .filter(review => !(review.state === 'APPROVED' && review.commit === facts.head))
  const everyone = [...new Map([...people, ...outside].map(review => [String(review.by).toLowerCase(), review.by])).values()]
  return everyone.filter(name => !has(standing.approvedAtHead, name)).map(by => {
    const own = outside.find(review => same(review.by, by))
    if (own) return { by, reason: ownReason(own, facts.head), commit: own.commit }
    const [reason, state] = REASONS.find(([, , list]) => has(list, by)) || ['commented_older', 'COMMENTED']
    return { by, reason, commit: people.find(review => same(review.by, by) && review.state === state)?.commit || '' }
  })
}
const ownReason = (review, head) => (review.state === 'CHANGES_REQUESTED' ? (review.commit === head ? 'changes_here' : 'changes_older')
  : review.state === 'APPROVED' ? 'approved_older' : review.commit === head ? 'commented_here' : 'commented_older')

// Every state. turn: you | agent | other | none. `label` is the short chip on a row,
// `headline` the line under a PR's title, `next` the highlighted action.
export const STATES = {
  merged: { turn: 'none', label: 'Merged', headline: 'Merged' },
  closed: { turn: 'none', label: 'Closed', headline: 'Closed' },
  unknown: { turn: 'you', label: 'Couldn’t read', headline: 'Couldn’t read this PR from GitHub. Try again', next: 'retry' },
  unconfirmed: { turn: 'you', label: 'Not confirmed', headline: 'GitHub didn’t confirm what was sent. Check GitHub before trying again', next: 'check_github' },
  sending: { turn: 'agent', label: 'Sending', headline: 'Sending to GitHub…' },
  to_confirm: { turn: 'you', label: 'Draft to send', headline: 'A draft is ready. Read it, then send it or throw it away', next: 'send_draft' },
  working: { turn: 'agent', label: 'Agent working', headline: 'An agent is working on it' },
  needs_answer: { turn: 'you', label: 'Agent asks you', headline: 'The agent has a question for you', next: 'open_job' },
  stalled: { turn: 'you', label: 'Agent stopped', headline: 'The agent stopped before it finished. Run it again', next: 'rerun_job' },

  'author.draft': { turn: 'you', label: 'Draft', headline: 'Your PR · a draft. Check it first', next: 'check_my_pr' },
  'author.draft_ready': { turn: 'you', label: 'Ready to open', headline: 'Your PR · checked and clean. Open it for review', next: 'open_for_review' },
  'author.findings': { turn: 'you', label: 'Findings', headline: 'Your PR · your check found problems. Fix them or set them aside', next: 'respond' },
  'author.blocked': { turn: 'you', label: 'Checks or conflicts', headline: 'Your PR · checks fail or it conflicts. Fix it', next: 'respond' },
  'author.feedback': { turn: 'you', label: 'Feedback to answer', headline: 'Your PR · feedback is waiting. Answer every point', next: 'respond' },
  'author.waiting_rereview': { turn: 'other', label: 'Fixes pushed', headline: 'Your PR · fixes pushed. Waiting on {who} to review again' },
  'author.looked_again': { turn: 'you', label: 'Looked again · not approved', headline: 'Your PR · {who} looked again and left a comment, but GitHub still holds their change request. Ask for their approval', next: 'ask_approval' },
  'author.commented': { turn: 'you', label: 'Commented · not approved', headline: 'Your PR · {who} left a comment but hasn’t approved. Ask for their approval', next: 'ask_approval' },
  'author.approval_stale': { turn: 'other', label: 'Approval is old', headline: 'Your PR · approved on an older version. Waiting on {who} to look again' },
  'author.waiting_review': { turn: 'other', label: 'Waiting on reviewers', headline: 'Your PR · waiting on reviewers' },
  'author.approved_checks': { turn: 'other', label: 'Approved', headline: 'Your PR · approved. {checks}' },
  'author.approved': { turn: 'you', label: 'Ready to merge', headline: 'Your PR · approved by {who} at this version, {green}. Merge it', next: 'merge' },
  'author.approved_no_rights': { turn: 'other', label: 'Approved', headline: 'Your PR · approved, {green}. Waiting on someone who can merge' },

  'reviewer.draft': { turn: 'other', label: 'Draft', headline: 'Their PR · still a draft' },
  'reviewer.to_review': { turn: 'you', label: 'To review', headline: 'Their PR · your turn: review it', next: 'review' },
  'reviewer.result_ready': { turn: 'you', label: 'Review ready', headline: 'Their PR · your review is ready. Send a verdict or keep it private', next: 'draft_verdict' },
  'reviewer.waiting_author': { turn: 'other', label: 'Waiting on {author}', headline: 'Their PR · you asked for changes. Waiting on {author}' },
  'reviewer.re_review': { turn: 'you', label: 'New commits · review again', headline: 'Their PR · new commits since your review. Review again', next: 'review' },
  'reviewer.reviewed': { turn: 'none', label: 'Reviewed', headline: 'Their PR · you reviewed this version' },
  'reviewer.kept_private': { turn: 'none', label: 'Kept private', headline: 'Their PR · you kept your review of this version private' },
  'reviewer.mergeable': { turn: 'you', label: 'Ready to merge', headline: 'Their PR · approved at this version, {green}. Merge it', next: 'merge' },
}

// A drafted repair is a fix an agent prepared: the same state as any draft, in the words of a push.
// Only the app sees prepared fixes (the platform's facts never carry an outbox), so this stays here.
const FIX_WAITING = { label: 'Fix to push', headline: 'A fix is ready. Read it, then push it or don’t' }
// An approval that only carries over says so: "at this version" would be untrue of it.
const CARRIED_APPROVAL = { headline: 'Your PR · approved by {who}, {green}. The lines you added and removed are the same as when they approved. Merge it' }
function wordsOf(key, d) {
  if (key === 'to_confirm' && d.outbox?.kind === 'repair') return { ...STATES[key], ...FIX_WAITING }
  return key === 'author.approved' && d.carriedOnly ? { ...STATES[key], ...CARRIED_APPROVAL } : STATES[key]
}

// The state, by a fixed priority: the first match wins.
function stateOf(facts, d) {
  if (facts.lifecycle === 'merged' || facts.lifecycle === 'closed') return facts.lifecycle
  if (facts.lifecycle === 'unknown' || facts.readComplete === false) return 'unknown'
  const outboxState = { unconfirmed: 'unconfirmed', sending: 'sending', drafted: 'to_confirm' }[d.outbox?.state]
  if (outboxState) return outboxState
  if (facts.job) return { running: 'working', needs_answer: 'needs_answer', stalled: 'stalled' }[facts.job.state] || 'working'
  return facts.role === 'author' ? authorStanding(facts, d) : reviewerStanding(facts, d)
}

function authorStanding(facts, d) {
  if (facts.lifecycle === 'draft') return d.openFindings ? 'author.findings' : d.result?.outcome === 'clear' ? 'author.draft_ready' : 'author.draft'
  if (d.openFindings) return 'author.findings'
  if (facts.checks === 'fail' || facts.mergeable === 'conflict') return 'author.blocked'
  if (d.changesAtHead.length || facts.openThreads > 0) return 'author.feedback'
  if (d.changesOlder.length) return d.lookedAgain.length ? 'author.looked_again' : 'author.waiting_rereview'
  if (d.approvedAtHead.length) return approvedStanding(facts)
  if (d.commentedOnly.length) return 'author.commented'
  if (d.approvedOlder.length) return 'author.approval_stale'
  return 'author.waiting_review'
}

function approvedStanding(facts) {
  if (!['pass', 'none'].includes(facts.checks) || facts.mergeable !== 'yes' || facts.gate === 'review_required') return 'author.approved_checks'
  return mayWrite(facts.permission) ? 'author.approved' : 'author.approved_no_rights'
}

// Your verdict on this version comes first, then a finished review of this version
// (a re-review that is done is no longer "new commits"), then an older review of yours, posted on
// GitHub (`mine`) or kept private (`earlier`).
function reviewerStanding(facts, d) {
  if (d.mineAtHead && d.mine.state === 'CHANGES_REQUESTED') return 'reviewer.waiting_author'
  if (d.mineAtHead) return notReadyToMerge(facts, d) ? 'reviewer.reviewed' : 'reviewer.mergeable'
  if (d.result) return d.result.setAside ? 'reviewer.kept_private' : 'reviewer.result_ready'
  if (d.mine || d.earlier) return 'reviewer.re_review'
  return facts.lifecycle === 'draft' ? 'reviewer.draft' : 'reviewer.to_review'
}

const CHECK_WORDS = { pass: '', none: '', fail: 'Checks are failing.', pending: 'Checks are still running.', unknown: 'Checks could not be read. Try again.' }
const GATE_WORDS = 'GitHub still needs a review.'
const CONFLICT_WORDS = { yes: '', conflict: 'It has merge conflicts.', unknown: 'GitHub hasn’t worked out conflicts yet. Try again.' }
const firstReason = (...reasons) => reasons.find(Boolean) || ''
// A stalled job holds nothing: starting again (or another job) is the way out of it.
const jobIdle = facts => (facts.job && facts.job.state !== 'stalled' ? 'An agent is already working on this PR.' : '')
// Something sent to GitHub but not yet confirmed: no new agent job may race it.
const nothingInFlight = d => (d.outbox && d.outbox.state !== 'drafted' ? 'Something sent to GitHub is not confirmed yet.' : '')
// A draft that deals with the open findings owns them, in every step of its way out. The fact is the app's alone:
// the platform never sees drafts, so its table has no such rule and every case it shares with this one is unchanged.
const OWNED_BY_DRAFT = {
  drafted: 'A waiting draft already deals with these findings. Send it or throw it away first.',
  sending: 'A draft that deals with these findings is being sent.',
  unconfirmed: 'A draft that deals with these findings is not confirmed yet. Check GitHub first.',
}
const draftOwnsFindings = d => (d.outbox?.covers ? OWNED_BY_DRAFT[d.outbox.state] || '' : '')
const stillOpen = facts => (['open', 'draft'].includes(facts.lifecycle) ? '' : 'This PR is no longer open.')
const readable = facts => (facts.lifecycle === 'unknown' || facts.readComplete === false ? 'This PR could not be read. Try again.' : '')

// Why this PR is not ready to merge, in order; '' when it is. It words the PR's standing (Ready to merge, the highlighted
// next step); Merge itself is offered whenever its stops below allow, whatever this says.
export function notReadyToMerge(facts, d = derive(facts)) {
  const standing = [...d.changesAtHead, ...d.changesOlder]
  return firstReason(
    readable(facts),
    facts.lifecycle === 'draft' ? 'Open it for review first.' : stillOpen(facts),
    mayWrite(facts.permission) ? '' : 'Needs merge rights.',
    d.approvedAtHead.length ? '' : d.approvedOlder.length ? 'The approval is for an older version.' : 'Nobody but the author has approved it yet.',
    standing.length ? `${standing.join(', ')} asked for changes and hasn’t approved since.` : '',
    facts.gate === 'review_required' ? GATE_WORDS : '',
    CHECK_WORDS[facts.checks] ?? CHECK_WORDS.unknown,
    CONFLICT_WORDS[facts.mergeable] ?? CONFLICT_WORDS.unknown,
    nothingInFlight(d),
    jobIdle(facts),
  )
}

// What stops one of your actions whatever the PR's review standing is: the PR cannot be read, it is closed or merged, an agent
// is working on it, or something sent to GitHub is not confirmed. The rest (approvals, checks, rights) GitHub and the
// platform refuse in their own words when the tap reaches them.
const agentStops = (facts, d) => firstReason(readable(facts), stillOpen(facts), jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d))
const takeOverStops = (facts, d) => firstReason(readable(facts), stillOpen(facts), MAINTAINER.includes(facts.permission) ? '' : 'Only maintainers can take over someone else’s PR.', jobIdle(facts), nothingInFlight(d), draftOwnsFindings(d))
const mergeStops = (facts, d) => firstReason(readable(facts), stillOpen(facts), nothingInFlight(d), jobIdle(facts))
const statusStops = facts => firstReason(readable(facts), stillOpen(facts), jobIdle(facts))
// The two Ask actions need someone to name: anyone who reviewed or commented, except who already approved this version.
const nobodyToAsk = d => (d.approvedAtHead.length ? 'Everyone who reviewed it has already approved this version.' : 'Nobody has reviewed this PR yet.')
// A list of people that was not read whole is not offered: they cannot be added by hand. (A fact set with no `participants`
// asks nobody beyond the reviews it lists; only the fact reader says null.)
const unreadPeople = facts => (facts.participants === null ? 'Could not read everyone who reviewed this PR. Try again.' : '')
const askStops = (facts, d) => firstReason(readable(facts), stillOpen(facts), unreadPeople(facts), d.askable.length ? '' : nobodyToAsk(d))
const outboxIs = (d, state) => (d.outbox?.state === state ? '' : 'Nothing like that is waiting.')

// Every action. `by` says who acts: an agent job, or your own tap (each behind a
// confirm sheet). `when` returns '' when allowed, otherwise the reason it is not.
export const ACTIONS = [
  { id: 'check_my_pr', by: 'agent', roles: ['author'], title: NAMES.review, detail: 'Private. Nothing is posted.',
    when: agentStops },
  { id: 'respond', by: 'agent', roles: ['author'], title: NAMES.respond, detail: 'Answers every point, then one approval sheet for the pushes and replies.',
    when: agentStops },
  { id: 'finish_it', by: 'agent', roles: ['author'], title: NAMES.finishIt, detail: 'Responds, checks and fixes. Stops for your approval before each push.',
    when: agentStops },
  { id: 'review', by: 'agent', roles: ['reviewer'], title: d => (d.mine || d.result || d.earlier ? NAMES.reviewAgain : NAMES.review), detail: 'Private, drafted for you, or posted by the agent if you allow it.',
    when: agentStops },
  { id: 'take_over', by: 'agent', roles: ['reviewer'], title: NAMES.takeOver, detail: 'Maintainers only. Needs a reason, and says so on the PR. Each push needs your approval.',
    when: takeOverStops },

  { id: 'send_draft', by: 'you', roles: ['author', 'reviewer'], title: 'Send…', when: (facts, d) => outboxIs(d, 'drafted') },
  { id: 'check_github', by: 'you', roles: ['author', 'reviewer'], title: 'Check GitHub', when: (facts, d) => outboxIs(d, 'unconfirmed') },
  // Only an unconfirmed verdict can be set aside here; other outcomes settle by checking GitHub.
  { id: 'dismiss', by: 'you', roles: ['author', 'reviewer'], title: NAMES.discard, when: (facts, d) => outboxIs(d, 'unconfirmed') || (d.outbox.kind === 'verdict' ? '' : 'Only a verdict can be discarded.') },
  { id: 'draft_verdict', by: 'you', roles: ['reviewer'], title: 'Approve, request changes or comment…',
    when: (facts, d) => firstReason(readable(facts), d.result && !d.mineAtHead && !d.outbox ? '' : 'Review this version first.') },
  { id: 'set_aside', by: 'you', roles: ['author', 'reviewer'], title: 'Set aside…',
    when: (facts, d) => firstReason(readable(facts), d.result && !d.result.setAside && (facts.role === 'reviewer' || d.openFindings) ? '' : 'Nothing to set aside.', draftOwnsFindings(d)) },
  { id: 'open_for_review', by: 'you', roles: ['author'], title: NAMES.openForReview, when: statusStops },
  { id: 'back_to_draft', by: 'you', roles: ['author'], title: NAMES.backToDraft, when: statusStops },
  { id: 'ask_rereview', by: 'you', roles: ['author'], title: NAMES.askRereview, when: askStops },
  { id: 'ask_approval', by: 'you', roles: ['author'], title: d => (d.approvalFrom.length ? `Ask ${d.approvalFrom.join(', ')} to approve` : NAMES.askApproval), detail: 'Posts one short note on the PR.',
    when: askStops },
  { id: 'merge', by: 'you', roles: ['author', 'reviewer'], title: NAMES.merge, when: mergeStops },
  { id: 'close', by: 'you', roles: ['author', 'reviewer'], title: NAMES.closePr, detail: 'Asks you to confirm first.',
    when: statusStops },
  { id: 'retry', by: 'you', roles: ['author', 'reviewer'], title: 'Try again', when: facts => (readable(facts) ? '' : 'Already up to date.') },
  { id: 'open_job', by: 'you', roles: ['author', 'reviewer'], title: 'Answer the agent', when: facts => (facts.job?.state === 'needs_answer' ? '' : 'No question is waiting.') },
  { id: 'rerun_job', by: 'you', roles: ['author', 'reviewer'], title: (d, facts) => rerunName(facts.job?.kind), when: facts => (facts.job?.state === 'stalled' ? '' : 'Nothing has stalled.') },
]

// The people a headline names: who approved this version, or whose review is of an older one.
const headlineWho = (key, d) => ({ 'author.waiting_rereview': d.changesOlder, 'author.looked_again': d.lookedAgain, 'author.commented': d.commentedOnly, 'author.approval_stale': d.approvedOlder, 'author.approved': d.approvedAtHead }[key] || [])

function headlineFor(key, facts, d) {
  const clean = ['pass', 'none'].includes(facts.checks) && facts.mergeable === 'yes'
  const checks = clean && facts.gate === 'review_required' ? GATE_WORDS
    : facts.mergeable === 'yes' ? CHECK_WORDS[facts.checks] || 'Checks are still running.' : CONFLICT_WORDS[facts.mergeable] || CONFLICT_WORDS.unknown
  return wordsOf(key, d).headline.replace('{who}', headlineWho(key, d).join(', ') || 'reviewers').replace('{author}', facts.author || 'the author')
    .replace('{checks}', checks).replace('{green}', facts.checks === 'none' ? 'no checks' : 'checks green')
}

// The one entry point: facts in, { role, state, turn, label, headline, next, jobKind, coveredBy, waitingOn, actions,
// approvedBy, carriedFrom, changesFrom, lookedAgain, approvalFrom, rereviewFrom, askable } out. `jobKind` is the kind of the PR's agent job ('' when none); `coveredBy` the kind of
// draft that owns the open findings (repair, answer, verdict; '' when none). The rest name people: who approved this version (carriedFrom:
// those of them whose approval is of an older commit with the same work, as { by, commit }), who looked again without approving, and whose
// review is of an older version that they have not looked past; changesFrom: who holds a change request, of this version or an older one; askable: everyone the Ask actions may name, as { by, reason, commit } (approvalFrom and rereviewFrom are the ones ticked at first).
export function decide(facts) {
  const d = derive(facts)
  const key = stateOf(facts, d)
  const state = wordsOf(key, d)
  const actions = ACTIONS.filter(action => action.roles.includes(facts.role)).map(action => {
    const reason = action.when(facts, d)
    const title = typeof action.title === 'function' ? action.title(d, facts) : action.title
    return { id: action.id, by: action.by, title, detail: action.detail || '', enabled: !reason, reason, highlighted: action.id === state.next && !reason }
  })
  const waitingOn = state.turn !== 'other' ? '' : facts.role === 'reviewer' ? facts.author || 'the author' : headlineWho(key, d).join(', ') || 'reviewers'
  const label = state.label.replace('{author}', facts.author || 'the author')
  return { role: facts.role, state: key, turn: state.turn, label, headline: headlineFor(key, facts, d), next: state.next || '', jobKind: facts.job?.kind || '', coveredBy: d.coveredBy, waitingOn, actions,
    approvedBy: d.approvedAtHead, carriedFrom: d.carried, changesFrom: [...d.changesAtHead, ...d.changesOlder], lookedAgain: d.lookedAgain, approvalFrom: d.approvalFrom, rereviewFrom: d.rereview, askable: d.askable }
}

export const actionOf = (decision, id) => decision.actions.find(action => action.id === id) || null
