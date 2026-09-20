import { TaskPane, useProjectTask } from './TaskPane.jsx'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  contributionFailureOwner,
  progressReviewAction,
  reviewStateFor,
} from '../review.js'
import {
  contributionPath,
  contributionPathDecision,
  contributionStackDecision,
} from '../contribution-policy.js'
import { sortStackRecords, stackMeta, stackPublicationRecords } from '../stack.js'
import {
  contributionTitle,
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

function itemHeading(item) {
  if (item?.unit?.type === 'stack') return item.label
  const record = runPrimaryRecord(item)
  return record ? contributionTitle(record) : item.label
}

function itemPublicationRecords(item) {
  return item?.unit?.type === 'stack'
    ? stackPublicationRecords(item.unit)
    : runUnitRecords(item).filter(record => record?.status === 'prepared')
}

function actionCount(items) {
  return (items || []).reduce(
    (total, item) => total + itemPublicationRecords(item).length,
    0,
  )
}

function readyCount(items) {
  return (items || []).reduce((total, item) => total + runUnitRecords(item)
    .filter(record => record?.status === 'draft' && record?.submission_mode !== 'mobius-bot').length, 0)
}

export function batchFingerprint(items, mode, publicationPreference, githubState) {
  const rows = (items || []).flatMap(item => runUnitRecords(item).map(record => [
    item?.kind,
    runUnitKey(item),
    record?.id,
    record?.status,
    record?.plan?.action,
    record?.plan?.repo || record?.repo,
    record?.plan?.branch || record?.branch,
    record?.plan?.head_sha,
    record?.last_submit_push_sha,
    record?.submission_mode,
    record?.readying ? 'readying' : '',
    record?.last_submit_error,
    record?.last_ready_error_code,
  ].map(value => String(value || '')).join('\u0001')))
  return JSON.stringify([
    mode, publicationPreference, githubState, ...rows.sort(),
  ])
}

function captureBatchItems(items) {
  return (items || []).map((item) => {
    const records = runUnitRecords(item).map(record => ({
      ...record,
      plan: record?.plan ? { ...record.plan } : record?.plan,
      quality_review: record?.quality_review
        ? { ...record.quality_review }
        : record?.quality_review,
    }))
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

function publicationLine(record, publicationPreference, githubState) {
  if (record?.plan?.action === 'pr_update') return 'Update the existing pull request'
  return contributionPath(record, publicationPreference, githubState) === 'mobius'
    ? 'Open as a legacy draft'
    : 'Open ready for review'
}

export function publicationRouteProblem(item, publicationPreference, githubState) {
  if (item?.kind === 'mark_ready') {
    return githubState === 'connected'
      ? ''
      : 'Reconnect GitHub before requesting review for these drafts.'
  }
  if (item?.kind !== 'publish') return ''
  const records = item?.unit?.type === 'stack'
    ? stackPublicationRecords(item.unit)
    : runUnitRecords(item)
  const updating = records.length > 0 && records.every(
    record => record?.plan?.action === 'pr_update',
  )
  if (updating) {
    return githubState === 'connected'
      ? ''
      : 'Connect GitHub before updating these pull requests.'
  }
  if (item?.unit?.type === 'stack') {
    const route = contributionStackDecision(
      records, publicationPreference, githubState,
    )
    if (route.error) return route.error
    if (route.method === 'mobius') {
      return 'Connect GitHub to send this related group as your account.'
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
        const publicationIds = new Set(
          mode === 'send' ? itemPublicationRecords(item).map(record => record.id) : [],
        )
        return ordered
          .filter(record => mode !== 'send' || publicationIds.has(record.id))
          .filter(record => mode !== 'ready' || (
            record?.status === 'draft' && record?.submission_mode !== 'mobius-bot'
          ))
          .map(record => {
            const meta = stackMeta(record)
            return (
              <li key={record.id}>
                <span>
                  <strong>{contributionTitle(record)}</strong>
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
  const task = useProjectTask()
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
  const singleRecord = count === 1 ? runPrimaryRecord(activeItems[0]) : null

  useEffect(() => {
    if (confirming) safeRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (!approval || approval.fingerprint === fingerprint) return
    setApproval({ fingerprint, items: captureBatchItems(items) })
    setBusy(false)
    setNote('The reviewed set changed. The current actions are listed now; confirm this refreshed set when you are ready.')
  }, [approval, fingerprint, items])

  if (count < 1) return null

  async function applyAll() {
    if (busy) return
    if (!approval || approval.fingerprint !== fingerprint) {
      setApproval({ fingerprint, items: captureBatchItems(items) })
      setNote('The reviewed set changed. The current actions are listed now; confirm this refreshed set when you are ready.')
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
          <strong>{mode === 'ready'
            ? `${count} ready to request review`
            : `${count} reviewed and ready to send`}</strong>
          <p>{mode === 'ready'
            ? 'Requesting review does not merge these changes.'
            : 'Choose the exact changes before anything is sent.'}</p>
          {note ? <p className="co-run-error" role="status">{note}</p> : null}
        </div>
        <button
          type="button"
          className="co-btn co-btn-primary"
          onClick={() => {
            setNote('')
            task?.open(`task:${mode}`)
            setApproval({ fingerprint, items: captureBatchItems(items) })
          }}
        >
          {mode === 'ready' ? 'Request review' : count === 1 ? 'Review and send' : `Review and send ${count}`}
        </button>
      </section>
    )
  }

  return (
    <>
    {task ? <button className="co-local-summary" onClick={() => task.open(`task:${mode}`)}><Icon name={mode === 'ready' ? 'review' : 'send'} size={20} /><span><strong>{singleRecord?.number ? `#${singleRecord.number} ${mode === 'ready' ? 'ready for review' : 'ready to share'}` : `${count} ${mode === 'ready' ? 'ready for review' : 'ready to share'}`}</strong><small>{singleRecord?.title || (mode === 'ready' ? 'Review the exact request' : 'Review the exact public actions')}</small></span><Icon name="right" size={16} /></button> : null}
    <TaskPane id={`task:${mode}`}>
    <section
      className="co-run-approval"
      role="alertdialog"
      aria-label={mode === 'ready' ? 'Confirm requesting review' : 'Confirm reviewed contribution publication'}
      aria-describedby={descriptionId}
    >
      <header>
        <h3>{mode === 'ready'
          ? `Request review for ${count} ${count === 1 ? 'pull request' : 'pull requests'}?`
          : `Send ${count} reviewed ${count === 1 ? 'pull request' : 'pull requests'}?`}</h3>
        <p id={descriptionId}>{mode === 'ready'
          ? 'Makes the named drafts ready for review. Nothing merges.'
          : 'Publishes the reviewed changes exactly as listed below. Nothing merges.'}</p>
        {mode === 'send' ? <details className="co-task-details"><summary>Where each change goes</summary><p>New pull requests use your connected GitHub account and open ready for review. Existing pull requests receive only the reviewed update. Legacy relay records marked as Möbius-bot are published by the Möbius service under its legacy identity.</p></details> : null}
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
            ? (count === 1 ? 'Request review on GitHub' : `Request review for ${count} on GitHub`)
            : (count === 1 ? 'Send to GitHub' : `Send ${count} to GitHub`)}
        </button>
      </div>
    </section>
    </TaskPane>
    </>
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
        {busy ? 'Assigning…' : 'Assign & review'}
      </button>
      {note ? <small className="co-run-row-error" role="status">{note}</small> : null}
    </>
  )
}

const STATE_LABELS = {
  publish: 'Ready',
  mark_ready: 'Review draft',
  ready_attention: 'Review',
  route_attention: 'Choose route',
  public_attention: 'Resolve',
  private_review: 'Review',
  connecting: 'Finishing publication',
  incoming_review: 'Incoming',
  request: 'Review draft',
}

const DECISION_ACTION_LABELS = {
  ready_attention: 'Review',
  route_attention: 'Choose',
  public_attention: 'Resolve',
  private_review: 'Review',
  request: 'Review',
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
          <strong>{itemHeading(item)}</strong>
          <small>{item.detail}</small>
        </span>
        <Icon name="right" size={14} />
      </button>
      {item.kind === 'incoming_review' ? (
        <IncomingAction item={item.item} onAssign={onAssignIncomingReview} />
      ) : (
        <button
          type="button"
          className="co-run-row-action"
          onClick={() => onSelect?.(item)}
        >
          {DECISION_ACTION_LABELS[item.kind] || 'Review'}
        </button>
      )}
    </article>
  )
}

function QuietRow({ item, onSelect }) {
  return (
    <button type="button" className="co-run-quiet-row" onClick={() => onSelect?.(item)}>
      <span className={'co-run-dot is-' + item.kind} aria-hidden="true" />
      <span><strong>{itemHeading(item)}</strong><small>{item.detail}</small></span>
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
  const reviewChats = [...new Set((records || []).map(record => record.quality_review?.chat_id).filter(Boolean))]
  if ((sources.length === 0 && reviewChats.length === 0) || typeof onFeedback !== 'function') return null
  function open(source) {
    const outcome = onFeedback({ ...source.record, chat_id: source.chatId }) || {}
    if (!outcome.ok) setNote('Open Contribute inside Möbius to return to this source chat.')
  }
  return (
    <div className="co-run-source-choices">
      {reviewChats.map((chatId, index) => <button key={`review:${chatId}`} type="button" className="co-btn co-btn-sm" onClick={() => {
        const outcome = openAgentConversation(chatId)
        if (!outcome?.ok) setNote('Open Contribute inside Möbius to view this review conversation.')
      }}>{reviewChats.length === 1 ? 'Open review conversation' : `Open review conversation ${index + 1}`}</button>)}
      {sources.map((source, index) => (
        <button key={source.chatId} type="button" className="co-btn co-btn-sm" onClick={() => open(source)}>
          {sources.length === 1 ? 'Open source chat' : `Open source chat ${index + 1}`}
        </button>
      ))}
      {note ? <small className="co-run-error">{note}</small> : null}
    </div>
  )
}

function StackFocus({ item, reviewStatus, onFeedback, onRestore, onSetAutopilot, loadDiff }) {
  const records = sortStackRecords(runUnitRecords(item))
  const needsAnswer = record => record?.needs_attention === true || !!record?.attention?.title || !!record?.attention?.message || record?.quality_review?.state === 'changes_needed'
  const questions = records.filter(needsAnswer)
  const [note, setNote] = useState('')
  function addressTogether() {
    const owner = records.find(record => record.quality_review?.chat_id || record.chat_id)
    if (!owner) { setNote('No source conversation is saved for this group. Open a contribution below for its available actions.'); return }
    const draft = ['Help me address these related contributions together. Treat each finding independently and preserve their dependency order.',
      ...records.map(record => `${record.id}: ${contributionTitle(record)}${record.attention?.message ? ` — ${record.attention.message}` : ''}`),
      'Resolve what you can safely, ask me about remaining decisions, and return updated results for each contribution. This does not approve any public action.',
    ].join('\n')
    const result = onFeedback?.({ ...owner, chat_id: owner.quality_review?.chat_id || owner.chat_id }, { draft })
    if (!result?.ok) setNote('The conversation could not open. Try the individual source conversation below.')
  }
  return <div className="co-focus-unit">
    <section className={'co-run-focus-summary is-' + item.kind}>
      <h3>{itemHeading(item)}</h3>
      <p className="co-group-count">1 group · {records.length} contributions{questions.length ? ` · ${questions.length} need attention` : ''}</p>
      <p>{item.detail}</p>
      {item.kind === 'route_attention' ? <p>Connect GitHub to send this related group as your account.</p> : null}
      {onFeedback ? <button className="co-btn co-btn-primary" onClick={addressTogether}>Address group in conversation</button> : null}
      {note ? <p role="status">{note}</p> : null}
    </section>
    <div className="co-group-members">{records.map(record => <details className="co-group-member" key={record.id}>
      <summary>{contributionTitle(record)}<span className="co-group-count"> · {needsAnswer(record) ? 'Needs attention' : record.status === 'prepared' ? 'Private proposal' : record.status}</span></summary>
      {record?.status === 'abandoned' || needsAnswer(record) ? <ContributionDecision rec={record} reviewState={reviewStateFor(record, reviewStatus)} onFeedback={onFeedback} onRestore={onRestore} /> : null}
      <ContributionCard rec={record} reviewState={reviewStateFor(record, reviewStatus)} onSetAutopilot={onSetAutopilot} loadDiff={loadDiff} initialExpanded showDecision={false} />
      <SourceChatChoices records={[record]} onFeedback={onFeedback} />
    </details>)}</div>
  </div>
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
      <h3>{itemHeading(item)}</h3>
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
      <h3>{itemHeading(item)}</h3>
      <p>{item.detail}</p>
      <div className="co-run-focus-actions">
        <IncomingAction item={pull} onAssign={onAssignIncomingReview} />
        {pull.url ? <a className="co-btn co-btn-sm" href={pull.url} target="_blank" rel="noopener noreferrer">Open on GitHub ↗</a> : null}
      </div>
    </section>
  )
}

function BatchOwnedFocus({ item, reviewStatus, onFeedback, onSetAutopilot, loadDiff }) {
  const record = runPrimaryRecord(item)
  if (!record) return null
  return (
    <div className="co-focus-unit">
      <SourceChatChoices records={runUnitRecords(item)} onFeedback={onFeedback} />
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
  if (item.kind === 'connecting') {
    const record = runPrimaryRecord(item)
    return (
      <div className="co-focus-unit">
        <section className="co-run-focus-summary is-connecting">
          <small>Finishing publication</small>
          <h3>{itemHeading(item)}</h3>
          <p>The reviewed app is already public. Contribute is attaching that identity to the same local app automatically; saved data and newer local work stay in place.</p>
        </section>
        {record ? (
          <ContributionCard
            rec={record}
            reviewState={reviewStateFor(record, reviewStatus)}
            onSetAutopilot={onSetAutopilot}
            loadDiff={loadDiff}
            initialExpanded
            showDecision={false}
          />
        ) : null}
      </div>
    )
  }
  if (item?.unit?.type === 'stack') {
    return (
      <StackFocus
        item={item}
        reviewStatus={reviewStatus}
        onFeedback={onFeedback}
        onRestore={onRestore}
        onSetAutopilot={onSetAutopilot}
        loadDiff={loadDiff}
      />
    )
  }
  if (item.kind === 'route_attention') {
    return (
      <section className="co-run-focus-summary is-route_attention">
        <small>Choose a publication route</small>
        <h3>{itemHeading(item)}</h3>
        <p>{item.detail}</p>
        <p>Connect GitHub, then return to the exact Send batch.</p>
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
        onRestore={onRestore}
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
  publicationPreference = 'mobius',
  githubState = 'unknown',
  reviewStatus,
  onSend,
  onSendStack,
  onMarkReady,
  onFeedback,
  onDismiss,
  onRestore,
  onSetAutopilot,
  onWithdraw,
  onAssignIncomingReview,
  loadDiff,
  presentation = 'project',
  renderPublicWork,
  projectName = 'project',
  selectedId = '',
  onSelect,
  onBack,
  focusTarget,
  focusReady,
  onFocusConsumed,
}) {
  const task = useProjectTask()
  const cycle = task?.cycle
  const [missingTarget, setMissingTarget] = useState(false)
  const [allDecisions, setAllDecisions] = useState(false)
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
    setMissingTarget(false)
    if (focusTarget.queue) onBack?.()
    else {
      const found = findRunItemByRecord(run, focusTarget.recordId)
      if (found) onSelect?.(found.item.id)
      else setMissingTarget(true)
    }
    onFocusConsumed?.(focusTarget.nonce)
  }, [focusTarget, focusReady, run, onFocusConsumed])

  function selectRunItem(item) { onSelect?.(item.id) }


  const decisions = projectedDecisions
  const privateItems = decisions.filter(item => item.kind === 'private_review')
  const privateCycleRunning = cycle?.event !== 'update_source_projects' && ['running', 'starting', 'checking', 'stopping'].includes(cycle?.phase)
  const working = [
    ...(run?.working || []),
    ...(privateCycleRunning ? privateItems.map(item => ({
      ...item,
      kind: 'review_in_progress',
      detail: `Private run in progress · ${item.detail}`,
    })) : []),
  ]
  const visibleWorking = renderPublicWork ? working.filter(item => {
    return !runUnitRecords(item).every(record => record?.type === 'pr' && ['open', 'draft'].includes(record.status)
      && task?.publicKeys?.has(`${(record.repo || record.plan?.repo || '').toLowerCase()}#${record.number}`))
  }) : working
  const recent = run?.recent || []
  const archive = run?.archive || []
  const publishItems = decisions.filter(item => item.kind === 'publish')
  const readyItems = decisions.filter(item => item.kind === 'mark_ready')
  const ownerDecisions = decisions.filter(item => ![
    'publish', 'mark_ready', 'private_review', 'request',
  ].includes(item.kind))
  const ownerActionCount = ownerDecisions.length
  const ownerContributionCount = ownerDecisions.reduce((total, item) => total + Math.max(1, runUnitRecords(item).length), 0)
  const groupedDecisions = ownerDecisions.filter(item => runUnitRecords(item).length > 1).length
  const privateProposals = [...(privateCycleRunning ? [] : privateItems), ...decisions.filter(item => item.kind === 'request')]

  const missingSelection = selectedId && !selectedId.startsWith('task:') && !selected
  const focus = (selected || missingTarget || missingSelection) ? (
      <TaskPane id={selectedId}>
        <div className="co-run-focus-layout">
          <div className="co-run-focus-detail">
        {missingTarget || missingSelection ? (
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
            onMarkReady={onMarkReady}
            onAssignIncomingReview={onAssignIncomingReview}
            loadDiff={loadDiff}
          />
        )}
          </div>
        </div>
      </TaskPane>
    ) : null

  if (presentation === 'overview' && !actionCount(publishItems) && !readyCount(readyItems) && !omittedCount) return null

  return (
    <section className="co-run" aria-label="Contributions">
      {focus}
      {!actionCount(publishItems) ? <TaskPane id="task:send"><h3>Publication status</h3><p>No reviewed changes are waiting to send. Your contributions below show their current public or private status.</p><button className="co-btn co-btn-primary" onClick={() => task?.close()}>Review public contributions</button></TaskPane> : null}
      {!readyCount(readyItems) ? <TaskPane id="task:ready"><h3>Review status</h3><p>No drafts are waiting for a review request. Check your public contributions for their current state.</p><button className="co-btn" onClick={() => task?.close()}>View public contributions</button></TaskPane> : null}
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

      {presentation === 'project' ? <>
      {ownerActionCount > 0 ? <section className="co-run-section" aria-label="Needs you">
        <header><h3>Needs you <span className="co-section-count">{groupedDecisions ? `${groupedDecisions} ${groupedDecisions === 1 ? 'group' : 'groups'}${ownerActionCount > groupedDecisions ? ` + ${ownerActionCount - groupedDecisions} individual` : ''} · ${ownerContributionCount} contributions` : ownerActionCount}</span></h3></header>
        <div className="co-run-list">{(allDecisions ? ownerDecisions : ownerDecisions.slice(0, 3)).map(item => <DecisionRow key={item.id} item={item} onSelect={selectRunItem} onAssignIncomingReview={onAssignIncomingReview} />)}</div>
        {ownerActionCount > 3 ? <button className="co-quiet-action" onClick={() => setAllDecisions(!allDecisions)}>{allDecisions ? 'Show fewer' : `Show all ${ownerActionCount} decisions`}</button> : null}
      </section> : null}
      {privateProposals.length ? (
        <details className="co-run-fold">
          <summary><span>Prepared proposals · not shared</span><b>{privateProposals.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{privateProposals.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      {renderPublicWork?.()}

      {visibleWorking.length > 0 ? (
        <section className="co-run-section">
          <header><h3>In progress</h3></header>
          <div>{visibleWorking.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <details className="co-run-fold is-recent">
          <summary><span>Done recently</span><b>{recent.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{recent.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      {archive.length > 0 ? (
        <details className="co-run-fold is-archive">
          <summary><span>History</span><b>{archive.length}</b><Icon name="chevron" size={14} /></summary>
          <div>{archive.map(item => <QuietRow key={item.id} item={item} onSelect={selectRunItem} />)}</div>
        </details>
      ) : null}

      </> : null}
      {omittedCount > 0 ? <p className="co-run-maintenance">{omittedCount} contribution records could not be shown.</p> : null}
    </section>
  )
}
