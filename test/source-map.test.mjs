import assert from 'node:assert/strict'
import test from 'node:test'
import {
  actionableSourceProjects,
  attachSourceProjects,
  prepareProjectsAction,
  projectDetailSummary,
  projectMatchesFilter,
  projectNeedsPreparation,
  projectNeedsSorting,
  projectOverview,
  projectForks,
  projectReadyToPrepare,
  projectRowFacts,
  projectSourceState,
  projectStatus,
  sourcePathRelationship,
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
    { id: 'ready', type: 'pr', repo: 'MOBIUS-OS/MOBIUS', status: 'prepared', plan: {} },
    { id: 'landing', type: 'pr', repo: 'mobius-os/mobius', status: 'landing', plan: {} },
    { id: 'open', type: 'pr', repo: 'mobius-os/app-contribute', status: 'open', plan: {} },
    { id: 'done', type: 'pr', repo: 'mobius-os/mobius', status: 'merged', plan: {} },
    { id: 'issue', type: 'issue', repo: 'mobius-os/mobius', status: 'prepared', plan: {} },
  ]
  const projects = attachSourceProjects(snapshot, records)
  assert.equal(projects[0].name, 'Möbius')
  assert.deepEqual(projects[0].contributions.map((r) => r.id), ['ready', 'landing'])
  assert.deepEqual(projects[1].contributions.map((r) => r.id), ['open'])
  assert.equal(projects.reduce((total, project) => total + project.contributions.length, 0), 3)
})

test('tree equality wins over bookkeeping-only ahead history', () => {
  const projects = attachSourceProjects(snapshot, [])
  const contribute = projects.find((p) => p.name === 'Contribute')
  assert.equal(contribute.ahead, 1)
  assert.equal(contribute.different, false)
  assert.equal(projectStatus(contribute).label, 'Aligned')
  assert.equal(projectMatchesFilter(contribute, 'changed'), false)
})

test('semantic receipt separates landed, local, incoming, and residual paths', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'conflict',
      tree: {
        available: true, files: 4, authored_files: 4, managed_files: 0,
        paths: [
          { path: 'local.js', group: 'authored' },
          { path: 'incoming.js', group: 'authored' },
          { path: 'compatible.js', group: 'authored' },
          { path: 'choice.js', group: 'authored' },
        ],
      },
      reconciliation: {
        available: true,
        proven_present: ['one', 'two'],
        proven_present_count: 2,
        local_only_paths: ['local.js'],
        local_only_count: 1,
        new_upstream_paths: ['incoming.js'],
        new_upstream_count: 1,
        compatible_paths: ['compatible.js'],
        compatible_count: 1,
        unresolved_conflict_paths: ['choice.js'],
        unresolved_conflict_count: 1,
      },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.provenShared, 2)
  assert.equal(project.localFiles, 1)
  assert.equal(project.incomingFiles, 1)
  assert.equal(project.compatibleFiles, 1)
  assert.equal(project.conflictFiles, 1)
  assert.equal(projectStatus(project).label, '1 file needs a choice')
  assert.equal(projectSourceState(project), 'conflict')
  assert.equal(projectOverview(project).tone, 'danger')
  assert.match(projectDetailSummary(project), /remaining overlapping files/)
  assert.ok(projectRowFacts(project).includes('1 needs a choice'))
  assert.equal(sourcePathRelationship(project, 'local.js'), 'local')
  assert.equal(sourcePathRelationship(project, 'incoming.js'), 'incoming')
  assert.equal(sourcePathRelationship(project, 'compatible.js'), 'compatible')
  assert.equal(sourcePathRelationship(project, 'choice.js'), 'conflict')
  assert.equal(sourcePathRelationship(project, 'outside-preview.js'), 'changed')
  assert.equal(projectNeedsSorting(project), true)
  assert.match(prepareProjectsAction([project]).draft, /Classify working drafts/)
})

test('semantic conflict counts outrank a stale customized state everywhere', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized',
      tree: { available: true, files: 1, authored_files: 1 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 1,
        unresolved_conflict_paths: ['choice.js'],
      },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [])[0]

  assert.equal(projectSourceState(project), 'conflict')
  assert.equal(projectStatus(project).tone, 'danger')
  assert.equal(projectOverview(project).tone, 'danger')
  assert.equal(projectNeedsSorting(project), true)
})

