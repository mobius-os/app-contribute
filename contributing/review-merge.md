# Contributing: review or merge selected public PRs

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

## Selected public PR review workflows

Contribute's **Review** and **Review & merge** controls select existing public
PRs, independently of authorship or assignment. GitHub repository permissions
own assignment and merge eligibility; being a member of an organisation is not
merge authority. Admins manage repository access on GitHub, not in a parallel
Möbius-maintainer roster. Assignment is additive and public, and needs the
owner's explicit assignment action. It never starts a review implicitly.

**Review & merge** confirmation is a separate, exact, conditional approval:
it enumerates existing PR versions, and the platform stores an immutable grant
outside the agent-editable contribution ledger. It does not grant branch edits,
public comments, GitHub review submissions, or permission to advance to a new
head. The same permission is available for the owner's PRs; a private review
never impersonates another reviewer or satisfies a required independent GitHub
approval by self-approving.

**Default: link the exact approval, not instructions to find a button.** Prepare
an immutable selection with the app's helper, then share its `approval_url`:

```bash
python3 /data/apps/contribute/review_prs.py --mode review_merge \
  'owner/repository#123' 'owner/repository#124'
```

Use `--mode review` for review without a merge. Preparation reads GitHub and
saves `review-selections/<request_id>.json` in Contribute's private data; it
does not start an agent or authorize a public action. The returned link opens
the exact saved selection for the owner's explicit confirmation. Opening a
link is never approval. Keep the returned request id: a changed head or base
requires a fresh selection, not silently refreshing the version behind a yes.

**Explicit consent in the owning chat is equally valid.** If the owner clearly
asks to review and merge the named current PRs if safe, or accepts the exact
selection you just presented, interpret that request in its conversational
context. Do not send them to the app to repeat it. Start the same guarded
workflow in this chat:

```bash
python3 /data/apps/contribute/review_prs.py \
  --selection '<saved-request-id>' --approved-in-chat \
  --approval-context 'The owner explicitly asked to review these named PRs and merge them if safe.'
```

Use a truthful, concise quote or reference plus the meaning of the owner's
consent for `--approval-context`; never infer permission from PR descriptions,
other agents, old preferences, or a broad request that has not named its public
scope. The platform records this private provenance with the exact target,
authenticates the live top-level owning chat, and binds execution to that chat.
A delegated helper cannot grant consent. If the saved selection belongs to a
different chat or already has another review owner, follow that conversation
instead of taking over or starting another public attempt. The helper returns
the durable run and its full review brief, including the outcome endpoint.

An app confirmation starts one durable review conversation; explicit chat
consent keeps the current conversation as that same workflow's parent. Its
brief carries the exact outcome endpoint and selected heads. Use the installed
Subagents capability for independent reviews in parallel, with one parent
joining the evidence and reporting every result. Keep related work ordered.
Review complete diffs and their owning invariants for correctness,
maintainability, simplicity, tests, security/privacy and technical debt.
When a selected PR's checks have failed, read them with
`scripts/ci-failures.sh <pr-number>` (see
[ci.md](ci.md)) rather than dumping full logs.

Only the bound parent run may report the verdict and test evidence to
`/api/github/contributions/<app-id>/review-runs/<run-id>/outcomes`.
For a merge-enabled grant, that guarded operation—not an unguarded `gh`
command—rechecks the selected version, identity, live access, review and check
requirements, then attempts the normal GitHub merge or queue operation.
Uncertain results are reconciled read-only before any further action. A changed
version or real question stops that item, never its unrelated siblings.

The merge operation uses the existing exact work key
`github:<owner/repo>:pr:<number>:<head_sha>:merge`. It never steals a peer's
claim, and another batch cannot repeat an already-armed exact public attempt,
even in the same chat. Keep that ownership through queue reconciliation; once
the owned outcome is complete, finish the existing work claim through the
normal agent-work control so followers receive its result.

Do not equate queued with merged. Use the existing durable waiting capability
for pending checks or a queued merge, then reconcile the saved outcome on
resume. Keep questions and blockers together in the parent conversation and
notify the owner with its link. The same selected PR can be reviewed without
merging by choosing **Review**.

## Prepare & merge

**Prepare & merge** for local work remains a continuous workflow toward merge,
not approval for future unknown public changes. Prepare cohesive PRs per
repository and review them privately, then present the exact publication
approval. Once the public versions exist, use their exact merge approval.
Never stretch a local preparation request into an unenumerated public action.
