// The "always load" choice: which repositories have their pull requests loaded in the background, and how it is saved.
import assert from 'node:assert/strict'
import test from 'node:test'

import { PINNED_REPOSITORIES, pinChoices, pinnedRepositories, setRepositoryPinned } from '../repositories.js'

const PLATFORM = 'mobius-os/mobius'

test('the platform repository starts pinned, and a choice about another repository does not change that', () => {
  assert.deepEqual([...pinnedRepositories({}, PLATFORM)], [PLATFORM])
  assert.deepEqual([...pinnedRepositories({ 'team/other': true }, PLATFORM)], [PLATFORM, 'team/other'])
  assert.deepEqual([...pinnedRepositories({ 'team/other': false }, PLATFORM)], [PLATFORM], 'unpinning another repository is not unpinning this one')
  assert.deepEqual([...pinnedRepositories({}, '')], [], 'an install without a platform repository pins nothing by default')
})

test('the owner can unpin the platform repository, and pin it again', () => {
  assert.deepEqual([...pinnedRepositories({ [PLATFORM]: false, 'team/other': true }, PLATFORM)], ['team/other'])
  assert.deepEqual([...pinnedRepositories({ [PLATFORM]: true }, 'MOBIUS-OS/Mobius')], [PLATFORM], 'names compare without regard to letter case')
})

test('a saved choice that is damaged or of another shape is ignored, never trusted', () => {
  assert.deepEqual(pinChoices({ 'Team/Other': true, 'team/off': false, 'bad name': true, 'team/odd': 'yes', 'team/nothing': null }), { 'team/other': true, 'team/off': false })
  for (const broken of [null, undefined, [], 'team/other', 7]) assert.deepEqual(pinChoices(broken), {})
  assert.deepEqual([...pinnedRepositories(pinChoices(['team/other']), PLATFORM)], [PLATFORM], 'an older list-shaped file is not a choice')
})

function runtime(t, { conflicts = 0, stored = null } = {}) {
  const original = globalThis.window
  t.after(() => { globalThis.window = original })
  const log = { writes: [], paths: [] }
  let version = stored ? 'v0' : ''
  let value = stored
  globalThis.window = { mobius: { storage: {
    getWithVersion: async () => ({ value, version }),
    durableWrite: async (path, next, condition) => {
      log.paths.push(path)
      if (log.writes.length < conflicts) { log.writes.push('conflict'); value = { ...(value || {}), 'team/elsewhere': true }; version = 'v' + log.writes.length; throw Object.assign(new Error('changed'), { code: 'conflict' }) }
      log.writes.push({ next, condition }); value = next
    },
  } } }
  return log
}

test('a choice is saved as a preference of this workspace, next to the others, and nothing else', async t => {
  const log = runtime(t)
  assert.deepEqual(await setRepositoryPinned('https://github.com/Team/New', true), { 'team/new': true })
  assert.deepEqual(log.paths, [PINNED_REPOSITORIES])
  assert.deepEqual(log.writes, [{ next: { 'team/new': true }, condition: { ifNoneMatch: true } }])
})

test('a choice made at the same time elsewhere is kept: the write is repeated on top of it', async t => {
  const log = runtime(t, { conflicts: 1, stored: { [PLATFORM]: false } })
  const next = await setRepositoryPinned('team/new', true)
  assert.deepEqual(next, { [PLATFORM]: false, 'team/elsewhere': true, 'team/new': true })
  assert.deepEqual(log.writes.at(-1).condition, { ifMatch: 'v1' })
  const stuck = runtime(t, { conflicts: 5, stored: {} })
  await assert.rejects(setRepositoryPinned('team/new', true), /changed elsewhere/)
  assert.equal(stuck.writes.length, 2, 'it tries twice and then says so')
})

test('unpinning is saved as a choice, so the platform repository stays off after a restart', async t => {
  const log = runtime(t, { stored: {} })
  await setRepositoryPinned(PLATFORM, false)
  assert.deepEqual(log.writes[0].next, { [PLATFORM]: false })
  assert.deepEqual([...pinnedRepositories(log.writes[0].next, PLATFORM)], [])
  await assert.rejects(setRepositoryPinned('not a repository', true), /valid GitHub repository/)
})
