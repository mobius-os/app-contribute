// A saved Respond-to-feedback result and what the owner decided about it. Pure: no React, no I/O.
// The contract with respond_result.py (which writes the result) is in respond-result.md.
//
// The app reads strictly: a file that breaks a rule is not a response at all, never half shown. The helper
// has already enforced the same rules, so a file that fails here was edited or is from another version.
import { NAMES } from './names.js'
import { stateOf } from './lifecycle-record.js'
import { LIFECYCLE_TABLES as TABLES } from './lifecycle-tables.js'

// THE GATE on Post. The responding agent shares the app's storage, so it can write an approval itself: a matching approval file does
// not show the owner pressed Post. Post is therefore offered only when this Möbius confirms it on its own sheet (owner-grant.js,
// ownerConfirmOffered): approveResponse asks that sheet for a grant bound to this answer, and respond_result.py spends it before it posts.
// Until the host offers it (or when its capabilities cannot be read) Post is off.
export const COPY_REPLIES = 'Copy replies'
// The quiet button of an approved answer whose chat never started: it removes the approval, so nothing is posted and Post is offered again.
export const TAKE_BACK = 'Take back Post'
// Why Post is off, naming only the controls the card has in that state: the chat button is Reply in chat until Post was
// pressed once, and Open chat after (Send again, Try again); Copy replies is named only when there are replies to copy.
export function postOffReason(status = 'ready', hasReplies = true) {
  const chat = status === 'ready' ? NAMES.replyInChat : NAMES.openChat
  const next = hasReplies ? `${COPY_REPLIES} to post the replies yourself, or ${chat}` : `${chat} to talk it over`
  return `${NAMES.postAnswer} is off on this Möbius: it cannot yet confirm that it was you who pressed it. The answer stays saved. Use ${next}.`
}
// The reason as the first Post press meets it (with replies, before anything was sent).
export const POST_OFF_REASON = postOffReason()

import { SCREENSHOT_NAME } from './domain.js'

export const RESULT_FOLDER = 'respond-results/'
export const DECISION_FOLDER = 'respond-decisions/'
export const SCREENSHOT_FOLDER = 'respond-screenshots/'
const VERSION = 1
const SHA = /^[0-9a-f]{40}$/
const RESULT_ID = /^r-[0-9a-f]{12}$/
const DIGEST = /^[0-9a-f]{64}$/
const ATTEMPT = /^[0-9a-f]{12}$/
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const LOGIN = /^[A-Za-z0-9-]{1,39}$/
const STATES = new Set(['ready', 'posting', 'posted', 'failed'])
const ENDINGS = new Set(['fixed', 'not_valid', 'out_of_scope'])
const FILE_STATUSES = new Set(['added', 'modified', 'removed', 'renamed'])

// The name the helper gives a PR's files: lower case, owner__repo__number.
export const resultSlug = (repo, number) => `${String(repo).toLowerCase().replace('/', '__')}__${number}`

// Lengths count characters (code points) as the helper does, not UTF-16 units: an emoji is one character here, as there.
const within = (text, max) => text.length <= max || [...text].length <= max
const isText = (value, max, { empty = false } = {}) => typeof value === 'string' && within(value, max) && (empty || value.trim() !== '')
const isCount = value => Number.isInteger(value) && value >= 0
const list = (value, max) => (Array.isArray(value) && value.length <= max ? value : null)

function readPoint(point) {
  if (!point || typeof point !== 'object') return null
  const { reviewer, title, ending, commit, answer } = point
  if (!isText(reviewer, 60) || !isText(title, 160) || !ENDINGS.has(ending) || !isText(answer, 400, { empty: true })) return null
  if (commit !== null && !SHA.test(commit)) return null
  return { reviewer, title, ending, commit, answer }
}

function readReply(reply) {
  if (!reply || typeof reply !== 'object' || !isText(reply.body, 20000)) return null
  if (reply.reply_to !== null && !(Number.isInteger(reply.reply_to) && reply.reply_to > 0)) return null
  return { body: reply.body, reply_to: reply.reply_to }
}

function readCommit(commit) {
  return commit && typeof commit === 'object' && SHA.test(commit.sha) && isText(commit.title, 300, { empty: true }) ? { sha: commit.sha, title: commit.title } : null
}

