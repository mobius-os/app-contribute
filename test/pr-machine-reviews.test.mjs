import assert from 'node:assert/strict'
import test from 'node:test'
import { decide, notReadyToMerge } from '../pr-machine.js'

const facts = (reviews, extra = {}) => ({ role: 'author', author: 'alex', head: 'h2', lifecycle: 'open', checks: 'pass', mergeable: 'yes', permission: 'WRITE', reviews, openThreads: 0, myReview: null, job: null, result: null, outbox: null, readComplete: true, ...extra })
const action = (decision, id) => decision.actions.find(item => item.id === id)
const changes = { by: 'sam', state: 'CHANGES_REQUESTED', commit: 'h1', bot: false }
const comment = (commit, extra = {}) => ({ by: 'sam', state: 'COMMENTED', commit, bot: false, ...extra })
const approval = (extra = {}) => ({ by: 'sam', state: 'APPROVED', commit: 'h1', bot: false, ...extra })

test('a reviewer who looked again and only commented is asked to approve, and the PR is not ready to merge', () => {
  const decision = decide(facts([changes, comment('h2')]))
  assert.equal(decision.state, 'author.looked_again')
  assert.deepEqual(decision.lookedAgain, ['sam'])
  assert.match(decision.headline, /sam looked again and left a comment, but GitHub still holds their change request/)
  assert.equal(decision.actions.find(item => item.highlighted).id, 'ask_approval')
  assert.equal(action(decision, 'ask_approval').title, 'Ask sam to approve')
  assert.deepEqual(decision.changesFrom, ['sam'])
  assert.notEqual(notReadyToMerge(facts([changes, comment('h2')])), '')
})

test('the people ticked at first for a re-review are those who have not looked past their old review', () => {
  const looked = decide(facts([changes, comment('h2')]))
  assert.deepEqual(looked.rereviewFrom, [])
  assert.equal(action(looked, 'ask_rereview').enabled, true, 'anyone who reviewed can still be asked: the sheet just starts with nobody ticked')
  const notYet = decide(facts([changes]))
  assert.deepEqual(notYet.rereviewFrom, ['sam'])
  assert.equal(action(notYet, 'ask_approval').enabled, true, 'a change request of an older version can be asked to approve too')
  assert.deepEqual(notYet.approvalFrom, [])
  assert.equal(action(notYet, 'ask_approval').title, 'Ask for approval')
  const mixed = decide(facts([changes, comment('h2'), { ...approval(), by: 'kim', sameWork: false }]))
  assert.deepEqual([mixed.lookedAgain, mixed.rereviewFrom], [['sam'], ['kim']])
})

test('request review needs no earlier review where the Ask actions need one', () => {
  const unreviewed = decide(facts([]))
  assert.equal(action(unreviewed, 'request_review').enabled, true)
  assert.equal(action(unreviewed, 'request_review').title, 'Request review')
  assert.equal(action(unreviewed, 'ask_rereview').reason, 'Nobody has reviewed this PR yet.')
  assert.equal(action(decide({ ...facts([]), lifecycle: 'closed' }), 'request_review').reason, 'This PR is no longer open.')
  assert.equal(action(decide({ ...facts([], { author: 'sam' }), role: 'reviewer' }), 'request_review'), undefined, 'only the author asks')
})

test('anyone who only commented on this version can be asked to approve, whether or not they hold a change request', () => {
  const commented = decide(facts([comment('h2')]))
  assert.equal(commented.state, 'author.commented')
  assert.deepEqual([commented.lookedAgain, commented.approvalFrom], [[], ['sam']])
  assert.match(commented.headline, /^Your PR · sam left a comment but hasn’t approved\. Ask for their approval$/)
  assert.equal(action(commented, 'ask_approval').title, 'Ask sam to approve')
  assert.equal(commented.actions.find(item => item.highlighted).id, 'ask_approval')
  const holding = decide(facts([changes, comment('h2'), comment('h2', { by: 'kim' })]))
  assert.deepEqual([holding.state, holding.lookedAgain, holding.approvalFrom], ['author.looked_again', ['sam'], ['sam', 'kim']])
  const older = decide(facts([approval({ sameWork: false }), comment('h2')]))
  assert.deepEqual([older.state, older.rereviewFrom], ['author.commented', []], 'they looked at this version, so they are not asked to look again')
  assert.equal(decide(facts([comment('h2'), { ...approval({ commit: 'h2' }), by: 'kim' }])).state, 'author.approved', 'an approval of this version comes first')
  assert.equal(decide(facts([comment('h2')], { openThreads: 1 })).state, 'author.feedback', 'a comment still to answer comes first, and the ask stays on offer')
  assert.equal(action(decide(facts([comment('h2')], { openThreads: 1 })), 'ask_approval').enabled, true)
  assert.equal(decide(facts([comment('h2', { bot: true })])).state, 'author.waiting_review')
})