test('semantic counts normalize invalid receipt numbers at the boundary', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'aligned',
      reconciliation: {
        available: true,
        local_only_count: -2,
        new_upstream_count: '2',
        compatible_count: Infinity,
        unresolved_conflict_count: true,
        proven_present_count: 1.8,
      },
      working: { available: true, files: -5 },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.localFiles, 0)
  assert.equal(project.incomingFiles, 0)
  assert.equal(project.compatibleFiles, 0)
  assert.equal(project.conflictFiles, 0)
  assert.equal(project.workingFiles, 0)
  assert.equal(project.provenShared, 1)
  assert.equal(projectSourceState(project), 'aligned')
})

test('incoming-only semantic paths are not offered as local contributions', () => {
  const project = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'incoming',
      tree: { available: true, files: 2, authored_files: 2, managed_files: 0 },
      reconciliation: {
        available: true,
        proven_present: ['already-landed'],
        proven_present_count: 1,
        local_only_paths: [],
        local_only_count: 0,
        new_upstream_paths: ['a.js', 'b.js'],
        new_upstream_count: 2,
        compatible_paths: [],
        compatible_count: 0,
        unresolved_conflict_paths: [],
        unresolved_conflict_count: 0,
      },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [])[0]

  assert.equal(project.different, false)
  assert.equal(projectStatus(project).label, 'Shared changes')
  assert.equal(projectNeedsPreparation(project), false)
  assert.equal(prepareProjectsAction([project]), null)
})

test('installed apps ignore full-repository origin projections', () => {
  const projects = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:66', kind: 'app', name: 'Notes', available: true,
      canonical_repo: 'mobius-os/app-notes', state: 'aligned',
      branch: 'main', base_ref: 'upstream', version: '1.2.33',
      ahead: 1, behind: 0,
      tree: {
        available: true, files: 0, authored_files: 0, managed_files: 0,
        paths: [],
      },
      origin: {
        ref: 'origin/main', local_ahead: 59, local_behind: 88,
        local_tree: {
          available: true, files: 75, authored_files: 74, managed_files: 1,
          paths: [{ path: 'src/app.jsx', group: 'authored', deletions: 805 }],
        },
      },
      working: { available: true, files: 0, paths: [] },
    }],
  }, [])
  const notes = projects[0]

  assert.equal(notes.different, false)
  assert.equal(notes.authoredFiles, 0)
  assert.equal(notes.originBehind, 0)
  assert.equal(notes.attention, false)
  assert.equal(projectStatus(notes).label, 'Aligned')
  assert.equal(projectOverview(notes), null)
  assert.equal(projectNeedsPreparation(notes), false)
  assert.equal(projectMatchesFilter(notes, 'changed'), false)
})

test('exact canonical tree equality outranks a stale installer marker', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:equal', kind: 'app', name: 'Equal app', available: true,
      canonical_repo: 'mobius-os/app-equal', state: 'aligned',
      branch: 'main', base_ref: 'upstream', base_sha: 'old-base',
      comparison_ref: 'origin/main', comparison_sha: 'new-shared',
      tree: { available: true, files: 0, authored_files: 0, managed_files: 0 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 0,
      },
      origin: {
        ref: 'origin/main', sha: 'new-shared', tree_matches_local: true,
      },
      working: { available: true, files: 0 },
    }],
  }, [])[0]

  assert.equal(project.sourceComparisonRequired, false)
  assert.equal(projectStatus(project).label, 'Aligned')
  assert.equal(projectOverview(project), null)
  assert.equal(projectNeedsPreparation(project), false)
})

test('a moved canonical source is compared before local work is prepared', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:stale', kind: 'app', name: 'Stale app', available: true,
      canonical_repo: 'mobius-os/app-stale', state: 'customized',
      branch: 'main', base_ref: 'upstream', base_sha: 'old-base',
      tree: { available: true, files: 2, authored_files: 2, managed_files: 0 },
      origin: {
        ref: 'origin/main', sha: 'new-shared', tree_matches_local: false,
      },
      working: { available: true, files: 0 },
    }],
  }, [])[0]

  assert.equal(project.sourceComparisonRequired, true)
  assert.equal(projectSourceState(project), 'comparison_needed')
  assert.equal(projectStatus(project).label, 'Needs comparison')
  assert.equal(projectOverview(project).label, 'Compare before contributing')
  assert.match(projectDetailSummary(project), /Compare both versions/)
  assert.ok(projectRowFacts(project).includes('Compare shared source'))
  assert.equal(projectNeedsSorting(project), true)
  assert.match(prepareProjectsAction([project]).draft, /Classify working drafts/)
})

