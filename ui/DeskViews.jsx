import { useState } from 'react'
import { authoredPulls, chainPulls, deskStanding, feedbackPull, mergedRecently, newSince, projectNeedsRows } from '../desk.js'
import { conversationCount, prKey, reviewForPull } from '../collaboration.js'
import { savedFindings } from '../address-feedback.js'
import { frameState, reviewForRecord } from '../review-frame.js'
import { ReviewFrame } from './ReviewFrame.jsx'
import { chipOf, frameOf } from '../pr-standing.js'
import { decisionChip, isDraftWord } from '../review-list.js'
import { actionOf } from '../pr-machine.js'
import { recordsForProject } from '../source-map.js'
import { STATUS_LABELS } from '../domain.js'
import { groupNote, lookAtReason } from './AttentionList.jsx'
import { ChecksBadge, PullLabels, PullStateIcon, TimeAgo } from './GithubParts.jsx'
import { Icon } from './Icons.jsx'
import { DeskRow, DotLine, StatusPill, whoOf } from './DeskRow.jsx'
import { Envelope, EmptyView } from './Envelope.jsx'
import { AgentRunsView, ReviewRow } from './ReviewsView.jsx'
import { NAMES } from '../names.js'

const matches = (query, ...parts) => !query.trim()
  || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

function NewDot({ value, lastLooked }) {
  if (!newSince(value, lastLooked)) return null
  return <span className="co-newdot" title="Changed since you last looked" />
}

const requestChip = { label: 'Asks for your review', tone: 'you' }

// One PR under its project's card. The whole row opens the PR on its own page. Its status is the shared decision's
// label (the repository list and the PR page say the same, whatever the screen); a review request keeps its own pill
// beside it, and a PR with a review running or waiting wears the comet frame and opens on its Review tab.
function DeskPullRow({ project, pr, request = false, order = '', lastLooked, facts, onOpenPull, login }) {
  const comments = conversationCount(pr)
  const decision = deskStanding(pr, login, facts)
  const framed = frameOf(decision)
  // No decision pill while an agent works: the travelling frame says it, and a running review wears no tag (the owner's choice,
  // 3 Nov). A request's own pill already says "your turn" while the PR rests; the decision adds its words when it has some.
  const labelled = framed !== 'reviewing' && (!request || chipOf(decision))
  const pills = [...(request ? [requestChip] : []), ...(labelled && !isDraftWord(pr, decisionChip(decision)) ? [decisionChip(decision)] : [])]
  const who = [`#${pr.number}`, whoOf(pr.author?.login, login) || 'Contributor', pr.updatedAt ? <TimeAgo prefix="updated " value={pr.updatedAt} /> : null]
  return (
    <ReviewFrame state={framed} inset={3} radius={10}>
      <DeskRow
        icon={<PullStateIcon pr={pr} />}
        title={<><NewDot value={pr.updatedAt} lastLooked={lastLooked} />{pr.title}</>}
        facts={<>
          {order ? <span className="co-desk-order">{order}</span> : null}
          <span><DotLine parts={who} /></span>
          <ChecksBadge pr={pr} />
          {Number.isInteger(pr.additions) ? <span className="co-change-total"><b>+{pr.additions}</b><em>−{pr.deletions}</em></span> : null}
        </>}
        labels={<span className="co-pr-labels"><PullLabels pr={pr} /></span>}
        pills={pills.map(chip => <StatusPill key={chip.label} chip={chip} />)}
        aside={comments ? <span className="co-pr-comments" title={`${comments} in the conversation: comments and reviews`}><Icon name="comment" size={15} />{comments}</span> : null}
        onOpen={() => onOpenPull(project, pr, framed === 'idle' ? 'conversation' : 'review')}
      />
    </ReviewFrame>
  )
}

