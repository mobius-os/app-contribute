import { useMemo, useState } from 'react'
import { CHECK_STATE_WORDS, NAMES } from '../names.js'
import { CHECK_STATES, checkCounts, checkGroups, checkRows, countWords, durationWords, foldedRows, foldsAt, resultWord } from '../pull-checks.js'
import { safeDetailLink } from '../pull-details.js'
import { Icon } from './Icons.jsx'
import { TimeAgo } from './GithubParts.jsx'
import { Shine } from './Shine.jsx'

const STATE_ICONS = { failing: 'check-fail', running: 'check-pending', passed: 'check-pass', skipped: 'skip' }

// The states as one ring, drawn in the order of the groups; the words beside it are what carries the meaning. The ring's own
// name says it the way the tab's badge does: skipped and neutral checks count as passing.
function CheckRing({ counts }) {
  let drawn = 0
  return <svg className="co-check-ring" viewBox="0 0 36 36" width="36" height="36" role="img" aria-label={`${counts.passing} of ${counts.all} checks passed or skipped`}>
    <circle className="co-check-ring-track" cx="18" cy="18" r="15.9155" pathLength="100" />
    {CHECK_STATES.filter(state => counts[state]).map(state => {
      const share = 100 * counts[state] / counts.all
      const offset = drawn
      drawn += share
      return <circle key={state} className={'is-' + state} cx="18" cy="18" r="15.9155" pathLength="100" strokeDasharray={`${share} ${100 - share}`} strokeDashoffset={-offset} transform="rotate(-90 18 18)" />
    })}
  </svg>
}

// What the version is and when it was read, with Check again where the result is read.
function ChecksSummary({ data, counts, onCheckAgain }) {
  const words = counts.all ? countWords(counts) : data?.errors?.length ? 'Checks could not be read' : 'No checks reported for this version'
  return <div className="co-checks-summary">
    {counts.all ? <CheckRing counts={counts} /> : null}
    <div className="co-checks-summary-text">
      <strong>{words}</strong>
      {data?.head ? <span>For commit <code>{data.head.slice(0, 7)}</code>{data.readAt ? <> · <TimeAgo prefix="read " value={data.readAt} /></> : null}</span> : null}
    </div>
    {onCheckAgain ? <button type="button" className="co-btn co-btn-quiet" onClick={onCheckAgain}><Icon name="refresh" size={16} />{NAMES.checkAgain}</button> : null}
  </div>
}

// The same chips as the PR list, with a state that has no checks stepped back.
function CheckFilters({ counts, filter, onFilter }) {
  return <div className="co-pr-filters" role="group" aria-label="Filter checks">{['all', ...CHECK_STATES].map(key =>
    <button key={key} type="button" className={counts[key] === 0 ? 'is-empty' : undefined} aria-pressed={filter === key} onClick={() => onFilter(key)}>{CHECK_STATE_WORDS[key]}<span className="co-pr-filter-count">{counts[key]}</span></button>)}
  </div>
}

// Why a failed check failed: its failed step names and first annotations, as plain text (an annotation is
// whatever the check's own tool wrote). With no reason to read, the check's own one-line result stands in. The log
// itself is on GitHub, behind the row's link.
function CheckWhy({ row: { why, detail } }) {
  if (!why && !detail) return null
  return <div className="co-check-why">
    {why?.steps.length ? <p>{why.steps.length === 1 ? 'Failed step' : 'Failed steps'}: {why.steps.map(name => <code key={name}>{name}</code>)}</p> : null}
    {why?.annotations.length ? <ul>{why.annotations.map((note, index) => <li key={index}>{note.where ? <code>{note.where}</code> : null} {note.text}</li>)}</ul> : null}
    {why ? null : <p>{detail}</p>}
  </div>
}

function CheckTime({ row }) {
  if (row.duration !== null) return <span className="co-check-time">{durationWords(row.duration)}</span>
  return row.when ? <span className="co-check-time"><TimeAgo prefix={row.when.prefix} value={row.when.at} /></span> : null
}

// One line per check: its icon and its word (a state is never colour alone), its name, its time, and the way out to GitHub.
// A failing check opens with its reason.
function CheckRow({ row }) {
  const link = safeDetailLink(row.link)
  const word = resultWord(row)
  return <li className={'co-check is-' + row.state}>
    <span className="co-check-icon"><Icon name={STATE_ICONS[row.state]} size={16} /></span>
    <span className="co-check-name">{row.name}</span>
    <span className="co-check-meta"><b>{row.verdict === 'in_progress' ? <Shine>{word}</Shine> : word}</b><CheckTime row={row} /></span>
    {link ? <a className="co-btn co-btn-quiet co-btn-icon co-tip" href={link} target="_blank" rel="noopener noreferrer" aria-label={`${NAMES.viewOnGitHub}: ${row.name}`} data-tip={NAMES.viewOnGitHub}><Icon name="github" size={16} /></a> : null}
    {row.state === 'failing' ? <CheckWhy row={row} /> : null}
  </li>
}

// A state's checks. Passed and skipped fold when there are many; a filter shows the whole group it picked.
function CheckGroup({ group, folding }) {
  const [open, setOpen] = useState(false)
  const rows = foldedRows(group, open || !folding)
  const fold = folding && foldsAt(group.state, group.rows.length)
  return <section className={'co-check-group is-' + group.state} aria-label={CHECK_STATE_WORDS[group.state]}>
    <h4>{CHECK_STATE_WORDS[group.state]}<span className="co-check-count">{group.rows.length}</span></h4>
    <ul>
      {rows.map(row => <CheckRow key={row.key} row={row} />)}
      {fold ? <li className="co-check-fold"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? 'Show fewer' : `Show ${group.rows.length - rows.length} more`}<Icon name="chevron" size={16} /></button></li> : null}
    </ul>
  </section>
}

export function PullChecks({ data, onCheckAgain }) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => checkRows(data), [data])
  const counts = checkCounts(rows)
  return <section className="co-checks" aria-label="Checks">
    <ChecksSummary data={data} counts={counts} onCheckAgain={onCheckAgain} />
    <p className="co-pr-note">Reported by GitHub for this version{data?.page > 1 ? ` · page ${data.page}` : ''}. Checks are not an all-clear review.</p>
    {data?.groups?.some(group => group.hasMore) ? <p className="co-pr-note">More results remain on GitHub.</p> : null}
    {counts.all ? <CheckFilters counts={counts} filter={filter} onFilter={setFilter} /> : null}
    {checkGroups(rows, filter).map(group => <CheckGroup key={group.state} group={group} folding={filter === 'all'} />)}
    {counts.all && !counts[filter] ? <p className="co-pr-note">No {CHECK_STATE_WORDS[filter].toLowerCase()} checks.</p> : null}
    {data?.capped ? <p>Only the first 100 result pages are available here. More results remain on GitHub.</p> : null}
  </section>
}
