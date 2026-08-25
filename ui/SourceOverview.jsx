import React, { useState } from 'react'
import { projectStatus } from '../source-map.js'
import { contributionCycleProgress } from '../review.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

function SectionHeading({ id, title, action, onAction }) {
  return (
    <header className="co-workspace-section-head">
      <h2 id={id}>{title}</h2>
      {action ? <button type="button" onClick={onAction}>{action}<Icon name="right" size={14} /></button> : null}
    </header>
  )
}

function ReviewStep({ icon, label, count, tone = '' }) {
  return (
    <span className={'co-review-step ' + tone}>
      <Icon name={icon} size={15} />
      <strong>{count}</strong>
      <small>{label}</small>
    </span>
  )
}

function IncomingReview({ item, onAssign }) {
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')
  async function assign() {
    setState('busy')
    setError('')
    const outcome = await onAssign?.(item)
    if (outcome?.ok) setState('done')
    else {
      setState('idle')
      setError(outcome?.error || 'Could not start this review.')
    }
  }
  if (state === 'done') return null
  return (
    <article className="co-incoming-review">
      <span><strong>{item.title}</strong><small>{item.repository?.nameWithOwner} #{item.number}</small></span>
      <button type="button" className="co-btn co-btn-primary co-btn-sm" disabled={state === 'busy'} onClick={assign}>
        <Icon name="review" size={14} />{state === 'busy' ? 'Assigning…' : 'Assign & review'}
      </button>
      {error ? <small className="co-incoming-error">{error}</small> : null}
    </article>
  )
}

function CycleCard({ cycleAction, cycle, onStart, onStop, onOpen }) {
  const phase = cycle?.phase || 'idle'
  if (!cycleAction && phase === 'idle') return null
  const progress = contributionCycleProgress(cycle?.runtime)
  const busy = ['checking', 'starting', 'stopping'].includes(phase)
  const running = phase === 'running'
  const canOpen = !!cycle?.chatId
  const title = {
    idle: 'Run contribution cycle',
    checking: 'Checking contribution cycle…',
    starting: 'Starting contribution cycle…',
    running: 'Cycle in progress',
    stopping: 'Stopping contribution cycle…',
    stopped: 'Cycle stopped',
    waiting: 'Cycle needs you',
    paused: 'Cycle paused',
    failed: 'Cycle stopped with a problem',
    complete: 'Cycle finished',
  }[phase] || 'Contribution cycle'
  const detail = {
    idle: 'Prepares and reviews what needs attention. Nothing goes public without your approval.',
    checking: 'Restoring the latest progress.',
    starting: 'Opening one agent conversation while you stay here.',
    stopping: 'Asking the active agent to stop safely.',
    stopped: 'No further work is running.',
    waiting: 'Open the conversation to answer the pending decision.',
    paused: 'Open the conversation when you are ready to continue.',
    failed: 'Open the conversation for details, or start a fresh cycle.',
    complete: 'Projects and reviews now reflect the latest completed work.',
  }[phase]

  return (
    <section className={'co-cycle-card is-' + phase} aria-live="polite">
      <span className="co-cycle-mark" aria-hidden="true">
        {busy || running
          ? <span className="ma-spinner is-compact" />
          : <Icon name={phase === 'complete' ? 'check' : phase === 'waiting' ? 'feedback' : 'cycle'} size={18} />}
      </span>
      <div className="co-cycle-copy">
        <h2>{title}</h2>
        {running ? <p>{progress.label}</p> : <p>{detail}</p>}
        {running && progress.total > 0 ? (
          <div className="co-cycle-progress">
            <span><i style={{ transform: `scaleX(${progress.percent / 100})` }} /></span>
            <small>{progress.completed} of {progress.total} complete</small>
          </div>
        ) : null}
        {cycle?.error ? <small className="co-cycle-error" role="alert">{cycle.error}</small> : null}
      </div>
      <div className="co-cycle-actions">
        {phase === 'idle' ? (
          <button type="button" className="co-btn co-btn-primary co-btn-sm" disabled={!cycleAction} onClick={onStart}>
            <Icon name="cycle" size={15} /> Start cycle
          </button>
        ) : null}
        {running ? (
          <button type="button" className="co-btn co-btn-sm co-cycle-stop" onClick={onStop}>
            Stop
          </button>
        ) : null}
        {canOpen && !busy ? (
          <button type="button" className="co-cycle-link" onClick={onOpen}>Open conversation</button>
        ) : null}
        {['stopped', 'paused', 'failed', 'complete'].includes(phase) && cycleAction ? (
          <button type="button" className="co-cycle-link" onClick={onStart}>Run again</button>
        ) : null}
      </div>
    </section>
  )
}

