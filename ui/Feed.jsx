import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  contributionActionScope,
  contributionApprovalFingerprint,
  contributionCycleProgress,
  contributionFailureOwner,
  progressReviewAction,
  reviewStateFor,
} from '../review.js'
import {
  contributionPath,
  contributionPathDecision,
  contributionStackDecision,
} from '../contribution-policy.js'
import { sortStackRecords, stackMeta } from '../stack.js'
import {
  findRunItemByRecord,
  runPrimaryRecord,
  runUnitKey,
  runUnitRecords,
} from '../run.js'
import { openAgentConversation } from './BatchAction.jsx'
import { ContributionCard, ContributionDecision } from './ContributionCard.jsx'
import { Icon } from './Icons.jsx'
import { ProjectIcon } from './ProjectIcon.jsx'

function itemProject(item) {
  return item?.project || { name: item?.detail || 'Contribution' }
}

function actionCount(items) {
  return (items || []).reduce((total, item) => total + runUnitRecords(item)
    .filter(record => record?.status === 'prepared').length, 0)
}

function readyCount(items) {
  return (items || []).reduce((total, item) => total + runUnitRecords(item)
    .filter(record => record?.status === 'draft' && record?.submission_mode !== 'mobius-bot').length, 0)
}

export function batchFingerprint(items, mode, publicationPreference, githubState) {
  const rows = (items || []).flatMap(item => runUnitRecords(item).map(record => [
    item?.kind,
    runUnitKey(item),
    contributionApprovalFingerprint(record),
  ].map(value => String(value || '')).join('\u0001')))
  return JSON.stringify([
    mode, publicationPreference, githubState, ...rows.sort(),
  ])
}

function captureBatchValue(value) {
  if (Array.isArray(value)) return value.map(captureBatchValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, captureBatchValue(child),
  ]))
}

function captureBatchItems(items) {
  return (items || []).map((item) => {
    const records = runUnitRecords(item).map(captureBatchValue)
    const primaryId = runPrimaryRecord(item)?.id
    return {
      ...item,
      record: records.find(record => record.id === primaryId) || records[0] || null,
      unit: item?.unit ? {
        ...item.unit,
        record: records.find(record => record.id === item.unit?.record?.id) || null,
        records,
      } : item?.unit,
    }
  })
}

function recordTitle(record) {
  return record?.plan?.title || record?.title || record?.summary || 'Untitled contribution'
}

function publicationLine(record, publicationPreference, githubState) {
  if (record?.plan?.action === 'pr_update') return 'Update the existing pull request'
  return contributionPath(record, publicationPreference, githubState) === 'mobius'
    ? 'Open as a draft through Möbius'
    : 'Open ready for review'
}

export function publicationRouteProblem(item, publicationPreference, githubState) {
  if (item?.kind === 'mark_ready') {
    return githubState === 'connected'
      ? ''
      : 'Reconnect Personal GitHub before requesting review for these drafts.'
  }
  if (item?.kind !== 'publish') return ''
  const records = runUnitRecords(item)
  const updating = records.length > 0 && records.every(
    record => record?.plan?.action === 'pr_update',
  )
  if (updating) {
    return githubState === 'connected'
      ? ''
      : 'Connect Personal GitHub before updating these pull requests.'
  }
  if (item?.unit?.type === 'stack') {
    const route = contributionStackDecision(
      records, publicationPreference, githubState,
    )
    if (route.error) return route.error
    if (route.method === 'mobius') {
      return 'Related pull requests need Personal GitHub; the Möbius relay supports standalone drafts only.'
    }
    return ''
  }
  const record = runPrimaryRecord(item)
  const route = contributionPathDecision(record, publicationPreference, githubState)
  return route.error || ''
}

