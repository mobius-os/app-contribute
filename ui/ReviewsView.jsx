import { useState } from 'react'
import { Envelope, EmptyView } from './Envelope.jsx'
import { DeskRow, DotLine, StatusPill, whoOf } from './DeskRow.jsx'
import { PullStateIcon, TimeAgo } from './GithubParts.jsx'
import { NAMES } from '../names.js'
import { Shine } from './Shine.jsx'

// What waits on you leads, in the order it wants you: your move, an agent that stopped, a PR GitHub did not answer for.
const ORDER = { waiting: 0, stalled: 1, unknown: 2 }
const SHOWN_AT_FIRST = 8
// The tabs, in the order the page opens on the first that has rows. Finished is only what is over; saved agent work
// (a draft to open, a private review) waits on you too, so it belongs to the first tab.
const TABS = [['waiting', 'Waiting on you'], ['running', 'Running'], ['finished', 'Finished']]
const EMPTY = {
  waiting: { title: 'Nothing is waiting on you', hint: 'A review to send, a question from an agent or saved agent work that needs you shows here.' },
  running: { title: 'No agent is running', hint: 'Start one from a PR’s Actions menu. It shows here while it works.' },
  finished: { title: 'No finished agent runs yet', hint: 'Runs that are over, with their result, collect here.' },
}

const lowerRepo = value => String(value || '').toLowerCase()
const matches = (query, ...parts) => !query.trim() || parts.filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase())

// One review of a PR as a desk row: the same layout as every other row, its status the shared decision's words.
export function ReviewRow({ entry, project, login = '', onOpenPull }) {
  const { item, run, chips, pull } = entry
  const open = () => onOpenPull(project, { number: item.number, repository: { nameWithOwner: item.repo } }, 'review')
  const facts = [`#${item.number}`, whoOf(pull?.author?.login, login), run ? <TimeAgo prefix="you reviewed " value={run.created_at} /> : 'responding to feedback']
  return <DeskRow icon={<PullStateIcon pr={pull} />} title={item.title || `Pull request #${item.number}`} facts={<span><DotLine parts={facts} /></span>}
    pills={chips.map(chip => <StatusPill key={chip.label} chip={chip} />)} onOpen={open} />
}

// One project's rows; a long history folds behind "Show earlier".
function ProjectRows({ rows, project, login, onOpenPull }) {
  const [all, setAll] = useState(false)
  const shown = all ? rows : rows.slice(0, SHOWN_AT_FIRST)
  return <>
    {shown.map(entry => <ReviewRow key={entry.id} entry={entry} project={project} login={login} onOpenPull={onOpenPull} />)}
    {rows.length > shown.length ? <button type="button" className="co-btn co-comments-toggle" onClick={() => setAll(true)}>{`Show ${rows.length - shown.length} earlier`}</button> : null}
  </>
}

// Projects in the desk's order first; a repository the desk does not know gets
// a card of its own so no review is ever left out.
function groupByProject(entries, projects) {
  const known = new Set(projects.map(project => lowerRepo(project.canonical_repo)))
  const groups = projects.map(project => ({ project, rows: entries.filter(entry => lowerRepo(entry.item.repo) === lowerRepo(project.canonical_repo)) }))
  const strays = [...new Set(entries.map(entry => lowerRepo(entry.item.repo)).filter(repo => !known.has(repo)))]
  return [...groups, ...strays.map(repo => ({ project: { key: `external:${repo}`, name: repo, kind: 'external' }, rows: entries.filter(entry => lowerRepo(entry.item.repo) === repo) }))]
    .filter(group => group.rows.length)
}

// Agent runs: every review the owner started plus the saved agent work, by project, in three tabs named for
// what they hold (finding 5): Waiting on you, Running (an agent at work now) and Finished (only what is over).
// A run keeps its own pill ("Ready to merge", "Agent stopped"). The page opens on the first tab that has rows.
export function AgentRunsView({ reviews, projects, query, login = '', renderWork, onOpenProject, onOpenPull }) {
  const entries = reviews?.entries || []
  // A run whose PR is still being read ('checking') is in no tab until GitHub answers.
  const inTab = {
    waiting: entries.filter(entry => entry.bucket in ORDER).sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || b.at - a.at),
    running: entries.filter(entry => entry.bucket === 'running').sort((a, b) => b.at - a.at),
    finished: entries.filter(entry => entry.bucket === 'done').sort((a, b) => b.at - a.at),
  }
  const searched = list => list.filter(entry => matches(query, entry.item.title, String(entry.item.number), entry.item.repo))
  const savedWork = projects.map(project => ({ project, rows: renderWork(project) })).filter(group => group.rows.length)
  // Each tab's number is the rows it opens, searched or not.
  const counts = { waiting: searched(inTab.waiting).length + savedWork.reduce((total, group) => total + group.rows.length, 0), running: searched(inTab.running).length, finished: searched(inTab.finished).length }
  const [picked, setPicked] = useState(null)
  const tab = picked || TABS.find(([key]) => counts[key])?.[0] || TABS[0][0]
  const shown = searched(inTab[tab])
  const groups = groupByProject(shown, projects)
  const work = tab === 'waiting' ? savedWork : []
  const tabs = TABS.map(([key, label]) => [key, label, counts[key]])
  const empty = !groups.length && !work.length
  return <>
    <div className="co-pr-filters" role="group" aria-label="Agent runs">
      {tabs.map(([key, label, count]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setPicked(key)}>{label}<span className="co-pr-filter-count">{count}</span></button>)}
    </div>
    {reviews?.checking && !shown.length ? <p className="co-pr-note" role="status"><Shine>Checking which of these pull requests are still open…</Shine></p> : null}
    {reviews?.counts?.unknown && tab === 'waiting' ? <p className="co-pr-note" role="status">{reviews.counts.unknown === 1 ? 'One pull request' : `${reviews.counts.unknown} pull requests`} could not be read from GitHub, so where {reviews.counts.unknown === 1 ? 'it stands' : 'they stand'} is unknown. {reviews.retry ? <button type="button" className="co-btn co-btn-quiet" onClick={reviews.retry}>Try again</button> : null}</p> : null}
    {empty && !reviews?.checking
      ? <EmptyView icon="cycle" title={query.trim() ? 'Nothing matches your search' : EMPTY[tab].title} hint={query.trim() ? 'Try a PR number, a title word or a repository.' : EMPTY[tab].hint} />
      : <div className="co-desk-envelopes">
        {groups.map(({ project, rows }) => (
          <Envelope key={project.key} project={project} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>
            <ProjectRows rows={rows} project={project} login={login} onOpenPull={onOpenPull} />
          </Envelope>))}
        {work.map(({ project, rows }) => (
          <Envelope key={`work:${project.key}`} project={project} group={NAMES.preparedWork} count={rows.length} foldable={rows.length > 1} onOpenProject={onOpenProject}>{rows}</Envelope>))}
      </div>}
  </>
}