export function ContributionOverview({
  projects,
  loading,
  reviewSummary,
  incomingReviews,
  onAssignIncomingReview,
  onViewProjects,
  onViewProject,
  onViewReviews,
  cycleAction,
  cycle,
  omittedCount,
  onStartCycle,
  onStopCycle,
  onOpenCycle,
}) {
  const rows = (projects || []).slice(0, 3)
  const reviews = reviewSummary || {}
  const allClear = Number(reviews.allClear || 0)
  const needsReview = Number(reviews.needed || 0)
  const reviewing = Number(reviews.reviewing || 0)
  const changesNeeded = Number(reviews.changesNeeded || 0)

  return (
    <section id="co-panel-overview" className="co-workspace" role="tabpanel" aria-labelledby="co-tab-overview">
      <CycleCard
        cycleAction={cycleAction}
        cycle={cycle}
        onStart={onStartCycle}
        onStop={onStopCycle}
        onOpen={onOpenCycle}
      />
      <section className="co-workspace-section" aria-labelledby="co-workspace-projects">
        <SectionHeading id="co-workspace-projects" title="Projects" action="View all" onAction={onViewProjects} />
        <div className="co-workspace-card co-workspace-projects">
          {loading ? (
            <div className="co-workspace-loading" role="status" aria-live="polite">
              <span className="ma-spinner is-compact" aria-hidden="true" />
              <strong>Checking projects…</strong>
            </div>
          ) : rows.length > 0 ? rows.map((project) => {
            const status = projectStatus(project)
            return (
              <button type="button" className="co-workspace-project" key={project.key} onClick={() => onViewProject?.(project.key)}>
                <ProjectIcon project={project} className="co-workspace-project-mark" />
                <span><strong>{project.name}</strong><small>{project.summary || project.canonical_repo || 'Local project'}</small></span>
                <em className={'tone-' + status.tone}>{status.label}</em>
              </button>
            )
          }) : (
            <div className="co-workspace-empty-row"><strong>No local changes</strong></div>
          )}
        </div>
      </section>

      {(incomingReviews || []).length > 0 ? (
        <section className="co-workspace-section" aria-labelledby="co-workspace-incoming">
          <SectionHeading id="co-workspace-incoming" title="Needs you" />
          <div className="co-workspace-card co-incoming-list">
            {incomingReviews.map((item) => (
              <IncomingReview key={item.url} item={item} onAssign={onAssignIncomingReview} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="co-workspace-section" aria-labelledby="co-workspace-reviews">
        <SectionHeading id="co-workspace-reviews" title="Review queue" action="Open" onAction={onViewReviews} />
        <button type="button" className="co-workspace-card co-review-pipeline" onClick={onViewReviews}>
          <ReviewStep icon="review" label="To review" count={needsReview} />
          <ReviewStep icon="refresh" label="Reviewing" count={reviewing} tone="is-progress" />
          <ReviewStep icon="fix" label="Needs fixes" count={changesNeeded} tone="is-warn" />
          <ReviewStep icon="check" label="All clear" count={allClear} tone="is-clear" />
        </button>
      </section>

      {omittedCount > 0 ? (
        <p className="co-workspace-maintenance" role="status">
          <Icon name="fix" size={13} />
          {omittedCount} contribution {omittedCount === 1 ? 'record could' : 'records could'} not be shown.
        </p>
      ) : null}

    </section>
  )
}
