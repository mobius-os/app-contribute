// Pure Sources-view logic: correlate local repositories with active ledger
// records, derive attention/filter state, and format relationship labels.
// React and I/O stay in ui/SourceMap.jsx + api.js so these rules are cheap to
// exercise under node:test.

const ACTIVE = new Set(['prepared', 'submitting', 'draft', 'open'])

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
  const workingFiles = Number(project?.working?.files || 0)
  // Installed apps are release projections, not full development checkouts.
  // Their authoritative local delta is against installer-owned `upstream`;
  // comparing them with origin can make omitted tests/docs/source look like
  // thousands of owner-authored deletions. Only the platform is a full clone
  // whose local/origin tree and ancestry describe the same source surface.
  const compareWithOrigin = project?.kind === 'platform'
  const comparisonTree = compareWithOrigin
    ? (project?.origin?.local_tree || project?.tree)
    : project?.tree
  const authoredFiles = Number(
    comparisonTree?.authored_files ?? comparisonTree?.files ?? 0,
  )
  const managedFiles = Number(comparisonTree?.managed_files || 0)
  const originAhead = Number(
    compareWithOrigin
      ? (project?.origin?.local_ahead ?? project?.ahead ?? 0)
      : (project?.ahead ?? 0),
  )
  const originBehind = Number(
    compareWithOrigin
      ? (project?.origin?.local_behind ?? project?.behind ?? 0)
      : (project?.behind ?? 0),
  )
  const different = authoredFiles > 0
  const forks = projectForks(project, contributions)
  const contributionAttention = contributions.some((rec) => rec.needs_attention)
  const builtHere = project?.kind === 'app'
    && project?.state === 'local_only'
    && !repoKey(project?.canonical_repo)
  const attention = (
    project?.state === 'conflict' ||
    project?.state === 'diverged' ||
    originBehind > 0 ||
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

export function projectStatus(project) {
  if (project.kind === 'external') return { label: 'Contribution only', tone: 'quiet' }
  if (project.builtHere) return { label: 'Built here', tone: 'accent' }
  if (!project.available) return { label: 'Not tracked', tone: 'quiet' }
  if (project.state === 'conflict') return { label: 'Update conflict', tone: 'danger' }
  if (project.contributions.some((rec) => rec.needs_attention)) {
    return { label: 'Needs attention', tone: 'danger' }
  }
  if (project.workingFiles > 0) {
    return { label: project.workingFiles + ' working', tone: 'warn' }
  }
  if (project.originBehind > 0 && project.originAhead > 0) {
    return { label: 'Both sides changed', tone: 'warn' }
  }
  if (project.originBehind > 0) return { label: 'Origin ahead', tone: 'accent' }
  if (project.state === 'diverged') {
    return { label: 'Both sides changed', tone: 'warn' }
  }
  if (project.detached || (project.branch && project.branch !== 'main')) {
    return { label: project.detached ? 'Detached' : project.branch, tone: 'warn' }
  }
  if (project.state === 'incoming') return { label: 'Update available', tone: 'accent' }
  if (project.state === 'customized' || project.different) return { label: 'Different', tone: 'accent' }
  if (project.state === 'adapted') return { label: 'Install-managed', tone: 'quiet' }
  if (project.state === 'local_only') return { label: 'No shared source', tone: 'warn' }
  return { label: 'Aligned', tone: 'ok' }
}

function fileCount(value) {
  const count = Number(value || 0)
  return count + (count === 1 ? ' file' : ' files')
}

function changeFacts(project) {
  const facts = []
  if (project.workingFiles > 0) facts.push(fileCount(project.workingFiles) + ' being edited')
  if (project.authoredFiles > 0) facts.push(fileCount(project.authoredFiles) + ' changed locally')
  if (project.originBehind > 0) {
    facts.push(project.originBehind + (project.originBehind === 1 ? ' shared update' : ' shared updates'))
  }
  return facts.join(' · ')
}

// The opening view uses this deliberately narrow summary. Aligned projects,
// installer-only adjustments, and ordinary active reviews already represented
// in the feed return null, keeping the overview silent when there is no useful
// local/upstream position to act on.
export function projectOverview(project) {
  if (!project || project.kind === 'external') return null
  if (project.builtHere) {
    return {
      label: 'Built here',
      detail: 'This app does not have a GitHub home yet',
      tone: 'accent',
    }
  }
  if (project.state === 'local_only') {
    return {
      label: 'No shared update source',
      detail: 'A GitHub repository exists, but there is no shared version to compare',
      tone: 'warn',
    }
  }
  if (project.state === 'conflict') {
    return {
      label: 'Changes need help',
      detail: changeFacts(project) || 'An update could not be combined safely',
      tone: 'danger',
    }
  }
  const bothChanged = project.state === 'diverged' || (
    project.originBehind > 0 && (project.originAhead > 0 || project.different || project.workingFiles > 0)
  )
  if (bothChanged) {
    return {
      label: 'Both versions changed',
      detail: changeFacts(project) || 'Your version and the shared version are different',
      tone: 'warn',
    }
  }
  if (project.workingFiles > 0) {
    return {
      label: 'Local edits in progress',
      detail: fileCount(project.workingFiles) + ' being edited',
      tone: 'warn',
    }
  }
  if (project.different || project.state === 'customized') {
    return {
      label: 'Local changes not shared',
      detail: project.authoredFiles > 0
        ? fileCount(project.authoredFiles) + ' differ from the shared version'
        : 'Your version differs from the shared version',
      tone: 'accent',
    }
  }
  if (project.originBehind > 0 || project.state === 'incoming') {
    return {
      label: 'Update available',
      detail: project.originBehind > 0
        ? project.originBehind + (project.originBehind === 1 ? ' shared update is ready' : ' shared updates are ready')
        : 'The shared version has moved ahead',
      tone: 'accent',
    }
  }
  if (project.detached) {
    return {
      label: 'Not on the main version',
      detail: project.head_sha ? 'At commit ' + project.head_sha.slice(0, 7) : 'Detached from a branch',
      tone: 'warn',
    }
  }
  if (project.branch && project.branch !== 'main') {
    return {
      label: 'On another version',
      detail: 'Currently on ' + project.branch,
      tone: 'warn',
    }
  }
  return null
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
  if (project.builtHere) {
    return {
      label: 'Ask agent to publish',
      event: 'publish_local_app',
      draft: `Help me publish the locally built app "${name}" to GitHub. Inspect the app first, then confirm the repository name and visibility with me before creating or pushing anything public.`,
    }
  }
  if (project.state === 'local_only') {
    return {
      label: 'Ask agent to review',
      event: 'review_missing_source',
      draft: `Inspect ${name}${repo}. It has a GitHub repository but no shared update source on this Möbius. Explain whether the source should be connected before making any changes.`,
    }
  }
  if (project.state === 'conflict' || project.state === 'diverged' || (
    project.originBehind > 0 && (project.different || project.workingFiles > 0)
  )) {
    return {
      label: 'Ask agent for help',
      event: 'resolve_source_state',
      draft: `Inspect ${name}${repo}. My local version and the shared version both have changes. Explain what differs and help me choose a safe next step without discarding local work.`,
    }
  }
  if (project.workingFiles > 0 || project.different || project.state === 'customized') {
    return {
      label: 'Ask agent to prepare',
      event: 'prepare_contribution',
      draft: `Inspect my local changes in ${name}${repo} and prepare an upstream contribution for them. Do not publish anything yet; stage it in Contribute so I can review it first.`,
    }
  }
  if (project.originBehind > 0 || project.state === 'incoming') {
    return {
      label: 'Ask agent about update',
      event: 'review_source_update',
      draft: `Review the available shared update for ${name}${repo}. Explain what changed and whether it is safe to update my local version before making any changes.`,
    }
  }
  if (project.detached || (project.branch && project.branch !== 'main')) {
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
