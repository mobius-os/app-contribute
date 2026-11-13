// The lists of the repositories: how a list is opened from what is known, read, kept current and saved.
import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { prKey } from '../collaboration.js'
import { createRepositoryLists } from '../repository-lists.js'
import { pullsInView } from '../pull-view.js'
import { moveSignature } from '../list-reads.js'
import { fullPull, installGithub } from './fake-lists.mjs'

let github
afterEach(() => { github?.restore(); github = null })
// Waits for a held call to be reached (never for a time): `reached()` is true once the hook has been called.
const until = async reached => { for (let turn = 0; turn < 200 && !reached(); turn += 1) await new Promise(resolve => setTimeout(resolve, 1)) }
const many = (repo, count, extra = {}) => Array.from({ length: count }, (_, index) => fullPull(repo, index + 1, extra))
const numbers = list => pullsInView(list.view).map(pr => pr.number)
const saved = (repo, pulls, extra = {}) => ({ repo, syncedAt: '2026-11-12T07:00:00Z', openedAt: '', total: pulls.length, hasNextPage: false, endCursor: null, pulls, ...extra })
// What a screen would see over time: every state of the list as it was announced.
function watch(lists, repo) {
  const seen = []
  lists.subscribe(changed => { if (changed === repo) { const list = lists.entry(repo); seen.push({ ...list.data, rows: numbers(list), titles: pullsInView(list.view).filter(pr => pr.titlesOnly).length }) } })
  return seen
}

test('a repository with no list shows its titles first, then fills the details into the same rows', async () => {
  github = installGithub({ 'o/r': many('o/r', 25) })
  const lists = createRepositoryLists()
  const seen = watch(lists, 'o/r')
  await lists.read('o/r', { token: 't' })
  assert.equal(github.names()[0], 'ContributeListTitles')
  assert.equal(github.names().filter(name => name === 'ContributeListDetails').length, 3, 'the details came as three groups')
  assert.deepEqual(seen[0], { total: 0, hasNextPage: false, endCursor: null, loading: true, updating: false, partial: false, error: '', rows: [], titles: 0 })
  const first = seen.find(state => state.rows.length)
  assert.deepEqual([first.rows.length, first.titles, first.loading, first.updating, first.partial], [25, 25, false, true, true], 'the titles of every PR at once, not skeleton rows')
  const settled = seen.at(-1)
  assert.deepEqual([settled.rows.length, settled.titles, settled.updating, settled.partial], [25, 0, false, false])
  assert.ok(seen.slice(seen.indexOf(first)).every(state => state.rows.length === 25), 'the rows never left the list while the details filled in')
  const list = lists.entry('o/r')
  assert.deepEqual([list.listed, list.sessionRead], [true, true])
  assert.ok(pullsInView(list.view).every(pr => pr.latestOpinionatedReviews && !pr.titlesOnly))
})

test('a list shown from the last visit is never empty or loading while it updates, and its rows change where they stand', async () => {
  const world = { 'o/r': many('o/r', 3) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 3))])
  const copy = lists.entry('o/r')
  assert.deepEqual([copy.listed, copy.settled, copy.sessionRead, numbers(copy)], [true, true, false, [1, 2, 3]], 'it opens at once, as last known')
  world['o/r'][1] = fullPull('o/r', 2, { title: 'Renamed since', updatedAt: '2026-11-13T09:00:00Z' })
  world['o/r'].splice(2, 1)
  world['o/r'].push(fullPull('o/r', 4))
  const seen = watch(lists, 'o/r')
  await lists.read('o/r', { token: 't' })
  assert.ok(seen.every(state => !state.loading && state.rows.length > 0), 'no skeleton and no empty list at any moment')
  assert.ok(seen[0].updating)
  assert.deepEqual(seen.at(-1).rows, [1, 2, 4])
  assert.equal(pullsInView(lists.entry('o/r').view)[1].title, 'Renamed since')
  assert.equal(github.names().includes('ContributeListTitles'), false, 'a list that is known is read in full, not by its titles')
  assert.equal(lists.entry('o/r').sessionRead, true)
})

