import test from 'node:test'
import assert from 'node:assert/strict'

import {
  actionableSourceProjects,
  attachSourceProjects,
  prepareProjectsAction,
  projectIconUrl,
  projectMatchesFilter,
  projectNeedsPreparation,
  projectNeedsSorting,
  projectPreparationState,
  projectReadyToPrepare,
  projectStatus,
} from '../source-map.js'

test('project icons reuse canonical app and platform artwork', () => {
  assert.equal(projectIconUrl({ kind: 'platform', key: 'platform' }), '/moebius.png')
  assert.equal(projectIconUrl({ kind: 'app', key: 'app:77' }), '/api/apps/77/icon?size=64')
  assert.equal(projectIconUrl({ kind: 'external', key: 'external:owner/repo' }), '')
  assert.equal(projectIconUrl({ kind: 'app', key: 'app:not-an-id' }), '')
})

function platform() {
  return {
    key: 'platform',
    kind: 'platform',
    name: 'Möbius',
    canonical_repo: 'mobius-os/mobius',
    available: true,
    state: 'aligned',
    branch: 'main',
    working: { files: 0, paths: [] },
    tree: { available: true, files: 0, paths: [] },
    origin: { local_tree: { available: true, files: 0, paths: [] } },
  }
}

function installedApp(overrides = {}) {
  return {
    key: 'app:7',
    kind: 'app',
    name: 'Notes',
    canonical_repo: 'mobius-apps/notes',
    available: true,
    state: 'working',
    branch: 'main',
    working: { files: 1, paths: [{ path: 'index.jsx', group: 'untracked' }] },
    tree: { available: true, files: 0, paths: [] },
    reconciliation: { available: true },
    origin: {},
    ...overrides,
  }
}

test('working drafts stay visible without becoming changes or attention', () => {
  const [mobius, notes] = attachSourceProjects(
    { platform: platform(), apps: [installedApp()] },
    [],
  )

  assert.equal(mobius.key, 'platform')
  assert.equal(notes.key, 'app:7')
  assert.equal(notes.attention, false)
  assert.deepEqual(projectStatus(notes), { label: 'Editing', tone: 'quiet' })
  assert.equal(projectMatchesFilter(notes, 'editing'), true)
  assert.equal(projectMatchesFilter(notes, 'changed'), false)
  assert.deepEqual(actionableSourceProjects([notes]), [])
})

test('a locally built app with only new files is kept as real source work', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({ canonical_repo: null })],
  }, [])
  const local = projects.find((project) => project.key === 'app:7')

  assert.ok(local)
  assert.equal(local.builtHere, true)
  assert.equal(projectMatchesFilter(local, 'editing'), true)
  assert.equal(projectMatchesFilter(local, 'changed'), false)
})

test('committed differences remain visible while another file is being edited', () => {
  const notes = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      tree: {
        available: true,
        files: 1,
        authored_files: 1,
        paths: [{ path: 'api.js', group: 'authored' }],
      },
      reconciliation: {
        available: true,
        local_only_count: 1,
        local_only_paths: ['api.js'],
      },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.deepEqual(projectStatus(notes), { label: 'Local changes', tone: 'accent' })
  assert.deepEqual(actionableSourceProjects([notes]), [notes])
  assert.equal(projectMatchesFilter(notes, 'editing'), true)
  assert.equal(projectMatchesFilter(notes, 'changed'), true)
})

test('shared changes remain decision-bearing in the inbox overview', () => {
  const incoming = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      state: 'incoming',
      working: { files: 0, paths: [] },
      reconciliation: {
        available: true,
        new_upstream_count: 2,
        new_upstream_paths: ['api.js', 'index.jsx'],
      },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.equal(incoming.attention, true)
  assert.equal(projectMatchesFilter(incoming, 'changed'), true)
  assert.deepEqual(actionableSourceProjects([incoming]), [incoming])
  assert.equal(projectNeedsPreparation(incoming), false)
  assert.equal(prepareProjectsAction([incoming]), null)
})

