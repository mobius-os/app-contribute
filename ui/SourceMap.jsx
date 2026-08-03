import { useEffect, useMemo, useRef, useState } from 'react'
import {
  contributionRelationship,
  projectAgentAction,
  projectDetailSummary,
  projectFlowStatus,
  projectMatchesFilter,
  projectRowFacts,
  projectStatus,
  recordBranch,
  sourcePathRelationship,
} from '../source-map.js'
import { groupContributionUnits, stackMeta } from '../stack.js'
import { BatchAction } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'

const FILTERS = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['changed', 'Differs from shared'],
  ['shared', 'Shared'],
]

function countLabel(value, singular, plural = singular + 's') {
  return value + ' ' + (value === 1 ? singular : plural)
}

function incomingCountLabel(project) {
  return project.semanticAvailable
    ? countLabel(project.incomingFiles, 'file')
    : countLabel(project.originBehind, 'shared update')
}

function localCountLabel(project) {
  return `${countLabel(project.localFiles, 'file')} ${project.localFiles === 1 ? 'remains' : 'remain'} local`
}

function ProjectFlow({ project }) {
  const status = projectFlowStatus(project)
  const contributions = project.contributions || []
  const reviews = contributions.length
  const ready = contributions.filter((rec) => rec.status === 'prepared').length
  const open = reviews - ready
  const reviewAttention = contributions.some((rec) => rec.needs_attention)
  const chains = groupContributionUnits(contributions).filter((unit) => unit.type === 'stack').length
  const sourceName = project.canonical_repo || 'Shared source'
  const installedRelease = project.kind === 'app' && project.base_ref === 'upstream'
  const comparesWithRelease = installedRelease && project.comparison_ref !== project.origin?.ref
  const sourceRef = comparesWithRelease
    ? `Full source · release ${project.version || 'installed'}`
    : `${project.comparison_ref || project.origin?.ref || project.base_ref || 'shared main'} · last fetched`
  const localBranch = project.branch || (project.detached ? 'detached' : 'main')
  const localBits = [
    installedRelease && project.version ? `v${project.version}` : localBranch,
    project.provenShared > 0
      ? `${countLabel(project.provenShared, 'landed submission')} recognized`
      : '',
    project.localFiles > 0
      ? localCountLabel(project)
      : '',
    project.incomingFiles > 0
      ? `${incomingCountLabel(project)} incoming`
      : '',
    project.compatibleFiles > 0
      ? `${countLabel(project.compatibleFiles, 'file')} combine cleanly`
      : '',
    project.conflictFiles > 0
      ? `${countLabel(project.conflictFiles, 'file')} ${project.conflictFiles === 1 ? 'needs' : 'need'} a choice`
      : '',
    project.workingFiles > 0 ? countLabel(project.workingFiles, 'file being edited', 'files being edited') : '',
    !project.localFiles && !project.incomingFiles && !project.compatibleFiles && !project.conflictFiles && !project.workingFiles && project.managedFiles > 0 ? 'safe install adjustments only' : '',
    !project.localFiles && !project.incomingFiles && !project.compatibleFiles && !project.conflictFiles && !project.workingFiles && !project.managedFiles
      ? (comparesWithRelease
          ? 'installed files match release'
          : installedRelease
            ? 'committed source matches last-fetched shared source'
            : 'source matches')
      : '',
  ].filter(Boolean)
  const forks = project.forks?.length || 0
  const reviewBits = [
    ready ? `${ready} ready` : '',
    open ? `${open} open` : '',
    forks ? countLabel(forks, 'GitHub copy', 'GitHub copies') : '',
    chains ? countLabel(chains, 'linked chain') : '',
  ].filter(Boolean)
  return (
    <div
      className="co-observe-map"
      aria-label={`Shared source to your ${status.label.toLowerCase()} version to ${countLabel(reviews, 'review')}`}
    >
      <div className="co-observe-node is-source">
        <span className="co-observe-icon" aria-hidden="true">◎</span>
        <div><span>Shared source</span><strong>{sourceName}</strong><small>{sourceRef}</small></div>
      </div>
      <div className="co-observe-edge" aria-hidden="true"><span /><i>→</i></div>
      <div className={'co-observe-node is-local tone-' + status.tone}>
        <span className="co-observe-icon" aria-hidden="true">●</span>
        <div><span>This Möbius</span><strong>{status.label}</strong><small>{localBits.join(' · ')}</small></div>
      </div>
      <div className="co-observe-branch" aria-hidden="true"><span /><i>↓</i><small>shared from here</small></div>
      <div className={'co-observe-node is-reviews' + (reviews ? ' has-reviews' : '') + (reviewAttention ? ' has-attention' : '')}>
        <span className="co-observe-icon" aria-hidden="true">⑂</span>
        <div>
          <span>Shared reviews</span>
          <strong>{reviews ? `${reviews}${reviewAttention ? ' · needs attention' : ''}` : 'Nothing shared'}</strong>
          <small>{reviewBits.join(' · ') || 'No active reviews'}</small>
        </div>
      </div>
    </div>
  )
}