function ExactActionList({
  items,
  mode,
  publicationPreference,
  githubState,
  onSelect,
}) {
  return (
    <ol className="co-run-approval-list">
      {items.flatMap(item => {
        const unit = item.unit || item
        const ordered = unit?.type === 'stack'
          ? sortStackRecords(runUnitRecords(item))
          : runUnitRecords(item)
        return ordered
          .filter(record => mode !== 'send' || record?.status === 'prepared')
          .filter(record => mode !== 'ready' || (
            record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
          ))
          .map(record => {
            const meta = stackMeta(record)
            return (
              <li key={record.id}>
                <span>
                  <strong>{recordTitle(record)}</strong>
                  <small>{record?.plan?.repo || record?.repo || 'Project'}</small>
                </span>
                <em>{mode === 'ready'
                  ? 'Request review'
                  : publicationLine(record, publicationPreference, githubState)}</em>
                {meta ? <code>{meta.baseBranch} → {record?.plan?.branch || record?.branch}</code> : null}
                {typeof onSelect === 'function' ? (
                  <button type="button" onClick={() => onSelect(item)}>Details</button>
                ) : null}
              </li>
            )
          })
      })}
    </ol>
  )
}

function ExactBatchAction({
  items,
  mode,
  publicationPreference,
  githubState,
  onSend,
  onSendStack,
  onMarkReady,
  onSelect,
}) {
  const [approval, setApproval] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const safeRef = useRef(null)
  const descriptionId = useId()
  const fingerprint = useMemo(() => batchFingerprint(
    items, mode, publicationPreference, githubState,
  ), [items, mode, publicationPreference, githubState])
  const confirming = !!approval && approval.fingerprint === fingerprint
  const activeItems = confirming ? approval.items : items
  const count = mode === 'ready' ? readyCount(activeItems) : actionCount(activeItems)

  useEffect(() => {
    if (confirming) safeRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!approval || approval.fingerprint === fingerprint) return
    setApproval(null)
    setBusy(false)
    setNote('The exact set changed. Review it again before continuing.')
  }, [approval, fingerprint])

  if (count < 1) return null

  async function applyAll() {
    if (busy) return
    if (!approval || approval.fingerprint !== fingerprint) {
      setApproval(null)
      setNote('The exact set changed. Review it again before continuing.')
      return
    }
    const approvedItems = approval.items
    setBusy(true)
    setNote('')
    const failures = []
    for (const item of approvedItems) {
      try {
        let outcome = null
        if (mode === 'ready') {
          const records = sortStackRecords(runUnitRecords(item)).filter(record => (
            record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
          ))
          for (const record of records) {
            outcome = await onMarkReady?.(record)
            if (!(outcome?.ok || outcome?.alreadyHandled || outcome?.pending)) break
          }
        } else if (item?.unit?.type === 'stack') {
          outcome = await onSendStack?.(runUnitRecords(item))
        } else {
          outcome = await onSend?.(runPrimaryRecord(item))
        }
        if (outcome?.ok || outcome?.alreadyHandled || outcome?.pending) continue
        failures.push(outcome?.error || (
          contributionFailureOwner(outcome) === 'agent'
            ? 'The remaining work moved back to private preparation.'
            : 'One action still needs attention.'
        ))
      } catch {
        failures.push('One result could not be confirmed. Refresh before trying it again.')
      }
    }
    setBusy(false)
    setApproval(null)
    setNote(failures[0] || '')
  }

  if (!confirming) {
    return (
      <section className={'co-run-primary is-' + mode}>
        <span className="co-run-primary-mark" aria-hidden="true">
          <Icon name={mode === 'ready' ? 'review' : 'send'} size={19} />
        </span>
        <div>
          <small>{mode === 'ready' ? 'Drafts ready' : 'Reviews ready'}</small>
          <strong>{mode === 'ready'
            ? `${count} ${count === 1 ? 'pull request is' : 'pull requests are'} ready to request review`
            : `${count} reviewed ${count === 1 ? 'pull request' : 'pull requests'} can move now`}</strong>
          <p>{mode === 'ready'
            ? 'One exact approval moves these drafts into review. Nothing merges.'
            : 'One exact approval opens or updates the complete reviewed set. Nothing merges.'}</p>
          {note ? <p className="co-run-error" role="status">{note}</p> : null}
        </div>
        <button
          type="button"
          className="co-btn co-btn-primary"
          onClick={() => {
            setNote('')
            setApproval({ fingerprint, items: captureBatchItems(items) })
          }}
        >
          {mode === 'ready'
            ? (count === 1 ? 'Request review' : `Request review for ${count}`)
            : (count === 1 ? 'Send' : `Send all ${count}`)}
        </button>
        <details className="co-run-primary-details">
          <summary>Review exact set <Icon name="chevron" size={14} /></summary>
          <ExactActionList
            items={activeItems}
            mode={mode}
            publicationPreference={publicationPreference}
            githubState={githubState}
            onSelect={onSelect}
          />
        </details>
      </section>
    )
  }

  return (
    <section
      className="co-run-approval"
      role="alertdialog"
      aria-label={mode === 'ready' ? 'Confirm requesting review' : 'Confirm reviewed contribution publication'}
      aria-describedby={descriptionId}
    >
      <header>
        <small>Exact public actions</small>
        <h3>{mode === 'ready'
          ? `Request review for ${count} ${count === 1 ? 'pull request' : 'pull requests'}?`
          : `Send ${count} reviewed ${count === 1 ? 'pull request' : 'pull requests'}?`}</h3>
        <p id={descriptionId}>{mode === 'ready'
          ? 'Each named draft becomes ready for review on its current public head. Nothing merges.'
          : 'Each line below names its exact publication route. Personal pull requests open ready for review; Möbius relay pull requests open as drafts; existing pull requests receive only the reviewed update. Nothing merges.'}</p>
      </header>
      <ExactActionList
        items={activeItems}
        mode={mode}
        publicationPreference={publicationPreference}
        githubState={githubState}
      />
      <div className="co-run-approval-actions">
        <button ref={safeRef} type="button" className="co-btn" disabled={busy} onClick={() => setApproval(null)}>
          {mode === 'ready' ? 'Keep drafts' : 'Keep private'}
        </button>
        <button type="button" className="co-btn co-btn-primary" disabled={busy} aria-busy={busy} onClick={applyAll}>
          {busy ? 'Working…' : mode === 'ready'
            ? 'Request review'
            : (count === 1 ? 'Send' : `Send all ${count}`)}
        </button>
      </div>
    </section>
  )
}

