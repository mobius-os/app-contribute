import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachSourceProjects,
  contributionRelationship,
  formatSourceDelta,
  projectMatchesFilter,
  projectForks,
  projectStatus,
  sourceSummary,
} from '../source-map.js'

const snapshot = {
  platform: {
    key: 'platform', kind: 'platform', name: 'Möbius', available: true,
    canonical_repo: 'mobius-os/mobius', state: 'diverged', ahead: 23, behind: 2,
    head_sha: 'aaaaaaaa', base_sha: 'bbbbbbbb',
    tree: { available: true, files: 4, insertions: 12, deletions: 3 },
    working: { available: true, files: 0 },
  },
  apps: [{
    key: 'app:80', kind: 'app', name: 'Contribute', available: true,
    canonical_repo: 'mobius-os/app-contribute', state: 'aligned', ahead: 1, behind: 0,
    head_sha: 'cccccccc', base_sha: 'dddddddd',
    tree: { available: true, files: 0, insertions: 0, deletions: 0 },
    working: { available: true, files: 0 },
  }],
}

test('joins only active contribution records to their source project', () => {
  const records = [
    { id: 'ready', repo: 'MOBIUS-OS/MOBIUS', status: 'prepared', plan: {} },
    { id: 'open', repo: 'mobius-os/app-contribute', status: 'open', plan: {} },
    { id: 'done', repo: 'mobius-os/mobius', status: 'merged', plan: {} },
  ]
  const projects = attachSourceProjects(snapshot, records)
  assert.equal(projects[0].name, 'Möbius')
  assert.deepEqual(projects[0].contributions.map((r) => r.id), ['ready'])
  assert.deepEqual(projects[1].contributions.map((r) => r.id), ['open'])
  assert.equal(sourceSummary(projects).active, 2)
})

test('tree equality wins over bookkeeping-only ahead history', () => {
  const projects = attachSourceProjects(snapshot, [])
  const contribute = projects.find((p) => p.name === 'Contribute')
  assert.equal(contribute.ahead, 1)
  assert.equal(contribute.different, false)
  assert.equal(projectStatus(contribute).label, 'Aligned')
  assert.equal(projectMatchesFilter(contribute, 'changed'), false)
})

test('active records for an uninstalled repo stay visible', () => {
  const projects = attachSourceProjects(snapshot, [{
    id: 'other', repo: 'mobius-os/app-gone', status: 'open', title: 'Still open',
  }])
  const external = projects.find((p) => p.kind === 'external')
  assert.equal(external.canonical_repo, 'mobius-os/app-gone')
  assert.equal(external.contributions.length, 1)
  assert.equal(projectStatus(external).label, 'Contribution only')
})

test('attention and relationship labels preserve real PR head topology', () => {
  const project = attachSourceProjects(snapshot, [{
    id: 'pr', repo: 'mobius-os/mobius', status: 'open', needs_attention: true,
    last_submit_push_sha: 'eeeeeeee',
    plan: { base_sha: 'bbbbbbbb', head_sha: 'ffffffff' },
  }])[0]
  assert.equal(projectStatus(project).label, 'Needs attention')
  assert.equal(contributionRelationship(project.contributions[0], project), 'Published as eeeeeee')
})

test('joins configured and contribution-discovered forks without duplication', () => {
  const forks = projectForks({
    canonical_repo: 'mobius-os/mobius',
    forks: [{ repo: 'owner/mobius', ref: 'fork/main', sha: 'aaaa' }],
  }, [{
    id: 'pr', head_repository: 'owner/mobius', last_submit_fork_sha: 'bbbb',
  }])
  assert.equal(forks.length, 1)
  assert.equal(forks[0].repo, 'owner/mobius')
  assert.equal(forks[0].sha, 'aaaa')
  assert.deepEqual(forks[0].contributions.map((rec) => rec.id), ['pr'])
})

test('install-managed deltas are visible without counting as customization', () => {
  const adapted = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'adapted',
      tree: {
        available: true, files: 3, authored_files: 0, managed_files: 3,
        insertions: 10, deletions: 2,
      },
      origin: {
        local_ahead: 1,
        local_behind: 0,
        local_tree: {
          available: true, files: 3, authored_files: 0, managed_files: 3,
          insertions: 10, deletions: 2,
        },
      },
    },
    apps: [],
  }, [])[0]
  assert.equal(adapted.different, false)
  assert.equal(adapted.adapted, true)
  assert.equal(projectStatus(adapted).label, 'Install-managed')
  assert.equal(formatSourceDelta(adapted), '3 install-managed')
})

test('formats authoritative endpoint tree delta', () => {
  assert.equal(formatSourceDelta(snapshot.platform), '4 source files')
  assert.equal(formatSourceDelta(snapshot.apps[0]), 'Source trees match')
})