function readFile(file) {
  if (!file || typeof file !== 'object' || !isText(file.path, 4096) || !FILE_STATUSES.has(file.status) || !isCount(file.added) || !isCount(file.removed)) return null
  if (file.patch !== null && !isText(file.patch, 60000, { empty: true })) return null
  const read = { path: file.path, status: file.status, added: file.added, removed: file.removed, patch: file.patch }
  if (typeof file.previous_path === 'string') read.previous_path = file.previous_path
  if (file.binary === true) read.binary = true
  if (file.patch_omitted === true) read.patch_omitted = true
  return read
}

// The screenshots the answer adds to the description, as the helper listed them; a malformed entry makes the whole list unreadable.
function readScreenshot(shot) {
  const ok = shot && typeof shot === 'object' && SCREENSHOT_NAME.test(shot.name) && DIGEST.test(shot.sha256) && isCount(shot.size) && isText(shot.alt, 200)
  return ok ? { name: shot.name, sha256: shot.sha256, size: shot.size, alt: shot.alt } : null
}

const stamped = value => (value && typeof value === 'object' && typeof value.at === 'string' ? value : null)

// What the helper recorded as done. Anything unreadable counts as not done, so the card never claims a step went out.
function readReceipts(raw, replyCount) {
  if (!raw || typeof raw !== 'object') return null
  const push = raw.push && typeof raw.push === 'object' && SHA.test(raw.push.sha) && typeof raw.push.at === 'string' ? { sha: raw.push.sha, at: raw.push.at } : null
  const replies = (Array.isArray(raw.replies) ? raw.replies : []).filter(item => item && Number.isInteger(item.index) && typeof item.url === 'string' && typeof item.at === 'string')
    .map(item => ({ index: item.index, url: item.url, at: item.at }))
  const rerequest = stamped(raw.rerequest)
  const screenshots = stamped(raw.screenshots) && typeof raw.screenshots.commit === 'string' ? { commit: raw.screenshots.commit, at: raw.screenshots.at } : null
  // The reply that was being sent when the post stopped, and may be on GitHub without a receipt. Only present when the helper wrote one.
  const sending = stamped(raw.sending) && Number.isInteger(raw.sending.index) && raw.sending.index >= 0 && raw.sending.index < replyCount ? { index: raw.sending.index, at: raw.sending.at } : null
  return { push, replies, screenshots, description: stamped(raw.description) ? { at: raw.description.at } : null, rerequest: rerequest ? { at: rerequest.at, reviewers: Array.isArray(rerequest.reviewers) ? rerequest.reviewers.filter(login => typeof login === 'string') : [] } : null, ...(sending ? { sending } : {}) }
}

function readEach(raw, read, max) {
  const items = list(raw, max)
  const read_ = items && items.map(read)
  return read_ && read_.every(Boolean) ? read_ : null
}

// A result as the helper wrote it, or null when it is anything else.
export function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== VERSION) return null
  const { id, repo, number, chat_id: chatId, created_at: createdAt, state, pr, tip_sha: tip, digest, tests, description, error } = raw
  if (!RESULT_ID.test(id) || !REPO.test(repo) || !Number.isInteger(number) || number < 1 || !isText(chatId, 128) || !isText(createdAt, 40) || !STATES.has(state)) return null
  if (!pr || typeof pr !== 'object' || !SHA.test(pr.head_sha) || !isText(pr.head_ref, 255) || !isText(pr.base_ref, 255) || !REPO.test(pr.head_repo) || !SHA.test(tip) || !DIGEST.test(digest)) return null
  if (!isText(tests, 500, { empty: true }) || (description !== null && !isText(description, 60000))) return null
  const rerequest = list(raw.rerequest, 10)
  const points = readEach(raw.points, readPoint, 30)
  const replies = readEach(raw.replies, readReply, 12)
  const commits = readEach(raw.commits, readCommit, 60)
  const files = readEach(raw.files, readFile, 300)
  const receipts = readReceipts(raw.receipts, replies ? replies.length : 0)
  const screenshots = raw.screenshots === undefined ? [] : readEach(raw.screenshots, readScreenshot, 8)
  if (!screenshots || !rerequest || !rerequest.every(login => LOGIN.test(login)) || !points || !replies || !commits || !files || !receipts) return null
  const failure = error && typeof error === 'object' && typeof error.step === 'string' && typeof error.message === 'string' ? { step: error.step, message: error.message } : null
  if (error !== null && !failure) return null
  // The helper's own stamp of the post (respond_lifecycle.py), kept as written: respond-lifecycle.js decides whether it is usable.
  const stamp = raw.lifecycle && typeof raw.lifecycle === 'object' && !Array.isArray(raw.lifecycle) ? { lifecycle: raw.lifecycle } : {}
  return { version: VERSION, id, repo, number, chat_id: chatId, created_at: createdAt, state, pr: { head_sha: pr.head_sha, head_ref: pr.head_ref, base_ref: pr.base_ref, head_repo: pr.head_repo },
    tip_sha: tip, points, replies, description, rerequest, tests, screenshots, commits, files, digest, receipts, error: failure, ...stamp }
}