function shortCommit(value) {
  return typeof value === 'string' && value ? value.slice(0, 7) : 'Unavailable'
}

function ProjectPosition({ project }) {
  const installedRelease = project.kind === 'app' && project.base_ref === 'upstream'
  const comparisonRef = project.comparison_ref || project.base_ref
  const comparisonSha = project.comparison_sha || project.base_sha
  const comparesWithRelease = installedRelease && comparisonRef === project.base_ref
  const sharedRef = comparesWithRelease
    ? `installed release (${comparisonRef})`
    : (comparisonRef || 'Not configured')
  return (
    <details className="co-position-details">
      <summary>
        <span>Technical details</span>
        <Icon name="chevron" size={15} />
      </summary>
      <dl>
        <div><dt>Your branch</dt><dd><code>{project.detached ? 'Detached' : project.branch || 'Unknown'}</code></dd></div>
        <div><dt>Your commit</dt><dd><code>{shortCommit(project.head_sha)}</code></dd></div>
        {project.state !== 'local_only' ? (
          <>
            <div><dt>Compared with</dt><dd><code>{sharedRef}</code></dd></div>
            <div><dt>{comparesWithRelease ? 'Release commit' : 'Shared commit'}</dt><dd><code>{shortCommit(comparisonSha)}</code></dd></div>
          </>
        ) : null}
        {project.canonical_repo ? (
          <div><dt>Repository</dt><dd><code>{project.canonical_repo}</code></dd></div>
        ) : null}
      </dl>
    </details>
  )
}

function ProjectGlyph({ project }) {
  if (project.kind === 'platform') {
    return (
      <span className="co-source-glyph is-platform" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
             strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="5" r="2.2" />
          <circle cx="6" cy="19" r="2.2" />
          <circle cx="18" cy="9" r="2.2" />
          <path d="M6 7.2v9.6M18 11.2c0 4.1-2.8 5.8-8 5.8" />
        </svg>
      </span>
    )
  }
  const letter = String(project.name || '?').trim().charAt(0).toUpperCase() || '?'
  return <span className="co-source-glyph" aria-hidden="true">{letter}</span>
}

function PrStatus({ rec }) {
  const ready = rec.status === 'prepared'
  const label = rec.needs_attention
    ? (rec.attention?.title || 'Checks failed')
    : ready ? 'Ready'
      : rec.status === 'submitting' ? 'Sending'
        : rec.status === 'draft' ? 'Draft'
          : rec.status === 'merged' ? 'Merged'
            : 'Open'
  const tone = rec.needs_attention ? 'danger' : ready ? 'ready' : 'open'
  return <span className={'co-pr-status is-' + tone}>{label}</span>
}

