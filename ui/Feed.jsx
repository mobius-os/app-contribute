import React, { useEffect, useMemo, useState } from 'react'
import { ContributionCard } from './ContributionCard.jsx'
import { ContributionStack } from './ContributionStack.jsx'
import { preparedContributionUnits, publicContributionUnits, stackLandable } from '../stack.js'
import {
  partitionReviewUnits,
  locateContributionReview,
  prePrCheckPhase,
  qualityReviewFor,
  reviewStateFor,
} from '../review.js'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import { historyContributionLabel, STATUS_LABELS, timeAgo } from '../domain.js'

const REVIEW_STAGES = [
  ['action', 'Needs action'],
  ['working', 'In review'],
  ['clear', 'All clear'],
  ['open', 'Open'],
  ['history', 'History'],
]

const REQUEST_STAGES = [
  ['action', 'Drafts'],
  ['open', 'Published'],
  ['history', 'History'],
]

const STAGE_PAGE_SIZE = 16

function unitRecords(unit) {
  return unit.records || (unit.record ? [unit.record] : [])
}

function primaryRecord(unit) {
  return unit.record || unit.records?.[0] || null
}

function unitRepo(unit) {
  const rec = primaryRecord(unit)
  return rec?.plan?.repo || rec?.repo || 'Other'
}

function unitTitle(unit) {
  if (unit.type === 'stack') return unit.name || 'Related pull requests'
  const rec = primaryRecord(unit)
  return rec?.plan?.title || rec?.title || rec?.summary || 'Untitled contribution'
}

function unitKey(unit) {
  return `${unit.type || 'single'}:${unit.id || primaryRecord(unit)?.id}`
}

function phaseLabel(unit, phase, reviewStatus) {
  const records = unitRecords(unit)
  if (phase === 'clear') return 'All clear'
  if (phase === 'working') {
    if (records.some((rec) => prePrCheckPhase(rec) === 'running')) return 'Checks running'
    return 'Reviewing'
  }
  if (phase === 'open') return records.some((rec) => rec.status === 'submitting') ? 'Publishing' : 'Open'
  if (phase === 'history') return historyContributionLabel(records[0]?.status)
  if (records.some((rec) => reviewStateFor(rec, reviewStatus)?.state === 'needs_refresh')) return 'Needs update'
  if (records.some((rec) => qualityReviewFor(rec).state === 'changes_needed')) return 'Needs fixes'
  return records[0]?.type === 'pr' ? 'Review needed' : 'Draft'
}

function groupByProject(units, projects) {
  const projectByRepo = new Map((projects || []).map((project) => [
    String(project.canonical_repo || '').toLowerCase(), project,
  ]))
  const grouped = new Map()
  for (const unit of units) {
    const repo = unitRepo(unit)
    const key = repo.toLowerCase()
    if (!grouped.has(key)) grouped.set(key, { repo, project: projectByRepo.get(key), units: [] })
    grouped.get(key).units.push(unit)
  }
  return [...grouped.values()].sort((a, b) =>
    (a.project?.name || a.repo).localeCompare(b.project?.name || b.repo))
}

function StageNav({ stages, phaseUnits, active, onChange, label }) {
  return (
    <nav className="co-stage-nav" aria-label={label}>
      {stages.map(([key, title]) => (
        <button
          type="button"
          key={key}
          className={active === key ? 'is-active' : ''}
          aria-pressed={active === key}
          onClick={() => onChange(key)}
        >
          <span>{title}</span><b>{phaseUnits[key]?.length || 0}</b>
        </button>
      ))}
    </nav>
  )
}

function ListContinuation({ shown, total, onContinue }) {
  if (shown >= total) return null
  const next = Math.min(STAGE_PAGE_SIZE, total - shown)
  return (
    <button type="button" className="co-list-continuation" onClick={onContinue}>
      <span>Show next {next}</span>
      <small>{total - shown} remaining</small>
      <Icon name="chevron" size={14} />
    </button>
  )
}

function ReviewRow({ unit, phase, reviewStatus, onSelect }) {
  const count = unitRecords(unit).length
  const record = primaryRecord(unit)
  const detail = count > 1
    ? `${count} linked pull requests`
    : phase === 'history'
      ? timeAgo(record?.updated_at || record?.created_at)
      : ''
  return (
    <button type="button" className={'co-review-row' + (detail ? '' : ' is-compact')} onClick={onSelect}>
      <span className="co-review-row-copy">
        <strong>{unitTitle(unit)}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      <span className={'co-review-state is-' + phase}>{phaseLabel(unit, phase, reviewStatus)}</span>
      <Icon name="right" size={14} />
    </button>
  )
}