test('prepare handoffs include only projects with real local work', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [
      installedApp({
        name: 'Notes',
        working: { files: 0, paths: [] },
        tree: {
          available: true,
          files: 1,
          authored_files: 1,
          paths: [{ path: 'index.jsx', group: 'authored' }],
        },
        reconciliation: {
          available: true,
          local_only_count: 1,
          local_only_paths: ['index.jsx'],
        },
      }),
      installedApp({
        key: 'app:8',
        name: 'Voice',
        state: 'incoming',
        working: { files: 0, paths: [] },
        reconciliation: {
          available: true,
          new_upstream_count: 1,
          new_upstream_paths: ['api.js'],
        },
      }),
    ],
  }, [])

  const action = prepareProjectsAction(projects)
  assert.equal(action.count, 1)
  assert.equal(action.label, 'Prepare changes')
  assert.match(action.draft, /^Prepare my changes for Notes\./)
  assert.match(action.draft, /Do not publish anything/)
  assert.doesNotMatch(action.draft, /Voice/)
})

test('prepare all handoff names the complete private workflow', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [
      installedApp({ name: 'Notes' }),
      installedApp({ key: 'app:8', name: 'Voice' }),
    ],
  }, [])

  const action = prepareProjectsAction(projects)
  assert.equal(action.count, 2)
  assert.equal(action.label, 'Prepare all')
  assert.match(action.draft, /^Prepare my project changes\./)
  assert.match(action.draft, /Notes, Voice/)
  assert.match(action.draft, /stage it privately in Contribute/)
  assert.match(action.startedMessage, /Stay in Contribute/)
})

test('preparation certainty separates clear candidates from ambiguous local work', () => {
  const projects = attachSourceProjects({
    platform: platform(),
    apps: [
      installedApp({
        name: 'Clear',
        working: { files: 0, paths: [] },
        tree: { available: true, files: 1, authored_files: 1, paths: [] },
        reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
        origin: { sha: 'same' },
        base_sha: 'same',
      }),
      installedApp({
        key: 'app:8',
        name: 'Ambiguous',
        working: { files: 0, paths: [] },
        tree: { available: true, files: 2, authored_files: 2, paths: [] },
        reconciliation: { available: true, local_only_count: 2, local_only_paths: ['api.js', 'index.jsx'] },
        origin: { sha: 'newer' },
        base_sha: 'recorded',
      }),
    ],
  }, [])

  const clear = projects.find((project) => project.name === 'Clear')
  const ambiguous = projects.find((project) => project.name === 'Ambiguous')
  assert.equal(projectPreparationState(clear), 'candidate')
  assert.equal(projectReadyToPrepare(clear), true)
  assert.equal(projectNeedsSorting(clear), false)
  assert.equal(projectPreparationState(ambiguous), 'sorting')
  assert.equal(projectReadyToPrepare(ambiguous), false)
  assert.equal(projectNeedsSorting(ambiguous), true)
})

test('incoming-only projects need alignment, not preparation or sorting', () => {
  const incoming = attachSourceProjects({
    platform: platform(),
    apps: [installedApp({
      state: 'incoming',
      working: { files: 0, paths: [] },
      reconciliation: { available: true, new_upstream_count: 1, new_upstream_paths: ['api.js'] },
    })],
  }, []).find((project) => project.key === 'app:7')

  assert.equal(projectPreparationState(incoming), 'none')
  assert.equal(projectReadyToPrepare(incoming), false)
  assert.equal(projectNeedsSorting(incoming), false)
})

test('active reviews move remaining local work into sorting', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
      origin: { sha: 'same' },
      base_sha: 'same',
    })],
  }, [{ type: 'pr', status: 'prepared', repo: 'mobius-apps/notes' }])

  assert.equal(notes.contributions.length, 1)
  assert.equal(projectPreparationState(notes), 'sorting')
})

test('tracked app work needs sorting when no current shared position is available', () => {
  const [notes] = attachSourceProjects({
    apps: [installedApp({
      working: { files: 0, paths: [] },
      tree: { available: true, files: 1, authored_files: 1, paths: [] },
      reconciliation: { available: true, local_only_count: 1, local_only_paths: ['index.jsx'] },
      origin: {},
      base_sha: 'recorded',
    })],
  }, [])

  assert.equal(projectNeedsPreparation(notes), true)
  assert.equal(projectPreparationState(notes), 'sorting')
})
