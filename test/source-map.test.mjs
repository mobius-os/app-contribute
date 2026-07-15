import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachSourceProjects,
  contributionRelationship,
  formatSourceDelta,
  projectMatchesFilter,
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
  assert.equal(projectMatchesFilter(contribute, 'different'), false)
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

test('formats authoritative endpoint tree delta', () => {
  assert.equal(formatSourceDelta(snapshot.platform), '4 files differ · +12 −3')
  assert.equal(formatSourceDelta(snapshot.apps[0]), 'Source trees match')
})