function ReviewList({ units, phase, projects, reviewStatus, onSelect }) {
  const groups = groupByProject(units, projects)
  return (
    <div className="co-review-list">
      {groups.map((group) => (
        <section className="co-review-project" key={group.repo}>
          <header>
            <ProjectIcon project={group.project || { name: group.repo }} />
            <strong>{group.project?.name || group.repo}</strong>
            <span>{group.units.length}</span>
          </header>
          {group.units.map((unit) => (
            <ReviewRow
              key={unitKey(unit)}
              unit={unit}
              phase={phase}
              reviewStatus={reviewStatus}
              onSelect={() => onSelect(unit)}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function SelectedUnit({
  unit,
  phase,
  reviewStatus,
  onSend,
  onRunPrePrChecks,
  onSendStack,
  onLandStack,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  onStartAgent,
  loadDiff,
}) {
  if (unit.type === 'stack') {
    return (
      <ContributionStack
        unit={unit}
        action={phase === 'open' ? 'land' : 'send'}
        landable={phase === 'open' ? stackLandable(unit) : false}
        reviewStatus={reviewStatus}
        onSendStack={onSendStack}
        onLandStack={onLandStack}
        onFeedback={onFeedback}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  const rec = primaryRecord(unit)
  return (
    <ContributionCard
      key={rec.id}
      rec={rec}
      reviewState={reviewStateFor(rec, reviewStatus)}
      onSend={onSend}
      onRunPrePrChecks={onRunPrePrChecks}
      onReview={onStartAgent}
      onFeedback={onFeedback}
      onDismiss={onDismiss}
      onRestore={onRestore}
      onSetAutopilot={onSetAutopilot}
      onWithdraw={onWithdraw}
      onConnectApp={onConnectApp}
      loadDiff={loadDiff}
      initialExpanded
    />
  )
}

function ViewHeading({ title, description }) {
  return (
    <header className="co-view-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
    </header>
  )
}

const REVIEW_EMPTY_STAGES = {
  action: {
    icon: 'check',
    tone: 'is-clear',
    title: 'No reviews need action',
    detail: 'Prepared work will appear here when it needs your decision.',
  },
  working: {
    icon: 'review',
    title: 'No reviews in progress',
    detail: 'Reviews and checks that are running will appear here.',
  },
  clear: {
    icon: 'check',
    title: 'Nothing ready to send',
    detail: 'Reviewed work appears here once its current version is all clear.',
  },
  open: {
    icon: 'merge',
    title: 'No open pull requests',
    detail: 'Published pull requests stay here until they merge or close.',
  },
  history: {
    icon: 'cycle',
    title: 'No review history yet',
    detail: 'Finished and deliberately dropped contributions will collect here.',
  },
}

const REQUEST_EMPTY_STAGES = {
  action: {
    icon: 'check',
    tone: 'is-clear',
    title: 'No request drafts',
    detail: 'Requests prepared for your decision will appear here.',
  },
  open: {
    icon: 'send',
    title: 'No published requests',
    detail: 'Published issues and comments will appear here while they are active.',
  },
  history: {
    icon: 'cycle',
    title: 'No request history yet',
    detail: 'Settled requests will collect here.',
  },
}

function EmptyStage({ phase, requests = false }) {
  const copy = (requests ? REQUEST_EMPTY_STAGES : REVIEW_EMPTY_STAGES)[phase]
  return (
    <div className={'co-stage-empty ' + (copy?.tone || '')}>
      <Icon name={copy?.icon || 'check'} size={20} />
      <strong>{copy?.title || 'Nothing here'}</strong>
      <span>{copy?.detail || 'This stage is empty.'}</span>
    </div>
  )
}

function ReviewWorkspace({
  groups,
  records,
  projects,
  reviewStatus,
  onSend,
  onRunPrePrChecks,
  onSendStack,
  onLandStack,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  onStartAgent,
  loadDiff,
  focusTarget,
  focusReady,
  onFocusConsumed,
}) {
  const readyUnits = useMemo(
    () => preparedContributionUnits(groups.ready, records),
    [groups.ready, records],
  )
  const openUnits = useMemo(
    () => publicContributionUnits(groups.open, records),
    [groups.open, records],
  )
  const historyUnits = useMemo(
    () => groups.history.map((record) => ({ type: 'single', id: record.id, record, records: [record] })),
    [groups.history],
  )
  const partition = useMemo(
    () => partitionReviewUnits(readyUnits, reviewStatus),
    [readyUnits, reviewStatus],
  )
  const phaseUnits = useMemo(() => ({
    action: [...partition.needsAttention, ...partition.needsReview],
    working: [...partition.reviewing, ...partition.checking],
    clear: partition.readyToSend,
    open: openUnits,
    history: historyUnits,
  }), [partition.needsAttention, partition.needsReview, partition.reviewing, partition.checking, partition.readyToSend, openUnits, historyUnits])
  const firstNonempty = REVIEW_STAGES.find(([key]) => phaseUnits[key]?.length)?.[0] || 'action'
  const [filter, setFilter] = useState(firstNonempty)
  const [selectedKey, setSelectedKey] = useState(null)
  const [missingTarget, setMissingTarget] = useState(false)
  const [visibleLimit, setVisibleLimit] = useState(STAGE_PAGE_SIZE)

  const selected = useMemo(() => {
    if (!selectedKey) return null
    for (const units of Object.values(phaseUnits)) {
      const match = (units || []).find((unit) => unitKey(unit) === selectedKey)
      if (match) return match
    }
    return null
  }, [phaseUnits, selectedKey])

  useEffect(() => {
    if (!focusTarget?.recordId || !focusReady) return
    const located = locateContributionReview(phaseUnits, focusTarget.recordId)
    if (located) {
      setFilter(located.phase)
      setSelectedKey(unitKey(located.unit))
      setMissingTarget(false)
      setVisibleLimit(STAGE_PAGE_SIZE)
      onFocusConsumed?.(focusTarget.nonce)
      return
    }
    setSelectedKey(null)
    setMissingTarget(true)
    onFocusConsumed?.(focusTarget.nonce)
  }, [focusTarget, focusReady, phaseUnits, onFocusConsumed])

  const visibleUnits = phaseUnits[filter] || []
  const renderedUnits = visibleUnits.slice(0, visibleLimit)
  const copy = {
    action: ['Needs action', 'Review and improve this private work before anything is published.'],
    working: ['In review', 'Agents and checks currently working through prepared contributions.'],
    clear: ['All clear', 'Reviewed work whose exact current version is ready for your public approval.'],
    open: ['Open', 'Published pull requests moving through checks, feedback, and merge.'],
    history: ['History', 'Merged, closed, superseded, and deliberately dropped work.'],
  }[filter]

  if (missingTarget) {
    return (
      <section className="co-review-workspace is-focus">
        <h2 className="co-visually-hidden">Contribution review</h2>
        <div className="co-focus-view">
          <button type="button" className="co-focus-back" onClick={() => setMissingTarget(false)}>
            <Icon name="left" size={15} /> Back to reviews
          </button>
          <div className="co-stage-empty">
            <Icon name="cycle" size={20} />
            <strong>Review no longer available</strong>
            <span>Refresh Contribute or return to the source conversation for its latest state.</span>
          </div>
        </div>
      </section>
    )
  }

  if (selected) {
    return (
      <section className="co-review-workspace is-focus">
        <h2 className="co-visually-hidden">Contribution review</h2>
        <div className="co-focus-view">
          <button type="button" className="co-focus-back" onClick={() => setSelectedKey(null)}>
            <Icon name="left" size={15} /> Back to {copy[0].toLowerCase()}
          </button>
          <SelectedUnit
            unit={selected}
            phase={filter}
            reviewStatus={reviewStatus}
            onSend={onSend}
            onRunPrePrChecks={onRunPrePrChecks}
            onSendStack={onSendStack}
            onLandStack={onLandStack}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onSetAutopilot={onSetAutopilot}
            onWithdraw={onWithdraw}
            onConnectApp={onConnectApp}
            onStartAgent={onStartAgent}
            loadDiff={loadDiff}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="co-review-workspace">
      <ViewHeading title="Reviews" description="Move each contribution from private review to a deliberate public handoff." />
      <StageNav
        stages={REVIEW_STAGES}
        phaseUnits={phaseUnits}
        active={filter}
        onChange={(next) => {
          setFilter(next)
          setSelectedKey(null)
          setMissingTarget(false)
          setVisibleLimit(STAGE_PAGE_SIZE)
        }}
        label="Review stages"
      />
      <section className="co-stage-intro" aria-labelledby="co-review-stage-title">
        <div><h3 id="co-review-stage-title">{copy[0]}</h3><p>{copy[1]}</p></div>
      </section>
      {visibleUnits.length ? (
        <ReviewList
          units={renderedUnits}
          phase={filter}
          projects={projects}
          reviewStatus={reviewStatus}
          onSelect={(unit) => setSelectedKey(unitKey(unit))}
        />
      ) : <EmptyStage phase={filter} />}
      <ListContinuation
        shown={renderedUnits.length}
        total={visibleUnits.length}
        onContinue={() => setVisibleLimit((current) => current + STAGE_PAGE_SIZE)}
      />
    </section>
  )
}

function requestKind(rec) {
  if (rec?.type === 'issue_comment') return 'Issue comment'
  if (rec?.type === 'discussion_comment') return 'Discussion reply'
  return 'Issue'
}

function RequestCard({ unit, phase, project, onSelect }) {
  const rec = primaryRecord(unit)
  const history = phase === 'history'
  const status = phase === 'action'
    ? 'Draft'
    : history
      ? STATUS_LABELS[rec?.status] || 'Settled'
      : 'Published'
  const context = [
    requestKind(rec),
    project?.name || unitRepo(unit),
    history ? timeAgo(rec?.updated_at || rec?.created_at) : '',
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" className={'co-request-card' + (history ? ' is-history' : '')} onClick={onSelect}>
      <ProjectIcon project={project || { name: unitRepo(unit) }} className="co-request-project" />
      <span className="co-request-copy">
        <small>{context}</small>
        <strong>{unitTitle(unit)}</strong>
        {!history && rec?.summary ? <span>{rec.summary}</span> : null}
      </span>
      <em className={'is-' + phase}>{status}</em>
      <Icon name="right" size={15} />
    </button>
  )
}

function RequestsWorkspace({
  groups,
  records,
  projects,
  reviewStatus,
  onSend,
  onRunPrePrChecks,
  onSendStack,
  onLandStack,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  onStartAgent,
  loadDiff,
}) {
  const phaseUnits = useMemo(() => ({
    action: groups.ready.map((record) => ({ type: 'single', id: record.id, record, records: [record] })),
    open: groups.open.map((record) => ({ type: 'single', id: record.id, record, records: [record] })),
    history: groups.history.map((record) => ({ type: 'single', id: record.id, record, records: [record] })),
  }), [groups.ready, groups.open, groups.history])
  const firstNonempty = REQUEST_STAGES.find(([key]) => phaseUnits[key]?.length)?.[0] || 'action'
  const [filter, setFilter] = useState(firstNonempty)
  const [selected, setSelected] = useState(null)
  const [visibleLimit, setVisibleLimit] = useState(STAGE_PAGE_SIZE)
  const projectByRepo = useMemo(() => new Map((projects || []).map((project) => [
    String(project.canonical_repo || '').toLowerCase(), project,
  ])), [projects])
  const visibleUnits = phaseUnits[filter] || []
  const renderedUnits = visibleUnits.slice(0, visibleLimit)
  const stageLabel = REQUEST_STAGES.find(([key]) => key === filter)?.[1] || 'requests'

  if (selected) {
    return (
      <section className="co-requests-workspace is-focus">
        <h2 className="co-visually-hidden">Request detail</h2>
        <div className="co-focus-view co-request-focus">
          <button type="button" className="co-focus-back" onClick={() => setSelected(null)}>
            <Icon name="left" size={15} /> Back to {stageLabel.toLowerCase()}
          </button>
          <SelectedUnit
            unit={selected}
            phase={filter}
            reviewStatus={reviewStatus}
            onSend={onSend}
            onRunPrePrChecks={onRunPrePrChecks}
            onSendStack={onSendStack}
            onLandStack={onLandStack}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onSetAutopilot={onSetAutopilot}
            onWithdraw={onWithdraw}
            onConnectApp={onConnectApp}
            onStartAgent={onStartAgent}
            loadDiff={loadDiff}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="co-requests-workspace">
      <ViewHeading title="Requests" description="Decide what to ask, say, or publish without losing the conversation that shaped it." />
      <StageNav
        stages={REQUEST_STAGES}
        phaseUnits={phaseUnits}
        active={filter}
        onChange={(next) => {
          setFilter(next)
          setSelected(null)
          setVisibleLimit(STAGE_PAGE_SIZE)
        }}
        label="Request stages"
      />
      {visibleUnits.length ? (
        <div className="co-request-list">
          {renderedUnits.map((unit) => {
            const project = projectByRepo.get(unitRepo(unit).toLowerCase())
            return (
              <RequestCard
                key={unitKey(unit)}
                unit={unit}
                phase={filter}
                project={project}
                onSelect={() => setSelected(unit)}
              />
            )
          })}
        </div>
      ) : <EmptyStage phase={filter} requests />}
      <ListContinuation
        shown={renderedUnits.length}
        total={visibleUnits.length}
        onContinue={() => setVisibleLimit((current) => current + STAGE_PAGE_SIZE)}
      />
    </section>
  )
}

export function Feed(props) {
  const isPrFeed = props.records.some((rec) => rec.type === 'pr')
  return isPrFeed ? <ReviewWorkspace {...props} /> : <RequestsWorkspace {...props} />
}