function PrivateRunAction({ action, cycle, items = [], onStart, onStop, onOpen, onSelect }) {
  const phase = cycle?.phase || 'idle'
  const progress = contributionCycleProgress(cycle?.runtime)
  const currentScope = contributionActionScope(action)
  const earlier = action && cycle?.scope && currentScope && cycle.scope !== currentScope
  if (!action && !['running', 'starting', 'checking', 'stopping', 'waiting', 'paused', 'failed'].includes(phase)) return null
  const running = ['running', 'starting', 'checking', 'stopping'].includes(phase)
  const title = running
    ? 'Preparing private work'
    : phase === 'waiting'
      ? 'A private decision needs you'
      : phase === 'paused' || phase === 'failed'
        ? 'Earlier private work paused'
        : 'Private work can be handled together'
  return (
    <section className={'co-run-private is-' + phase}>
      <span aria-hidden="true">{running ? <span className="ma-spinner is-compact" /> : <Icon name="cycle" size={17} />}</span>
      <div>
        <strong>{title}</strong>
        <p>{running
          ? (progress.label || 'Aligning and reviewing the current private work.')
          : action
            ? 'One private run prepares, aligns, and reviews everything that needs judgment.'
            : 'Open the earlier run to continue.'}</p>
        {running && progress.total > 0 ? <small>{progress.completed} of {progress.total} complete</small> : null}
        {cycle?.error ? <small className="co-run-error">{cycle.error}</small> : null}
      </div>
      <div className="co-run-private-actions">
        {!running && action ? (
          <button type="button" className="co-btn co-btn-sm co-btn-primary" onClick={onStart}>
            {earlier ? 'Prepare latest' : action.label || 'Prepare all'}
          </button>
        ) : null}
        {phase === 'running' ? <button type="button" className="co-btn co-btn-sm" onClick={onStop}>Stop</button> : null}
        {cycle?.chatId && ['waiting', 'paused', 'failed'].includes(phase) ? (
          <button type="button" className="co-btn co-btn-sm" onClick={onOpen}>Open</button>
        ) : null}
      </div>
      {!running && items.length > 0 ? (
        <details className="co-run-private-items">
          <summary>
            <span>{items.length} {items.length === 1 ? 'contribution group' : 'contribution groups'} in this run</span>
            <Icon name="chevron" size={14} />
          </summary>
          <div>{items.map(item => <QuietRow key={item.id} item={item} onSelect={onSelect} />)}</div>
        </details>
      ) : null}
    </section>
  )
}

