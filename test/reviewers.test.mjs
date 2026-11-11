import assert from 'node:assert/strict'
import test from 'node:test'
import { pendingReviewers, reviewersOf } from '../reviewers.js'

const user = login => ({ __typename: 'User', login })
const team = slug => ({ __typename: 'Team', slug })
const asked = (who, createdAt) => ({ createdAt, requestedReviewer: who })
const reviewed = (login, state, submittedAt) => ({ state, submittedAt, author: { login } })
const pull = ({ pending = [], events = [], reviews = [] } = {}) => ({
  reviewRequests: { nodes: pending.map(requestedReviewer => ({ requestedReviewer })) },
  timelineItems: { nodes: events },
  reviews: { nodes: reviews },
})
const row = (rows, name) => rows.find(item => item.name === name)

test('an approval of an older version is not shown as an approval of this one', () => {
  const HEAD = 'a'.repeat(40), OLDER = 'b'.repeat(40)
  const approved = (login, oid) => ({ ...reviewed(login, 'APPROVED', '2026-11-09T09:00:00Z'), commit: { oid } })
  const rows = reviewersOf(pull({ events: [asked(user('sam'), '2026-11-09T08:00:00Z'), asked(user('kim'), '2026-11-09T08:00:00Z'), asked(user('bo'), '2026-11-09T08:00:00Z')],
    reviews: [approved('sam', OLDER), approved('kim', HEAD), reviewed('bo', 'APPROVED', '2026-11-09T09:00:00Z')] }), HEAD)
  assert.deepEqual(['sam', 'kim', 'bo'].map(name => [row(rows, name).status, row(rows, name).label, row(rows, name).tone]),
    [['approved_old', 'Approved an older version', 'is-waiting'], ['approved', 'Approved', 'is-ready'], ['approved', 'Approved', 'is-ready']],
    'a review that names no commit is taken as current, and without a head nothing is judged')
  assert.equal(row(reviewersOf(pull({ events: [asked(user('sam'), '2026-11-09T08:00:00Z')], reviews: [approved('sam', OLDER)] })), 'sam').status, 'approved')
})

test('a request nobody has answered is waiting, with the day it was made', () => {
  const rows = reviewersOf(pull({ pending: [user('sam')], events: [asked(user('sam'), '2026-11-09T11:20:00Z')] }))
  assert.deepEqual(rows.map(({ name, status, label, tone, again, requestedAt }) => ({ name, status, label, tone, again, requestedAt })),
    [{ name: 'sam', status: 'waiting', label: 'Waiting', tone: 'is-waiting', again: false, requestedAt: '2026-11-09T11:20:00Z' }])
})

test('a new request after an earlier review says another review is awaited, and is never an approval', () => {
  const rows = reviewersOf(pull({
    pending: [user('sam')],
    events: [asked(user('sam'), '2026-11-09T08:00:00Z'), asked(user('sam'), '2026-11-09T12:20:00Z')],
    reviews: [reviewed('sam', 'APPROVED', '2026-11-09T09:00:00Z')],
  }))
  assert.equal(rows.length, 1)
  assert.deepEqual({ status: rows[0].status, label: rows[0].label, again: rows[0].again, requestedAt: rows[0].requestedAt },
    { status: 'waiting_again', label: 'Waiting for another review', again: true, requestedAt: '2026-11-09T12:20:00Z' })
})

test('once they answer, the row carries that one answer', () => {
  const events = [asked(user('ana'), '2026-11-09T08:00:00Z'), asked(user('bo'), '2026-11-09T08:00:00Z'), asked(user('cy'), '2026-11-09T08:00:00Z'), asked(user('di'), '2026-11-09T08:00:00Z')]
  const rows = reviewersOf(pull({ events, reviews: [
    reviewed('ana', 'APPROVED', '2026-11-09T09:00:00Z'), reviewed('bo', 'CHANGES_REQUESTED', '2026-11-09T09:00:00Z'),
    reviewed('cy', 'COMMENTED', '2026-11-09T09:00:00Z'), reviewed('di', 'DISMISSED', '2026-11-09T09:00:00Z')] }))
  assert.deepEqual(['ana', 'bo', 'cy', 'di'].map(name => [row(rows, name).label, row(rows, name).tone]),
    [['Approved', 'is-ready'], ['Changes requested', 'is-blocker'], ['Commented', 'is-tone'], ['Dismissed', '']])
})

test('someone who reviewed without ever being asked is not a requested reviewer', () => {
  assert.deepEqual(reviewersOf(pull({ reviews: [reviewed('sam', 'APPROVED', '2026-11-09T09:00:00Z')] })), [])
})

test('an assignee is never listed: only review requests are', () => {
  const data = { ...pull(), assignees: { nodes: [{ login: 'sam' }] } }
  assert.deepEqual(reviewersOf(data), [])
})

