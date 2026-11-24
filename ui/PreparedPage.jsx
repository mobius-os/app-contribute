import { useState } from 'react'
import { parseDiffStat } from '../diff.js'
import { timeAgo } from '../domain.js'
import { contributionTitle } from '../run.js'
import { ContributionCard, ReviewPlan, cardStatus } from './ContributionCard.jsx'
import { Icon } from './Icons.jsx'

// The page of a prepared contribution, drawn inside the tab that lists it (owner's choice, 2026-11-23): what it is, what
// waits on the owner, then its description in sections. It is the card's own content in a page's order: title, facts,
// the source chats, the state and summary, Hide details, and the Description / Files / Activity tabs. Publication stays
// with the send bar above the tabs, so nothing here sends.
function PreparedPage({ rec, reviewState, chats, loadDiff }) {
  const plan = rec.plan
  const [expanded, setExpanded] = useState(true)
  const { blocked, label: stateLabel, key: stateKey, narration } = cardStatus(rec, reviewState)
  const title = contributionTitle(rec, plan.title || rec.title || 'Untitled contribution')
  const summary = rec.summary && rec.summary !== title ? rec.summary : ''
  const stat = parseDiffStat(plan.diff_stat)
  const when = timeAgo(rec.updated_at || rec.created_at)
  const repo = plan.repo || rec.repo || ''
  const branch = plan.branch || rec.branch || ''
  return (
    <article className={'co-pr-page' + (blocked ? ' is-blocked' : '')} aria-label={title}>
      <h3 className="co-pr-page-title">{title}</h3>
      <div className="co-pr-page-facts">
        <span className={`co-chip is-${stateKey}`}>{stateLabel}</span>
        {(plan.labels || []).map(name => <span className="co-plan-label" key={name}>{name}</span>)}
      </div>
      <p className="co-pr-page-line">
        {repo ? <span>{repo}</span> : null}
        {branch ? <span className="co-pr-page-branch">{branch}</span> : null}
        {when ? <span>{when}</span> : null}
        {stat?.totalFiles ? <span className="co-diffline">
          <span className="co-diffline-files">{stat.totalFiles} {stat.totalFiles === 1 ? 'file' : 'files'}</span>
          <span className="co-diffline-add">+{stat.additions}</span>
          <span className="co-diffline-del">{'−'}{stat.deletions}</span>
        </span> : null}
      </p>
      {chats}
      {narration || summary ? <div className="co-pr-page-next">
        {narration ? <span className="co-pr-page-state">{narration}</span> : null}
        {summary ? <p>{summary}</p> : null}
      </div> : null}
      <button type="button" className="co-btn co-btn-quiet co-details-toggle" aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
        <span>{expanded ? 'Hide details' : 'Details'}</span>
        <span className={expanded ? 'is-open' : ''}><Icon name="chevron" size={16} /></span>
      </button>
      {expanded ? <div className="co-pr-page-body"><ReviewPlan rec={rec} loadDiff={loadDiff} sections fileCount={stat?.totalFiles ?? null} /></div> : null}
    </article>
  )
}

// A prepared plan is read as a page; any other record (a published PR opened from its history, a draft with no plan)
// keeps the card it has always had, with the source chats above it.
export function FocusedCard({ rec, reviewState, chats = null, onSetAutopilot, loadDiff }) {
  if (rec?.status === 'prepared' && rec.plan && typeof rec.plan === 'object') {
    return <PreparedPage rec={rec} reviewState={reviewState} chats={chats} loadDiff={loadDiff} />
  }
  return <>
    {chats}
    <ContributionCard rec={rec} reviewState={reviewState} onSetAutopilot={onSetAutopilot} loadDiff={loadDiff} initialExpanded showDecision={false} />
  </>
}