function IncomingAction({ item, onAssign }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function assign() {
    setBusy(true)
    setNote('')
    const outcome = await onAssign?.(item)
    if (!outcome?.ok) setNote(outcome?.error || 'Could not start this review.')
    setBusy(false)
  }
  return (
    <>
      <button type="button" className="co-run-row-action is-primary" disabled={busy} onClick={assign}>
        {busy ? 'Assigning…' : 'Assign'}
      </button>
      {note ? <small className="co-run-row-error" role="status">{note}</small> : null}
    </>
  )
}

const STATE_LABELS = {
  publish: 'Ready',
  mark_ready: 'Draft',
  ready_attention: 'Review stage',
  route_attention: 'Choose route',
  public_attention: 'Needs you',
  private_review: 'Private',
  connect: 'Connect',
  incoming_review: 'Incoming',
  request: 'Draft',
}

function DecisionRow({
  item,
  onSelect,
  onAssignIncomingReview,
}) {
  return (
    <article className={'co-run-row is-' + item.kind}>
      <button type="button" className="co-run-row-main" onClick={() => onSelect?.(item)}>
        <ProjectIcon project={itemProject(item)} className="co-run-row-icon" />
        <span>
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
        </span>
        <em>{STATE_LABELS[item.kind] || 'Needs you'}</em>
      </button>
      {item.kind === 'incoming_review' ? (
        <IncomingAction item={item.item} onAssign={onAssignIncomingReview} />
      ) : (
        <button
          type="button"
          className="co-run-row-action"
          onClick={() => onSelect?.(item)}
        >
          Open
        </button>
      )}
    </article>
  )
}

function QuietRow({ item, onSelect }) {
  return (
    <button type="button" className="co-run-quiet-row" onClick={() => onSelect?.(item)}>
      <span className={'co-run-dot is-' + item.kind} aria-hidden="true" />
      <span><strong>{item.label}</strong><small>{item.detail}</small></span>
      <Icon name="right" size={14} />
    </button>
  )
}

function SourceChatChoices({ records, onFeedback }) {
  const [note, setNote] = useState('')
  const sources = []
  const seen = new Set()
  for (const record of records || []) {
    for (const chatId of [record?.chat_id, ...(record?.chat_ids || [])]) {
      if (!chatId || seen.has(chatId)) continue
      seen.add(chatId)
      sources.push({ chatId, record })
    }
  }
  if (sources.length === 0 || typeof onFeedback !== 'function') return null
  function open(source) {
    const outcome = onFeedback({ ...source.record, chat_id: source.chatId }) || {}
    if (!outcome.ok) setNote('Open Contribute inside Möbius to return to this source chat.')
  }
  return (
    <div className="co-run-source-choices">
      {sources.map((source, index) => (
        <button key={source.chatId} type="button" className="co-btn co-btn-sm" onClick={() => open(source)}>
          {sources.length === 1 ? 'Open source chat' : `Open source chat ${index + 1}`}
        </button>
      ))}
      {note ? <small className="co-run-error">{note}</small> : null}
    </div>
  )
}

