import { DeskRow, DotLine } from './DeskRow.jsx'
import { PullStateIcon } from './GithubParts.jsx'
import { askAgainIntent } from '../next-step.js'
import { NAMES, waitingWords } from '../names.js'

// The quiet block under Needs you: your own PRs that have waited on their reviewers for days (desk.js waitingOnOthers), each with
// the one ask the PR machine offers for it. A reminder, not a task: it adds to no badge, chip or sentence, it is no part of the
// list or its filters, and nothing in it draws the eye. `rows` are { project, pr, decision, days }. Hidden when there are none.
export function WaitingOnOthers({ rows, capabilities, onOpenPull }) {
  if (!rows.length) return null
  // The PRs of one repository need no name for it; with two or more the repository is the first thing to tell them apart.
  const several = new Set(rows.map(({ project }) => project.key)).size > 1
  return <section className="co-envelope co-waiting" aria-label={NAMES.waitingOnOthers}>
    <header className="co-envelope-head"><h3>{NAMES.waitingOnOthers} · {rows.length}</h3></header>
    <div className="co-envelope-body">
      {rows.map(({ project, pr, decision, days }) => {
        const ask = askAgainIntent(decision, { capabilities })
        return <DeskRow key={`${project.key}#${pr.number}`}
          icon={<PullStateIcon pr={pr} />}
          title={pr.title}
          facts={<span><DotLine parts={[`#${pr.number}`, several ? project.name : null, waitingWords(days, decision.waitingOn)]} /></span>}
          action={ask ? <button type="button" className="co-btn co-btn-quiet co-desk-row-action" aria-label={`${NAMES.askAgain}: ${pr.title}`} onClick={() => onOpenPull(project, pr, 'conversation', ask)}>{NAMES.askAgain}</button> : null}
          onOpen={() => onOpenPull(project, pr)} />
      })}
    </div>
  </section>
}