test('installed apps still surface genuine local work plus a release update', () => {
  const projects = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:7', kind: 'app', name: 'Demo', available: true,
      canonical_repo: 'mobius-os/app-demo', state: 'diverged',
      branch: 'main', base_ref: 'upstream', version: '2.0.0',
      ahead: 2, behind: 1,
      tree: {
        available: true, files: 1, authored_files: 1, managed_files: 0,
        paths: [{ path: 'index.jsx', group: 'authored', insertions: 2, deletions: 1 }],
      },
      origin: {
        ref: 'origin/main', local_ahead: 200, local_behind: 300,
        local_tree: {
          available: true, files: 40, authored_files: 40, managed_files: 0,
        },
      },
      working: { available: true, files: 0, paths: [] },
    }],
  }, [])
  const demo = projects[0]

  assert.equal(demo.authoredFiles, 1)
  assert.equal(demo.originBehind, 1)
  assert.equal(demo.attention, true)
  assert.equal(projectStatus(demo).label, 'Both sides changed')
  assert.equal(projectOverview(demo).label, 'Both versions changed')
  assert.equal(projectNeedsSorting(demo), true)
  assert.match(prepareProjectsAction([demo]).draft, /Classify working drafts/)
})

test('active records for an uninstalled repo stay visible', () => {
  const projects = attachSourceProjects(snapshot, [{
    id: 'other', type: 'pr', repo: 'mobius-os/app-gone', status: 'open', title: 'Still open',
  }])
  const external = projects.find((p) => p.kind === 'external')
  assert.equal(external.canonical_repo, 'mobius-os/app-gone')
  assert.equal(external.contributions.length, 1)
  assert.equal(projectStatus(external).label, 'Contribution only')
})

test('keeps locally built apps at the bottom as publishing candidates', () => {
  const projects = attachSourceProjects({
    ...snapshot,
    apps: [
      ...snapshot.apps,
      {
        key: 'app:local', kind: 'app', name: 'Local scratchpad',
        available: false, canonical_repo: null, state: 'local_only',
      },
    ],
  }, [])
  assert.equal(projects.at(-1).name, 'Local scratchpad')
  assert.equal(projectStatus(projects.at(-1)).label, 'Built here')
  assert.equal(projectMatchesFilter(projects.at(-1), 'changed'), false)
  assert.equal(projects.length, 3)
})

test('does not offer to publish an app that already has a GitHub repository', () => {
  const project = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:github', kind: 'app', name: 'Existing app', available: true,
      canonical_repo: 'owner/existing-app', state: 'local_only', branch: 'main',
      head_sha: 'abcdef12', working: { available: true, files: 0 },
    }],
  }, [])[0]
  assert.equal(project.builtHere, false)
  assert.equal(projectStatus(project).label, 'No shared source')
  assert.equal(projectNeedsPreparation(project), false)
})

test('attention and relationship labels preserve real PR head topology', () => {
  const project = attachSourceProjects(snapshot, [{
    id: 'pr', type: 'pr', repo: 'mobius-os/mobius', status: 'open', needs_attention: true,
    last_submit_push_sha: 'eeeeeeee',
    plan: { base_sha: 'bbbbbbbb', head_sha: 'ffffffff' },
  }])[0]
  assert.equal(projectStatus(project).label, 'Needs attention')
  assert.equal(project.contributions[0].last_submit_push_sha, 'eeeeeeee')
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
  assert.ok(projectRowFacts(adapted).includes('Installed normally'))
})

test('formats authoritative endpoint tree delta', () => {
  const projects = attachSourceProjects(snapshot, [])
  assert.equal(projects[0].authoredFiles, 4)
  assert.equal(projects[1].different, false)
})