function StackFocus({
  item,
  reviewStatus,
  onFeedback,
  onRestore,
  onSetAutopilot,
  onConnectApp,
  loadDiff,
}) {
  const records = sortStackRecords(runUnitRecords(item))
  const eyebrow = item.kind === 'public_attention'
    ? 'Public follow-up'
    : item.kind === 'private_review'
      ? 'Private repair'
      : item.kind === 'connect'
        ? 'App ready to connect'
      : item.kind === 'route_attention'
        ? 'Publication route'
        : item.kind === 'mark_ready'
          ? 'Included in the review batch'
          : item.kind === 'publish'
            ? 'Included in the send batch'
            : item.kind === 'archived'
              ? 'Dismissed chain'
              : 'Related pull requests'
  return (
    <div className="co-focus-unit">
      <section className={'co-run-focus-summary is-' + item.kind}>
        <small>{eyebrow}</small>
        <h3>{item.label}</h3>
        <p>{item.detail}</p>
        {item.kind === 'route_attention' ? (
          <p>Choose Personal GitHub from Contribute settings to send this related chain together.</p>
        ) : null}
        <SourceChatChoices records={records} onFeedback={onFeedback} />
      </section>
      <div className="co-run-stack-records">
        {records.map(record => (
          <div key={record.id}>
            {record?.status === 'abandoned' || (
              item.kind === 'connect' && record?.id === item.record?.id
            ) || (
              item.kind === 'public_attention' && (
                record?.needs_attention === true ||
                !!record?.attention?.title ||
                !!record?.attention?.message
              )
            ) ? (
              <ContributionDecision
                rec={record}
                reviewState={reviewStateFor(record, reviewStatus)}
                onFeedback={onFeedback}
                onRestore={onRestore}
                onConnectApp={onConnectApp}
              />
            ) : null}
            <ContributionCard
              rec={record}
              reviewState={reviewStateFor(record, reviewStatus)}
              onSetAutopilot={onSetAutopilot}
              loadDiff={loadDiff}
              initialExpanded={item.kind === 'public_attention'}
              showDecision={false}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadyAttentionFocus({ item, onMarkReady, onFeedback }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const records = sortStackRecords(runUnitRecords(item))
  const record = item.record || records.find(row => row?.last_ready_error) || records[0]
  const retryable = new Set([
    'ready_not_applied', 'ready_lookup_failed', 'ready_failed',
    'ready_auto_merge_enabled',
  ]).has(String(record?.last_ready_error_code || ''))
  async function run() {
    setBusy(true)
    setNote('')
    const outcome = await onMarkReady?.(record)
    if (!(outcome?.ok || outcome?.pending || outcome?.alreadyHandled)) {
      setNote(outcome?.error || 'Could not request review for this pull request.')
    }
    setBusy(false)
  }
  return (
    <section className="co-run-focus-summary is-ready_attention">
      <small>Review stage needs attention</small>
      <h3>{item.label}</h3>
      <p>{record?.last_ready_error || item.detail}</p>
      {retryable ? (
        <button type="button" className="co-btn co-btn-primary" disabled={busy} onClick={run}>
          {busy
            ? 'Working…'
            : record?.last_ready_error_code === 'ready_auto_merge_enabled'
              ? 'I disabled auto-merge — request review'
              : 'Request review again'}
        </button>
      ) : null}
      {record?.url ? <a className="co-review-link" href={record.url} target="_blank" rel="noopener noreferrer">Open pull request ↗</a> : null}
      <SourceChatChoices records={records} onFeedback={onFeedback} />
      {note ? <p className="co-run-error" role="status">{note}</p> : null}
    </section>
  )
}

function IncomingFocus({ item, onAssignIncomingReview }) {
  const pull = item?.item || {}
  return (
    <section className="co-run-focus-summary is-incoming_review">
      <small>Incoming review</small>
      <h3>{item.label}</h3>
      <p>{item.detail}</p>
      <div className="co-run-focus-actions">
        <IncomingAction item={pull} onAssign={onAssignIncomingReview} />
        {pull.url ? <a className="co-btn co-btn-sm" href={pull.url} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a> : null}
      </div>
    </section>
  )
}

function BatchOwnedFocus({ item, reviewStatus, onFeedback, onDismiss, onSetAutopilot, loadDiff }) {
  const record = runPrimaryRecord(item)
  if (!record) return null
  const eyebrow = item.kind === 'publish'
    ? 'Included in the send batch'
    : item.kind === 'mark_ready'
      ? 'Included in the review batch'
      : 'Owned by the private Run'
  return (
    <div className="co-focus-unit">
      <section className={'co-run-focus-summary is-' + item.kind}>
        <small>{eyebrow}</small>
        <h3>{item.label}</h3>
        <p>{item.detail}</p>
        <SourceChatChoices records={runUnitRecords(item)} onFeedback={onFeedback} />
      </section>
      <ContributionDecision
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        reviewAction={progressReviewAction([record], reviewStatus)}
        onFeedback={onFeedback}
        onDismiss={onDismiss}
      />
      <ContributionCard
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
        initialExpanded
        showDecision={false}
      />
    </div>
  )
}

export function FocusedItem({
  item,
  reviewStatus,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  onMarkReady,
  onAssignIncomingReview,
  loadDiff,
}) {
  const records = runUnitRecords(item)
  if (item.kind === 'incoming_review') {
    return <IncomingFocus item={item} onAssignIncomingReview={onAssignIncomingReview} />
  }
  if (item.kind === 'ready_attention') {
    return <ReadyAttentionFocus item={item} onMarkReady={onMarkReady} onFeedback={onFeedback} />
  }
  if (item?.unit?.type === 'stack') {
    return (
      <StackFocus
        item={item}
        reviewStatus={reviewStatus}
        onFeedback={onFeedback}
        onRestore={onRestore}
        onSetAutopilot={onSetAutopilot}
        onConnectApp={onConnectApp}
        loadDiff={loadDiff}
      />
    )
  }
  if (item.kind === 'route_attention') {
    return (
      <section className="co-run-focus-summary is-route_attention">
        <small>Choose a publication route</small>
        <h3>{item.label}</h3>
        <p>{item.detail}</p>
        <p>Choose Personal GitHub from Contribute settings, then return to the exact Send batch.</p>
        <SourceChatChoices records={records} onFeedback={onFeedback} />
      </section>
    )
  }
  if (['publish', 'mark_ready', 'private_review'].includes(item.kind)) {
    return (
      <BatchOwnedFocus
        item={item}
        reviewStatus={reviewStatus}
        onFeedback={onFeedback}
        onDismiss={onDismiss}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  const record = runPrimaryRecord(item)
  if (!record) return null
  return (
    <div className="co-focus-unit">
      <ContributionDecision
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        reviewAction={progressReviewAction([record], reviewStatus)}
        onFeedback={onFeedback}
        onDismiss={onDismiss}
        onRestore={onRestore}
        onWithdraw={onWithdraw}
        onConnectApp={onConnectApp}
      />
      <ContributionCard
        rec={record}
        reviewState={reviewStateFor(record, reviewStatus)}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
        initialExpanded
        showDecision={false}
      />
    </div>
  )
}

export function ContributionRun({
  run,
  loading,
  omittedCount = 0,
  publicationPreference = 'github',
  githubState = 'unknown',
  reviewStatus,
  cycle,
  onStartCycle,
  onStopCycle,
  onOpenCycle,
  onSend,
  onSendStack,
  onMarkReady,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onConnectApp,
  onAssignIncomingReview,
  onViewProject,
  loadDiff,
  focusTarget,
  focusReady,
  onFocusConsumed,
}) {
  const [selectedId, setSelectedId] = useState('')
  const [missingTarget, setMissingTarget] = useState(false)
  const [focusReturnProject, setFocusReturnProject] = useState('')
  const projectedDecisions = useMemo(() => (run?.decisions || []).map((item) => {
    const problem = publicationRouteProblem(
      item, publicationPreference, githubState,
    )
    if (!problem) return item
    return {
      ...item,
      kind: 'route_attention',
      detail: problem,
    }
  }), [run?.decisions, publicationPreference, githubState])
  const allItems = useMemo(() => [
    ...projectedDecisions,
    ...(run?.working || []),
    ...(run?.recent || []),
    ...(run?.archive || []),
  ], [projectedDecisions, run?.working, run?.recent, run?.archive])
  const selected = allItems.find(item => item.id === selectedId) || null

  useEffect(() => {
    if (!focusTarget || !focusReady) return
    if (focusTarget.queue) {
      setSelectedId('')
      setMissingTarget(false)
      setFocusReturnProject('')
      onFocusConsumed?.(focusTarget.nonce)
      return
    }
    setFocusReturnProject(String(focusTarget.returnProjectKey || ''))
    const found = findRunItemByRecord(run, focusTarget.recordId)
    if (found) {
      setSelectedId(found.item.id)
      setMissingTarget(false)
    } else {
      setSelectedId('')
      setMissingTarget(true)
    }
    onFocusConsumed?.(focusTarget.nonce)
  }, [focusTarget, focusReady, run, onFocusConsumed])

  function selectRunItem(item) {
    setFocusReturnProject('')
    setMissingTarget(false)
    setSelectedId(item.id)
  }

  function closeFocus() {
    const returnProjectKey = focusReturnProject
    setSelectedId('')
    setMissingTarget(false)
    setFocusReturnProject('')
    if (returnProjectKey) onViewProject?.(returnProjectKey)
  }

  const decisions = projectedDecisions
  const privateItems = decisions.filter(item => item.kind === 'private_review')
  const privateCycleRunning = ['running', 'starting', 'checking', 'stopping'].includes(cycle?.phase)
  const working = [
    ...(run?.working || []),
    ...(privateCycleRunning ? privateItems.map(item => ({
      ...item,
      kind: 'review_in_progress',
      detail: `Private run in progress · ${item.detail}`,
    })) : []),
  ]
  const recent = run?.recent || []
  const archive = run?.archive || []
  const publishItems = decisions.filter(item => item.kind === 'publish')
  const readyItems = decisions.filter(item => item.kind === 'mark_ready')
  const publishTotal = actionCount(publishItems)
  const readyTotal = readyCount(readyItems)
  const acceptedRecent = recent.filter(item => (
    runUnitRecords(item).length > 0
    && runUnitRecords(item).every(record => record?.status === 'merged')
  )).length
  const ownerDecisions = decisions.filter(item => ![
    'publish', 'mark_ready', 'private_review',
  ].includes(item.kind))
  const headline = publishTotal > 0
    ? `${publishTotal} reviewed ${publishTotal === 1 ? 'change is' : 'changes are'} ready`
    : readyTotal > 0
      ? `${readyTotal} ${readyTotal === 1 ? 'draft is' : 'drafts are'} ready for review`
      : ownerDecisions.length > 0
        ? `${ownerDecisions.length} ${ownerDecisions.length === 1 ? 'decision needs' : 'decisions need'} you`
        : working.length > 0
          ? 'Everything is moving'
          : run?.privateAction
            ? 'Private work is ready to prepare'
          : 'You’re caught up'

  const returnProject = focusReturnProject
    ? (run?.projects || []).find(row => row?.project?.key === focusReturnProject)
    : null

  if (selected || missingTarget) {
    return (
      <section className="co-run co-run-focus">
        <button type="button" className="co-focus-back" onClick={closeFocus}>
          <Icon name="left" size={15} /> {focusReturnProject
            ? `Back to ${returnProject?.label || 'project'}`
            : 'Back to the run'}
        </button>
        {missingTarget ? (
          <div className="co-run-empty">
            <Icon name="cycle" size={20} />
            <strong>This contribution moved</strong>
            <span>The current run no longer contains that exact record. Refresh or return to its source chat.</span>
          </div>
        ) : (
          <FocusedItem
            item={selected}
            reviewStatus={reviewStatus}
            onFeedback={onFeedback}
            onDismiss={onDismiss}
            onRestore={onRestore}
            onSetAutopilot={onSetAutopilot}
            onWithdraw={onWithdraw}
            onConnectApp={onConnectApp}
            onMarkReady={onMarkReady}
            onAssignIncomingReview={onAssignIncomingReview}
            loadDiff={loadDiff}
          />
        )}
      </section>
    )
  }

  return (
    <section className="co-run" aria-labelledby="co-run-title">
      <header className="co-run-head">
        <div>
          <small>Current contribution run</small>
          <h2 id="co-run-title">{loading ? 'Checking current work…' : headline}</h2>
          <p>Prepare privately, approve exact public actions, and follow every project from one place.</p>
        </div>
      </header>

      <div className="co-run-summary" aria-label="Current run status">
        <span><b>{publishTotal + readyTotal}</b> ready</span>
        <span><b>{working.length}</b> moving</span>
        <span><b>{acceptedRecent}</b> accepted recently</span>
      </div>

      <PrivateRunAction
        action={run?.privateAction}
        cycle={cycle}
        items={privateCycleRunning ? [] : privateItems}
        onStart={() => onStartCycle?.(run?.privateAction)}
        onStop={onStopCycle}
        onOpen={onOpenCycle}
        onSelect={selectRunItem}
      />

      <ExactBatchAction
        key={`send:${run?.revision || ''}:${publicationPreference}:${githubState}`}
        items={publishItems}
        mode="send"
        publicationPreference={publicationPreference}
        githubState={githubState}
        onSend={onSend}
        onSendStack={onSendStack}
        onSelect={selectRunItem}
      />
      <ExactBatchAction
        key={`ready:${run?.revision || ''}:${publicationPreference}:${githubState}`}
        items={readyItems}
        mode="ready"
        publicationPreference={publicationPreference}
        githubState={githubState}
        onMarkReady={onMarkReady}
        onSelect={selectRunItem}
      />

      <section className="co-run-section" aria-labelledby="co-run-decisions">
        <header><h3 id="co-run-decisions">Needs you</h3><span>{ownerDecisions.length}</span></header>
        {ownerDecisions.length > 0 ? (
          <div className="co-run-list">
            {ownerDecisions.map(item => (
              <DecisionRow
                key={item.id}
                item={item}
                onSelect={selectRunItem}
                onAssignIncomingReview={onAssignIncomingReview}
              />
            ))}
          </div>
        ) : (
          <div className="co-run-empty is-clear">
            <Icon name="check" size={19} />
            <strong>No decisions waiting</strong>
            <span>Automatic checks and reconciliation keep running quietly.</span>
          </div>
        )}
      </section>

      {working.length > 0 ? (
        <details className="co-run-fold">
          <summary><span>Moving quietly</span><b>{working.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{working.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      {recent.length > 0 ? (
        <details className="co-run-fold is-recent">
          <summary><span>Recent outcomes</span><b>{recent.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{recent.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      {archive.length > 0 ? (
        <details className="co-run-fold is-archive">
          <summary><span>Dismissed</span><b>{archive.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{archive.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      {(run?.projects || []).length > 0 && typeof onViewProject === 'function' ? (
        <footer className="co-run-projects">
          <span>{run.projects.length} projects represented in this snapshot.</span>
          <button type="button" onClick={() => onViewProject()}>
            Browse projects <Icon name="right" size={14} />
          </button>
        </footer>
      ) : null}

      {omittedCount > 0 ? <p className="co-run-maintenance">{omittedCount} contribution records could not be shown.</p> : null}
    </section>
  )
}