test('anyone who reviewed or commented can be asked, except who approved this version, each with what is true of them', () => {
  const zed = { by: 'zed', state: 'COMMENTED', commit: 'h1', bot: false }
  const decision = decide(facts([changes, comment('h2', { by: 'kim' }), approval({ by: 'bob', sameWork: false }), approval({ by: 'dana', commit: 'h2' }),
    { ...changes, by: 'eve', commit: 'h2' }, zed, { by: 'qa-bot', state: 'COMMENTED', commit: 'h2', bot: true }]))
  assert.deepEqual(decision.askable, [
    { by: 'sam', reason: 'changes_older', commit: 'h1' }, { by: 'kim', reason: 'commented_here', commit: 'h2' }, { by: 'bob', reason: 'approved_older', commit: 'h1' },
    { by: 'eve', reason: 'changes_here', commit: 'h2' }, { by: 'zed', reason: 'commented_older', commit: 'h1' }])
  const looked = decide(facts([changes, comment('h2')]))
  assert.deepEqual(looked.askable, [{ by: 'sam', reason: 'looked_again', commit: 'h1' }], 'their change request still stands, and they looked again')
  assert.deepEqual(decide(facts([])).askable, [])
  assert.equal(action(decide(facts([])), 'ask_approval').reason, 'Nobody has reviewed this PR yet.')
  assert.equal(action(decide(facts([approval({ commit: 'h2' })])), 'ask_rereview').reason, 'Everyone who reviewed it has already approved this version.')
})

test('a comment never approves, whatever the version, and a comment from a bot or from nobody holding a request changes nothing', () => {
  assert.equal(notReadyToMerge(facts([comment('h2')])), 'Nobody but the author has approved it yet.')
  assert.equal(decide(facts([comment('h2')])).state, 'author.commented')
  assert.equal(decide(facts([changes, comment('h2', { by: 'kim' })])).state, 'author.waiting_rereview')
  assert.equal(decide(facts([changes, comment('h2', { bot: true })])).state, 'author.waiting_rereview')
  assert.equal(decide(facts([changes, comment('h1')])).state, 'author.waiting_rereview')
})

test('an approval of an older commit carries over only when its work was proved the same', () => {
  const carried = decide(facts([approval({ sameWork: true })]))
  assert.equal(carried.state, 'author.approved')
  assert.deepEqual([carried.approvedBy, carried.carriedFrom, carried.rereviewFrom], [['sam'], [{ by: 'sam', commit: 'h1' }], []])
  assert.match(carried.headline, /approved by sam, checks green\. The lines you added and removed are the same as when they approved\. Merge it/)
  assert.equal(action(carried, 'ask_rereview').reason, 'Everyone who reviewed it has already approved this version.')
  for (const sameWork of [false, null, undefined]) {
    const old = decide(facts([approval({ sameWork })]))
    assert.equal(old.state, 'author.approval_stale', String(sameWork))
    assert.deepEqual(old.carriedFrom, [])
  }
})

test('an approval of this very commit keeps its plain wording even when another approval carried over', () => {
  const decision = decide(facts([approval({ sameWork: true }), { ...approval({ commit: 'h2' }), by: 'kim' }]))
  assert.deepEqual(decision.approvedBy, ['sam', 'kim'])
  assert.match(decision.headline, /approved by sam, kim at this version/)
})

test('a carried approval still waits for checks, conflicts and any standing change request', () => {
  assert.equal(decide(facts([approval({ sameWork: true })], { checks: 'fail' })).state, 'author.blocked')
  assert.equal(decide(facts([approval({ sameWork: true })], { checks: 'pending' })).state, 'author.approved_checks')
  const standing = decide(facts([approval({ sameWork: true }), { ...changes, by: 'kim' }]))
  assert.equal(notReadyToMerge(facts([approval({ sameWork: true }), { ...changes, by: 'kim' }])), 'kim asked for changes and hasn’t approved since.')
  assert.equal(standing.state, 'author.waiting_rereview')
})
