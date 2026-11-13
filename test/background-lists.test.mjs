// What is read in the background and in what order: pinned, active, then the count of the quiet ones.
import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { probePinned, readListPass } from '../background-lists.js'
import { createRepositoryLists } from '../repository-lists.js'
import { pullsInView } from '../pull-view.js'
import { fullPull, installGithub } from './fake-lists.mjs'

let github
afterEach(() => { github?.restore(); github = null })
const many = (repo, count) => Array.from({ length: count }, (_, index) => fullPull(repo, index + 1))
const tiers = (pinned = [], active = [], quiet = []) => ({ pinned, active, quiet })
const run = (lists, extra) => readListPass({ lists, token: 't', paused: () => false, ...extra })
const readOf = call => call.repos[0]

test('the pinned repositories are read first, then the active ones, one at a time, and the quiet ones are only counted', async () => {
  let inFlight = 0, most = 0
  github = installGithub({ 'o/pinned': many('o/pinned', 2), 'o/active': many('o/active', 1), 'o/idle': [], 'o/other': many('o/other', 4) }, {
    hold: async () => { most = Math.max(most, ++inFlight); await new Promise(resolve => setTimeout(resolve, 2)); inFlight -= 1 } })
  const lists = createRepositoryLists()
  await run(lists, { tiers: tiers(['o/pinned'], ['o/active'], ['o/idle', 'o/other']) })
  const titles = github.calls.filter(call => call.name === 'ContributeListTitles').map(readOf)
  assert.deepEqual(titles, ['o/pinned', 'o/active'], 'in tier order')
  assert.equal(github.names().at(-1), 'ContributeOpenCounts', 'the count of the quiet repositories comes last, as one question')
  assert.equal(github.calls.filter(call => call.name === 'ContributeOpenCounts').length, 1)
  assert.equal(github.calls.filter(call => /Titles|Pull/.test(call.name)).every(call => !['o/idle', 'o/other'].includes(call.repos[0])), true, 'a quiet repository is not read')
  assert.ok(most <= 3, 'one list at a time: at most its own parallel groups of details were out together')
  assert.deepEqual(['o/pinned', 'o/active'].map(repo => lists.entry(repo).sessionRead), [true, true])
  assert.deepEqual([lists.entry('o/idle').listed, lists.entry('o/other').listed], [true, false], 'the one with nothing open shows its empty list at once; the other waits to be opened')
})

test('a list already read this visit is not read again, and nothing is asked twice', async () => {
  github = installGithub({ 'o/a': many('o/a', 1), 'o/q': [] })
  const lists = createRepositoryLists(), counted = new Set()
  await run(lists, { tiers: tiers(['o/a'], [], ['o/q']), counted })
  const asked = github.calls.length
  await run(lists, { tiers: tiers(['o/a'], [], ['o/q']), counted })
  assert.equal(github.calls.length, asked)
})

test('a list from the last visit is read in full on every open, and one with nothing yet starts by its titles', async () => {
  github = installGithub({ 'o/old': many('o/old', 2), 'o/new': many('o/new', 2) })
  const lists = createRepositoryLists()
  lists.restore([{ repo: 'o/old', syncedAt: '2026-11-12T07:00:00Z', openedAt: '', total: 2, hasNextPage: false, endCursor: null, pulls: many('o/old', 2) }])
  await run(lists, { tiers: tiers(['o/old', 'o/new']) })
  assert.deepEqual(github.names().filter(name => !/Details/.test(name)), ['ContributePullRequests', 'ContributeListTitles'])
  assert.equal(lists.entry('o/old').sessionRead, true)
})

test('what the probe saw move is read from what moved, and Sync brings every list read already up to date the same way', async () => {
  const world = { 'o/a': many('o/a', 3), 'o/b': many('o/b', 3) }
  github = installGithub(world)
  const lists = createRepositoryLists(), counted = new Set()
  await run(lists, { tiers: tiers(['o/a'], ['o/b']), counted })
  github.calls.length = 0
  world['o/a'][0] = fullPull('o/a', 1, { title: 'Moved', updatedAt: '2026-11-14T00:00:00Z' })
  await run(lists, { tiers: tiers(['o/a'], ['o/b']), counted, moved: ['o/a'] })
  assert.deepEqual(github.names(), ['ContributeListProbe', 'ContributeListDetails'], 'one probe, one PR read')
  assert.equal(pullsInView(lists.entry('o/a').view)[0].title, 'Moved')
  github.calls.length = 0
  await run(lists, { tiers: tiers(['o/a'], ['o/b']), counted, syncing: true })
  assert.deepEqual(github.names(), ['ContributeListProbe', 'ContributeListProbe'], 'each list asked what moved, nothing read in full')
})

