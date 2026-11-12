import assert from 'node:assert/strict'
import test from 'node:test'
import { syncFacts, syncLine } from '../sync-summary.js'

const request = (repo, number) => ({ repo, number, reviewRequested: true, repository: { nameWithOwner: repo } })
// The desk always counts every chip, so a test names only the ones it means.
const facts = ({ counts = {}, ...overrides } = {}) => syncFacts({ incoming: [], counts: { questions: 0, requests: 0, merge: 0, fix: 0, again: 0, ...counts }, projects: [], checks: {}, ...overrides })

test('a Sync that moved nothing says so in the desk\'s own words', () => {
  assert.equal(syncLine(facts(), facts()), 'Synced. Nothing new for you.')
})

test('new review requests are counted, and numbers are marked bold', () => {
  const before = facts({ incoming: [request('o/r', 1)] })
  const after = facts({ incoming: [request('o/r', 1), request('o/r', 2)] })
  assert.equal(syncLine(before, after), 'Synced. **1** new review request')
  const many = facts({ incoming: [request('o/r', 1), request('o/r', 2), request('o/r', 3)] })
  assert.equal(syncLine(facts(), many), 'Synced. **3** new review requests')
})

test('what waits on you grows or shrinks by the chips of Needs you', () => {
  const some = facts({ counts: { questions: 1, merge: 1 } })
  const more = facts({ counts: { questions: 1, merge: 1, fix: 2 } })
  assert.equal(syncLine(some, more), 'Synced. **2** more things need you')
  assert.equal(syncLine(more, facts({ counts: { questions: 1, merge: 1, fix: 1 } })), 'Synced. **1** fewer thing needs you')
})

test('a repository that newly has GitHub commits is named, and one already behind is not repeated', () => {
  const projects = [{ key: 'a', name: 'Möbius', incomingFiles: 2 }, { key: 'b', name: 'Kanban' }]
  const before = facts({ projects: [{ ...projects[0] }, projects[1]] })
  const after = facts({ projects, checks: { b: { newCommits: 3 } } })
  assert.equal(syncLine(before, after), 'Synced. Kanban has new commits on GitHub')
  assert.equal(syncLine(facts(), facts({ projects, checks: { b: { newCommits: 3 } } })), 'Synced. Möbius, Kanban have new commits on GitHub')
})

test('several changes read in the desk\'s order, joined by dots', () => {
  const line = syncLine(facts(), facts({ incoming: [request('o/r', 5)], counts: { merge: 1 } }))
  assert.equal(line, 'Synced. **1** new review request · **1** more thing needs you')
})