test('a repository of more than a page keeps its paging: the first page reads, the next one is asked for, and the copy keeps page one', async () => {
  github = installGithub({ 'o/big': many('o/big', 120) })
  const lists = createRepositoryLists()
  await lists.read('o/big', { token: 't' })
  const big = lists.entry('o/big')
  assert.deepEqual([numbers(big).length, big.data.total, big.data.hasNextPage, big.data.endCursor], [50, 120, true, 'c50'])
  await lists.loadMore('o/big', 't')
  assert.deepEqual([numbers(big).length, big.data.hasNextPage, big.data.endCursor], [100, true, 'c100'])
  const [toSave] = lists.listsToSave()
  assert.deepEqual([toSave.pulls.length, toSave.total, toSave.hasNextPage, toSave.endCursor], [50, 120, true, 'c50'], 'the copy is page one with page one\'s cursor, whatever was loaded after')
  const second = createRepositoryLists()
  second.restore([toSave])
  assert.deepEqual([second.entry('o/big').data.hasNextPage, second.entry('o/big').data.endCursor, second.entry('o/big').data.total], [true, 'c50', 120])
})

test('a refresh keeps the rows the screen has ticked, even from a later page, and the one it is looking at', async () => {
  github = installGithub({ 'o/big': many('o/big', 70) })
  const lists = createRepositoryLists()
  let focus = '', ticked = new Set()
  lists.hold('o/big', { focus: () => focus, selected: () => ticked })
  await lists.read('o/big', { token: 't' })
  assert.equal(numbers(lists.entry('o/big')).length, 50)
  ticked = new Set(['o/big#60'])
  await lists.read('o/big', { token: 't' })
  assert.ok(numbers(lists.entry('o/big')).includes(60), 'the ticked PR on page two is read too, so the selection survives')
  // The PR a chat link leases is read exactly (it may be closed, so outside the open list) and stays while the list is replaced.
  focus = 'o/big#999'
  const list = lists.entry('o/big')
  lists.publish(list, [fullPull('o/big', 999, { state: 'MERGED' })], lists.issue(list))
  await lists.read('o/big', { token: 't' })
  assert.ok(lists.entry('o/big').view.rows.has('o/big#999'), 'the PR a screen is on stays in the view while a read replaces the list')
})

test('every screen that holds a list hears each change with what it was before, and one that leaves hears no more', async () => {
  github = installGithub({ 'o/r': many('o/r', 2) })
  const lists = createRepositoryLists()
  const heard = []
  const release = lists.hold('o/r', { focus: () => '', published: change => heard.push([change.before.inventory.length, change.after.inventory.length, change.announce]) })
  await lists.read('o/r', { token: 't', fresh: true })
  assert.deepEqual(heard[0], [0, 2, true], 'the owner\'s own read says so, so a notice about an earlier change is cleared')
  await lists.read('o/r', { token: 't' })
  assert.equal(heard.at(-1)[2], false, 'a read the owner did not ask for does not')
  const count = heard.length
  release()
  await lists.read('o/r', { token: 't' })
  assert.equal(heard.length, count)
})

test('a list being read is joined, not read twice, and a refresh asked for during a probe follows it', async () => {
  let gate
  const open = new Promise(resolve => { gate = resolve })
  github = installGithub({ 'o/r': many('o/r', 2) }, { hold: call => (call.name === 'ContributePullRequests' ? open : null) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 2))])
  const one = lists.read('o/r', { token: 't' }), two = lists.read('o/r', { token: 't' })
  gate()
  await Promise.all([one, two])
  assert.equal(github.names().filter(name => name === 'ContributePullRequests').length, 1)
  github.calls.length = 0
  let probeGate
  github.restore()
  github = installGithub({ 'o/r': many('o/r', 2) }, { hold: call => (call.name === 'ContributeListProbe' ? new Promise(resolve => { probeGate = resolve }) : null) })
  const probing = lists.read('o/r', { token: 't', how: 'reconcile' })
  const refreshing = lists.read('o/r', { token: 't' })
  const joined = lists.read('o/r', { token: 't', how: 'reconcile' })
  assert.equal(joined, refreshing, 'a reconcile asked for while a refresh is waiting is covered by that refresh')
  probeGate()
  await Promise.all([probing, refreshing])
  assert.deepEqual(github.names(), ['ContributeListProbe', 'ContributePullRequests'], 'the refresh waited for the probe and then read')
})

