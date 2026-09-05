import { useEffect, useMemo, useRef, useState } from 'react'
import {
  projectNeedsSorting,
  projectReadyToPrepare,
  projectDetailSummary,
  projectStatus,
  sourcePathRelationship,
} from '../source-map.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import UnifiedDiff from './diff/UnifiedDiff.jsx'

const FILTERS = [
  ['local', 'Local work'],
  ['all', 'All projects'],
]

function projectMatchesJourney(project, filter) {
  if (filter === 'local') return !!(
    projectReadyToPrepare(project)
    || projectNeedsSorting(project)
  )
  return true
}

function projectContributionCountLabel(project) {
  const pullRequests = Number(project?.contributionCounts?.pullRequests || 0)
  const issues = Number(project?.contributionCounts?.issues || 0)
  return `${pullRequests} ${pullRequests === 1 ? 'pull request' : 'pull requests'} · ${issues} ${issues === 1 ? 'issue' : 'issues'}`
}

function localWorkLabel(project, ending) {
  const committed = project.localFiles + project.compatibleFiles + project.conflictFiles
  const count = committed || project.workingFiles || project.authoredFiles
  return count > 0 ? `${count} local ${count === 1 ? 'difference' : 'differences'} ${ending}` : ending[0].toUpperCase() + ending.slice(1)
}

function projectNextStep(project, journey = 'all') {
  if (project.builtHere) return 'Local app · no upstream repository'
  if (projectReadyToPrepare(project)) return localWorkLabel(project, 'ready to prepare')
  if (projectNeedsSorting(project)) return localWorkLabel(project, 'need sorting')
  if (project.conflictFiles > 0) return `${project.conflictFiles} need a choice`
  if (project.workingFiles > 0) return `${project.workingFiles} being edited`
  if (project.localFiles > 0 || project.compatibleFiles > 0) {
    const total = project.localFiles + project.compatibleFiles
    return `${total} ${total === 1 ? 'change' : 'changes'} to prepare`
  }
  if (project.incomingFiles > 0) return 'Shared update available'
  const activeRequests = (project.contributions?.length || 0) + (project.issues?.length || 0)
  if (activeRequests > 0) return `${activeRequests} active ${activeRequests === 1 ? 'request' : 'requests'}`
  return 'Up to date'
}

function shortCommit(value) {
  return typeof value === 'string' && value ? value.slice(0, 7) : 'Unavailable'
}

function ProjectPosition({ project }) {
  const installedRelease = project.kind === 'app' && project.base_ref === 'upstream'
  const comparisonRef = project.comparison_ref || project.base_ref
  const comparisonSha = project.comparison_sha || project.base_sha
  const comparesWithRelease = installedRelease && comparisonRef === project.base_ref
  return (
    <details className="co-position-details">
      <summary><span>Technical details</span><Icon name="chevron" size={15} /></summary>
      <dl>
        <div><dt>Your branch</dt><dd><code>{project.detached ? 'Detached' : project.branch || 'Unknown'}</code></dd></div>
        <div><dt>Your commit</dt><dd><code>{shortCommit(project.head_sha)}</code></dd></div>
        {project.state !== 'local_only' ? (
          <>
            <div><dt>Compared with</dt><dd><code>{comparesWithRelease ? `installed release (${comparisonRef})` : comparisonRef || 'Not configured'}</code></dd></div>
            <div><dt>{comparesWithRelease ? 'Release commit' : 'Shared commit'}</dt><dd><code>{shortCommit(comparisonSha)}</code></dd></div>
          </>
        ) : null}
        {project.canonical_repo ? <div><dt>Repository</dt><dd><code>{project.canonical_repo}</code></dd></div> : null}
      </dl>
    </details>
  )
}

function ProjectGlyph({ project }) {
  return <ProjectIcon project={project} className="co-source-glyph" />
}

