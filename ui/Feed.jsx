import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ContributionCard, ContributionDecision } from './ContributionCard.jsx'
import { ContributionStack } from './ContributionStack.jsx'
import { preparedContributionUnits, publicContributionUnits, stackLandable } from '../stack.js'
import {
  actionQueueDefaultAction,
  partitionReviewUnits,
  fixAndReviewAction,
  locateContributionReview,
  prePrCheckPhase,
  progressReviewAction,
  qualityReviewFor,
  recoveryReviewAction,
  reviewStateFor,
} from '../review.js'
import { AgentHandoffButton, openAgentConversation } from './BatchAction.jsx'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'
import { historyContributionLabel, STATUS_LABELS, timeAgo } from '../domain.js'

const REVIEW_STAGES = [
  ['action', 'Needs you'],
  ['working', 'In progress'],
  ['clear', 'Ready to send'],
  ['open', 'Published'],
  ['history', 'Past'],
]

const REQUEST_STAGES = [
  ['action', 'Drafts'],
  ['open', 'Published'],
  ['history', 'Past'],
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
  if (phase === 'clear') return 'Ready to send'
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
          className={(active === key ? 'is-active' : '') + (key === 'history' ? ' is-secondary' : '')}
          aria-pressed={active === key}
          onClick={() => onChange(key)}
        >
          <span>{title}</span>{key === 'history' ? null : <b>{phaseUnits[key]?.length || 0}</b>}
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

function ReviewRow({
  unit, phase, reviewStatus, onSelect, onStartAgent, onSend,
}) {
  const count = unitRecords(unit).length
  const record = primaryRecord(unit)
  const [busy, setBusy] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [startedChatId, setStartedChatId] = useState('')
  const [note, setNote] = useState('')
  const detail = count > 1
    ? `${count} linked pull requests`
    : phase === 'history'
      ? timeAgo(record?.updated_at || record?.created_at)
      : ''
  const privateAction = phase === 'action'
    ? actionQueueDefaultAction(unitRecords(unit), reviewStatus)
    : null
  const canPublishHere = phase === 'clear' && unit.type !== 'stack'
  const actionLabel = privateAction
    ? (startedChatId ? 'Open review' : privateAction.label)
    : canPublishHere
      ? (record?.plan?.action === 'pr_update' ? 'Update' : 'Send')
      : 'View'

  async function runDefault() {
    if (busy) return
    if (!privateAction && !canPublishHere) {
      onSelect()
      return
    }
    if (startedChatId) {
      openAgentConversation(startedChatId)
      return
    }
    setAccepted(true)
    setBusy(true)
    setNote('')
    try {
      const outcome = privateAction
        ? await onStartAgent?.(privateAction)
        : await onSend?.(record)
      if (privateAction && outcome?.ok) {
        setStartedChatId(String(outcome.chatId || ''))
      } else if (!privateAction && (outcome?.ok || outcome?.pending || outcome?.alreadyHandled)) {
        // The authoritative feed will place the record in its next stage.
      } else {
        const recovery = !privateAction
          ? await onStartAgent?.(recoveryReviewAction(record))
          : null
        if (!recovery?.ok) {
          setAccepted(false)
          setNote(outcome?.error || recovery?.error || 'Try again')
        }
      }
    } catch {
      setAccepted(false)
      setNote('Try again')
    } finally {
      setBusy(false)
    }
  }

  if (accepted) return null

  return (
    <div className={'co-review-row' + (detail ? '' : ' is-compact')}>
      <button type="button" className="co-review-row-main" onClick={onSelect}>
      <span className="co-review-row-copy">
        <strong>{unitTitle(unit)}</strong>
        {note ? <small role="status">{note}</small> : detail ? <small>{detail}</small> : null}
      </span>
      <span className={'co-review-state is-' + phase}>{phaseLabel(unit, phase, reviewStatus)}</span>
      </button>
      <button
        type="button"
        className={'co-review-default' + (privateAction || canPublishHere ? ' is-primary' : '')}
        disabled={busy}
        aria-busy={busy}
        onClick={runDefault}
      >
        {busy ? 'Working…' : actionLabel}
      </button>
    </div>
  )
}

function ReviewList({
  units, phase, projects, reviewStatus, onSelect, onStartAgent, onSend,
}) {
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
              onStartAgent={onStartAgent}
              onSend={onSend}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function BatchPublishAction({ units, onSend, onStartAgent }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [accepted, setAccepted] = useState(false)
  const cancelRef = useRef(null)
  const descriptionId = useId()
  // A stack has its own confirmation that names every layer and base → branch
  // pair. Keep the stage shortcut to independent PRs so it cannot bypass that
  // stronger approval boundary.
  const preparedUnits = units.filter((unit) => (
    unit.type !== 'stack' && primaryRecord(unit)?.status === 'prepared'
  ))
  const prepared = preparedUnits.map(primaryRecord)
  useEffect(() => {
    if (confirming) cancelRef.current?.focus()
  }, [confirming])
  if (prepared.length < 2) return null

  async function publishAll() {
    if (busy) return
    const snapshot = [...preparedUnits]
    setAccepted(true)
    setBusy(true)
    setNote('')
    let completed = 0
    const failedRecords = []
    for (const unit of snapshot) {
      try {
        const outcome = await onSend?.(primaryRecord(unit))
        if (outcome?.ok || outcome?.pending || outcome?.alreadyHandled) completed += 1
        else failedRecords.push(primaryRecord(unit))
      } catch {
        failedRecords.push(primaryRecord(unit))
      }
    }
    if (failedRecords.length > 0) {
      const recovery = await onStartAgent?.(fixAndReviewAction(failedRecords))
      if (!recovery?.ok) {
        setAccepted(false)
        setNote(recovery?.error || `${failedRecords.length} still need attention`)
      }
    }
    setBusy(false)
    setConfirming(false)
    void completed
  }

  if (accepted) return null

  if (confirming) {
    return (
      <div className="co-stage-batch-confirm" role="alertdialog" aria-label="Confirm sending all reviewed pull requests" aria-describedby={descriptionId}>
        <p id={descriptionId}>Publish {prepared.length} reviewed pull-request actions on GitHub? This may open new pull requests or update existing ones. Nothing will be merged.</p>
        <ul className="co-stage-batch-list" aria-label="Pull requests to send">
          {prepared.map((record) => (
            <li key={record.id}>
              <span>{record.plan?.title || record.title || record.summary || 'Untitled contribution'}</span>
              <small>{record.plan?.action === 'pr_update' ? 'Update pull request' : 'Open pull request'}</small>
            </li>
          ))}
        </ul>
        <div>
          <button ref={cancelRef} type="button" className="co-btn co-btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Not now</button>
          <button type="button" className="co-btn co-btn-sm co-btn-primary" disabled={busy} onClick={publishAll}>
            {busy ? 'Sending…' : `Send all ${prepared.length}`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="co-stage-action">
      <button type="button" className="co-btn co-btn-sm co-btn-primary" onClick={() => setConfirming(true)}>
        Send all {prepared.length}
      </button>
      {note ? <small className="co-stage-action-note" role="status">{note}</small> : null}
    </div>
  )
}

function StageDefaultAction({ phase, units, reviewStatus, onStartAgent, onSend }) {
  if (phase === 'action') {
    const action = actionQueueDefaultAction(units.flatMap(unitRecords), reviewStatus)
    if (!action || action.count < 2) return null
    return (
      <div className="co-stage-action">
        <AgentHandoffButton
          action={action}
          onStart={onStartAgent}
          className="co-btn co-btn-sm co-btn-primary"
          icon="review"
        />
      </div>
    )
  }
  if (phase === 'clear') {
    return <BatchPublishAction units={units} onSend={onSend} onStartAgent={onStartAgent} />
  }
  return null
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
        onStartAgent={onStartAgent}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  const rec = primaryRecord(unit)
  return (
    <div className="co-focus-unit">
      <ContributionDecision
        rec={rec}
        reviewState={reviewStateFor(rec, reviewStatus)}
        reviewAction={progressReviewAction([rec], reviewStatus)}
        onSend={onSend}
        onRunPrePrChecks={onRunPrePrChecks}
        onReview={onStartAgent}
        onFeedback={onFeedback}
        onDismiss={onDismiss}
        onRestore={onRestore}
        onWithdraw={onWithdraw}
        onConnectApp={onConnectApp}
      />
      <ContributionCard
        key={rec.id}
        rec={rec}
        reviewState={reviewStateFor(rec, reviewStatus)}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
        initialExpanded
        showDecision={false}
      />
    </div>
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
    title: 'No pull requests need you',
    detail: 'Private work will appear here when it needs review or a decision.',
  },
  working: {
    icon: 'review',
    title: 'Nothing in progress',
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
    title: 'No past pull requests yet',
    detail: 'Finished and deliberately dropped work will collect here.',
  },
}

const REQUEST_EMPTY_STAGES = {
  action: {
    icon: 'check',
    tone: 'is-clear',
    title: 'No issue drafts',
    detail: 'Issues and replies prepared for your decision will appear here.',
  },
  open: {
    icon: 'send',
    title: 'No published requests',
    detail: 'Published issues and comments will appear here while they are active.',
  },
  history: {
    icon: 'cycle',
    title: 'No past issues yet',
    detail: 'Settled issues and replies will collect here.',
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
  const firstNonempty = REVIEW_STAGES
    .filter(([key]) => key !== 'history')
    .find(([key]) => phaseUnits[key]?.length)?.[0] || 'action'
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
    if (!focusTarget || !focusReady) return
    if (focusTarget.queue) {
      setFilter(firstNonempty)
      setSelectedKey(null)
      setMissingTarget(false)
      setVisibleLimit(STAGE_PAGE_SIZE)
      onFocusConsumed?.(focusTarget.nonce)
      return
    }
    if (!focusTarget.recordId) return
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
  }, [focusTarget, focusReady, phaseUnits, firstNonempty, onFocusConsumed])

  const visibleUnits = phaseUnits[filter] || []
  const renderedUnits = visibleUnits.slice(0, visibleLimit)
  const copy = {
    action: ['Needs you', 'Review or improve this private work before anything is published.'],
    working: ['In progress', 'Reviews and checks already working through prepared changes.'],
    clear: ['Ready to send', 'Reviewed pull requests waiting for your public approval.'],
    open: ['Published', 'Pull requests moving through checks, feedback, and merge.'],
    history: ['Past pull requests', 'Merged, closed, superseded, and deliberately dropped work.'],
  }[filter]

  if (missingTarget) {
    return (
      <section className="co-review-workspace is-focus">
        <h2 className="co-visually-hidden">Contribution review</h2>
        <div className="co-focus-view">
          <button type="button" className="co-focus-back" onClick={() => setMissingTarget(false)}>
            <Icon name="left" size={15} /> Back to pull requests
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
      <ViewHeading title="Pull requests" description="Review private work, approve what is ready, and follow what is already published." />
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
        label="Pull request stages"
      />
      <section className="co-stage-intro" aria-labelledby="co-review-stage-title">
        <div><h3 id="co-review-stage-title">{copy[0]}</h3><p>{copy[1]}</p></div>
        <StageDefaultAction
          phase={filter}
          units={visibleUnits}
          reviewStatus={reviewStatus}
          onStartAgent={onStartAgent}
          onSend={onSend}
        />
      </section>
      {visibleUnits.length ? (
        <ReviewList
          units={renderedUnits}
          phase={filter}
          projects={projects}
          reviewStatus={reviewStatus}
          onSelect={(unit) => setSelectedKey(unitKey(unit))}
          onStartAgent={onStartAgent}
          onSend={onSend}
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
  const firstNonempty = REQUEST_STAGES
    .filter(([key]) => key !== 'history')
    .find(([key]) => phaseUnits[key]?.length)?.[0] || 'action'
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
      <ViewHeading title="Issues" description="Review drafts, publish deliberately, and follow the issues or replies already shared." />
      <StageNav
        stages={REQUEST_STAGES}
        phaseUnits={phaseUnits}
        active={filter}
        onChange={(next) => {
          setFilter(next)
          setSelected(null)
          setVisibleLimit(STAGE_PAGE_SIZE)
        }}
        label="Issue stages"
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