test('a list read in full is brought up to date from what moved: only those PRs are read, the new one comes in, the closed one goes', async () => {
  const world = { 'o/r': many('o/r', 4) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  await lists.read('o/r', { token: 't' })
  github.calls.length = 0
  await lists.read('o/r', { token: 't', how: 'reconcile' })
  assert.deepEqual(github.names(), ['ContributeListProbe'], 'nothing moved: one question, no PR read')
  const confirmed = lists.entry('o/r').syncedAt
  world['o/r'][1] = fullPull('o/r', 2, { updatedAt: '2026-11-13T10:00:00Z', title: 'Edited' })
  world['o/r'][2] = fullPull('o/r', 3, { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 2, checkRunCountsByState: [{ state: 'FAILURE', count: 2 }], statusContextCountsByState: [] } } } }] } })
  world['o/r'].splice(3, 1)
  world['o/r'].unshift(fullPull('o/r', 5))
  github.calls.length = 0
  await lists.read('o/r', { token: 't', how: 'reconcile' })
  const read = github.calls.find(call => call.name === 'ContributeListDetails')
  assert.deepEqual([...read.query.matchAll(/pullRequest\(number:(\d+)\)/g)].map(match => Number(match[1])).sort(), [2, 3, 5], 'the edited PR, the one whose checks failed and the new one; not the unmoved PR 1')
  const list = lists.entry('o/r')
  assert.deepEqual(numbers(list), [5, 1, 2, 3], 'in the order GitHub lists them: the new PR first, the closed one gone')
  assert.equal(pullsInView(list.view).find(pr => pr.number === 2).title, 'Edited')
  assert.deepEqual([list.data.total, list.data.updating, list.data.hasNextPage], [4, false, false])
  assert.ok(Date.parse(list.syncedAt) >= Date.parse(confirmed))
})

test('a list that is not yet read in full this visit, or holds more than a page, is read and not worked out from a probe', async () => {
  github = installGithub({ 'o/r': many('o/r', 2), 'o/big': many('o/big', 70) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 2))])
  await lists.read('o/r', { token: 't', how: 'reconcile' })
  assert.deepEqual(github.names(), ['ContributePullRequests'], 'a list from the last visit is read in full first')
  github.calls.length = 0
  await lists.read('o/big', { token: 't' })
  github.calls.length = 0
  await lists.read('o/big', { token: 't', how: 'reconcile' })
  assert.deepEqual(github.names(), ['ContributePullRequests'], 'more than a page reads its paging, never a probe')
})

test('a probe that finds more than a page worth of PRs now reads the list, so the paging is right', async () => {
  const world = { 'o/r': many('o/r', 40) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  await lists.read('o/r', { token: 't' })
  world['o/r'].push(...Array.from({ length: 30 }, (_, index) => fullPull('o/r', 100 + index)))
  github.calls.length = 0
  await lists.read('o/r', { token: 't', how: 'reconcile' })
  assert.deepEqual(github.names(), ['ContributeListProbe', 'ContributePullRequests'])
  assert.deepEqual([lists.entry('o/r').data.total, lists.entry('o/r').data.hasNextPage, lists.entry('o/r').data.endCursor], [70, true, 'c50'])
})

test('a read that fails leaves the list as it was, and says so', async () => {
  github = installGithub({ 'o/r': many('o/r', 2) }, { hold: call => { if (['ContributePullRequests', 'ContributeListTitles'].includes(call.name)) throw Object.assign(new Error('down'), { status: 502 }) } })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 2))])
  await assert.rejects(lists.read('o/r', { token: 't' }), /Could not check GitHub/)
  const list = lists.entry('o/r')
  assert.deepEqual([numbers(list), list.data.loading, list.data.updating, list.data.error], [[1, 2], false, false, 'Could not check GitHub. Sync to try again.'])
  assert.equal(list.sessionRead, false, 'what is shown is still the last visit\'s')
  const none = createRepositoryLists()
  await assert.rejects(none.read('o/r', { token: 't' }), /Could not check GitHub/)
  assert.deepEqual([none.entry('o/r').listed, none.entry('o/r').settled, none.entry('o/r').data.error.length > 0], [false, true, true], 'no list to show, and the read is over')
})