function fileStateLabel(group) {
  if (group === 'conflict') return 'Conflict'
  if (group === 'untracked') return 'New'
  if (group === 'staged') return 'Staged'
  if (group === 'local') return 'Local'
  if (group === 'incoming') return 'Incoming'
  if (group === 'compatible') return 'Both · combines'
  if (group === 'changed') return 'Differs'
  return 'Editing'
}

function projectFileRows(project) {
  const files = new Map()
  for (const file of project.comparisonTree?.paths || []) {
    if (file.group !== 'managed') files.set(file.path, { ...file })
  }
  for (const file of project.working?.paths || []) {
    files.set(file.path, { ...(files.get(file.path) || {}), ...file, working: true })
  }
  return [...files.values()].sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1
    return a.path.localeCompare(b.path)
  })
}

function fileSummary(project, rows) {
  const parts = []
  if (project.localFiles) parts.push(`${project.localFiles} local`)
  if (project.incomingFiles) parts.push(`${project.incomingFiles} incoming`)
  if (project.conflictFiles) parts.push(`${project.conflictFiles} need a choice`)
  if (project.workingFiles) parts.push(`${project.workingFiles} editing`)
  return parts.join(' · ') || `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`
}

function ProjectFileChanges({ project, loadProjectDiff, onRefresh }) {
  const rows = projectFileRows(project)
  const [state, setState] = useState({ phase: 'idle', data: null })
  useEffect(() => {
    setState({ phase: 'idle', data: null })
  }, [project.head_sha])
  if (!rows.length) return null

  async function load() {
    if (state.phase === 'loading') return
    setState({ phase: 'loading', data: null })
    const result = await loadProjectDiff?.(project)
    if (result?.ok) setState({ phase: 'ready', data: result.data })
    else setState({ phase: result?.stale ? 'stale' : 'error', data: null })
  }

  const preview = rows.slice(0, 4)

  return (
    <section className="co-project-files">
      <header><span>File changes</span><small>{fileSummary(project, rows)}</small></header>
      {state.phase === 'ready' ? (
        <UnifiedDiff
          diff={state.data?.diff}
          diffTruncated={state.data?.diff_truncated === true}
        />
      ) : (
        <div className="co-project-file-list">
          {preview.map((file) => {
            const relationship = file.working ? file.group : sourcePathRelationship(project, file.path)
            return (
              <div className="co-project-file" key={file.path} title={file.path}>
                <code>{file.path}</code>
                <span className="co-project-file-meta"><i className={'is-' + relationship}>{fileStateLabel(relationship)}</i></span>
              </div>
            )
          })}
          {rows.length > preview.length ? <p>+{rows.length - preview.length} more files</p> : null}
        </div>
      )}
      {state.phase !== 'ready' ? (
        <button
          type="button"
          className="co-project-files-toggle"
          onClick={state.phase === 'stale' ? onRefresh : load}
          disabled={state.phase === 'loading'}
        >
          {state.phase === 'loading' ? 'Loading diff…' : state.phase === 'stale' ? 'Project changed · check again' : state.phase === 'error' ? 'Try diff again' : 'Review file diffs'}
          <Icon name="chevron" size={15} />
        </button>
      ) : null}
    </section>
  )
}

function ProjectRequests({ title, emptyLabel, rows, onViewReview, projectKey }) {
  if (!rows.length) return null
  return (
    <section className="co-project-reviews">
      <header><strong>{title}</strong><small>{rows.length}</small></header>
      {rows.map((rec) => (
        <button type="button" key={rec.id} onClick={() => onViewReview(rec, projectKey)}>
          <span>{rec.plan?.title || rec.title || emptyLabel}</span>
          <small>{rec.status === 'prepared' ? 'Prepared' : rec.status === 'open' ? 'Open' : rec.status}</small>
        </button>
      ))}
    </section>
  )
}

