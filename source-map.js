// Pure Sources-view logic: correlate local repositories with active ledger
// records, derive attention/filter state, and format relationship labels.
// React and I/O stay in ui/SourceMap.jsx + api.js so these rules are cheap to
// exercise under node:test.

const ACTIVE = new Set(['prepared', 'submitting', 'draft', 'open'])

function nonnegativeCount(value) {
  const count = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

function repoKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function activeContribution(rec) {
  const isPullRequest = rec?.type === 'pr' || rec?.plan?.action === 'pr'
  return !!rec && isPullRequest && ACTIVE.has(rec.status)
}

export function recordBranch(rec) {
  return rec?.plan?.branch || rec?.branch || ''
}

export function attachSourceProjects(snapshot, records) {
  const base = []
  if (snapshot?.platform) base.push(snapshot.platform)
  if (Array.isArray(snapshot?.apps)) {
    // A locally built app has no shared repository yet, but it is exactly the
    // kind of work an owner may want help publishing. Keep it in the map and
    // sort it into a quiet "Built here" group instead of mislabelling it as a
    // broken tracked project.
    base.push(...snapshot.apps.filter((project) => (
      repoKey(project?.canonical_repo) || project?.state === 'local_only'
    )))
  }
  const active = (records || []).filter(activeContribution)
  const byRepo = new Map()
  for (const rec of active) {
    const key = repoKey(rec.repo || rec.plan?.repo)
    if (!key) continue
    const bucket = byRepo.get(key) || []
    bucket.push(rec)
    byRepo.set(key, bucket)
  }

  const seen = new Set()
  const projects = base.map((project) => {
    const key = repoKey(project.canonical_repo)
    if (key) seen.add(key)
    return decorateProject(project, key ? (byRepo.get(key) || []) : [])
  })

  // A live contribution can outlast an uninstall or refer to a repository not
  // installed here. Keep it visible instead of silently dropping it.
  for (const [repo, contributions] of byRepo.entries()) {
    if (seen.has(repo)) continue
    projects.push(decorateProject({
      key: 'external:' + repo,
      kind: 'external',
      name: repo,
      canonical_repo: repo,
      available: false,
      state: 'unavailable',
      branch: null,
      base_ref: null,
      tree: null,
      working: null,
    }, contributions))
  }

  return projects.sort((a, b) => {
    const aBuiltHere = a.builtHere
    const bBuiltHere = b.builtHere
    if (aBuiltHere !== bBuiltHere) return aBuiltHere ? 1 : -1
    if (a.kind === 'platform' && b.kind !== 'platform') return -1
    if (b.kind === 'platform' && a.kind !== 'platform') return 1
    if (a.attention !== b.attention) return a.attention ? -1 : 1
    if (a.contributions.length !== b.contributions.length) {
      return b.contributions.length - a.contributions.length
    }
    if (a.different !== b.different) return a.different ? -1 : 1
    return String(a.name).localeCompare(String(b.name))
  })
}

function decorateProject(project, contributions) {
  const workingFiles = nonnegativeCount(project?.working?.files)
  // Installed apps are release projections, not full development checkouts.
  // Their authoritative local delta is against installer-owned `upstream`;
  // comparing them with origin can make omitted tests/docs/source look like
  // thousands of owner-authored deletions. Only the platform is a full clone
  // whose local/origin tree and ancestry describe the same source surface.
  const compareWithOrigin = project?.kind === 'platform'
  const comparisonTree = compareWithOrigin
    ? (project?.origin?.local_tree || project?.tree)
    : project?.tree
  const authoredFiles = nonnegativeCount(
    comparisonTree?.authored_files ?? comparisonTree?.files ?? 0,
  )
  const managedFiles = nonnegativeCount(comparisonTree?.managed_files)
  const originAhead = nonnegativeCount(
    compareWithOrigin
      ? (project?.origin?.local_ahead ?? project?.ahead ?? 0)
      : (project?.ahead ?? 0),
  )
  const originBehind = nonnegativeCount(
    compareWithOrigin
      ? (project?.origin?.local_behind ?? project?.behind ?? 0)
      : (project?.behind ?? 0),
  )
  const reconciliation = project?.reconciliation || {}
  const semanticAvailable = reconciliation.available === true
  const originSha = typeof project?.origin?.sha === 'string' ? project.origin.sha : ''
  const baseSha = typeof project?.base_sha === 'string' ? project.base_sha : ''
  // Source status is intentionally fetch-free. If the last-fetched canonical
  // branch and the installer-owned marker name different commits, local work
  // needs comparison before it is contribution-ready. Exact tree equality is
  // the one conclusive exception.
  const sourceComparisonRequired = project?.kind === 'app'
    && project?.origin?.head_tree_matches_origin !== true
    && !!originSha
    && !!baseSha
    && originSha !== baseSha
  const localOnlyPaths = Array.isArray(reconciliation.local_only_paths)
    ? reconciliation.local_only_paths
    : []
  const incomingPaths = Array.isArray(reconciliation.new_upstream_paths)
    ? reconciliation.new_upstream_paths
    : []
  const compatiblePaths = Array.isArray(reconciliation.compatible_paths)
    ? reconciliation.compatible_paths
    : []
  const conflictPaths = Array.isArray(reconciliation.unresolved_conflict_paths)
    ? reconciliation.unresolved_conflict_paths
    : []
  const localFiles = semanticAvailable
    ? nonnegativeCount(reconciliation.local_only_count ?? localOnlyPaths.length)
    : authoredFiles
  const incomingFiles = semanticAvailable
    ? nonnegativeCount(reconciliation.new_upstream_count ?? incomingPaths.length)
    : originBehind
  const conflictFiles = semanticAvailable
    ? nonnegativeCount(reconciliation.unresolved_conflict_count ?? conflictPaths.length)
    : 0
  const compatibleFiles = semanticAvailable
    ? nonnegativeCount(reconciliation.compatible_count ?? compatiblePaths.length)
    : 0
  const provenShared = semanticAvailable
    ? nonnegativeCount(reconciliation.proven_present_count ?? reconciliation.proven_present?.length ?? 0)
    : 0
  const different = localFiles > 0 || compatibleFiles > 0 || conflictFiles > 0
  const forks = projectForks(project, contributions)
  const contributionAttention = contributions.some((rec) => rec.needs_attention)
  const builtHere = project?.kind === 'app'
    && project?.state === 'local_only'
    && !repoKey(project?.canonical_repo)
  const attention = (
    project?.state === 'conflict' ||
    project?.state === 'diverged' ||
    conflictFiles > 0 ||
    compatibleFiles > 0 ||
    incomingFiles > 0 ||
    workingFiles > 0 ||
    contributionAttention
  )
  const ready = contributions.filter((rec) => rec.status === 'prepared').length
  const open = contributions.length - ready
  return {
    ...project,
    contributions,
    contributionCounts: { ready, open },
    different,
    adapted: managedFiles > 0,
    authoredFiles,
    managedFiles,
    reconciliation,
    semanticAvailable,
    sourceComparisonRequired,
    localOnlyPaths,
    incomingPaths,
    compatiblePaths,
    conflictPaths,
    localFiles,
    incomingFiles,
    compatibleFiles,
    conflictFiles,
    provenShared,
    comparisonTree,
    originAhead,
    originBehind,
    forks,
    workingFiles,
    attention,
    builtHere,
  }
}

export function projectForks(project, contributions = []) {
  const forks = new Map()
  for (const fork of project?.forks || []) {
    const key = repoKey(fork?.repo)
    if (!key) continue
    forks.set(key, { ...fork, repo: fork.repo, contributions: [] })
  }
  for (const rec of contributions) {
    const repo = rec?.head_repository
    const key = repoKey(repo)
    if (!key || key === repoKey(project?.canonical_repo)) continue
    const existing = forks.get(key) || {
      repo,
      ref: null,
      sha: null,
      ahead: null,
      behind: null,
      tree: null,
      contributions: [],
    }
    existing.contributions.push(rec)
    if (!existing.sha && rec.last_submit_fork_sha) existing.sha = rec.last_submit_fork_sha
    if (!existing.branch && rec.last_submit_fork_branch) {
      existing.branch = rec.last_submit_fork_branch
    }
    if (!existing.sync && rec.last_submit_fork_sync) existing.sync = rec.last_submit_fork_sync
    forks.set(key, existing)
  }
  return [...forks.values()].sort((a, b) => a.repo.localeCompare(b.repo))
}

export function sourceSummary(projects) {
  return (projects || []).reduce((out, project) => {
    out.sources += 1
    out.different += Number(project.different)
    out.working += Number(project.workingFiles || 0)
    out.active += project.contributions?.length || 0
    out.forks += project.forks?.length || 0
    out.adapted += Number(project.adapted)
    out.attention += Number(project.attention)
    return out
  }, { sources: 0, different: 0, working: 0, active: 0, forks: 0, adapted: 0, attention: 0 })
}

export function projectMatchesFilter(project, filter) {
  if (filter === 'attention') return project.attention
  if (filter === 'changed') {
    return project.state === 'local_only' || project.different || project.workingFiles > 0
  }
  if (filter === 'shared') return project.contributions.length > 0 || project.forks.length > 0
  return true
}

export function sourcePathRelationship(project, path) {
  if (!project?.semanticAvailable || !path) return 'changed'
  const conflict = project.conflictPaths?.includes(path)
  const local = project.localOnlyPaths?.includes(path)
  const incoming = project.incomingPaths?.includes(path)
  const compatible = project.compatiblePaths?.includes(path)
  if (conflict) return 'conflict'
  if (compatible) return 'compatible'
  if (local) return 'local'
  if (incoming) return 'incoming'
  return 'changed'
}

export function projectSourceState(project) {
  if (!project) return 'unknown'
  if (project.kind === 'external') return 'external'
  if (project.builtHere) return 'built_here'
  if (project.state === 'local_only') return 'local_only'
  if (!project.available) return 'unavailable'
  if (project.state === 'conflict' || project.conflictFiles > 0) return 'conflict'
  if (project.sourceComparisonRequired && project.workingFiles > 0) return 'comparison_needed'
  if (project.workingFiles > 0) return 'working'
  if (
    project.compatibleFiles > 0
    || (project.localFiles > 0 && project.incomingFiles > 0)
    || project.state === 'diverged'
  ) return 'both_changed'
  if (project.incomingFiles > 0 || project.state === 'incoming') return 'incoming'
  if (project.detached) return 'detached'
  if (project.branch && project.branch !== 'main') return 'branch'
  if (project.sourceComparisonRequired && (project.state === 'customized' || project.different)) {
    return 'comparison_needed'
  }
  if (project.state === 'customized' || project.different) return 'local_changes'
  if (project.state === 'adapted' || project.adapted) return 'adapted'
  return 'aligned'
}

export function projectStatus(project) {
  const state = projectSourceState(project)
  if (state === 'external') return { label: 'Contribution only', tone: 'quiet' }
  if (state === 'built_here') return { label: 'Built here', tone: 'accent' }
  if (state === 'local_only') return { label: 'No shared source', tone: 'warn' }
  if (state === 'unavailable') return { label: 'Not tracked', tone: 'quiet' }
  if (state === 'conflict') {
    return {
      label: project.conflictFiles > 0
        ? fileCount(project.conflictFiles) + (project.conflictFiles === 1
          ? ' needs a choice'
          : ' need a choice')
        : 'Update conflict',
      tone: 'danger',
    }
  }
  if (project.contributions.some((rec) => rec.needs_attention)) {
    return { label: 'Needs attention', tone: 'danger' }
  }
  if (state === 'comparison_needed') return { label: 'Needs comparison', tone: 'warn' }
  if (state === 'working') return { label: project.workingFiles + ' working', tone: 'warn' }
  if (state === 'both_changed') return { label: 'Both sides changed', tone: 'warn' }
  if (state === 'incoming') {
    return { label: project.incomingFiles > 0 ? 'Shared changes' : 'Update available', tone: 'accent' }
  }
  if (state === 'detached' || state === 'branch') {
    return { label: state === 'detached' ? 'Detached' : project.branch, tone: 'warn' }
  }
  if (state === 'local_changes') return { label: 'Local changes', tone: 'accent' }
  if (state === 'adapted') return { label: 'Install-managed', tone: 'quiet' }
  return { label: 'Aligned', tone: 'ok' }
}

export function projectFlowStatus(project) {
  const state = projectSourceState(project)
  const views = {
    external: { label: 'Not installed', tone: 'quiet' },
    built_here: { label: 'Built here', tone: 'accent' },
    local_only: { label: 'No shared source', tone: 'warn' },
    unavailable: { label: 'Not tracked', tone: 'quiet' },
    conflict: { label: 'Update conflict', tone: 'danger' },
    comparison_needed: { label: 'Needs comparison', tone: 'warn' },
    working: { label: 'Being edited', tone: 'warn' },
    both_changed: { label: 'Both changed', tone: 'warn' },
    incoming: { label: 'Update available', tone: 'accent' },
    detached: { label: 'Another version', tone: 'warn' },
    branch: { label: 'Another version', tone: 'warn' },
    local_changes: { label: 'Committed differences', tone: 'accent' },
    adapted: { label: 'Installed normally', tone: 'quiet' },
    aligned: { label: 'Up to date', tone: 'ok' },
    unknown: { label: 'Not tracked', tone: 'quiet' },
  }
  return views[state]
}

function fileCount(value) {
  const count = Number(value || 0)
  return count + (count === 1 ? ' file' : ' files')
}

function presentVerb(value) {
  return Number(value || 0) === 1 ? 'is' : 'are'
}

function localCount(value) {
  return `${fileCount(value)} ${Number(value || 0) === 1 ? 'remains' : 'remain'} local`
}

function localWorkDescription(project) {
  return [
    project.localFiles > 0
      ? `${fileCount(project.localFiles)} committed only here`
      : '',
    project.workingFiles > 0
      ? `${fileCount(project.workingFiles)} being edited`
      : '',
  ].filter(Boolean).join(' and ') || 'remaining local work'
}

function incomingCount(project) {
  if (project.semanticAvailable) return fileCount(project.incomingFiles)
  const count = Number(project.originBehind || 0)
  return count + (count === 1 ? ' shared update' : ' shared updates')
}

function changeFacts(project) {
  const facts = []
  if (project.workingFiles > 0) facts.push(fileCount(project.workingFiles) + ' being edited')
  if (project.localFiles > 0) facts.push(localCount(project.localFiles))
  if (project.incomingFiles > 0) facts.push(incomingCount(project) + ' incoming')
  if (project.compatibleFiles > 0) {
    facts.push(fileCount(project.compatibleFiles) + ' combine cleanly')
  }
  if (project.conflictFiles > 0) {
    facts.push(fileCount(project.conflictFiles) + (project.conflictFiles === 1
      ? ' needs a choice'
      : ' need a choice'))
  }
  if (project.provenShared > 0) {
    facts.push(project.provenShared + (project.provenShared === 1
      ? ' landed submission recognized'
      : ' landed submissions recognized'))
  }
  return facts.join(' · ')
}

// The opening view uses this deliberately narrow summary. Aligned projects,
// installer-only adjustments, and ordinary active reviews already represented
// in the feed return null, keeping the overview silent when there is no useful
// local/upstream position to act on.
export function projectOverview(project) {
  const state = projectSourceState(project)
  if (state === 'unknown' || state === 'external') return null
  if (state === 'built_here') {
    return {
      label: 'Built here',
      detail: 'This app does not have a GitHub home yet',
      tone: 'accent',
    }
  }
  if (state === 'local_only') {
    return {
      label: 'No shared update source',
      detail: 'A GitHub repository exists, but there is no shared version to compare',
      tone: 'warn',
    }
  }
  if (state === 'conflict') {
    return {
      label: 'Changes need help',
      detail: changeFacts(project) || 'An update could not be combined safely',
      tone: 'danger',
    }
  }
  if (state === 'both_changed') {
    return {
      label: 'Both versions changed',
      detail: changeFacts(project) || 'Your version and the shared version are different',
      tone: 'warn',
    }
  }
  if (state === 'comparison_needed') {
    return {
      label: 'Compare before contributing',
      detail: 'The shared source and this app’s recorded baseline are different',
      tone: 'warn',
    }
  }
  if (state === 'working') {
    return {
      label: 'Local edits in progress',
      detail: fileCount(project.workingFiles) + ' being edited',
      tone: 'warn',
    }
  }
  if (state === 'local_changes') {
    return {
      label: 'Committed version differs',
      detail: project.localFiles > 0
        ? localCount(project.localFiles) + ' after shared work'
        : 'Your committed version differs from shared source',
      tone: 'accent',
    }
  }
  if (state === 'incoming') {
    return {
      label: 'Update available',
      detail: project.incomingFiles > 0
        ? incomingCount(project) + (project.incomingFiles === 1 ? ' is new upstream' : ' are new upstream')
        : 'The shared version has moved ahead',
      tone: 'accent',
    }
  }
  if (state === 'detached') {
    return {
      label: 'Not on the main version',
      detail: project.head_sha ? 'At commit ' + project.head_sha.slice(0, 7) : 'Detached from a branch',
      tone: 'warn',
    }
  }
  if (state === 'branch') {
    return {
      label: 'On another version',
      detail: 'Currently on ' + project.branch,
      tone: 'warn',
    }
  }
  return null
}

export function projectDetailSummary(project) {
  const state = projectSourceState(project)
  if (state === 'built_here') {
    return 'This app was built on your Möbius and does not have a shared GitHub repository yet.'
  }
  if (state === 'local_only') {
    return 'This project has a GitHub repository, but no shared update source is configured here.'
  }
  if (state === 'external') {
    return 'This project is not installed here, but it still has a contribution in review.'
  }
  if (state === 'conflict') {
    return project.conflictFiles > 0
      ? 'Shared submissions are already accounted for; only the remaining overlapping files need a choice.'
      : 'An update needs attention before this project can move forward.'
  }
  if (state === 'comparison_needed') {
    return 'The shared source does not match this app’s recorded comparison point. Compare both versions before treating local work as a contribution.'
  }
  if (state === 'working') return 'This project is currently being edited in your Möbius.'
  if (state === 'both_changed') {
    return 'Shared submissions are already accounted for. Genuine local and incoming changes remain.'
  }
  if (state === 'incoming') return 'A newer shared version is available.'
  if (state === 'local_changes') {
    return project.contributions.length > 0
      ? 'These are the committed changes that remain local after landed submissions; active reviews are shown separately below.'
      : 'These committed changes remain local after landed submissions. They are not working-tree edits.'
  }
  if (state === 'detached' || state === 'branch') {
    return 'This Möbius is using a version other than the shared main branch.'
  }
  if (state === 'unavailable') return 'No inspectable local source is available.'
  return project.kind === 'app'
    ? 'Your installed app has no local changes.'
    : 'Your version matches the shared source.'
}

export function projectRowFacts(project) {
  const facts = []
  const state = projectSourceState(project)
  if (state === 'built_here') facts.push('Not on GitHub yet')
  else if (state === 'local_only') facts.push('No shared update source')
  if (project.workingFiles) facts.push('Being edited')
  if (state === 'comparison_needed') {
    facts.push('Compare shared source')
  }
  if (project.provenShared) facts.push(`${project.provenShared} landed recognized`)
  if (project.incomingFiles) facts.push('Update available')
  if (project.localFiles) facts.push(localCount(project.localFiles))
  if (project.compatibleFiles) facts.push(`${project.compatibleFiles} combine cleanly`)
  if (project.conflictFiles) {
    facts.push(`${project.conflictFiles} ${project.conflictFiles === 1 ? 'needs' : 'need'} a choice`)
  }
  if (project.contributions.length) {
    const reviews = project.contributions.length
    facts.push(`${reviews} ${reviews === 1 ? 'review' : 'reviews'}`)
  }
  if (!facts.length && project.managedFiles) facts.push('Installed normally')
  if (!facts.length) facts.push(project.available ? 'Up to date' : 'Not tracked')
  return facts
}

export function actionableSourceProjects(projects) {
  return (projects || []).filter((project) => projectOverview(project))
}

export function preparableSourceProjects(projects) {
  return (projects || []).filter(
    (project) => projectAgentAction(project)?.event === 'prepare_contribution',
  )
}

export function prepareAllAction(projects) {
  const candidates = preparableSourceProjects(projects)
  if (candidates.length === 0) return null
  const projectList = candidates.map((project) => {
    const repo = project.canonical_repo ? ` — ${project.canonical_repo}` : ''
    return `- ${project.name || 'Unnamed project'}${repo}`
  }).join('\n')
  return {
    label: `Prepare all (${candidates.length})`,
    event: 'prepare_all_contributions',
    autoSend: true,
    count: candidates.length,
    draft: [
      'Prepare private upstream contributions for every eligible local change below:',
      '',
      projectList,
      '',
      'Inspect each project, check for overlapping upstream work, and stage every worthwhile contribution in Contribute for my review. Do not publish, push, open an issue, or open a pull request. If a project is not ready or should stay local, leave it untouched and explain why.',
    ].join('\n'),
  }
}

// Agent handoffs are specific to the inspected project and conservative about
// public work. Ordinary project actions open a reviewable draft; explicit batch
// actions opt into auto-send so the work begins after the owner clicks the
// clearly labelled Prepare all / Address all button.
export function projectAgentAction(project) {
  if (!project) return null
  const name = project.name || 'this project'
  const repo = project.canonical_repo ? ` (${project.canonical_repo})` : ''
  const state = projectSourceState(project)
  if (state === 'built_here') {
    return {
      label: 'Ask agent to publish',
      event: 'publish_local_app',
      draft: `Help me publish the locally built app "${name}" to GitHub. Inspect the app first, then confirm the repository name and visibility with me before creating or pushing anything public.`,
    }
  }
  if (state === 'local_only') {
    return {
      label: 'Ask agent to review',
      event: 'review_missing_source',
      draft: `Inspect ${name}${repo}. It has a GitHub repository but no shared update source on this Möbius. Explain whether the source should be connected before making any changes.`,
    }
  }
  if (state === 'conflict' || state === 'both_changed') {
    const hasSemanticOverlap = project.semanticAvailable && (
      project.conflictFiles > 0
      || project.compatibleFiles > 0
      || (project.localFiles > 0 && project.incomingFiles > 0)
    )
    return {
      label: 'Ask agent for help',
      event: 'resolve_source_state',
      draft: hasSemanticOverlap
        ? `Inspect ${name}${repo}. Use the semantic source receipt: shared submissions are already excluded, ${fileCount(project.localFiles)} ${presentVerb(project.localFiles)} local-only, ${incomingCount(project)} ${presentVerb(project.incomingFiles)} incoming-only, ${fileCount(project.compatibleFiles)} ${presentVerb(project.compatibleFiles)} compatible, and ${fileCount(project.conflictFiles)} ${presentVerb(project.conflictFiles)} unresolved. Explain the remaining groups and help me choose a safe next step without discarding local work.`
        : `Inspect ${name}${repo}. My local version and the shared version both have changes. Explain what differs and help me choose a safe next step without discarding local work.`,
    }
  }
  if (state === 'comparison_needed') {
    return {
      label: 'Ask agent to compare',
      event: 'review_source_position',
      draft: `Inspect ${name}${repo}. The shared repository and this app’s recorded update source point to different revisions. Compare the live source with current shared work, separate already-landed changes from genuine local work, and explain what remains. Do not prepare or publish anything yet.`,
    }
  }
  if (state === 'working' || state === 'local_changes') {
    const localWork = localWorkDescription(project)
    if (project.contributions?.length > 0) {
      return {
        label: 'Ask agent to inventory',
        event: 'review_remaining_changes',
        draft: project.semanticAvailable
          ? `Inventory the changes still shown for ${name}${repo} after landed submissions were excluded: ${localWork}. Separate changes already represented by active Contribute reviews from genuinely unreviewed work and intentional local-only behavior. Do not prepare or publish anything yet; explain the remaining groups first.`
          : `Inventory the local changes in ${name}${repo}: ${localWork}. Separate changes already represented by active Contribute reviews from genuinely unreviewed work and intentional local-only behavior. Do not prepare or publish anything yet; explain the remaining groups first.`,
      }
    }
    return {
      label: 'Ask agent to prepare',
      event: 'prepare_contribution',
      draft: project.semanticAvailable
        ? `Inspect the changes still shown for ${name}${repo} after landed submissions were excluded: ${localWork}. Prepare upstream contributions for the worthwhile changes. Do not publish anything yet; stage them in Contribute so I can review them first.`
        : `Inspect the local changes in ${name}${repo}: ${localWork}. Prepare upstream contributions for the worthwhile changes. Do not publish anything yet; stage them in Contribute so I can review them first.`,
    }
  }
  if (state === 'incoming') {
    return {
      label: 'Ask agent about update',
      event: 'review_source_update',
      draft: `Review the available shared update for ${name}${repo}. Explain what changed and whether it is safe to update my local version before making any changes.`,
    }
  }
  if (state === 'detached' || state === 'branch') {
    return {
      label: 'Ask agent to review',
      event: 'review_source_position',
      draft: `Inspect the current local version of ${name}${repo}. Explain how it relates to main and whether any local work needs to be preserved or contributed.`,
    }
  }
  return null
}

export function contributionRelationship(rec, project) {
  const plan = rec?.plan || {}
  const reviewedHead = plan.head_sha || ''
  const remoteHead = rec?.last_submit_push_sha || reviewedHead
  const base = plan.base_sha || rec?.last_submit_upstream_sha || ''
  const local = project?.head_sha || ''
  if (remoteHead && local && remoteHead === local) return 'Matches your main'
  if (base && local && base === local) return 'Based on your main'
  if (rec?.status === 'prepared') {
    return base ? 'Private · based on ' + base.slice(0, 7) : 'Private · not public'
  }
  if (remoteHead && remoteHead !== reviewedHead) {
    return 'Published as ' + remoteHead.slice(0, 7)
  }
  return base ? 'Based on ' + base.slice(0, 7) : 'Relationship unknown'
}

export function formatSourceDelta(project) {
  const tree = project?.tree
  if (!tree?.available) return 'Source comparison unavailable'
  const authored = Number(tree.authored_files ?? tree.files ?? 0)
  const managed = Number(tree.managed_files || 0)
  if (!authored && !managed) return 'Source trees match'
  const parts = []
  if (authored) parts.push(authored + (authored === 1 ? ' source file' : ' source files'))
  if (managed) parts.push(managed + ' install-managed')
  return parts.join(' · ')
}