// What the owner decided: only Post (approved) and Discard are ever written. `attempt` names the Post an approval belongs to (respond-flow.js);
// an approval written before it existed has none.
export function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return null
  if (!RESULT_ID.test(raw.result_id) || !DIGEST.test(raw.digest) || !['approved', 'discarded'].includes(raw.decision)) return null
  return { result_id: raw.result_id, digest: raw.digest, decision: raw.decision, at: typeof raw.at === 'string' ? raw.at : '', ...(ATTEMPT.test(raw.attempt) ? { attempt: raw.attempt } : {}) }
}

const samePr = (result, pr) => result.repo.toLowerCase() === pr?.repository?.nameWithOwner?.toLowerCase() && result.number === pr?.number

// The saved response of this PR: `{ slug, result, decision }`, or null.
export const responseFor = (responses, pr) => (responses || []).find(entry => entry?.result && samePr(entry.result, pr)) || null

// The owner's decision, counted only for the exact answer it names: another result, or the same result changed since, ignores it.
export const decisionOf = entry => (entry.decision && entry.decision.result_id === entry.result.id && entry.decision.digest === entry.result.digest ? entry.decision.decision : null)

// Where a response stands on its PR:
//   ready (fresh, nothing decided), approved (Post pressed, the chat has not started), stale (the PR moved after the answer),
//   posting, failed (stopped part-way), posted (the PR is where the post left it), or null (discarded, or history).
// A failed answer the owner discarded is gone from the PR like a ready one; what it already put on GitHub stays there.
export function responseStatus(entry, pr) {
  const result = entry?.result
  if (!result) return null
  const decision = decisionOf(entry)
  if (result.state === 'posted') return pr?.headRefOid === result.tip_sha || pr?.headRefOid === result.pr.head_sha ? 'posted' : null
  if (result.state === 'failed' && decision === 'discarded') return null
  if (result.state === 'posting' || result.state === 'failed') return result.state
  if (decision === 'discarded') return null
  if (pr?.headRefOid !== result.pr.head_sha) return 'stale'
  return decision === 'approved' ? 'approved' : 'ready'
}

// The step the app names when it is the one that took a post as stopped (respond-lifecycle.js), as against a stop the helper reported.
export const STALLED_STEP = 'posting'
// How long a post may go without a step going out before it is taken as stopped: the deadline of the POSTING state, in minutes.
export const POSTING_SILENCE_MINUTES = TABLES.regions.respond.states.POSTING.deadline.seconds / 60

// The seconds after Post. Both real posts had the message at the chat in 2 s, the first step done by 8.6 s and everything posted by 13 s.
// The chat gets this long to start before the card offers Send again: the deadline of the APPROVED state, read from the tables.
export const RESEND_AFTER_MS = TABLES.regions.respond.states.APPROVED.deadline.seconds * 1000
// After Post an answer is read closely for this long, then on the idle cadence: a chat that never starts is not read fast for ever.
export const WATCH_MS = 300000
// A clock a few seconds behind the one that pressed Post is normal; further off, the time is not trusted.
const SKEW_MS = 5000

