import { useEffect, useMemo, useState } from 'react'
import {
  attachSourceProjects,
  contributionRelationship,
  formatSourceDelta,
  projectMatchesFilter,
  projectStatus,
  recordBranch,
  sourceSummary,
} from '../source-map.js'

const FILTERS = [
  ['all', 'All'],
  ['attention', 'Attention'],
  ['different', 'Different'],
  ['working', 'Working'],
  ['prs', 'Has PRs'],
  ['aligned', 'Aligned'],
]

function shortSha(value) {
  return value ? String(value).slice(0, 7) : '—'
}

function countLabel(value, singular, plural = singular + 's') {
  return value + ' ' + (value === 1 ? singular : plural)
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

function CompactLane({ project }) {
  const base = project.kind === 'platform'
    ? 'origin/main'
    : !project.has_update_source ? 'No update source'
      : project.version ? 'Installed ' + project.version : (project.base_ref || 'Update source')
  const incoming = Number(project.behind || 0)
  const treeFiles = Number(project.tree?.files || 0)
  const working = Number(project.workingFiles || 0)
  const counts = project.contributionCounts || { ready: 0, open: 0 }
  const aria = [
    project.name,
    incoming ? countLabel(incoming, 'incoming commit') : 'no incoming commits',
    !project.has_update_source ? 'no recorded update source'
      : treeFiles ? countLabel(treeFiles, 'different file') : 'source trees match',
    working ? countLabel(working, 'working file') : 'no working files',
    counts.ready ? countLabel(counts.ready, 'ready contribution') : '',
    counts.open ? countLabel(counts.open, 'open contribution') : '',
  ].filter(Boolean).join(', ')
  return (
    <div className="co-source-compact" aria-label={aria}>
      <div className="co-source-mini-lane" aria-hidden="true">
        <span className="co-source-mini-ref">{base}</span>
        <span className={'co-source-mini-track state-' + project.state}>
          <i className="co-source-mini-node" />
          <b />
          <i className="co-source-mini-node is-local" />
          {working > 0 && <em />}
        </span>
        <span className="co-source-mini-ref is-local">Your main</span>
      </div>
      <div className="co-source-compact-meta">
        <span>{!project.has_update_source
          ? 'Local Git only'
          : treeFiles ? treeFiles + (treeFiles === 1 ? ' file differs' : ' files differ') : 'Trees match'}</span>
        {incoming > 0 && <span>{incoming} incoming</span>}
        {working > 0 && <span>{working} working</span>}
        {counts.ready > 0 && <span>{counts.ready} ready</span>}
        {counts.open > 0 && <span>{counts.open} open</span>}
      </div>
    </div>
  )
}

function ProjectRow({ project, selected, onSelect, mobileDetail, onShowContributions }) {
  const status = projectStatus(project)
  return (
    <div className={'co-source-row-wrap' + (selected ? ' is-selected' : '')}>
      <button
        type="button"
        className="co-source-row"
        onClick={() => onSelect(project.key)}
        aria-expanded={selected}
      >
        <div className="co-source-row-head">
          <ProjectGlyph project={project} />
          <span className="co-source-row-id">
            <span className="co-source-row-name">{project.name}</span>
            <span className="co-source-row-repo">
              {project.canonical_repo || (project.kind === 'app' ? 'Local app' : 'Local source')}
            </span>
          </span>
          <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
        </div>
        {project.kind !== 'external' && project.available && <CompactLane project={project} />}
        {project.kind !== 'external' && !project.available && (
          <div className="co-source-compact-meta is-external">
            <span>No local Git repository</span>
          </div>
        )}
        {project.kind === 'external' && (
          <div className="co-source-compact-meta is-external">
            <span>Not installed here</span>
            <span>{countLabel(project.contributions.length, 'active contribution')}</span>
          </div>
        )}
      </button>
      {selected && mobileDetail && (
        <div className="co-source-mobile-detail">
          <ProjectDetail project={project} onShowContributions={onShowContributions} />
        </div>
      )}
    </div>
  )
}

function RelationshipRail({ project }) {
  const working = project.working || {}
  const baseTitle = project.kind === 'platform' ? 'Last-fetched origin' : 'Installed upstream'
  const baseSubtitle = project.base_ref || 'No update source'
  const localTitle = 'Your main'
  const localSubtitle = project.branch || (project.detached ? 'Detached HEAD' : 'Unknown branch')
  return (
    <div className="co-rel" aria-label={
      baseTitle + ' ' + shortSha(project.base_sha) + ' to ' + localTitle + ' ' +
      shortSha(project.head_sha) + '. ' + formatSourceDelta(project)
    }>
      <div className="co-rel-endpoint">
        <span className="co-rel-kicker">Update source</span>
        <strong>{baseTitle}</strong>
        <span>{baseSubtitle} · {shortSha(project.base_sha)}</span>
      </div>
      <div className={'co-rel-track state-' + project.state} aria-hidden="true">
        <i />
        <b />
        <i className="is-local" />
        {project.workingFiles > 0 && <><em /><i className="is-working" /></>}
      </div>
      <div className="co-rel-endpoint is-local">
        <span className="co-rel-kicker">Live source</span>
        <strong>{localTitle}</strong>
        <span>{localSubtitle} · {shortSha(project.head_sha)}</span>
      </div>
      <div className="co-rel-metrics">
        <span><strong>{project.behind ?? '—'}</strong> incoming commits</span>
        <span><strong>{project.ahead ?? '—'}</strong> local commits</span>
        <span><strong>{project.tree?.files ?? '—'}</strong> different files</span>
      </div>
    </div>
  )
}

function ChangedSource({ project }) {
  const tree = project.tree
  if (!tree?.available) return null
  return (
    <section className="co-source-detail-section">
      <div className="co-source-detail-section-head">
        <h4>Changed source</h4>
        <span className="co-source-diff-total">
          <b className="co-file-add">+{tree.insertions}</b>
          <b className="co-file-del">−{tree.deletions}</b>
        </span>
      </div>
      {tree.files === 0 ? (
        <p className="co-source-detail-empty">The recorded source and your main have the same tree.</p>
      ) : (
        <div className="co-source-file-list">
          {(tree.paths || []).map((file) => (
            <div className="co-source-file" key={file.path} title={file.path}>
              <span className="co-source-file-path">{file.path}</span>
              <span className="co-source-file-stat">
                {file.binary ? 'binary' : <><b>+{file.insertions}</b><em>−{file.deletions}</em></>}
              </span>
            </div>
          ))}
          {tree.truncated && (
            <div className="co-source-files-more">+{tree.files - tree.paths.length} more files</div>
          )}
        </div>
      )}
    </section>
  )
}

function WorkingSource({ project }) {
  const working = project.working
  if (!working?.available) return null
  const parts = [
    ['staged', working.staged],
    ['unstaged', working.unstaged],
    ['untracked', working.untracked],
    ['conflicted', working.conflicts],
  ].filter(([, count]) => count > 0)
  return (
    <section className="co-source-detail-section">
      <div className="co-source-detail-section-head">
        <h4>Working files</h4>
        <span className={'co-source-working-state' + (working.files ? ' is-dirty' : '')}>
          {working.files ? countLabel(working.files, 'file') : 'No working changes'}
        </span>
      </div>
      {parts.length === 0 ? (
        <p className="co-source-detail-empty">Nothing staged, unstaged, or untracked.</p>
      ) : (
        <>
          <div className="co-source-working-counts">
            {parts.map(([label, count]) => <span key={label}><b>{count}</b> {label}</span>)}
          </div>
          <div className="co-source-working-paths">
            {(working.paths || []).map((item) => (
              <div key={item.status + item.path}>
                <span className={'co-source-work-chip is-' + item.group}>{item.group}</span>
                <code>{item.path}</code>
              </div>
            ))}
            {working.truncated && <span>More working paths are not shown.</span>}
          </div>
        </>
      )}
    </section>
  )
}

function ContributionLane({ project, onShowContributions }) {
  const contributions = project.contributions || []
  return (
    <section className="co-source-detail-section">
      <div className="co-source-detail-section-head">
        <h4>Contribution branches</h4>
        {contributions.length > 0 && <span>{contributions.length} active</span>}
      </div>
      {contributions.length === 0 ? (
        <p className="co-source-detail-empty">No ready or open contributions for this source.</p>
      ) : (
        <div className="co-branch-list">
          {contributions.map((rec) => {
            const ready = rec.status === 'prepared'
            const label = ready ? 'Ready' : rec.status === 'submitting' ? 'Submitting' : 'Open'
            const title = rec.title || rec.summary || recordBranch(rec) || 'Untitled contribution'
            return (
              <div className={'co-branch' + (rec.needs_attention ? ' needs-attention' : '')} key={rec.id}>
                <span className="co-branch-stem" aria-hidden="true"><i /></span>
                <div className="co-branch-body">
                  <div className="co-branch-top">
                    <span className={'co-branch-chip is-' + (rec.needs_attention ? 'danger' : ready ? 'ready' : 'open')}>
                      {rec.needs_attention ? (rec.attention?.title || 'Attention') : label}
                    </span>
                    {rec.number && <span className="co-branch-number">#{rec.number}</span>}
                  </div>
                  {rec.url ? (
                    <a href={rec.url} target="_blank" rel="noopener noreferrer" className="co-branch-title">{title}</a>
                  ) : <span className="co-branch-title">{title}</span>}
                  <code className="co-branch-name">{recordBranch(rec) || 'branch unavailable'}</code>
                  <span className="co-branch-relation">{contributionRelationship(rec, project)}</span>
                  {rec.needs_attention && rec.attention?.message && (
                    <span className="co-branch-attention">{rec.attention.message}</span>
                  )}
                </div>
              </div>
            )
          })}
          <button type="button" className="co-btn co-btn-sm co-source-review-btn" onClick={onShowContributions}>
            Open Contributions
          </button>
        </div>
      )}
    </section>
  )
}

function ProjectDetail({ project, onShowContributions }) {
  const status = projectStatus(project)
  return (
    <article className="co-source-detail">
      <header className="co-source-detail-head">
        <div className="co-source-detail-title">
          <ProjectGlyph project={project} />
          <div>
            <h3>{project.name}</h3>
            <p>{project.canonical_repo || 'This source lives only on this Möbius.'}</p>
          </div>
        </div>
        <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
      </header>
      {project.kind !== 'external' && project.available ? (
        <>
          <RelationshipRail project={project} />
        </>
      ) : project.kind !== 'external' ? (
        <div className="co-source-unavailable">
          This repository could not be inspected. Contributions remain visible below.
        </div>
      ) : null}
      <ContributionLane project={project} onShowContributions={onShowContributions} />
      {project.kind !== 'external' && project.available && (
        <>
          <WorkingSource project={project} />
          <ChangedSource project={project} />
        </>
      )}
    </article>
  )
}

function LoadingState() {
  return (
    <div className="co-source-loading" role="status">
      <span className="ma-spinner" aria-hidden="true" />
      <div><strong>Mapping your sources…</strong><span>Comparing recorded update sources, local mains, and working files.</span></div>
    </div>
  )
}

export function SourceMap({ snapshot, records, conn, loading, error, onRetry, onShowContributions }) {
  const [filter, setFilter] = useState('all')
  const projects = useMemo(() => attachSourceProjects(snapshot, records), [snapshot, records])
  const summary = useMemo(() => sourceSummary(projects), [projects])
  const filtered = useMemo(
    () => projects.filter((project) => projectMatchesFilter(project, filter)),
    [projects, filter],
  )
  const [selected, setSelected] = useState('platform')
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((project) => project.key === selected)) {
      setSelected(filtered[0].key)
    }
  }, [filtered, selected])
  const selectedProject = filtered.find((project) => project.key === selected) || filtered[0]

  if (loading && !snapshot) return <LoadingState />
  if (error && !snapshot) {
    return (
      <div className="co-source-error">
        <strong>{error === 'restart' ? 'Restart to finish Sources' : 'Source map unavailable'}</strong>
        <p>{error === 'restart'
          ? 'The Sources view is installed, but its new read-only platform service starts after the next Möbius restart.'
          : 'Contribute could not read local source status. Your contribution feed is unaffected.'}</p>
        <button type="button" className="co-btn co-btn-sm" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  const compared = snapshot?.generated_at
    ? new Date(snapshot.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <section className="co-sources" aria-labelledby="co-sources-title">
      <div className="co-sources-head">
        <div>
          <h2 id="co-sources-title">Source map</h2>
          <p>Recorded update sources, your live mains, working files, and active contribution branches.</p>
        </div>
        <div className="co-sources-fresh">
          {compared && <span>Compared {compared}</span>}
          <button type="button" className="co-btn co-btn-sm" onClick={onRetry} disabled={loading}>
            {loading ? 'Comparing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {conn?.state !== 'connected' && (
        <div className="co-source-note">
          Local comparisons are available; contribution states may be stale until GitHub reconnects.
        </div>
      )}

      <div className="co-source-summary" aria-label="Source summary">
        <div><strong>{summary.sources}</strong><span>Sources</span></div>
        <div><strong>{summary.different}</strong><span>Different</span></div>
        <div><strong>{summary.working}</strong><span>Working files</span></div>
        <div><strong>{summary.active}</strong><span>Active shares</span></div>
      </div>

      <div className="co-source-filters" role="group" aria-label="Filter sources">
        {FILTERS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={'co-source-filter' + (filter === key ? ' is-active' : '')}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="co-source-no-results">No sources match this filter.</div>
      ) : (
        <div className="co-source-layout">
          <div className="co-source-list">
            {filtered.map((project) => (
              <ProjectRow
                key={project.key}
                project={project}
                selected={project.key === selectedProject?.key}
                onSelect={setSelected}
                mobileDetail
                onShowContributions={onShowContributions}
              />
            ))}
          </div>
          {selectedProject && (
            <aside className="co-source-desktop-detail">
              <ProjectDetail project={selectedProject} onShowContributions={onShowContributions} />
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