function PullRequestNode({ rec, project, chained = false }) {
  const meta = stackMeta(rec)
  const title = rec.summary || rec.title || recordBranch(rec) || 'Untitled contribution'
  const fork = rec.head_repository || (rec.status === 'prepared' ? 'Private branch' : 'Fork unknown')
  return (
    <div className={'co-pr-node' + (chained ? ' is-chained' : '')}>
      <span className="co-pr-node-dot" aria-hidden="true" />
      <div className="co-pr-node-main">
        <div className="co-pr-node-top">
          {meta && <span className="co-pr-layer">PR {meta.position}/{meta.total}</span>}
          <PrStatus rec={rec} />
          {rec.number && <span className="co-pr-number">#{rec.number}</span>}
        </div>
        {rec.url ? (
          <a href={rec.url} target="_blank" rel="noopener noreferrer">{title}</a>
        ) : <strong>{title}</strong>}
        <small className="co-pr-origin">
          {rec.status === 'prepared'
            ? 'From this Möbius'
            : rec.head_repository
              ? 'From your GitHub copy'
              : 'From the shared source'}
        </small>
        <details className="co-pr-technical">
          <summary>Technical details</summary>
          <div className="co-pr-route">
            <code>{meta?.baseBranch || project.base_ref || 'main'}</code>
            <span aria-hidden="true">→</span>
            <code>{recordBranch(rec) || 'branch unavailable'}</code>
          </div>
          <small>{fork} · {contributionRelationship(rec, project)}</small>
        </details>
        {rec.needs_attention && rec.attention?.message && (
          <em>{rec.attention.message}</em>
        )}
      </div>
    </div>
  )
}

function PullRequestMap({ project }) {
  const contributions = project.contributions || []
  if (contributions.length === 0) return null
  const units = groupContributionUnits(contributions)
  return (
    <details className="co-pr-map">
      <summary>
        <span>Changes</span>
        <strong>{contributions.length}</strong>
        <Icon name="chevron" size={16} />
      </summary>
      <div className="co-pr-map-body">
        <div className="co-pr-units">
          {units.map((unit) => unit.type === 'stack' ? (
            <div className="co-pr-stack-map" key={'stack:' + unit.id}>
              <header>
                <span className="co-chain-mark" aria-hidden="true">⛓</span>
                <div><strong>{unit.name}</strong><small>Related changes · reviewed in order</small></div>
              </header>
              <div className="co-pr-chain">
                {unit.records.map((rec) => (
                  <PullRequestNode key={rec.id} rec={rec} project={project} chained />
                ))}
              </div>
            </div>
          ) : (
            <PullRequestNode key={unit.record.id} rec={unit.record} project={project} />
          ))}
        </div>
      </div>
    </details>
  )
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

function ProjectFileChanges({ project }) {
  const [expanded, setExpanded] = useState(false)
  const tree = project.comparisonTree
  const working = project.working
  const files = new Map()

  for (const file of tree?.paths || []) {
    if (file.group === 'managed') continue
    files.set(file.path, { ...file })
  }
  for (const file of working?.paths || []) {
    files.set(file.path, { ...(files.get(file.path) || {}), ...file, working: true })
  }

  const rows = [...files.values()].sort((a, b) => {
    if (a.working !== b.working) return a.working ? -1 : 1
    return a.path.localeCompare(b.path)
  })
  if (!rows.length) return null

  const changed = Number(project.authoredFiles || 0)
  const editing = Number(project.workingFiles || 0)
  const summary = [
    project.provenShared ? `${project.provenShared} landed recognized` : '',
    project.localFiles ? localCountLabel(project) : '',
    project.incomingFiles ? `${incomingCountLabel(project)} incoming` : '',
    project.compatibleFiles ? `${project.compatibleFiles} combine cleanly` : '',
    project.conflictFiles ? `${project.conflictFiles} ${project.conflictFiles === 1 ? 'needs' : 'need'} a choice` : '',
    editing ? `${editing} being edited` : '',
  ].filter(Boolean).join(' · ')
  const previewCount = 4
  const shown = expanded ? rows : rows.slice(0, previewCount)
  const hidden = rows.length - shown.length

  return (
    <section className="co-project-files">
      <header>
        <span>File changes</span>
        <small>{summary}</small>
      </header>
      <div className="co-project-file-list">
        {shown.map((file) => {
          const relationship = file.working
            ? file.group
            : sourcePathRelationship(project, file.path)
          return (
            <div className="co-project-file" key={file.path} title={file.path}>
              <code>{file.path}</code>
              <span className="co-project-file-meta">
                <i className={'is-' + relationship}>{fileStateLabel(relationship)}</i>
                {!file.binary && (file.insertions != null || file.deletions != null) && (
                  <span><b>+{file.insertions || 0}</b><em>−{file.deletions || 0}</em></span>
                )}
                {file.binary && <span>Binary</span>}
              </span>
            </div>
          )
        })}
        {expanded && tree?.truncated && (
          <p>Showing {tree.paths?.filter((file) => file.group !== 'managed').length || 0} of {changed} changed files.</p>
        )}
      </div>
      {rows.length > previewCount && (
        <button
          type="button"
          className="co-project-files-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded
            ? 'Show fewer files'
            : tree?.truncated
              ? `Show ${hidden} more available ${hidden === 1 ? 'file' : 'files'}`
              : `Show all ${rows.length} files`}
          <Icon name="chevron" size={15} />
        </button>
      )}
    </section>
  )
}

function ProjectDetail({ project, onAskAgent }) {
  const [handoffNote, setHandoffNote] = useState('')
  const status = projectStatus(project)
  const overview = projectDetailSummary(project)
  const agentAction = projectAgentAction(project)

  function askAgent() {
    const outcome = onAskAgent?.(project, agentAction) || {}
    setHandoffNote(outcome.ok ? '' : 'Open Contribute inside Möbius to ask your agent.')
  }
  return (
    <article className="co-source-detail">
      <header className="co-source-detail-head">
        <div className="co-source-detail-title">
          <ProjectGlyph project={project} />
          <div><h3>{project.name}</h3></div>
        </div>
        <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
      </header>
      <p className="co-source-overview-copy">{overview}</p>
      {project.state === 'local_only' ? (
        <div className="co-local-position">
          <strong>{project.builtHere ? 'Only on this Möbius' : 'No shared update source'}</strong>
          <span>{project.builtHere
            ? 'Publishing gives the app a GitHub home so it can be backed up or shared.'
            : 'The GitHub repository exists, but Möbius has no shared version to compare against.'}</span>
        </div>
      ) : <ProjectFlow project={project} />}
      {agentAction ? (
        <div className="co-source-action">
          <div>
            <strong>Continue with your agent</strong>
            <span>A new chat opens with this project already identified.</span>
          </div>
          <button type="button" className="co-btn co-btn-primary co-btn-sm" onClick={askAgent}>
            {agentAction.label}
          </button>
          {handoffNote ? <p role="status">{handoffNote}</p> : null}
        </div>
      ) : null}
      <PullRequestMap project={project} />
      <ProjectFileChanges key={project.key} project={project} />
      <ProjectPosition project={project} />
      {project.kind !== 'external' && !project.available && project.state !== 'local_only' ? (
        <div className="co-source-unavailable">No inspectable local source is available.</div>
      ) : null}
    </article>
  )
}

function ProjectRow({ project, selected, onSelect }) {
  const status = projectStatus(project)
  const facts = projectRowFacts(project)
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '')}>
      <button
        type="button"
        className="co-source-row"
        onClick={() => onSelect(project.key)}
        aria-expanded={selected}
      >
        <ProjectGlyph project={project} />
        <span className="co-source-row-id">
          <strong>{project.name}</strong>
        </span>
        <span className="co-source-row-facts">{facts.join(' · ')}</span>
        <span className={'co-source-dot tone-' + status.tone} title={status.label} />
      </button>
    </div>
  )
}