// Whether `at` (a saved time) is less than `limit` ms before `now`. An unreadable time is never within.
const withinMs = (at, now, limit) => { const elapsed = now - Date.parse(at || ''); return elapsed > -SKEW_MS && elapsed < limit }

// Whether the owner pressed Post so recently that the chat is still expected to be starting the command: the card says so and offers no
// Send again yet. Only an approved answer can be starting (posting and stopped have their own states).
export const chatStarting = (view, now = Date.now()) => view?.status === 'approved' && withinMs(view.decision?.at, now, RESEND_AFTER_MS)

// Whether this answer is being posted, and Post was pressed recently enough to read it closely.
export const postingSoon = (entry, now = Date.now()) => ['ready', 'posting'].includes(entry.result.state) && decisionOf(entry) === 'approved' && withinMs(entry.decision.at, now, WATCH_MS)

// The PR page's view of a response: the entry and its status, or null when there is nothing to show.
export function responseView(responses, pr) {
  const entry = responseFor(responses, pr)
  const status = responseStatus(entry, pr)
  return status ? { ...entry, status } : null
}

// How many points of an answer answer this saved review's findings, or 0. Only an answer built on the
// version the review checked, made after it, counts: an older or other-version answer never covered it.
export const AGENT_REVIEW = 'Agent review'
function answeredPoints(result, run, item) {
  if (!item || result.pr.head_sha !== item.head_sha) return 0
  if ((Date.parse(result.created_at) || 0) < (Date.parse(run?.created_at) || 0)) return 0
  return result.points.filter(point => point.reviewer === AGENT_REVIEW).length
}
export const pointsAnswering = (view, run, item) => (['ready', 'posted'].includes(view?.status) ? answeredPoints(view.result, run, item) : 0)

// What the PR logic already understands: a draft waiting for the owner, something being sent, something GitHub did not confirm.
// It is about the PR as it stands now (the logic ignores a fact about another head), so once the push has moved the head, a post
// that stopped part-way still reads as not confirmed.
const OUTBOX_STATES = { ready: 'drafted', approved: 'sending', posting: 'sending', failed: 'unconfirmed' }

// An approved answer whose chat never started is not "sending" for ever: the loader (respond-store.js) puts the region in `lifecycle`,
// and NOT_STARTED (30 seconds, lifecycle_tables.py) is the owner's move again, like a draft. An entry with no `lifecycle` (one not
// loaded from the store) reads as it always did.
const OUTBOX_NOT_STARTED = { approved: 'drafted' }

