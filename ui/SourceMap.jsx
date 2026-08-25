import { useEffect, useMemo, useRef, useState } from 'react'
import {
  prepareProjectsAction,
  projectNeedsSorting,
  projectReadyToPrepare,
  projectDetailSummary,
  projectStatus,
  sourcePathRelationship,
} from '../source-map.js'
import { Icon } from './Icons.jsx'
import { AgentHandoffButton } from './BatchAction.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import UnifiedDiff from './diff/UnifiedDiff.jsx'

const FILTERS = [
  ['prepare', 'To prepare'],
  ['sorting', 'Needs sorting'],
  ['align', 'Needs alignment'],
  ['reviews', 'Reviews'],
  ['all', 'All projects'],
]

function projectMatchesJourney(project, filter) {
  if (filter === 'prepare') return projectReadyToPrepare(project)
  if (filter === 'sorting') return projectNeedsSorting(project)
  if (filter === 'align') return project.incomingFiles > 0 || project.compatibleFiles > 0 || project.conflictFiles > 0
  if (filter === 'reviews') return (project.contributions?.length || 0) > 0
  return true
}

function localWorkLabel(project, ending) {
  const committed = project.localFiles + project.compatibleFiles + project.conflictFiles
  const count = committed || project.workingFiles || project.authoredFiles
  return count > 0 ? `${count} local ${count === 1 ? 'difference' : 'differences'} ${ending}` : ending[0].toUpperCase() + ending.slice(1)
}