function ProjectPreparationAction({ project, onPrepareProject }) {
  const [state, setState] = useState({ phase: 'idle', message: '' })
  const needsSorting = projectNeedsSorting(project)
  const ready = projectReadyToPrepare(project)
  if ((!needsSorting && !ready) || typeof onPrepareProject !== 'function') return null

  const hasOverlap = project.conflictFiles > 0 || project.compatibleFiles > 0
  const title = hasOverlap
    ? 'Resolve the overlap and prepare what remains'
    : needsSorting
      ? 'Compare and prepare this work'
      : 'Prepare these changes'
  const detail = hasOverlap
    ? 'Your local version stays in place while both versions are compared. Only the changes you keep move into review.'
    : needsSorting
      ? 'Contribute will classify the local and shared work, then bring back one reviewed proposal.'
      : 'Contribute can prepare this local work for private review now.'
  const label = hasOverlap
    ? 'Resolve and prepare'
    : needsSorting
      ? 'Compare and prepare'
      : 'Prepare changes'

  async function prepare() {
    if (state.phase === 'starting' || state.phase === 'started') return
    setState({ phase: 'starting', message: '' })
    const outcome = await onPrepareProject(project)
    if (outcome?.ok) {
      setState({
        phase: 'started',
        message: 'Working here in the background. This project will refresh when its reviewed proposal is ready.',
      })
    } else {
      setState({
        phase: 'error',
        message: outcome?.error || 'Could not start this preparation. Try again.',
      })
    }
  }

  return (
    <section className="co-project-next-action">
      <div><strong>{title}</strong><p>{detail}</p></div>
      <button
        type="button"
        className="co-btn co-btn-primary"
        disabled={state.phase === 'starting' || state.phase === 'started'}
        onClick={prepare}
      >
        {state.phase === 'starting' ? 'Starting…' : state.phase === 'started' ? 'Preparing…' : label}
      </button>
      {state.message ? (
        <small role={state.phase === 'error' ? 'alert' : 'status'}>{state.message}</small>
      ) : null}
    </section>
  )
}

function ProjectDetail({
  project,
  journey,
  loadProjectDiff,
  onRefresh,
  onViewReview,
  onPrepareProject,
}) {
  const status = projectStatus(project)
  return (
    <article className="co-source-detail">
      <header className="co-source-detail-head">
        <div className="co-source-detail-title"><ProjectGlyph project={project} /><div><h3>{project.name}</h3></div></div>
        <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
      </header>
      <div className="co-project-next">
        <span><strong>{projectNextStep(project, journey)}</strong></span>
      </div>
      <p className="co-source-overview-copy">{projectDetailSummary(project)}</p>
      <ProjectPreparationAction project={project} onPrepareProject={onPrepareProject} />
      <div className="co-project-request-summary" aria-label="Active GitHub work">
        <span>{projectContributionCountLabel(project)}</span>
      </div>
      <ProjectRequests
        title="Pull requests"
        emptyLabel="Untitled pull request"
        rows={project.contributions || []}
        onViewReview={onViewReview}
        projectKey={project.key}
      />
      <ProjectRequests
        title="Issues"
        emptyLabel="Untitled issue"
        rows={project.issues || []}
        onViewReview={onViewReview}
        projectKey={project.key}
      />
      <ProjectFileChanges project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
      <ProjectPosition project={project} />
      {project.kind !== 'external' && !project.available && project.state !== 'local_only' ? <div className="co-source-unavailable">No inspectable local source is available.</div> : null}
    </article>
  )
}

function ProjectRow({ project, journey, selected, onSelect }) {
  const status = projectStatus(project)
  const next = projectNextStep(project, journey)
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '')}>
      <button
        type="button"
        className="co-source-row"
        onClick={() => onSelect(project.key)}
        aria-expanded={selected}
        aria-label={`Open ${project.name}: ${next}`}
      >
        <ProjectGlyph project={project} />
        <span className="co-source-row-id"><strong>{project.name}</strong></span>
        <span className="co-source-row-facts">
          <span>{next}</span>
          <small>{projectContributionCountLabel(project)}</small>
        </span>
        <span className="co-source-row-cue" aria-hidden="true">
          <small className={'tone-' + status.tone}>{status.label}</small>
          <Icon name="right" size={15} />
        </span>
      </button>
    </div>
  )
}

