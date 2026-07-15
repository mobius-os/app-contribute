// Pure Sources-view logic: correlate local repositories with active ledger
// records, derive attention/filter state, and format relationship labels.
// React and I/O stay in ui/SourceMap.jsx + api.js so these rules are cheap to
// exercise under node:test.

const ACTIVE = new Set(['prepared', 'submitting', 'draft', 'open'])

function repoKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function activeContribution(rec) {
  return !!rec && ACTIVE.has(rec.status)
}

export function recordBranch(rec) {
  return rec?.branch || rec?.plan?.branch || ''
}

export function attachSourceProjects(snapshot, records) {
  const base = []
  if (snapshot?.platform) base.push(snapshot.platform)
  if (Array.isArray(snapshot?.apps)) base.push(...snapshot.apps)
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
  const different = Number(project?.tree?.files || 0) > 0
  const contributionAttention = contributions.some((rec) => rec.needs_attention)
  const attention = (
    project?.state === 'conflict' ||
    project?.state === 'diverged' ||
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
    workingFiles,
    attention,
  }
}

export function sourceSummary(projects) {
  return (projects || []).reduce((out, project) => {
    out.sources += 1
    out.different += Number(project.different)
    out.working += Number(project.workingFiles || 0)
    out.active += project.contributions?.length || 0
    out.attention += Number(project.attention)
    return out
  }, { sources: 0, different: 0, working: 0, active: 0, attention: 0 })
}

export function projectMatchesFilter(project, filter) {
  if (filter === 'attention') return project.attention
  if (filter === 'different') return project.different
  if (filter === 'working') return project.workingFiles > 0
  if (filter === 'prs') return project.contributions.length > 0
  if (filter === 'aligned') return project.state === 'aligned'
  return true
}

export function projectStatus(project) {
  if (project.kind === 'external') return { label: 'Contribution only', tone: 'quiet' }
  if (!project.available) return { label: 'Not tracked', tone: 'quiet' }
  if (project.state === 'conflict') return { label: 'Update conflict', tone: 'danger' }
  if (project.contributions.some((rec) => rec.needs_attention)) {
    return { label: 'Needs attention', tone: 'danger' }
  }
  if (project.workingFiles > 0) {
    return { label: project.workingFiles + ' working', tone: 'warn' }
  }
  if (project.state === 'diverged') {
    return { label: 'Both sides changed', tone: 'warn' }
  }
  if (project.detached || (project.branch && project.branch !== 'main')) {
    return { label: project.detached ? 'Detached' : project.branch, tone: 'warn' }
  }
  if (project.state === 'incoming') return { label: 'Update available', tone: 'accent' }
  if (project.state === 'customized') return { label: 'Different', tone: 'accent' }
  if (project.state === 'local_only') return { label: 'Local only', tone: 'quiet' }
  return { label: 'Aligned', tone: 'ok' }
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
  if (!tree.files) return 'Source trees match'
  const files = tree.files + (tree.files === 1 ? ' file differs' : ' files differ')
  return files + ' · +' + tree.insertions + ' −' + tree.deletions
}