test('titles that arrived stay when a group of details fails, and the list says its rows are not whole', async () => {
  let groups = 0
  github = installGithub({ 'o/r': many('o/r', 25) }, { hold: call => { if (call.name === 'ContributeListDetails' && ++groups === 2) throw Object.assign(new Error('down'), { status: 502 }) } })
  const lists = createRepositoryLists()
  await assert.rejects(lists.read('o/r', { token: 't' }), /Could not read/)
  const list = lists.entry('o/r')
  assert.equal(numbers(list).length, 25)
  assert.deepEqual([list.data.partial, list.data.updating, list.data.error.length > 0], [true, false, true])
  assert.deepEqual(lists.listsToSave(), [], 'a list with rows that hold only titles is not what the next visit opens from')
  github.restore()
  github = installGithub({ 'o/r': many('o/r', 25) })
  await lists.read('o/r', { token: 't' })
  assert.deepEqual([lists.entry('o/r').data.partial, lists.entry('o/r').data.error, pullsInView(lists.entry('o/r').view).some(pr => pr.titlesOnly)], [false, '', false], 'a retry reads it whole')
})

test('a newer exact read of a PR is never replaced by the titles or details of an older read', async () => {
  let release
  github = installGithub({ 'o/r': many('o/r', 2) }, { hold: call => (call.name === 'ContributeListDetails' ? new Promise(resolve => { release = resolve }) : null) })
  const lists = createRepositoryLists()
  const reading = lists.read('o/r', { token: 't' })
  await until(() => release)
  const list = lists.entry('o/r')
  lists.publish(list, [fullPull('o/r', 1, { title: 'Read exactly, later' })], lists.issue(list))
  release()
  await reading
  assert.equal(pullsInView(list.view).find(pr => pr.number === 1).title, 'Read exactly, later')
})