test('a read stops at once when the hub says to, and the repositories it did not reach are read by the next one', async () => {
  github = installGithub({ 'o/a': many('o/a', 1), 'o/b': many('o/b', 1) })
  const lists = createRepositoryLists()
  let steps = 0
  await assert.rejects(run(lists, { tiers: tiers(['o/a', 'o/b']), paused: () => ++steps > 1 }), /paused/)
  assert.deepEqual([lists.entry('o/a').sessionRead, lists.entry('o/b').sessionRead], [true, false])
  await run(lists, { tiers: tiers(['o/a', 'o/b']) })
  assert.deepEqual([lists.entry('o/a').sessionRead, lists.entry('o/b').sessionRead], [true, true])
  assert.equal(github.calls.filter(call => call.name === 'ContributeListTitles' && readOf(call) === 'o/a').length, 1, 'the one it had read was not read again')
})

test('a repository that cannot be read does not stop the rest, and the pass fails so the hub reads it again later', async () => {
  github = installGithub({ 'o/bad': many('o/bad', 1), 'o/good': many('o/good', 1) }, { hold: call => { if (call.repos[0] === 'o/bad' && call.name === 'ContributeListTitles') throw Object.assign(new Error('down'), { status: 502 }) } })
  const lists = createRepositoryLists()
  await assert.rejects(run(lists, { tiers: tiers(['o/bad', 'o/good']) }), /could not be read/)
  assert.deepEqual([lists.entry('o/bad').listed, lists.entry('o/good').sessionRead], [false, true])
})

test('the probe of the pinned repositories signs each one, and says nothing when GitHub did not answer for all of them', async () => {
  const world = { 'o/a': many('o/a', 2), 'o/b': many('o/b', 1) }
  github = installGithub(world)
  const lists = createRepositoryLists()
  const first = await probePinned('t', ['o/a', 'o/b'], lists)
  assert.deepEqual([...first.keys()], ['o/a', 'o/b'])
  assert.equal([...(await probePinned('t', ['o/a', 'o/b'], lists)).values()].join(), [...first.values()].join(), 'the same state signs the same')
  world['o/b'].push(fullPull('o/b', 9))
  const second = await probePinned('t', ['o/a', 'o/b'], lists)
  assert.equal(second.get('o/a'), first.get('o/a'))
  assert.notEqual(second.get('o/b'), first.get('o/b'), 'a PR that came is a move')
  world['o/b'].pop(); world['o/b'].pop()
  assert.notEqual((await probePinned('t', ['o/a', 'o/b'], lists)).get('o/b'), first.get('o/b'), 'and so is one that went')
  assert.equal(await probePinned('t', [], lists), null)
  github.restore()
  globalThis.fetch = async () => new Response('{}', { status: 502 })
  assert.equal(await probePinned('t', ['o/a'], lists), null)
})

test('a probe that finds a list showing exactly what GitHub holds confirms it current, and one that is behind is left for the read', async () => {
  let clock = Date.parse('2026-11-13T12:00:00Z')
  const world = { 'o/a': many('o/a', 2), 'o/b': many('o/b', 2) }
  github = installGithub(world)
  const lists = createRepositoryLists({ now: () => clock })
  await run(lists, { tiers: tiers(['o/a', 'o/b']) })
  const heard = []
  lists.subscribe((repo, change) => heard.push([repo, change.confirmed]))
  const readAt = lists.entry('o/a').syncedAt
  clock += 90000
  world['o/b'][0] = fullPull('o/b', 1, { updatedAt: '2026-11-14T00:00:00Z' })
  await probePinned('t', ['o/a', 'o/b'], lists)
  assert.equal(lists.entry('o/a').syncedAt, new Date(clock).toISOString(), 'the list that agrees with GitHub is known current as of the probe')
  assert.notEqual(lists.entry('o/a').syncedAt, readAt)
  assert.equal(lists.entry('o/b').syncedAt, readAt, 'the list that is behind is not called current')
  assert.deepEqual(heard, [['o/a', true]], 'a confirmation is heard as one, so it is not saved again')
})