// A saved-work card (review feedback, a decision) in the same layout as a PR row. About a PR that was read, its
// status is that PR's shared decision, as on every other screen; its saved note is the row's one-line reason.
function DeskAttentionRow({ item, pr, decision, login, onSelect, action = null }) {
  const reason = lookAtReason(item)
  const detectedAt = item.record?.attention?.detected_at
  const number = item.record?.number
  const facts = [number ? `#${number}` : null, pr ? whoOf(pr.author?.login, login) : null, detectedAt ? <TimeAgo prefix="detected " value={detectedAt} /> : null, groupNote(item)]
  return (
    <DeskRow
      tone={reason.key}
      icon={pr ? <PullStateIcon pr={pr} /> : <Icon name="info" size={16} className="co-desk-attention-icon" />}
      title={number ? item.label.replace(/^#\d+\s+/, '') : item.label}
      facts={<span><DotLine parts={facts} /></span>}
      pills={[decision ? <StatusPill key="status" chip={decisionChip(decision)} /> : <span key="reason" className="co-desk-chip is-tone">{reason.label}</span>]}
      reason={item.detail}
      // The row's own answer sits beside it, never inside the button that opens the PR.
      action={action ? <button type="button" className="co-btn co-btn-primary co-desk-row-action" onClick={action.run}>{action.label}</button> : null}
      onOpen={() => onSelect(item)}
    />
  )
}

// Rows per project and view. In Needs you each row is tagged with the step (desk.js NEEDS_CHIPS) that counts it:
// the rows are desk.js needsRows, the same list the chips and the rail count.
function projectRows(view, project, { login, decisionsFor, lastLooked, query, runs, chats, responses, ignored, reviewEntries, onOpenPull, onOpenRecord }) {
  const rows = []
  const facts = { runs, chats, responses, ignored }
  // The search finds a project by its name too: a name match keeps all of its rows.
  const keep = (...parts) => matches(query, project.name, ...parts)
  const pullRow = (pr, step, extra = {}) => ({ chip: step, el: <DeskPullRow key={`pr:${pr.number}`} project={project} pr={pr} lastLooked={lastLooked} facts={facts} onOpenPull={onOpenPull} login={login} {...extra} /> })
  const all = decisionsFor(project)
  const ownPulls = authoredPulls(project.incomingReviews, login)
  // Your own agent review of your own PR found problems at its current version:
  // the row offers the fix itself, and opens the PR straight into it.
  const fixAction = (target, pr, decision) => {
    if (!pr || !savedFindings(reviewForPull(runs, pr), ignored)) return null
    // The machine decides whether Respond may start; a draft that already deals with the findings turns it off.
    if (!actionOf(decision, 'respond')?.enabled) return null
    return { label: NAMES.fixFindings, run: () => onOpenPull(project, target, 'review', 'fix') }
  }
  const openDecision = item => {
    const target = feedbackPull(item)
    if (target) onOpenPull(project, target)
    else onOpenRecord(project, item)
  }
  const decisionRow = item => {
    const target = feedbackPull(item)
    const pr = target && ownPulls.find(candidate => prKey(candidate) === prKey(target))
    const decision = pr ? deskStanding(pr, login, facts) : null
    return { chip: 'look', el: (
      <ReviewFrame key={`decision:${item.id}`} state={frameState(reviewForRecord(runs, item.record), { own: true, ignored })} inset={3} radius={10}>
        <DeskAttentionRow item={item} pr={pr || null} decision={decision} login={login} onSelect={openDecision} action={fixAction(target, pr, decision)} />
      </ReviewFrame>
    ) }
  }
  // [what the search looks in, the row] for one row of Needs you.
  const needsEntry = row => {
    if (row.item) return [[row.item.label, String(row.item.record?.number || '')], decisionRow(row.item)]
    if (row.entry) return [[row.entry.item.title, String(row.entry.item.number)], { chip: row.step, el: <ReviewRow key={`run:${row.entry.id}`} entry={row.entry} project={project} login={login} onOpenPull={onOpenPull} /> }]
    return [[row.pr.title, String(row.pr.number), row.pr.author?.login], pullRow(row.pr, row.step, { request: row.step === 'review' })]
  }
  if (view === 'requests') {
    (project.reviewRequests || []).filter(pr => keep(pr.title, String(pr.number), pr.author?.login)).forEach(pr => rows.push(pullRow(pr, 'review', { request: true })))
  }
  if (view === 'work') {
    all.filter(item => keep(item.label, String(item.record?.number || ''))).forEach(item => rows.push(decisionRow(item)))
  }
  if (view === 'needs') {
    projectNeedsRows(project, all, login, reviewEntries, facts).map(needsEntry).filter(([parts]) => keep(...parts)).forEach(([, row]) => rows.push(row))
  }
  if (view === 'mine') {
    const mine = ownPulls.filter(pr => keep(pr.title, String(pr.number), pr.author?.login))
    chainPulls(mine).forEach(chain => chain.forEach((pr, index) => rows.push(pullRow(pr, '', { order: chain.length > 1 ? `Part ${index + 1} of ${chain.length}` : '' }))))
  }
  return rows
}

// A merged PR keeps its page: the row opens it, read-only because the PR no longer accepts actions.
function MergedRows({ project, records, query, lastLooked, onOpenPull }) {
  return records
    .filter(record => matches(query, project.name, record.title, String(record.number || '')))
    .map(record => {
      const repo = record.repo || record.plan?.repo
      return <DeskRow key={record.id}
        icon={<Icon name="merge" size={16} className="co-desk-merged-icon" />}
        title={<><NewDot value={record.updated_at} lastLooked={lastLooked} />{record.title || 'Untitled contribution'}</>}
        facts={<span><DotLine parts={[record.number ? `#${record.number}` : null, 'yours', <TimeAgo value={record.updated_at || record.created_at} />]} /></span>}
        pills={[<StatusPill key="status" chip={{ label: STATUS_LABELS[record.status] || record.status, tone: 'quiet' }} />]}
        onOpen={record.number && repo ? () => onOpenPull(project, { number: record.number, repository: { nameWithOwner: repo } }) : null} />
    })
}

const EMPTY = {
  needs: { title: 'Nothing needs you right now', hint: 'Review requests, approved work, failing checks and reviews that wait on you land here.' },
  filtered: { title: 'Nothing left for this step', hint: 'Tap the step again to see everything that needs you.' },
  requests: { icon: 'feedback', title: 'No review requests', hint: 'When someone asks for your review, the PR appears here.' },
  mine: { icon: 'pull', title: 'No open PRs of yours', hint: 'PRs you open on GitHub appear here with their next step.' },
  merged: { icon: 'check', title: 'Nothing merged this week', hint: 'Your PRs that land stay here for a week.' },
}

// My PRs holds what is open and, as a filter, what merged this week (finding 2).
const MINE_FILTERS = [['open', 'Open'], ['merged', 'Merged']]
function MineFilter({ value, counts, onChange }) {
  return <div className="co-pr-filters" role="group" aria-label="Show my PRs">
    {MINE_FILTERS.map(([key, label]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{label}<span className="co-pr-filter-count">{key === 'open' ? counts.mine || 0 : counts.merged || 0}</span></button>)}
  </div>
}

function viewEnvelopes(view, projects, { records, query, lastLooked, needsFilter, context, onOpenProject }) {
  const envelopes = []
  for (const project of projects) {
    const rows = view === 'merged'
      ? MergedRows({ project, records: mergedRecently(recordsForProject(records, project)), query, lastLooked, onOpenPull: context.onOpenPull })
      : projectRows(view, project, context).filter(row => !needsFilter || row.chip === needsFilter).map(row => row.el)
    if (rows.length) envelopes.push(
      <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>{rows}</Envelope>,
    )
  }
  return envelopes
}

// The selected side view: one card per app, in the projects list's own order.
export function DeskView({ view, projects, records, login, decisionsFor, lastLooked, query, runs = [], chats = [], responses = [], ignored = null, reviews = null, counts = {}, needsFilter = '', onOpenProject, onOpenPull, onOpenRecord }) {
  const [mineFilter, setMineFilter] = useState('open')
  const context = { login, decisionsFor, lastLooked, query, runs, chats, responses, ignored, reviewEntries: reviews?.entries || [], onOpenPull, onOpenRecord }
  if (view === 'runs') return <AgentRunsView reviews={reviews} projects={projects} query={query} login={login} renderWork={project => projectRows('work', project, context).map(row => row.el)} onOpenProject={onOpenProject} onOpenPull={onOpenPull} />
  const shownView = view === 'mine' && mineFilter === 'merged' ? 'merged' : view
  const envelopes = viewEnvelopes(shownView, projects, { records, query, lastLooked, needsFilter: view === 'needs' ? needsFilter : '', context, onOpenProject })
  const filter = view === 'mine' ? <MineFilter value={mineFilter} counts={counts} onChange={setMineFilter} /> : null
  if (!envelopes.length) {
    const empty = view === 'needs' && needsFilter ? EMPTY.filtered : EMPTY[shownView] || EMPTY.needs
    return <>{filter}<EmptyView icon={empty.icon} title={query.trim() ? 'Nothing matches your search' : empty.title} hint={query.trim() ? 'Try a PR number, a title word or a name.' : empty.hint} /></>
  }
  return <>{filter}<div className="co-desk-envelopes">{envelopes}</div></>
}
