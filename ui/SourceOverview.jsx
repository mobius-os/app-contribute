import React, { useState } from 'react'
import { projectNeedsPreparation, projectStatus } from '../source-map.js'
import { contributionActionScope, contributionCycleProgress } from '../review.js'
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

function TaskRow({ title, detail, count, tone = '', onOpen }) {
  return (
    <button type="button" className={'co-workspace-task ' + tone} onClick={onOpen}>
      <span className="co-workspace-task-top">
        <strong>{title}</strong>
        <em>{count}</em>
      </span>
      <span className="co-workspace-task-copy">{detail}</span>
    </button>
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
  const storedPhase = cycle?.phase || 'idle'
  const currentScope = contributionActionScope(cycleAction)
  const earlier = !!cycleAction && !!currentScope && currentScope !== cycle?.scope
  const phase = earlier && ['complete', 'stopped'].includes(storedPhase)
    ? 'idle'
    : storedPhase
  if (!cycleAction && phase === 'idle') return null
  const progress = contributionCycleProgress(cycle?.runtime)
  const busy = ['checking', 'starting', 'stopping'].includes(phase)
  const running = phase === 'running'
  const canOpen = !!cycle?.chatId
  const title = earlier && ['paused', 'failed'].includes(phase)
    ? (phase === 'paused' ? 'Earlier work paused' : 'Earlier work stopped')
    : ({
    idle: 'Organize private work',
    checking: 'Checking current work…',
    starting: 'Starting one conversation…',
    running: 'Reviewing private work',
    stopping: 'Stopping safely…',
    stopped: 'Work stopped',
    waiting: 'Your input is needed',
    paused: 'Work paused',
    failed: 'Work stopped with a problem',
    complete: 'Private work organized',
  }[phase] || 'Contribution work')
  const detail = earlier && ['paused', 'failed'].includes(phase)
    ? 'That conversation is still available. The latest changes can be organized separately.'
    : ({
    idle: 'Status and reconciliation are automatic. One background review handles only work that needs judgment.',
    checking: 'Restoring the latest progress.',
    starting: 'Opening it while you stay in Contribute.',
    stopping: 'Finishing the current safe step before stopping.',
    stopped: 'No further work is running.',
    waiting: 'Open the conversation to answer the pending decision.',
    paused: 'Open the conversation when you are ready to continue.',
    failed: 'Open the conversation for details, or try the current work again.',
    complete: 'Projects and pull requests reflect the latest completed private work.',
  }[phase])

  return (
    <section className={'co-cycle-card is-' + phase} aria-live="polite">
      <span className="co-cycle-mark" aria-hidden="true">
        {busy || running
          ? <span className="ma-spinner is-compact" />
          : <Icon name={phase === 'complete' ? 'check' : phase === 'waiting' ? 'feedback' : 'cycle'} size={18} />}
      </span>
      <div className="co-cycle-copy">
        <h2>{title}</h2>
        {running ? <p>Preparing and reviewing only the work that needs judgment.</p> : <p>{detail}</p>}
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
            <Icon name="cycle" size={15} /> {cycleAction?.label || 'Organize all'}
          </button>
        ) : null}
        {running ? (
          <button type="button" className="co-btn co-btn-sm co-cycle-stop" onClick={onStop}>
            Stop
          </button>
        ) : null}
        {canOpen && !busy ? (
          <button type="button" className="co-btn co-btn-sm" onClick={onOpen}>Open conversation</button>
        ) : null}
        {['stopped', 'paused', 'failed', 'complete'].includes(phase) && cycleAction ? (
          <button type="button" className="co-btn co-btn-sm" onClick={onStart}>
            {earlier ? 'Organize latest work' : 'Organize current work'}
          </button>
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
  const reviewAttention = needsReview + changesNeeded
  const projectAttention = (projects || []).filter((project) => (
    projectNeedsPreparation(project)
    || Number(project.incomingFiles || 0) > 0
    || (project.contributions || []).some((record) => record.needs_attention)
  )).length
  const hasTasks = projectAttention > 0 || reviewAttention > 0 || reviewing > 0 ||
    allClear > 0 || (incomingReviews || []).length > 0

  return (
    <section id="co-panel-overview" className="co-workspace" role="tabpanel" aria-labelledby="co-tab-overview">
      <CycleCard
        cycleAction={cycleAction}
        cycle={cycle}
        onStart={onStartCycle}
        onStop={onStopCycle}
        onOpen={onOpenCycle}
      />
      <section className="co-workspace-section" aria-labelledby="co-workspace-attention">
        <SectionHeading id="co-workspace-attention" title="Needs you" />
        {(incomingReviews || []).length > 0 ? (
          <div className="co-workspace-card co-incoming-list">
            {incomingReviews.map((item) => (
              <IncomingReview key={item.url} item={item} onAssign={onAssignIncomingReview} />
            ))}
          </div>
        ) : null}
        <div className="co-workspace-card-list">
          {projectAttention > 0 ? (
            <TaskRow
              title={`${projectAttention} ${projectAttention === 1 ? 'project needs' : 'projects need'} attention`}
              detail="Prepare local work, understand overlaps, or align shared changes."
              count={projectAttention}
              tone="is-call"
              onOpen={onViewProjects}
            />
          ) : null}
          {reviewAttention > 0 ? (
            <TaskRow
              title={`${reviewAttention} ${reviewAttention === 1 ? 'pull request needs' : 'pull requests need'} review`}
              detail="Review or fix the private work before anything is published."
              count={reviewAttention}
              tone="is-call"
              onOpen={onViewReviews}
            />
          ) : null}
          {allClear > 0 ? (
            <TaskRow
              title={`${allClear} ${allClear === 1 ? 'pull request is' : 'pull requests are'} ready to send`}
              detail="The current versions passed review and are waiting for your public approval."
              count={allClear}
              tone="is-call"
              onOpen={onViewReviews}
            />
          ) : null}
          {!hasTasks ? (
            <div className="co-workspace-card co-workspace-empty-row is-clear">
              <strong>You’re caught up</strong>
              <small>There are no contribution decisions waiting for you. Status and reconciliation continue automatically.</small>
            </div>
          ) : null}
          {reviewing > 0 ? (
            <div className="co-workspace-status-row">
              <span className="ma-spinner is-compact" aria-hidden="true" />
              {reviewing} {reviewing === 1 ? 'review is' : 'reviews are'} already in progress
            </div>
          ) : null}
        </div>
      </section>

      <section className="co-workspace-section" aria-labelledby="co-workspace-projects">
        <SectionHeading id="co-workspace-projects" title="Projects" action="All projects" onAction={onViewProjects} />
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

      {omittedCount > 0 ? (
        <p className="co-workspace-maintenance" role="status">
          <Icon name="fix" size={13} />
          {omittedCount} contribution {omittedCount === 1 ? 'record could' : 'records could'} not be shown.
        </p>
      ) : null}

    </section>
  )
}
