import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  projectNeedsSorting,
  projectReadyToPrepare,
  projectBoardFacts,
  sourcePathRelationship,
} from '../source-map.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import UnifiedDiff from './diff/UnifiedDiff.jsx'
import { TaskContext, TaskPane } from './TaskPane.jsx'

const FILTERS = [
  ['all', 'All'],
  ['local', 'Changes'],
  ['updates', 'Updates'],
]

function projectMatchesJourney(project, filter) {
  if (filter === 'local') return !!(
    projectReadyToPrepare(project)
    || projectNeedsSorting(project)
  )
  if (filter === 'updates') return project.incomingFiles > 0 || project.originBehind > 0 || project.sourceComparisonRequired || project.conflictFiles > 0
  return true
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
      <summary><span>Branch and version</span><Icon name="chevron" size={15} /></summary>
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

function ProjectDetail({
  project,
  loadProjectDiff,
  onRefresh,
  renderActivity,
  navigation,
  renderControls,
  sourceRevision,
}) {
  const [cycle, setCycle] = useState(null)
  const [publicKeys, setPublicKeys] = useState(new Set())
  const projectView = useRef(null)
  const pendingScroll = useRef(null)
  const facts = projectBoardFacts(project)
  const activeId = navigation.selectedId || ''
  function preservingScroll(change) {
    const page = projectView.current?.closest('.co-page')
    if (page) pendingScroll.current = { page, top: page.scrollTop }
    change()
  }
  useLayoutEffect(() => {
    const saved = pendingScroll.current
    if (!saved) return
    saved.page.scrollTop = saved.top
    pendingScroll.current = null
  }, [activeId])
  const task = {
    cycle, setCycle, publicKeys, setPublicKeys, activeId,
    explicit: !!navigation.selectedId,
    open: id => preservingScroll(() => navigation.onSelect(id)),
    close: () => preservingScroll(navigation.onBack),
  }
  const canUpdate = project.available && project.canonical_repo && project.kind !== 'external'
  return (
    <TaskContext.Provider value={task}>
      <article ref={projectView} className="co-workspace">
        <header className="co-workspace-head">
          <div className="co-workspace-title"><ProjectGlyph project={project} /><div>
            <div className="co-workspace-name-row"><h2>{project.name}</h2>
              {canUpdate ? <button className="co-icon-action" aria-label={`Check for updates. ${facts.shared}`} title="Check for updates" onClick={() => task.open('task:update')}><Icon name="refresh" size={17} /></button> : null}
            </div>
            <p><span>{project.canonical_repo || 'Only on your Möbius'}{project.viewerPermission ? ` · ${['ADMIN', 'MAINTAIN', 'WRITE'].includes(project.viewerPermission) ? 'Maintainer' : 'Contributor'}` : ''}</span>
              {project.viewerPermission === 'ADMIN' ? <a className="co-workspace-access" href={`https://github.com/${project.canonical_repo}/settings/access`} target="_blank" rel="noopener noreferrer">People &amp; access</a> : null}
            </p>
          </div></div>
        </header>
        <div className="co-workspace-body">
          <div className="co-workspace-inventory">
            {renderControls?.(project)}
            {renderActivity?.(project, navigation)}
          </div>
        </div>
        <TaskPane id="task:files">
          <h3>Files, branch and versions</h3>
          <p>See changed files and the exact versions being compared. Most work doesn’t need this view.</p>
          <ProjectFileChanges key={sourceRevision} project={project} loadProjectDiff={loadProjectDiff} onRefresh={onRefresh} />
          <ProjectPosition project={project} />
          {!project.available ? <p>No inspectable local source is available.</p> : null}
        </TaskPane>
      </article>
    </TaskContext.Provider>
  )
}

function ProjectRow({ project, selected, onSelect }) {
  const facts = projectBoardFacts(project)
  const next = `${facts.work}; ${facts.shared}`
  const incomingReviews = project.incomingReviews?.length || 0
  const visibleWork = incomingReviews ? facts.work.replace(/(?: · )?\d+ in review$/, '') : facts.work
  const showShared = !!(
    project.conflictFiles
    || project.state === 'conflict'
    || project.incomingFiles
    || project.originBehind
    || project.sourceComparisonRequired
    || !project.available
    || (!project.builtHere && project.kind !== 'external' && project.canonical_repo && !project.origin?.sha && !project.base_sha)
  )
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '')}>
      <button
        type="button"
        className="co-source-row"
        onClick={() => {
          if (window.getSelection?.()?.toString().trim()) return
          onSelect(project.key)
        }}
        aria-expanded={selected}
        aria-label={`Open ${project.name}: ${next}`}
      >
        <ProjectGlyph project={project} />
        <span className="co-source-row-id"><strong>{project.name}</strong></span>
        <span className="co-source-row-facts">
          {visibleWork ? <span>{visibleWork}</span> : null}
          {showShared ? <span className="co-source-shared">{facts.shared}</span> : null}
          {incomingReviews ? <span className="co-source-attention">{incomingReviews} incoming {incomingReviews === 1 ? 'review' : 'reviews'}</span> : null}
        </span>
        <span className="co-source-row-cue" aria-hidden="true">

          <Icon name="right" size={15} />
        </span>
      </button>
    </div>
  )
}