function projectNextStep(project, journey = 'all') {
  if (journey === 'prepare') return localWorkLabel(project, 'to prepare')
  if (journey === 'sorting') return localWorkLabel(project, 'to sort')
  if (journey === 'align') {
    if (project.conflictFiles > 0) return `${project.conflictFiles} need a choice`
    if (project.compatibleFiles > 0) return `${project.compatibleFiles} combine with shared work`
    return 'Shared update available'
  }
  if (journey === 'reviews') return `${project.contributions.length} active ${project.contributions.length === 1 ? 'review' : 'reviews'}`
  if (project.conflictFiles > 0) return `${project.conflictFiles} need a choice`
  if (project.workingFiles > 0) return `${project.workingFiles} being edited`
  if (project.localFiles > 0 || project.compatibleFiles > 0) {
    const total = project.localFiles + project.compatibleFiles
    return `${total} ${total === 1 ? 'change' : 'changes'} to prepare`
  }
  if (project.sourceComparisonRequired) return 'Compare before preparing'
  if (project.incomingFiles > 0) return 'Shared update available'
  if ((project.contributions?.length || 0) > 0) return `${project.contributions.length} active ${project.contributions.length === 1 ? 'review' : 'reviews'}`
  if (project.builtHere) return 'Publish when ready'
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

function ProjectReviews({ project, onViewReviews }) {
  const rows = project.contributions || []
  if (!rows.length) return null
  return (
    <section className="co-project-reviews">
      <header><strong>Pull requests</strong><button type="button" onClick={onViewReviews}>Open reviews <Icon name="right" size={14} /></button></header>
      {rows.slice(0, 4).map((rec) => (
        <button type="button" key={rec.id} onClick={onViewReviews}>
          <span>{rec.plan?.title || rec.title || 'Untitled pull request'}</span>
          <small>{rec.status === 'prepared' ? 'Prepared' : rec.status === 'open' ? 'Open' : rec.status}</small>
        </button>
      ))}
    </section>
  )
}

function ProjectDetail({ project, journey, loadProjectDiff, onRefresh, onStartAgent, onViewReviews }) {
  const status = projectStatus(project)
  const reviews = project.contributions?.length || 0
  const prepareAction = prepareProjectsAction([project])
  const detailAction = prepareAction && projectNeedsSorting(project)
    ? { ...prepareAction, label: 'Sort & prepare', title: `Sort ${project.name} changes` }
    : prepareAction
      ? { ...prepareAction, label: 'Prepare for review' }
      : null
  return (
    <article className="co-source-detail">
      <header className="co-source-detail-head">
        <div className="co-source-detail-title"><ProjectGlyph project={project} /><div><h3>{project.name}</h3></div></div>
        <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
      </header>
      <div className="co-project-next">
        <span><strong>{projectNextStep(project, journey)}</strong></span>
        {detailAction ? (
          <AgentHandoffButton action={detailAction} onStart={onStartAgent} icon="review" />
        ) : reviews ? (
          <button type="button" className="co-btn co-btn-primary co-btn-sm" onClick={onViewReviews}>
            <Icon name="review" size={14} /> Open reviews
          </button>
        ) : null}
      </div>
      <p className="co-source-overview-copy">{projectDetailSummary(project)}</p>
      <ProjectReviews project={project} onViewReviews={onViewReviews} />
      <ProjectFileChanges project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
      <ProjectPosition project={project} />
      {project.kind !== 'external' && !project.available && project.state !== 'local_only' ? <div className="co-source-unavailable">No inspectable local source is available.</div> : null}
    </article>
  )
}

function ProjectRow({ project, journey, selected, onSelect }) {
  const status = projectStatus(project)
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '')}>
      <button type="button" className="co-source-row" onClick={() => onSelect(project.key)} aria-expanded={selected}>
        <ProjectGlyph project={project} />
        <span className="co-source-row-id"><strong>{project.name}</strong></span>
        <span className="co-source-row-facts">{projectNextStep(project, journey)}</span>
        <span className={'co-source-dot tone-' + status.tone} title={status.label} />
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
  return <div className="co-source-loading" role="status"><span className="ma-spinner" aria-hidden="true" /><div><strong>Checking projects…</strong><span>Comparing accepted source and active reviews.</span></div></div>
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
  onStartAgent,
  onViewReviews,
}) {
  const [filter, setFilter] = useState(() => focusKey ? 'all' : 'prepare')
  const filtered = useMemo(
    () => projects.filter((project) => projectMatchesJourney(project, filter)),
    [projects, filter],
  )
  const filterCounts = useMemo(
    () => Object.fromEntries(FILTERS.map(([key]) => [
      key,
      projects.filter((project) => projectMatchesJourney(project, key)).length,
    ])),
    [projects],
  )
  const [selected, setSelected] = useState(() => focusKey || '')
  const listScrollRef = useRef(0)
  const pageScroller = () => document.querySelector('.co-page')

  function openProject(key) {
    listScrollRef.current = pageScroller()?.scrollTop || 0
    setSelected(key)
    requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
  }

  function closeProject() {
    setSelected('')
    requestAnimationFrame(() => pageScroller()?.scrollTo({
      top: listScrollRef.current,
      left: 0,
    }))
  }

  useEffect(() => {
    if (selected && !filtered.some((project) => project.key === selected)) {
      setSelected('')
    }
  }, [filtered, selected])

  const selectedProject = selected
    ? filtered.find((project) => project.key === selected) || null
    : null
  const builtHere = filtered.filter((project) => project.builtHere)
  const tracked = filtered.filter((project) => !project.builtHere)
  const copy = {
    prepare: {
      title: 'Ready to prepare',
      description: 'Reusable local work that can move into private review.',
    },
    sorting: {
      title: 'Needs sorting',
      description: 'Local work that needs context before it can become a contribution.',
    },
    align: {
      title: 'Needs alignment',
      description: 'Projects where shared work and your local version need to come together.',
    },
    reviews: {
      title: 'Active reviews',
      description: 'Projects with contributions already moving through review.',
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
          : 'Contribute could not read local source status. Your inbox is unaffected.'}</p>
        <button type="button" className="co-btn co-btn-sm" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  return (
    <section id="co-panel-sources" className={'co-projects-view' + (selectedProject ? ' is-focus' : '')} role="tabpanel" aria-labelledby="co-tab-sources">
      {selectedProject ? <h2 className="co-visually-hidden">Project detail</h2> : (
        <header className="co-view-heading">
          <div>
            <h2>Projects</h2>
            <p>See what can move, what needs context, and what should stay local.</p>
          </div>
          <button
            type="button"
            className="co-quiet-action"
            onClick={onRetry}
            disabled={loading}
          >
            <Icon name="refresh" size={15} />
            {loading ? 'Checking…' : 'Check projects'}
          </button>
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
          <nav className="co-lens-nav" aria-label="Project views">
            {FILTERS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={filter === key ? 'is-active' : ''}
                aria-pressed={filter === key}
                onClick={() => { setFilter(key); setSelected('') }}
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
              <Icon name="check" size={20} />
              <strong>Nothing here</strong>
              <span>This project stage is clear.</span>
            </div>
          ) : (
            <div className="co-project-index">
              <ProjectGroup
                label={builtHere.length ? 'Platform and installed apps' : ''}
                projects={tracked}
                journey={filter}
                selectedKey=""
                onSelect={openProject}
              />
              <ProjectGroup
                label="Built here"
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
            onStartAgent={onStartAgent}
            onViewReviews={onViewReviews}
          />
        </div>
      )}
    </section>
  )
}