// `review` is the PR's newest saved review ({ run, item }): the answer covers its findings when it took them on.
export function responseOutbox(entry, pr, review = null) {
  const status = responseStatus(entry, pr)
  const waiting = stateOf(entry?.lifecycle, 'respond') === 'NOT_STARTED' ? OUTBOX_NOT_STARTED[status] : null
  const state = waiting || OUTBOX_STATES[status]
  return state ? { kind: 'answer', head: pr.headRefOid, state, covers: answeredPoints(entry.result, review?.run, review?.item) > 0 } : null
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
const names = logins => (logins.length < 2 ? logins.join('') : `${logins.slice(0, -1).join(', ')} and ${logins.at(-1)}`)

// Whether the work changes something people see: a screen, component or style. Screenshots are required then, so the card says when
// an answer has none. Paths in tests do not count, and a file that only moved or was removed still changed a screen.
const FRONT_END = /(\.(jsx|tsx|vue|svelte|css|scss|html)|(^|\/)[^/]*theme[^/]*\.js)$/
export const changesFrontEnd = result => result.files.some(file => FRONT_END.test(file.path) && !/(^|\/)(test|tests|__tests__)\//.test(file.path) && !/\.(test|spec)\./.test(file.path))

// What Post will do, in the order the helper does it, and only what there is to do.
export function planSteps(result) {
  return [
    result.screenshots.length ? { key: 'screenshots', text: `Upload ${plural(result.screenshots.length, 'screenshot', 'screenshots')} to the PR’s repository, so the description can show them` } : null,
    result.commits.length ? { key: 'push', text: `Push ${plural(result.commits.length, 'commit', 'commits')} to the PR’s branch, on top of ${result.pr.head_sha.slice(0, 7)}` } : null,
    result.replies.length ? { key: 'replies', text: `Post ${plural(result.replies.length, 'reply', 'replies')}, as you` } : null,
    result.description !== null ? { key: 'description', text: 'Update the description' } : null,
    result.rerequest.length ? { key: 'rerequest', text: `Ask ${names(result.rerequest)} to review again` } : null,
  ].filter(Boolean)
}

// Whether the helper has recorded a step as done (a step that is not in the plan is never "done").
export function stepDone(result, key) {
  const receipts = result.receipts
  if (key === 'replies') return result.replies.length > 0 && receipts.replies.length >= result.replies.length
  return Boolean(receipts[key])
}

// What a stopped post already put on GitHub, in words, from the helper's receipts only: a step with no receipt is never claimed.
function wentOut(result) {
  const { receipts, replies } = result
  const posted = receipts.replies.length
  return [
    receipts.screenshots ? `${plural(result.screenshots.length, 'screenshot', 'screenshots')} uploaded` : null,
    receipts.push ? `${plural(result.commits.length, 'commit', 'commits')} pushed to the PR’s branch` : null,
    posted ? `${posted === replies.length ? plural(posted, 'reply', 'replies') : `${posted} of ${replies.length} replies`} posted` : null,
    receipts.description ? 'the description updated' : null,
    receipts.rerequest ? 'a new review asked for' : null,
  ].filter(Boolean)
}

// The reply that was being sent when the post stopped and has no receipt: it may be on GitHub already (the helper clears the note when
// GitHub refused the write), or null.
const unconfirmedReply = result => {
  const { sending, replies } = result.receipts
  return sending && !replies.some(reply => reply.index === sending.index) ? `Reply ${sending.index + 1} of ${result.replies.length}` : null
}

// The question Discard asks of a stopped answer, or null when it can act at once: only a stop the helper itself reported, with no step
// recorded as sent and none left unconfirmed. It asks when something went out (a receipt), when a step may be on GitHub without one, and when the app took
// the post as stopped after 3 minutes without a step (the helper may still be sending one, and stops before the next). Discard undoes nothing.
export function discardQuestion(result) {
  const out = wentOut(result)
  const unconfirmed = unconfirmedReply(result)
  const running = result.error?.step === STALLED_STEP
  if (!out.length && !unconfirmed && !running) return null
  const said = [
    out.length ? `What already went out stays on GitHub: ${names(out)}.` : null,
    unconfirmed ? `${unconfirmed} was being sent when it stopped and may already be on GitHub; if it is, it stays there.` : null,
    running ? 'The chat may still be sending one step; it stops before the next.' : null,
  ].filter(Boolean)
  return { title: 'Discard this answer?', text: `${said.join(' ')} Discard drops only what was not sent yet and takes this answer off the pull request in Contribute.` }
}

// Every reply with what it answers, for the owner to post by hand where Post is off: the review thread (a reply) or the PR's own conversation.
export function repliesText(result) {
  const pull = `https://github.com/${result.repo}/pull/${result.number}`
  return result.replies.map((reply, index) => {
    const target = reply.reply_to ? `answers review comment ${reply.reply_to}: ${pull}#discussion_r${reply.reply_to}` : `a new comment on the PR: ${pull}`
    return `Reply ${index + 1} of ${result.replies.length} (${target})\n\n${reply.body}`
  }).join('\n\n---\n\n')
}

export const POST_COMMAND = result => `python3 /data/apps/contribute/respond_result.py post --pr ${result.repo}#${result.number} --id ${result.id}`

// The one message Post sends the chat. The helper checks the approval itself; this only tells the chat to run it.
export const postMessage = result => [
  `Approved in Contribute: post result ${result.id} for ${result.repo}#${result.number}, built on ${result.pr.head_sha.slice(0, 7)}.`,
  '',
  'Run exactly this and report what it printed:',
  '',
  `    ${POST_COMMAND(result)}`,
  '',
  'It posts only what was shown and approved, and checks the approval and the PR head itself.',
  'Do not push, comment, reply or edit anything on GitHub by hand. If it refuses, say why and stop.',
].join('\n')
