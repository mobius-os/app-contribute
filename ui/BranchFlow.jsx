import { Icon } from './Icons.jsx'

// The branch a PR merges from, an arrow, and the branch it merges into ("feat/x → main"); only the target when
// the source is not known. Shown on the PR page and in every window about one PR, so the owner always sees what they are acting on.
export function BranchFlow({ pr }) {
  return <p className="co-branch-flow" aria-label="Branches">{pr.headRefName ? <><code>{pr.headRefName}</code><span className="co-branch-to"><Icon name="arrow-right" size={15} /><code>{pr.baseRefName}</code></span></> : <code>{pr.baseRefName}</code>}</p>
}