test('asking for the next page while the first is being read leaves the next page standing', async () => {
  let gate
  const open = new Promise(resolve => { gate = resolve })
  const world = { 'o/big': many('o/big', 120) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  await lists.read('o/big', { token: 't' })
  github.restore()
  github = installGithub(world, { hold: call => (call.name === 'ContributePullRequests' && !/after/.test(call.query) ? open : null) })
  const refreshing = lists.read('o/big', { token: 't' })
  await lists.loadMore('o/big', 't')
  gate()
  await refreshing
  assert.equal(numbers(lists.entry('o/big')).length, 100, 'the older answer did not collapse the list the owner just extended')
  assert.equal(lists.entry('o/big').data.loading, false)
})

test('counts show a repository without open PRs as empty at once, and a saved empty list GitHub now disagrees with is no longer known', () => {
  const lists = createRepositoryLists()
  lists.restore([saved('o/stale', []), saved('o/busy', many('o/busy', 2))])
  lists.applyCounts(new Map([['o/none', 0], ['o/stale', 4], ['o/busy', 5], ['o/some', 3]]))
  const none = lists.entry('o/none')
  assert.deepEqual([none.listed, numbers(none), none.data.total, none.data.error], [true, [], 0, ''], 'the empty list is known without a read')
  assert.equal(lists.entry('o/stale').listed, false, 'it would read, not say there is nothing')
  assert.equal(lists.entry('o/busy').listed, true, 'a list with rows is not changed by a count')
  assert.equal(lists.entry('o/some').listed, false, 'a repository with PRs is not read until it is opened')
})

test('a count never replaces what a read of this visit answered', async () => {
  github = installGithub({ 'o/r': many('o/r', 2) })
  const lists = createRepositoryLists()
  await lists.read('o/r', { token: 't' })
  lists.applyCounts(new Map([['o/r', 0]]))
  assert.equal(numbers(lists.entry('o/r')).length, 2)
})

test('what the last visit saved never covers what a read has already answered', async () => {
  github = installGithub({ 'o/r': many('o/r', 2, { title: 'Fresh' }) })
  const lists = createRepositoryLists()
  await lists.read('o/r', { token: 't' })
  lists.restore([saved('o/r', many('o/r', 5, { title: 'Last visit' }), { openedAt: '2026-11-10T00:00:00Z' })])
  assert.deepEqual(pullsInView(lists.entry('o/r').view).map(pr => pr.title), ['Fresh', 'Fresh'])
  assert.equal(lists.entry('o/r').openedAt, '2026-11-10T00:00:00Z', 'when the owner last opened it is still remembered')
})

test('the lists of another account are dropped, and only the ones that were not read', async () => {
  github = installGithub({ 'o/read': many('o/read', 1) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/old', many('o/old', 2)), saved('o/read', many('o/read', 3))])
  await lists.read('o/read', { token: 't' })
  lists.forgetRestored()
  assert.deepEqual([lists.entry('o/old').listed, numbers(lists.entry('o/old'))], [false, []])
  assert.deepEqual(numbers(lists.entry('o/read')), [1])
})

test('the copy holds the first page of every whole list with when it was read and opened', async () => {
  github = installGithub({ 'o/a': many('o/a', 2), 'o/b': [] })
  const lists = createRepositoryLists({ now: () => Date.parse('2026-11-13T12:00:00Z') })
  await lists.read('o/a', { token: 't' })
  lists.opened('o/a')
  lists.applyCounts(new Map([['o/b', 0]]))
  const saves = lists.listsToSave().sort((a, b) => a.repo.localeCompare(b.repo))
  assert.deepEqual(saves.map(list => [list.repo, list.pulls.length, list.syncedAt, list.openedAt]), [['o/a', 2, '2026-11-13T12:00:00.000Z', '2026-11-13T12:00:00.000Z']], 'o/b is empty only by a count, which is asked again at every open')
})

test('an assignment shows on the row at once, and a read that began before it cannot take it back', async () => {
  let release, held = 0
  const world = { 'o/r': many('o/r', 1) }
  github = installGithub(world, { hold: call => (call.name === 'ContributePullRequests' && ++held === 1 ? new Promise(resolve => { release = resolve }) : null) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 1))])
  const reading = lists.read('o/r', { token: 't' }) // GitHub answers it with nobody assigned
  await until(() => release)
  lists.acknowledge('o/r', ['o/r#1'], 'teammate')
  const assigned = () => pullsInView(lists.entry('o/r').view)[0].assignees.nodes.map(user => user.login)
  assert.deepEqual(assigned(), ['teammate'])
  release()
  await reading
  assert.deepEqual(assigned(), ['teammate'], 'the older answer did not take the assignment back')
  await lists.read('o/r', { token: 't', fresh: true })
  assert.deepEqual(assigned(), [], 'a read made after it is authoritative')
})

test('opening a repository is remembered, and a list is fresh for as long as it was confirmed recently', async () => {
  let clock = Date.parse('2026-11-13T12:00:00Z')
  github = installGithub({ 'o/r': many('o/r', 1) })
  const lists = createRepositoryLists({ now: () => clock })
  assert.equal(lists.confirmedWithin('o/r', 60000), false, 'a list nothing has read is not fresh')
  await lists.read('o/r', { token: 't' })
  clock += 30000
  assert.equal(lists.confirmedWithin('o/r', 60000), true)
  clock += 31000
  assert.equal(lists.confirmedWithin('o/r', 60000), false)
  lists.opened('o/r')
  assert.equal(lists.entry('o/r').openedAt, new Date(clock).toISOString())
  assert.equal(prKey(pullsInView(lists.entry('o/r').view)[0]), 'o/r#1')
})

test('a read asked for after an action does not join a read that began before it, so the action is in the answer', async () => {
  const world = { 'o/r': many('o/r', 2) }
  let release, held = 0
  github = installGithub(world, { hold: call => (call.name === 'ContributePullRequests' && ++held === 1 ? new Promise(resolve => { release = resolve }) : null) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 2))])
  const before = lists.read('o/r', { token: 't' })
  await until(() => release)
  world['o/r'] = [world['o/r'][0]] // the owner merged PR 2 while the first read was out
  const after = lists.read('o/r', { token: 't', fresh: true })
  release()
  await Promise.all([before, after])
  assert.equal(github.names().filter(name => name === 'ContributePullRequests').length, 2)
  assert.deepEqual(numbers(lists.entry('o/r')), [1])
})