test('a request withdrawn before any answer, or answered only before it was made, is not listed', () => {
  const rows = reviewersOf(pull({
    events: [asked(user('gone'), '2026-11-09T08:00:00Z'), asked(user('old'), '2026-11-09T12:00:00Z')],
    reviews: [reviewed('old', 'APPROVED', '2026-11-09T09:00:00Z')],
  }))
  assert.deepEqual(rows, [])
})

test('pending requests come first, then the newest request; a team request names nobody, so it is not listed', () => {
  const rows = reviewersOf(pull({
    pending: [team('qa'), user('late')],
    events: [asked(user('early'), '2026-11-09T07:00:00Z'), asked(team('qa'), '2026-11-09T09:00:00Z'), asked(user('late'), '2026-11-09T10:00:00Z')],
    reviews: [reviewed('early', 'COMMENTED', '2026-11-09T08:00:00Z')],
  }))
  assert.deepEqual(rows.map(item => [item.name, item.status]), [['late', 'waiting'], ['early', 'commented']])
})

test('a pending request the events no longer reach is still listed, without a day', () => {
  const rows = reviewersOf(pull({ pending: [user('sam')] }))
  assert.deepEqual(rows.map(item => [item.name, item.status, item.requestedAt]), [['sam', 'waiting', '']])
})

test('logins match whatever their case, and missing pieces of GitHub’s answer change nothing', () => {
  const rows = reviewersOf(pull({ pending: [user('Sam')], events: [asked(user('SAM'), '2026-11-09T11:00:00Z')], reviews: [reviewed('sAm', 'COMMENTED', '2026-11-09T09:00:00Z')] }))
  assert.deepEqual(rows.map(item => [item.status, item.again]), [['waiting_again', true]])
  assert.deepEqual(reviewersOf(null), [])
  assert.deepEqual(reviewersOf({ reviewRequests: null, timelineItems: { nodes: [null, { requestedReviewer: null }] }, reviews: { nodes: [null] } }), [])
})

test('only people still waiting need not be asked again', () => {
  const rows = reviewersOf(pull({ pending: [user('sam')], events: [asked(user('sam'), '2026-11-09T11:00:00Z'), asked(user('ana'), '2026-11-09T11:00:00Z')], reviews: [reviewed('ana', 'APPROVED', '2026-11-09T12:00:00Z')] }))
  assert.deepEqual(pendingReviewers(rows), ['sam'])
  assert.deepEqual(pendingReviewers(null), [])
})

test('the whole review history is read: GitHub’s own latest reviews leave out anyone asked again', () => {
  // The shape of a real PR whose two reviewers were asked again after commenting twice.
  const rows = reviewersOf(pull({
    pending: [user('ana'), user('bo')],
    events: [asked(user('ana'), '2026-11-06T08:00:00Z'), asked(user('bo'), '2026-11-06T08:00:00Z'), asked(user('ana'), '2026-11-09T11:20:00Z'), asked(user('bo'), '2026-11-09T08:15:00Z')],
    reviews: [reviewed('bo', 'COMMENTED', '2026-11-06T09:01:00Z'), reviewed('bo', 'COMMENTED', '2026-11-06T10:51:00Z'), reviewed('ana', 'COMMENTED', '2026-11-06T11:46:00Z'), reviewed('ana', 'COMMENTED', '2026-11-09T08:27:00Z')],
  }))
  assert.deepEqual(rows.map(item => [item.name, item.status, item.again, item.requestedAt]),
    [['ana', 'waiting_again', true, '2026-11-09T11:20:00Z'], ['bo', 'waiting_again', true, '2026-11-09T08:15:00Z']])
})

test('a later comment does not withdraw a verdict, and the latest verdict wins', () => {
  const events = [asked(user('ana'), '2026-11-09T08:00:00Z'), asked(user('bo'), '2026-11-09T08:00:00Z')]
  const rows = reviewersOf(pull({ events, reviews: [
    reviewed('ana', 'APPROVED', '2026-11-09T09:00:00Z'), reviewed('ana', 'COMMENTED', '2026-11-09T10:00:00Z'),
    reviewed('bo', 'CHANGES_REQUESTED', '2026-11-09T09:00:00Z'), reviewed('bo', 'APPROVED', '2026-11-09T11:00:00Z')] }))
  assert.deepEqual(['ana', 'bo'].map(name => row(rows, name).status), ['approved', 'approved'])
  const held = reviewersOf(pull({ events, reviews: [reviewed('ana', 'CHANGES_REQUESTED', '2026-11-09T09:00:00Z'), reviewed('ana', 'COMMENTED', '2026-11-09T10:00:00Z')] }))
  assert.equal(row(held, 'ana').status, 'changes', 'GitHub keeps holding the change request')
})

test('a review that was never submitted (a draft) says nothing', () => {
  const draft = { state: 'PENDING', submittedAt: null, author: { login: 'sam' } }
  assert.deepEqual(reviewersOf(pull({ pending: [user('sam')], events: [asked(user('sam'), '2026-11-09T08:00:00Z')], reviews: [draft] })).map(item => item.status), ['waiting'])
})