function ProjectGroup({ label, projects, selectedKey, onSelect }) {
  if (!projects.length) return null
  return (
    <div className="co-source-group">
      {label ? <div className="co-source-group-label">{label}</div> : null}
      {projects.map((project) => <ProjectRow key={project.key} project={project} selected={project.key === selectedKey} onSelect={onSelect} />)}
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
  renderActivity,
  renderControls,
  repositoryPicker,
  onProjectOpenChange,
}) {
  const [manualRefresh, setManualRefresh] = useState('idle')
  const [filter, setFilter] = useState('all')
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
      projects.filter((project) => project.kind !== 'external' && projectMatchesJourney(project, key)).length,
    ])),
    [projects],
  )
  const [selected, setSelected] = useState('')
  const listScrollRef = useRef(0)
  const projectNavRef = useRef(null)
  const handledFocusRef = useRef('')
  const [selectedWorkId, setSelectedWorkId] = useState('')
  const workTriggerRef = useRef(null)
  const [navigationError, setNavigationError] = useState('')
  const pageScroller = () => document.querySelector('.co-page')

  async function refreshProjects() {
    if (loading || manualRefresh === 'running') return
    setManualRefresh('running')
    try {
      const ok = await onRetry?.()
      setManualRefresh(ok ? 'done' : 'failed')
    } catch {
      setManualRefresh('failed')
    }
  }

  function closeWork() {
    setSelectedWorkId('')
    requestAnimationFrame(() => workTriggerRef.current?.isConnected && workTriggerRef.current.focus({ preventScroll: true }))
  }

  function openWork(itemId) {
    if (!itemId || itemId === selectedWorkId) return
    if (!document.activeElement?.closest('.co-task-content')) workTriggerRef.current = document.activeElement
    setSelectedWorkId(itemId)
  }
  const activityNavigation = { selectedId: selectedWorkId, onSelect: openWork, onBack: closeWork }

  function showProject(key) {
    listScrollRef.current = pageScroller()?.scrollTop || 0
    setSelected(key)
    requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
  }

  async function openProject(key) {
    if (!key || selected === key) return
    setNavigationError('')
    closeWork()
    if (projectNavRef.current) closeProject()
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
    if (outcome?.status !== 'owned') {
      projectNavRef.current = null
      setNavigationError('Could not open this project. Try again.')
      return
    }
    showProject(key)
  }

  function closeProject() {
    closeWork()
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
    if (!focusKey?.nonce || handledFocusRef.current === focusKey.nonce) return
    if (focusKey.key && !projects.some(project => project.key === focusKey.key)) return
    handledFocusRef.current = focusKey.nonce
    if (!focusKey.key) { closeProject(); return }
    setFilter('all')
    void openProject(focusKey.key)
  }, [focusKey, projects])

  const selectedProject = selected
    ? projects.find((project) => project.key === selected) || null
    : null
  useEffect(() => { onProjectOpenChange?.(!!selectedProject) }, [selectedProject, onProjectOpenChange])
  const builtHere = filtered.filter((project) => project.builtHere)
  const tracked = filtered.filter((project) => !project.builtHere && project.kind !== 'external')
  const external = filtered.filter((project) => project.kind === 'external')
  const externalQuestions = external.reduce((count, project) => count + (project.incomingReviews?.length || 0), 0)
  if (loading && !snapshot && !projects.length) return <LoadingState />
  return (
    <section className={'co-projects-view' + (selectedProject ? ' is-focus' : '')} aria-label="Project details">
      {selectedProject ? <h2 className="co-visually-hidden">Project detail</h2> : (
        <header className="co-view-heading">
          <div>
            <h2>Your projects</h2>
          </div>
          <div className="co-project-view-actions">
            {repositoryPicker}
            <button
              type="button"
              className="co-icon-action"
              aria-label={loading || manualRefresh === 'running' ? 'Refreshing projects' : manualRefresh === 'done' ? 'Projects updated just now' : manualRefresh === 'failed' ? 'Try refreshing projects again' : 'Refresh projects'}
              title={manualRefresh === 'failed' ? 'Try refreshing projects again' : 'Refresh projects'}
              onClick={refreshProjects}
              disabled={loading || manualRefresh === 'running'}
            >
              <Icon name={manualRefresh === 'done' ? 'check' : 'refresh'} size={15} />
              <span className="co-visually-hidden">{loading || manualRefresh === 'running' ? 'Refreshing…' : manualRefresh === 'done' ? 'Updated just now' : manualRefresh === 'failed' ? 'Try refresh again' : 'Refresh projects'}</span>
            </button>
          </div>
        </header>
      )}

      {navigationError ? <p className="co-run-error" role="alert">{navigationError}</p> : null}
      {['unknown', 'unsupported'].includes(conn?.state) ? (
        <div className="co-view-note">GitHub is unavailable. Local status and saved reviews remain visible.</div>
      ) : null}
      {error ? (
        <div className="co-view-warning" role="status">Project status could not refresh. Saved contributions remain available.</div>
      ) : null}

      {!selectedProject ? (
        <>
          {renderControls?.(null)}
          {renderActivity?.(null, activityNavigation)}
          <div className="co-directory">
          <label className="co-project-search">
            <span className="co-visually-hidden">Find a project</span>
            <input
              type="search"
              value={query}
              placeholder="Find a project"
              onChange={(event) => {
                const value = event.target.value
                setQuery(value)
              }}
            />
          </label>
          <div className="co-directory-filters" role="group" aria-label="Filter projects">
            {FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{key !== 'all' ? <span>{filterCounts[key]}</span> : null}</button>)}
          </div>

          {filtered.length === 0 ? (
            <div className="co-stage-empty">
              <Icon name={query.trim() ? 'review' : 'check'} size={20} />
              <strong>{query.trim() ? 'No matching project' : filter === 'updates' ? 'No shared updates found' : 'No local work to prepare'}</strong>
              <span>{query.trim() ? 'Try a project name or repository.' : filter === 'all' ? 'No projects are available.' : 'All projects includes work already prepared or shared.'}</span>
            </div>
          ) : (
            <div className="co-project-index">
              <ProjectGroup
                label=""
                projects={tracked}
                selectedKey=""
                onSelect={openProject}
              />
              <ProjectGroup
                label="Only on your Möbius"
                projects={builtHere}
                selectedKey=""
                onSelect={openProject}
              />
            </div>
          )}
          {external.length ? <details className="co-other-repositories" open={query.trim() ? true : undefined}>
            <summary>On GitHub, not installed here <span>{external.length}{externalQuestions ? ` · ${externalQuestions} review requests` : ''}</span></summary>
            <p>Shown because Contribute has saved history here, you added the repository, or a pull request currently involves you. Other repositories stay on GitHub until you add or work on them.</p>
            <ProjectGroup label="" projects={external} selectedKey="" onSelect={openProject} />
          </details> : null}
          </div>
        </>
      ) : (
        <div className="co-project-layout">
          <ProjectDetail
            key={selectedProject.key}
            project={selectedProject}
            loadProjectDiff={loadProjectDiff}
            onRefresh={onRetry}
            renderActivity={renderActivity}
            navigation={activityNavigation}
            renderControls={renderControls}
            sourceRevision={snapshot?.generated_at}
          />
        </div>
      )}
    </section>
  )
}