function ProjectGroup({ label, projects, journey, selectedKey, onSelect }) {
  if (!projects.length) return null
  return (
    <div className="co-source-group">
      {label ? <div className="co-source-group-label">{label}</div> : null}
      {projects.map((project) => <ProjectRow key={project.key} project={project} journey={journey} selected={project.key === selectedKey} onSelect={onSelect} />)}
    </div>
  )
}

function LoadingState() {
  return <div className="co-source-loading" role="status"><span className="ma-spinner" aria-hidden="true" /><div><strong>Checking projects…</strong><span>Comparing local, shared, and prepared work.</span></div></div>
}

export function SourceMap({
  snapshot,
  projects,
  focusKey,
  conn,
  loading,
  error,
  onRetry,
  loadProjectDiff,
  onViewReview,
  onPrepareProject,
}) {
  const [filter, setFilter] = useState(() => focusKey ? 'all' : 'local')
  const [query, setQuery] = useState('')
  const filtered = useMemo(
    () => projects.filter((project) => (
      projectMatchesJourney(project, filter)
      && (!query.trim() || [project.name, project.key, project.canonical_repo]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query.trim().toLowerCase())))
    )),
    [projects, filter, query],
  )
  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [
      key,
      projects.filter((project) => projectMatchesJourney(project, key)).length,
    ])),
    [projects],
  )
  const [selected, setSelected] = useState('')
  const listScrollRef = useRef(0)
  const projectNavRef = useRef(null)
  const handledFocusRef = useRef('')
  const pageScroller = () => document.querySelector('.co-page')

  function showProject(key) {
    listScrollRef.current = pageScroller()?.scrollTop || 0
    setSelected(key)
    requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
  }

  async function openProject(key) {
    if (!key || selected === key) return
    if (!window.mobius?.nav?.open) {
      showProject(key)
      return
    }
    let handle = null
    handle = window.mobius.nav.open('contribute-project', {
      onBack: () => {
        if (projectNavRef.current !== handle) return
        projectNavRef.current = null
        setSelected('')
        requestAnimationFrame(() => pageScroller()?.scrollTo({
          top: listScrollRef.current,
          left: 0,
        }))
      },
      onForward: () => {
        projectNavRef.current = handle
        setSelected(key)
        requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
      },
    })
    projectNavRef.current = handle
    const outcome = await handle.outcome
    if (projectNavRef.current !== handle) {
      handle.close()
      return
    }
    if (!['owned', 'standalone'].includes(outcome?.status)) {
      projectNavRef.current = null
      return
    }
    showProject(key)
  }

  function closeProject() {
    const handle = projectNavRef.current
    projectNavRef.current = null
    try { handle?.close?.() } catch {}
    setSelected('')
    requestAnimationFrame(() => pageScroller()?.scrollTo({
      top: listScrollRef.current,
      left: 0,
    }))
  }

  useEffect(() => () => {
    try { projectNavRef.current?.close?.() } catch {}
    projectNavRef.current = null
  }, [])

  useEffect(() => {
    if (!focusKey || handledFocusRef.current === focusKey) return
    if (!projects.some((project) => project.key === focusKey)) return
    handledFocusRef.current = focusKey
    setFilter('all')
    void openProject(focusKey)
  }, [focusKey, projects])

  useEffect(() => {
    if (selected && !filtered.some((project) => project.key === selected)) {
      closeProject()
    }
  }, [filtered, selected])

  const selectedProject = selected
    ? filtered.find((project) => project.key === selected) || null
    : null
  const builtHere = filtered.filter((project) => project.builtHere)
  const tracked = filtered.filter((project) => !project.builtHere)
  const copy = {
    local: {
      title: 'Local work not yet resolved upstream',
      description: 'These projects contain local work that still needs preparing or sorting. Open a row to see the files and any existing pull requests.',
    },
    all: {
      title: 'All projects',
      description: 'Every project Contribute can currently inspect.',
    },
  }[filter]

  if (loading && !snapshot) return <LoadingState />
  if (error && !snapshot) {
    return (
      <div className="co-source-error">
        <strong>{error === 'restart' ? 'Restart to finish Projects' : 'Projects unavailable'}</strong>
        <p>{error === 'restart'
          ? 'The source review service starts after the next Möbius restart.'
          : 'Contribute could not read local source status. Your contribution run is unaffected.'}</p>
        <button type="button" className="co-btn co-btn-sm" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  return (
    <section className={'co-projects-view' + (selectedProject ? ' is-focus' : '')} aria-label="Project details">
      {selectedProject ? <h2 className="co-visually-hidden">Project detail</h2> : (
        <header className="co-view-heading">
          <div>
            <h2>Projects</h2>
            <p>Start with local work that is not yet resolved upstream. Open any row for its files, pull requests, and next step.</p>
          </div>
          <div className="co-project-view-actions">
            <button
              type="button"
              className="co-quiet-action"
              onClick={onRetry}
              disabled={loading}
            >
              <Icon name="refresh" size={15} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>
      )}

      {['disconnected', 'unknown', 'unsupported'].includes(conn?.state) ? (
        <div className="co-view-note">Local positions are current; GitHub review states may be older.</div>
      ) : null}
      {error && snapshot ? (
        <div className="co-view-warning" role="status">Refresh failed—keeping the last project snapshot.</div>
      ) : null}

      {!selectedProject ? (
        <>
          <label className="co-project-search">
            <span className="co-visually-hidden">Find a project</span>
            <input
              type="search"
              value={query}
              placeholder="Find a project"
              onChange={(event) => {
                const value = event.target.value
                setQuery(value)
                if (value.trim()) setFilter('all')
              }}
            />
          </label>
          <nav className="co-lens-nav" aria-label="Project views">
            {FILTERS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={filter === key ? 'is-active' : ''}
                aria-pressed={filter === key}
                onClick={() => { setFilter(key); closeProject() }}
              >
                <span>{label}</span><b>{filterCounts[key]}</b>
              </button>
            ))}
          </nav>

          <section className="co-stage-intro" aria-labelledby="co-project-stage-title">
            <div>
              <h3 id="co-project-stage-title">{copy.title}</h3>
              <p>{copy.description}</p>
            </div>
          </section>

          {filtered.length === 0 ? (
            <div className="co-stage-empty">
              <Icon name={query.trim() ? 'review' : 'check'} size={20} />
              <strong>{query.trim() ? 'No matching project' : 'Nothing here'}</strong>
              <span>{query.trim() ? 'Try a project name or repository.' : 'This project stage is clear.'}</span>
            </div>
          ) : (
            <div className="co-project-index">
              <ProjectGroup
                label={builtHere.length ? 'Tracked upstream' : ''}
                projects={tracked}
                journey={filter}
                selectedKey=""
                onSelect={openProject}
              />
              <ProjectGroup
                label="Local apps without an upstream repository"
                projects={builtHere}
                journey={filter}
                selectedKey=""
                onSelect={openProject}
              />
            </div>
          )}
        </>
      ) : (
        <div className="co-focus-view">
          <button type="button" className="co-focus-back" onClick={closeProject}>
            <Icon name="left" size={15} /> Back to {copy.title.toLowerCase()}
          </button>
          <ProjectDetail
            key={`${selectedProject.key}:${snapshot?.generated_at || ''}`}
            project={selectedProject}
            journey={filter}
            loadProjectDiff={loadProjectDiff}
            onRefresh={onRetry}
            onViewReview={onViewReview}
            onPrepareProject={onPrepareProject}
          />
        </div>
      )}
    </section>
  )
}
