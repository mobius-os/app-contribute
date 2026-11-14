import { prKey } from '../collaboration.js'
import { Icon } from './Icons.jsx'
import { BranchFlow } from './BranchFlow.jsx'

// The top of every agent and confirm window, always the same centred lines: the repository in purple capitals,
// the job with the PR's number, then the branches it merges from and into on one line. The PR's name is not
// repeated here: the owner opened the window from that PR. A window over several PRs says "N PRs" and lists each one.
// A question about a saved record, not a PR on GitHub (Withdraw, Discard), gives its own `eyebrow` and no
// `pulls`. `tools` (the close X of a window with no Cancel) sit in the head; `done` swaps in a green check
// above the lines.
export function WindowHead({ title, titleId, pulls = [], eyebrow = null, tools = null, done = false }) {
  const [only] = pulls
  const line = eyebrow ?? (pulls.length === 1 ? only.repository.nameWithOwner : `${pulls.length} PRs`)
  // A job that already names the number ("Merge #12 into main?") is not given it twice.
  const job = pulls.length === 1 && !String(title).includes(`#${only.number}`) ? `${title} #${only.number}` : title
  return <header className={'co-rw-head' + (done ? ' is-done' : '')}>
    {done ? <span className="co-rw-icon"><Icon name="check" size={22} /></span> : null}
    <div className="co-rw-lines">
      <p className="co-rw-eyebrow">{line}</p>
      <h3 id={titleId}>{job}</h3>
      {pulls.length === 1 && only.baseRefName ? <BranchFlow pr={only} /> : null}
      {pulls.length > 1 ? <ul className="co-rw-list">{pulls.map(pr => <li key={prKey(pr)}><strong>#{pr.number}</strong> {pr.title}<span>{pr.repository.nameWithOwner}</span></li>)}</ul> : null}
    </div>
    {tools ? <div className="co-rw-tools">{tools}</div> : null}
  </header>
}

export function CloseWindowButton({ onClick, disabled = false }) {
  return <button type="button" className="co-btn co-btn-quiet co-btn-icon co-rw-close" aria-label="Close" disabled={disabled} onClick={onClick}><Icon name="close" size={18} /></button>
}
