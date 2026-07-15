import { useEffect, useMemo, useState } from 'react'
import {
  attachSourceProjects,
  contributionRelationship,
  projectMatchesFilter,
  projectStatus,
  recordBranch,
  sourceSummary,
} from '../source-map.js'
import { groupContributionUnits, stackMeta } from '../stack.js'

const FILTERS = [
  ['all', 'All'],
  ['attention', 'Action'],
  ['changed', 'Changed'],
  ['shared', 'PRs & forks'],
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

function RepoNode({ kind, eyebrow, title, refName, sha, note, badges = [] }) {
  return (
    <div className={'co-map-node is-' + kind}>
      <span className="co-map-node-icon" aria-hidden="true">
        {kind === 'origin' ? '◎' : kind === 'fork' ? '⑂' : '●'}
      </span>
      <div className="co-map-node-copy">
        <span className="co-map-node-eyebrow">{eyebrow}</span>
        <strong title={title}>{title}</strong>
        <code>{refName || 'branch unknown'} · {shortSha(sha)}</code>
        {note && <small>{note}</small>}
      </div>
      {badges.length > 0 && (
        <div className="co-map-node-badges">
          {badges.map((badge) => <span key={badge}>{badge}</span>)}
        </div>
      )}
    </div>
  )
}

function ForkState({ fork }) {
  if (fork.sync === 'diverged') return <span className="is-danger">Fork main diverged</span>
  if (fork.sync === 'strictly-behind') return <span>{fork.branch || 'main'} is behind origin</span>
  if (fork.sync === 'current') return <span>Default branch matches origin</span>
  if (fork.sync === 'contains-upstream') return <span>Contains the reviewed origin</span>
  if (fork.ahead != null && fork.behind != null) {
    return <span>{fork.behind} behind · {fork.ahead} ahead of origin</span>
  }
  return <span>Fork recorded; default branch was not fetched here</span>
}

function RepositoryGraph({ project }) {
  const origin = project.origin || {}
  const originRepo = origin.repo || project.canonical_repo || 'No recorded origin'
  const originRef = origin.ref || project.base_ref || 'origin/main'
  const originSha = origin.sha || project.base_sha
  const relation = project.originBehind
    ? `${countLabel(project.originBehind, 'incoming commit')} from origin`
    : project.authoredFiles
      ? 'Your main differs from the installed source'
      : project.managedFiles
        ? 'Only installation-managed files differ'
        : 'Your source tree matches the installed source'

  return (
    <section className="co-map-graph" aria-label="Repository relationship map">
      <div className="co-map-primary">
        <RepoNode
          kind="origin"
          eyebrow="Origin"
          title={originRepo}
          refName={originRef}
          sha={originSha}
        />
        <div className={'co-map-edge state-' + project.state} aria-hidden="true">
          <span /><i>→</i>
        </div>
        <RepoNode
          kind="local"
          eyebrow="This Möbius"
          title="Your main"
          refName={project.branch || (project.detached ? 'detached' : 'main')}
          sha={project.head_sha}
          note={relation}
        />
      </div>

      <div className="co-map-stats" aria-label="Origin and local differences">
        <span><b>{project.originBehind}</b> incoming</span>
        <span><b>{project.authoredFiles}</b> different</span>
        <span><b>{project.workingFiles}</b> working</span>
      </div>

      {project.forks.length > 0 && (
        <div className="co-map-fork-zone">
          <div className="co-map-fork-label">Forks</div>
          {project.forks.map((fork) => (
            <div className="co-map-fork-row" key={fork.repo}>
              <span className="co-map-fork-connector" aria-hidden="true" />
              <RepoNode
                kind="fork"
                eyebrow="Your GitHub fork"
                title={fork.repo}
                refName={fork.ref || fork.branch || 'main'}
                sha={fork.sha}
                note={fork.contributions?.length
                  ? countLabel(fork.contributions.length, 'active PR')
                  : null}
              />
              <div className="co-map-fork-state"><ForkState fork={fork} /></div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function PrStatus({ rec }) {
  const ready = rec.status === 'prepared'
  const label = rec.needs_attention
    ? (rec.attention?.title || 'Checks failed')
    : ready ? 'Ready' : rec.status === 'submitting' ? 'Sending' : 'Open'
  const tone = rec.needs_attention ? 'danger' : ready ? 'ready' : 'open'
  return <span className={'co-pr-status is-' + tone}>{label}</span>
}

function PullRequestNode({ rec, project, chained = false }) {
  const meta = stackMeta(rec)
  const title = rec.title || rec.summary || recordBranch(rec) || 'Untitled contribution'
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
        <div className="co-pr-route">
          <code>{meta?.baseBranch || project.base_ref || 'main'}</code>
          <span aria-hidden="true">→</span>
          <code>{recordBranch(rec) || 'branch unavailable'}</code>
        </div>
        <small>{fork} · {contributionRelationship(rec, project)}</small>
        {rec.needs_attention && rec.attention?.message && (
          <em>{rec.attention.message}</em>
        )}
      </div>
    </div>
  )
}

function PullRequestMap({ project, onShowContributions }) {
  const contributions = project.contributions || []
  if (contributions.length === 0) return null
  const units = groupContributionUnits(contributions)
  return (
    <section className="co-pr-map">
      <div className="co-map-section-head">
        <div><span>Pull requests</span><strong>{contributions.length} active</strong></div>
        <button type="button" className="co-link-btn" onClick={onShowContributions}>Review all</button>
      </div>
      <div className="co-pr-units">
        {units.map((unit) => unit.type === 'stack' ? (
          <div className="co-pr-stack-map" key={'stack:' + unit.id}>
            <header>
              <span className="co-chain-mark" aria-hidden="true">⛓</span>
              <div><strong>{unit.name}</strong><small>Chained PRs · each layer builds on the one above</small></div>
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
    </section>
  )
}

function FileRow({ file, working = false }) {
  return (
    <div className="co-map-file" title={file.path}>
      {working && <span className={'co-map-work is-' + file.group}>{file.group}</span>}
      <code>{file.path}</code>
      {!working && (
        <span>{file.binary ? 'binary' : <><b>+{file.insertions}</b><em>−{file.deletions}</em></>}</span>
      )}
    </div>
  )
}

function DifferenceMap({ project }) {
  const tree = project.comparisonTree || project.tree
  const working = project.working
  if (!tree?.available && !working?.available) return null
  const authored = (tree?.paths || []).filter((file) => file.group !== 'managed')
  const managed = (tree?.paths || []).filter((file) => file.group === 'managed')
  const authoredCount = Number(tree?.authored_files ?? tree?.files ?? 0)
  const managedCount = Number(tree?.managed_files || 0)
  const workingCount = Number(working?.files || 0)
  return (
    <section className="co-difference-map">
      <div className="co-map-section-head">
        <div><span>Where it differs</span><strong>{authoredCount + workingCount} local file differences</strong></div>
      </div>
      <div className="co-difference-columns">
        <div className="co-difference-group">
          <h4><span className="co-diff-dot is-committed" />Committed tree differences <b>{authoredCount}</b></h4>
          {authoredCount === 0 ? <p>None — the editable source matches.</p> : (
            <div className="co-map-files">
              {authored.map((file) => <FileRow key={file.path} file={file} />)}
              {authoredCount > authored.length && <small>+{authoredCount - authored.length} more</small>}
            </div>
          )}
        </div>
        <div className="co-difference-group">
          <h4><span className="co-diff-dot is-working" />Working now <b>{workingCount}</b></h4>
          {workingCount === 0 ? <p>Nothing unstaged, staged, or untracked.</p> : (
            <div className="co-map-files">
              {(working.paths || []).map((file) => <FileRow key={file.status + file.path} file={file} working />)}
              {working.truncated && <small>More working files are not shown.</small>}
            </div>
          )}
        </div>
      </div>
      {managedCount > 0 && (
        <details className="co-managed-differences">
          <summary>
            <span><i aria-hidden="true">◇</i>{managedCount} installation-managed {managedCount === 1 ? 'difference' : 'differences'}</span>
            <small>Expected packaging changes, not your customization</small>
          </summary>
          <div className="co-map-files">
            {managed.map((file) => <FileRow key={file.path} file={file} />)}
            {managedCount > managed.length && <small>+{managedCount - managed.length} more</small>}
          </div>
        </details>
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
          <div><h3>{project.name}</h3><p>{project.canonical_repo || 'Local repository'}</p></div>
        </div>
        <span className={'co-source-status tone-' + status.tone}>{status.label}</span>
      </header>
      {project.kind !== 'external' && project.available ? (
        <RepositoryGraph project={project} />
      ) : project.kind !== 'external' ? (
        <div className="co-source-unavailable">No inspectable local Git repository.</div>
      ) : null}
      <PullRequestMap project={project} onShowContributions={onShowContributions} />
      {project.kind !== 'external' && project.available && <DifferenceMap project={project} />}
    </article>
  )
}

function ProjectRow({ project, selected, onSelect }) {
  const status = projectStatus(project)
  const facts = []
  if (project.authoredFiles) facts.push(countLabel(project.authoredFiles, 'different', 'different'))
  if (project.workingFiles) facts.push(countLabel(project.workingFiles, 'working', 'working'))
  if (project.contributions.length) facts.push(countLabel(project.contributions.length, 'PR'))
  if (project.forks.length) facts.push(countLabel(project.forks.length, 'fork'))
  if (!facts.length && project.managedFiles) facts.push(countLabel(project.managedFiles, 'install-managed', 'install-managed'))
  if (!facts.length) facts.push(project.available ? 'In sync' : 'Not tracked')
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
          <small>{project.canonical_repo || 'Local app'}</small>
        </span>
        <span className="co-source-row-facts">{facts.join(' · ')}</span>
        <span className={'co-source-dot tone-' + status.tone} title={status.label} />
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="co-source-loading" role="status">
      <span className="ma-spinner" aria-hidden="true" />
      <div><strong>Mapping repositories…</strong><span>Comparing origin, local mains, forks, and PR branches.</span></div>
    </div>
  )
}

export function SourceMap({ snapshot, records, conn, loading, error, onRetry, onShowContributions }) {
  const [filter, setFilter] = useState('all')
  const projects = useMemo(
    () => attachSourceProjects(snapshot, records).filter((project) => project.available),
    [snapshot, records],
  )
  const summary = useMemo(() => sourceSummary(projects), [projects])
  const filtered = useMemo(
    () => projects.filter((project) => projectMatchesFilter(project, filter)),
    [projects, filter],
  )
  const [selected, setSelected] = useState('platform')
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    document.querySelector('.co-page')?.scrollTo({ top: 0, left: 0 })
  }, [mobileOpen])
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
        <strong>{error === 'restart' ? 'Restart to finish Repository map' : 'Repository map unavailable'}</strong>
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
    <section className={'co-sources' + (mobileOpen ? ' is-detail-open' : '')} aria-labelledby="co-sources-title">
      <div className="co-sources-head">
        <div>
          <h2 id="co-sources-title">Repository map</h2>
          <p>
            <strong>{summary.sources}</strong> Git repositories · <strong>{summary.different}</strong> different from origin ·{' '}
            <strong>{summary.active}</strong> active PRs · <strong>{summary.forks}</strong> forks
          </p>
        </div>
        <div className="co-sources-fresh">
          {compared && <span>{compared}</span>}
          <button type="button" className="co-btn co-btn-sm" onClick={onRetry} disabled={loading}>
            {loading ? 'Comparing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {conn?.state !== 'connected' && (
        <div className="co-source-note">Local positions are current; GitHub PR states may be older.</div>
      )}

      <div className="co-source-toolbar">
        <div className="co-source-filters" role="group" aria-label="Filter repositories">
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
        {summary.adapted > 0 && <span className="co-adapted-note">{summary.adapted} installs adapted safely</span>}
      </div>

      {filtered.length === 0 ? (
        <div className="co-source-no-results">No repositories match this filter.</div>
      ) : (
        <div className={'co-source-layout' + (mobileOpen ? ' is-mobile-open' : '')}>
          <div className="co-source-list">
            {filtered.map((project) => (
              <ProjectRow
                key={project.key}
                project={project}
                selected={project.key === selectedProject?.key}
                onSelect={(key) => { setSelected(key); setMobileOpen(true) }}
              />
            ))}
          </div>
          {selectedProject && (
            <aside className="co-source-desktop-detail">
              <button type="button" className="co-map-back" onClick={() => setMobileOpen(false)}>
                <span aria-hidden="true">←</span> Repositories
              </button>
              <ProjectDetail project={selectedProject} onShowContributions={onShowContributions} />
            </aside>
          )}
        </div>
      )}
    </section>
  )
}