test('opening overview includes only useful local or shared-source positions', () => {
  const projects = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'aligned', ahead: 0, behind: 0,
      tree: { available: true, files: 0 },
    },
    apps: [
      snapshot.apps[0],
      {
        key: 'app:changed', kind: 'app', name: 'Notes', available: true,
        canonical_repo: 'mobius-os/app-notes', state: 'working', branch: 'main',
        tree: { available: true, files: 0 }, working: { available: true, files: 2 },
      },
      {
        key: 'app:new', kind: 'app', name: 'My app', available: true,
        canonical_repo: null, state: 'local_only', branch: 'main',
        tree: null, working: { available: true, files: 0 },
      },
    ],
  }, [])
  const overview = actionableSourceProjects(projects)
  assert.deepEqual(overview, [])
  assert.deepEqual(projects.map((project) => project.name), ['Möbius', 'Contribute', 'Notes', 'My app'])
})

test('agent actions prepare local changes and guard public app publishing', () => {
  const changed = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized', ahead: 1, behind: 0,
      tree: { available: true, files: 3 },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [])[0]
  const prepare = prepareProjectsAction([changed])
  assert.equal(prepare.label, 'Prepare changes')
  assert.match(prepare.draft, /stage it privately in Contribute/)

  const localApp = attachSourceProjects({
    platform: null,
    apps: [{
      key: 'app:new', kind: 'app', name: 'My app', available: true,
      canonical_repo: null, state: 'local_only', working: { files: 1 },
    }],
  }, [])[0]
  const publish = prepareProjectsAction([localApp])
  assert.equal(publish.label, 'Prepare changes')
  assert.match(publish.draft, /Classify working drafts/)
  assert.match(publish.draft, /Do not publish anything/)
})

test('active reviews turn a broad source delta into an inventory, not a mega-PR prompt', () => {
  const changed = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized', ahead: 270, behind: 0,
      tree: { available: true, files: 264 },
      working: { available: true, files: 0 },
    },
    apps: [],
  }, [{
    id: 'open', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
  }])[0]

  assert.equal(projectOverview(changed).label, 'Committed version differs')
  assert.equal(projectOverview(changed).detail, '264 files remain local after shared work')
  const action = prepareProjectsAction([changed])
  assert.equal(projectNeedsSorting(changed), true)
  assert.match(action.draft, /Classify working drafts/)
  assert.match(action.draft, /Do not publish anything/)
  assert.equal(projectReadyToPrepare(changed), false)
})

test('working-only projects with active reviews describe the edits instead of zero local files', () => {
  const changed = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'working', ahead: 0, behind: 0,
      tree: { available: true, files: 0, authored_files: 0, managed_files: 0 },
      working: { available: true, files: 2 },
      reconciliation: {
        available: true,
        local_only_count: 0,
        new_upstream_count: 0,
        compatible_count: 0,
        unresolved_conflict_count: 0,
      },
    },
    apps: [],
  }, [{
    id: 'open', type: 'pr', repo: 'mobius-os/mobius', status: 'open',
  }])[0]

  const action = prepareProjectsAction([changed])
  assert.equal(projectNeedsSorting(changed), true)
  assert.equal(action.label, 'Prepare changes')
  assert.match(projectRowFacts(changed).join(' · '), /Being edited/)
})

test('prepare all batches only projects with eligible local contribution changes', () => {
  const projects = attachSourceProjects({
    platform: {
      ...snapshot.platform,
      state: 'customized', ahead: 1, behind: 0,
      tree: { available: true, files: 3 },
      working: { available: true, files: 0 },
    },
    apps: [
      {
        ...snapshot.apps[0],
        state: 'working',
        working: { available: true, files: 2 },
      },
      {
        key: 'app:incoming', kind: 'app', name: 'Incoming', available: true,
        canonical_repo: 'mobius-os/app-incoming', state: 'incoming',
        ahead: 0, behind: 2, working: { available: true, files: 0 },
      },
    ],
  }, [])

  const candidates = projects.filter(projectNeedsPreparation)
  assert.deepEqual(candidates.map((project) => project.name), ['Möbius', 'Contribute'])
  const action = prepareProjectsAction(projects)
  assert.equal(action.label, 'Prepare all')
  assert.equal(action.event, 'prepare_all_project_changes')
  assert.match(action.draft, /Möbius, Contribute/)
  assert.doesNotMatch(action.draft, /Incoming/)
  assert.match(action.draft, /Do not publish anything/)
})