test('a row restored while the titles were being read is not replaced by a row with less in it', async () => {
  let release
  github = installGithub({ 'o/r': many('o/r', 2) }, { hold: call => (call.name === 'ContributeListTitles' ? new Promise(resolve => { release = resolve }) : null) })
  const lists = createRepositoryLists()
  const reading = lists.read('o/r', { token: 't' })
  await until(() => release)
  lists.restore([saved('o/r', many('o/r', 2).map(pr => ({ ...pr, title: 'Last visit' })))])
  release()
  const seen = []
  lists.subscribe(() => seen.push(pullsInView(lists.entry('o/r').view).map(pr => [pr.title, !!pr.titlesOnly])))
  await reading
  assert.ok(seen.every(rows => rows.every(([, light]) => !light)), 'no row was ever light after the restore')
  assert.deepEqual(pullsInView(lists.entry('o/r').view).map(pr => pr.title), ['Change 1', 'Change 2'])
})

test('a probe confirms a list that shows what GitHub holds, finds one that is behind, and leaves what a read must settle', async () => {
  github = installGithub({ 'o/r': many('o/r', 3) })
  let clock = Date.parse('2026-11-13T12:00:00Z')
  const lists = createRepositoryLists({ now: () => clock })
  const probe = { total: 3, pulls: many('o/r', 3).map(pr => ({ number: pr.number, signature: moveSignature(pr) })) }
  assert.equal(lists.checkAgainst('o/r', probe), 'unchecked', 'a list nothing has read is no list to confirm')
  await lists.read('o/r', { token: 't' })
  const before = lists.entry('o/r').syncedAt
  lists.entry('o/r').data = { ...lists.entry('o/r').data, partial: true }
  assert.equal(lists.checkAgainst('o/r', probe), 'unchecked', 'rows that hold only their titles are not what GitHub holds')
  lists.entry('o/r').data = { ...lists.entry('o/r').data, partial: false }
  assert.equal(lists.checkAgainst('o/r', { ...probe, total: 120 }), 'behind', 'a repository that grew past a page is found, its first page is read again')
  assert.equal(lists.entry('o/r').syncedAt, before)
  assert.equal(lists.checkAgainst('o/r', { ...probe, pulls: [{ number: 1, signature: 'moved' }, ...probe.pulls.slice(1)] }), 'behind')
  assert.equal(lists.checkAgainst('o/r', { total: 4, pulls: [...probe.pulls, { number: 9, signature: 'new' }] }), 'behind', 'a PR that came')
  assert.equal(lists.entry('o/r').syncedAt, before, 'a list that is behind is not called current')
  clock += 60000
  assert.equal(lists.checkAgainst('o/r', probe), 'current')
  assert.notEqual(lists.entry('o/r').syncedAt, before)
})

