import { Icon } from './Icons.jsx'

// A long branch name is split in the markup, never cut: where it must stay on one line (a window's head) the start
// shrinks behind an ellipsis and the end stays whole, because the end is what tells two long names apart.
const LONG_BRANCH = 28
const KEPT_END = 11
function BranchName({ name }) {
  if (name.length <= LONG_BRANCH) return <code>{name}</code>
  return <code><span className="co-branch-start">{name.slice(0, -KEPT_END)}</span>{name.slice(-KEPT_END)}</code>
}

// The branch a PR merges from, an arrow, and the branch it merges into ("feat/x → main"); only the target when
// the source is not known. Shown on the PR page and in every window about one PR, so the owner always sees what they are acting on.
export function BranchFlow({ pr, inline = false }) {
  const Tag = inline ? 'span' : 'p'
  return <Tag className="co-branch-flow" aria-label="Branches">{pr.headRefName ? <><BranchName name={pr.headRefName} /><span className="co-branch-to"><Icon name="arrow-right" size={15} /><BranchName name={pr.baseRefName} /></span></> : <BranchName name={pr.baseRefName} />}</Tag>
}
