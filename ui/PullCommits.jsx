import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { authorLine, authorNames, checkWords, commitGroups, commitStats, copyText, madeWithAgent, reviewMarker } from '../pull-commits.js'
import { NAMES } from '../names.js'
import { safeDetailLink } from '../pull-details.js'
import { Icon } from './Icons.jsx'

// The short hash is the Copy control: pressing it copies the full hash. The icon swaps to a check only after the
// write succeeded; otherwise it says so, and the short hash is on screen to copy by hand. The tooltip and the
// accessible name say what it does, as for every icon-led button.
function CommitHash({ oid, short }) {
  const [result, setResult] = useState('')
  const said = result === 'copied' ? 'Copied' : result === 'failed' ? 'Couldn\u2019t copy' : ''
  return <button type="button" className="co-commit-hash co-tip" data-tip={said || NAMES.copyHash} aria-label={`${NAMES.copyHash} ${short}`}
    onClick={async () => {
      setResult((await copyText(oid)) ? 'copied' : 'failed')
      window.setTimeout(() => setResult(''), 1500)
    }}><code>{short}</code><Icon name={result === 'copied' ? 'check' : 'copy'} size={14} /><span className="co-visually-hidden" role="status">{said}</span></button>
}

function CommitTime({ value }) {
  if (!Number.isFinite(Date.parse(value))) return null
  const at = new Date(value)
  return <time dateTime={value} title={at.toLocaleString(undefined, { hourCycle: 'h23' })}>{at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</time>
}

function CommitStats({ commit }) {
  const stats = commitStats(commit)
  if (!stats) return null
  return <span className="co-commit-stats">{stats.files} {stats.files === 1 ? 'file' : 'files'} <b className="co-file-add">+{stats.additions}</b> <b className="co-file-del">−{stats.deletions}</b></span>
}

// The title opens the commit's changes, the short hash copies the full hash and one GitHub icon stays. A long message
// opens from the chevron beside the title, at the card's full width below it.
function CommitRow({ commit, onOpen }) {
  const names = authorNames(commit)
  const checks = checkWords(commit)
  const link = safeDetailLink(commit.url)
  const body = String(commit.messageBody || '').trim()
  const short = commit.abbreviatedOid || commit.oid.slice(0, 7)
  const [more, setMore] = useState(false)
  const bodyId = useId()
  return <li className="co-commit">
    <div className="co-commit-main">
      <div className="co-commit-head">
        <button type="button" className="co-commit-title" data-commit={commit.oid} onClick={() => onOpen(commit)}>{commit.messageHeadline}<span className="co-visually-hidden"> — {NAMES.seeChanges}: commit {short}</span></button>
        {body ? <button type="button" className="co-commit-toggle" aria-expanded={more} aria-controls={bodyId} aria-label={NAMES.showFullMessage} onClick={() => setMore(value => !value)}><Icon name="chevron" size={16} /></button> : null}
      </div>
      {body && more ? <div id={bodyId} className="co-commit-body">{body}</div> : null}
      <p className="co-commit-meta">
        {names.length ? <span>{authorLine(names)} committed </span> : null}<CommitTime value={commit.committedDate} />
        <CommitStats commit={commit} />
        {madeWithAgent(commit) ? <span className="co-commit-agent" title="Written with the Möbius agent"><Icon name="prepare" size={14} />Agent</span> : null}
        {checks ? <span className={'co-commit-checks is-' + checks.tone}>{checks.text}</span> : null}
      </p>
    </div>
    <div className="co-commit-side">
      <CommitHash oid={commit.oid} short={short} />
      {link ? <a className="co-btn co-btn-quiet co-btn-icon co-tip" href={link} target="_blank" rel="noopener noreferrer" aria-label={`${NAMES.viewOnGitHub}: commit ${short}`} data-tip={NAMES.viewOnGitHub}><Icon name="github" size={16} /></a> : null}
    </div>
  </li>
}

// The head of one commit's own diff: the way back to the list, and which commit this is. The diff itself
// is PullFiles, the same viewer as Files changed.
export function CommitChangesHead({ commit, onBack }) {
  const link = safeDetailLink(commit.url)
  return <div className="co-commit-open">
    <button type="button" className="co-btn" autoFocus onClick={onBack}><Icon name="left" size={16} />Back to commits</button>
    <h4><code>{commit.abbreviatedOid || commit.oid.slice(0, 7)}</code> {commit.messageHeadline}</h4>
    {link ? <a className="co-btn co-btn-quiet" href={link} target="_blank" rel="noopener noreferrer" aria-label={`${NAMES.viewOnGitHub}: commit ${commit.oid.slice(0, 7)}`}><Icon name="github" size={16} /><span>{NAMES.viewOnGitHub}</span></a> : null}
  </div>
}

// The PR's commits, grouped by day like GitHub, plus two things only Contribute knows: where the
// last review stopped, and a Review again banner when the PR has commits it has not seen.
// `again` is the machine's own review action for this PR (null when it is not yours to run). `pinned` is true
// when the page's one filled button already offers the same step; on a phone the banner then leaves it to the foot bar.
export function PullCommits({ data, reviewedHead = '', again = null, pinned = false, onAgain, onOpen, returnFocus = null }) {
  const commits = data?.commits || []
  const list = useRef(null)
  // `returnFocus.current` names the commit whose diff was just closed: its row takes keyboard focus back, once.
  useEffect(() => {
    if (returnFocus?.current) list.current?.querySelector(`[data-commit="${returnFocus.current}"]`)?.focus()
    if (returnFocus) returnFocus.current = ''
  }, [])
  if (!commits.length) return <p className="co-pr-note">No commits yet.</p>
  const marker = reviewMarker(commits, reviewedHead)
  const fresh = marker.newCount > 0
  return <section className="co-commits" aria-label="Commits" ref={list}>
    {fresh ? <div className="co-commits-banner" role="status">
      <span>{marker.newCount}{data.hasMore ? '+' : ''} new {marker.newCount === 1 && !data.hasMore ? 'commit' : 'commits'} since your last review</span>
      {again ? <button type="button" className={'co-btn co-commits-again' + (pinned ? ' is-pinned' : '')} onClick={() => onAgain?.(again.id)}>{NAMES.reviewAgain}</button> : null}
    </div> : null}
    {commitGroups(commits).map(group => <div key={group.day} className="co-commit-day">
      <h4>Commits on {group.day}</h4>
      <ul>{group.commits.map(commit => <Fragment key={commit.oid}>
        <CommitRow commit={commit} onOpen={onOpen} />
        {marker.at >= 0 && commit.oid === commits[marker.at].oid ? <li className="co-commit-seen" role="separator"><span>Last review covered up to here</span></li> : null}
      </Fragment>)}</ul>
    </div>)}
  </section>
}