function ProjectGroup({ label, projects, selectedKey, onSelect }) {
  if (!projects.length) return null
  return (
    <div className="co-source-group">
      {label ? <div className="co-source-group-label">{label}</div> : null}
      {projects.map((project) => (
        <ProjectRow
          key={project.key}
          project={project}
          selected={project.key === selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="co-source-loading" role="status">
      <span className="ma-spinner" aria-hidden="true" />
      <div><strong>Checking your code…</strong><span>Looking for local changes and shared reviews.</span></div>
    </div>
  )
}

export function SourceMap({
  snapshot,
  projects,
  conn,
  loading,
  error,
  onRetry,
  focusRequest,
  onAskAgent,
  prepareAll,
}) {
  const [filter, setFilter] = useState('all')
  const filtered = useMemo(
    () => projects.filter((project) => projectMatchesFilter(project, filter)),
    [projects, filter],
  )
  const [selected, setSelected] = useState(() => focusRequest?.key || 'platform')
  const [mobileOpen, setMobileOpen] = useState(() => !!focusRequest?.key)
  const listScrollRef = useRef(0)

  function pageScroller() {
    return document.querySelector('.co-page')
  }

  function openProject(key) {
    const page = pageScroller()
    listScrollRef.current = page?.scrollTop || 0
    setSelected(key)
    setMobileOpen(true)
    // Run after React swaps the mobile list for the detail. This prevents
    // scroll anchoring from restoring the list offset onto the new panel.
    requestAnimationFrame(() => pageScroller()?.scrollTo({ top: 0, left: 0 }))
  }

  function closeProject() {
    setMobileOpen(false)
    // Back returns to the exact list position the owner left.
    requestAnimationFrame(() => pageScroller()?.scrollTo({
      top: listScrollRef.current,
      left: 0,
    }))
  }
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((project) => project.key === selected)) {
      setSelected(filtered[0].key)
    }
  }, [filtered, selected])
  useEffect(() => {
    if (!focusRequest?.key || !projects.some((project) => project.key === focusRequest.key)) return
    setFilter('all')
    setSelected(focusRequest.key)
    setMobileOpen(true)
  }, [focusRequest, projects])
  const selectedProject = filtered.find((project) => project.key === selected) || filtered[0]
  const builtHere = filtered.filter((project) => project.builtHere)
  const tracked = filtered.filter((project) => !project.builtHere)

  if (loading && !snapshot) return <LoadingState />
  if (error && !snapshot) {
    return (
      <div className="co-source-error">
        <strong>{error === 'restart' ? 'Restart to finish Projects' : 'Projects unavailable'}</strong>
        <p>{error === 'restart'
          ? 'The visual map is installed, but its read-only source service starts after the next Möbius restart.'
          : 'Contribute could not read local source status. Your contribution feed is unaffected.'}</p>
        <button type="button" className="co-btn co-btn-sm" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  const compared = snapshot?.generated_at
    ? new Date(snapshot.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <section
      id="co-panel-sources"
      className={'co-sources' + (mobileOpen ? ' is-detail-open' : '')}
      role="tabpanel"
      aria-labelledby="co-tab-sources"
    >
      <div className="co-sources-head">
        <div>
          <h2 id="co-sources-title">Where changes live</h2>
          <p className="co-sources-intro">Separate committed differences, working edits, shared updates, and reviews already in progress.</p>
        </div>
        <div className="co-sources-fresh">
          {compared && <span>Checked {compared}</span>}
          <button
            type="button"
            className="co-icon-btn co-source-refresh"
            onClick={onRetry}
            disabled={loading}
            aria-label={loading ? 'Checking for changes' : 'Check again'}
            title={loading ? 'Checking…' : 'Check again'}
          >
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {conn?.state !== 'connected' && (
        <div className="co-source-note">Local positions are current; GitHub PR states may be older.</div>
      )}
      {error && snapshot ? (
        <div className="co-source-warning" role="status">
          Refresh failed — keeping the last repository map on screen.
        </div>
      ) : null}

      {prepareAll ? (
        <BatchAction
          count={prepareAll.count}
          eyebrow="Private preparation"
          title={`${prepareAll.count} local ${prepareAll.count === 1 ? 'change is' : 'changes are'} ready to inspect`}
          description="Starts one agent handoff to inspect each change and stage the worthwhile ones here. Nothing is published."
          actionLabel="Prepare all"
          onAction={async () => {
            const outcome = await (onAskAgent?.(null, prepareAll) || {})
            return outcome.ok
              ? { ok: true, message: 'Starting one preparation chat…' }
              : { error: outcome.error || 'Open Contribute inside Möbius to prepare these changes.' }
          }}
        />
      ) : null}

      <div className="co-source-toolbar">
        <div className="co-source-filters" role="group" aria-label="Filter projects">
          {FILTERS.map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={'co-source-filter' + (filter === key ? ' is-active' : '')}
              onClick={() => { setFilter(key); setMobileOpen(false) }}
              aria-pressed={filter === key}
            >{label}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="co-source-no-results">No projects match this filter.</div>
      ) : (
        <div className={'co-source-layout' + (mobileOpen ? ' is-mobile-open' : '')}>
          <div className="co-source-list">
            <ProjectGroup
              label={builtHere.length ? 'Platform and installed apps' : ''}
              projects={tracked}
              selectedKey={selectedProject?.key}
              onSelect={openProject}
            />
            <ProjectGroup
              label="Built here"
              projects={builtHere}
              selectedKey={selectedProject?.key}
              onSelect={openProject}
            />
          </div>
          {selectedProject && (
            <aside className="co-source-desktop-detail">
              <button type="button" className="co-map-back" onClick={closeProject}>
                <Icon name="left" /> All projects
              </button>
              <ProjectDetail key={selectedProject.key} project={selectedProject} onAskAgent={onAskAgent} />
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