test('a list known to be empty only from a count is not saved, so it never takes the place of a list that was read', async () => {
  github = installGithub({ 'o/real': many('o/real', 2) })
  const lists = createRepositoryLists()
  await lists.read('o/real', { token: 't' })
  lists.applyCounts(new Map(Array.from({ length: 13 }, (_, index) => [`o/empty${index}`, 0])))
  assert.equal(lists.entry('o/empty0').listed, true, 'it still shows its empty list at once')
  assert.deepEqual(lists.listsToSave().map(list => list.repo), ['o/real'])
  await lists.read('o/empty3', { token: 't' }) // opened: now it was read, and the copy keeps it
  assert.deepEqual(lists.listsToSave().map(list => list.repo).sort(), ['o/empty3', 'o/real'])
})

test('a read that is not the owner\'s leaves a list they paged past its first page as it is, and their own read refreshes it', async () => {
  github = installGithub({ 'o/big': many('o/big', 120) })
  const lists = createRepositoryLists()
  await lists.read('o/big', { token: 't' })
  await lists.loadMore('o/big', 't')
  assert.equal(numbers(lists.entry('o/big')).length, 100)
  github.calls.length = 0
  await lists.read('o/big', { token: 't' })
  await lists.read('o/big', { token: 't', how: 'reconcile' })
  assert.deepEqual([github.calls.length, numbers(lists.entry('o/big')).length], [0, 100], 'the pages the owner opened were not collapsed')
  await lists.read('o/big', { token: 't', fresh: true })
  assert.equal(numbers(lists.entry('o/big')).length, 50, 'Sync reads the first page again, as it always did')
})

test('the answer of a read that began before an action never shows once a read after the action is out', async () => {
  const world = { 'o/r': many('o/r', 2) }
  let release, held = 0
  github = installGithub(world, { hold: call => (call.name === 'ContributePullRequests' && ++held === 1 ? new Promise(resolve => { release = resolve }) : null) })
  const lists = createRepositoryLists()
  lists.restore([saved('o/r', many('o/r', 3))]) // what the last visit saw; GitHub has two PRs when the first read is made
  const seen = []
  lists.subscribe(() => seen.push(numbers(lists.entry('o/r')).join()))
  const before = lists.read('o/r', { token: 't' })
  await until(() => release)
  world['o/r'] = [world['o/r'][0]] // the owner merged PR 2 while that read was out
  const after = lists.read('o/r', { token: 't', fresh: true })
  seen.length = 0
  release()
  await Promise.all([before, after])
  assert.ok(!seen.includes('1,2'), 'the list from before the action showed again: ' + seen.join(' | '))
  assert.deepEqual(numbers(lists.entry('o/r')), [1])
})

test('a PR that closed between the probe and the read leaves the list instead of showing as open', async () => {
  const world = { 'o/r': many('o/r', 2) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  await lists.read('o/r', { token: 't' })
  world['o/r'][1] = fullPull('o/r', 2, { updatedAt: '2026-11-14T00:00:00Z' })
  const exact = github.calls.length
  const real = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    // The PR is merged by the time its exact read is made.
    if (/query ContributeListDetails/.test(options?.body || '')) { world['o/r'][1] = fullPull('o/r', 2, { state: 'MERGED' }); globalThis.fetch = real }
    return real(url, options)
  }
  await lists.read('o/r', { token: 't', how: 'reconcile' })
  assert.deepEqual(numbers(lists.entry('o/r')), [1])
  assert.ok(github.calls.length > exact)
})

test('asking for the next page of a list whose details are still arriving keeps it marked as not whole', async () => {
  let groups = 0
  github = installGithub({ 'o/big': many('o/big', 70) }, { hold: call => { if (call.name === 'ContributeListDetails' && ++groups === 2) throw Object.assign(new Error('down'), { status: 502 }) } })
  const lists = createRepositoryLists()
  await assert.rejects(lists.read('o/big', { token: 't' }), /Could not read/)
  await lists.loadMore('o/big', 't')
  assert.equal(lists.entry('o/big').data.partial, true, 'page one still holds rows with only their titles')
})
