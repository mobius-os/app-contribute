# Contributing: maintainer work

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies.

Everything here needs rights an ordinary contributor does not have: pushing to
the upstream repository, merging, or publishing into an organization's
repository. The default path for ordinary contributions is independent fork
PRs ([publish.md](publish.md)). GitHub repository
permissions own push, assignment, and merge eligibility; organization
membership alone is not merge authority.

## PR stacks

**Confirm upstream push permission first.** GitHub cannot use a branch that
exists only in the contributor's fork as the base of a PR in the upstream
repository, so a stack publishes dedicated `stack/**` branches directly to
upstream, and the server refuses before pushing anything unless the connected
owner has `permissions.push` there:

```bash
gh api repos/<owner>/<repo> --jq .permissions.push
```

Without it, prepare independent fork PRs; never simulate a stack by publishing
a cumulative diff that differs from the reviewed `.diff`.

With push permission, decide explicitly before preparing two or more PRs for
one goal. Use a stack when every layer is independently coherent and later
layers genuinely depend on earlier ones, or when an ordered split makes review
substantially clearer; CI then runs on the foundation and on the cumulative
result at the same time. Do not manufacture layers from one indivisible fix,
and do not stack unrelated changes: independent work stays as independent PRs
to the default branch so one failure, review, or delay cannot block the others.
A stack's direction is parent-first: PR A targets the default branch; PR B
targets A's upstream branch, so B's check covers A+B; and so on. Mention the
stack choice in `prior_work.summary` or the record summary when it helps the
partner understand the review shape.

### Prepare a stack

Each layer is its own complete, reviewed commit and its `.diff` is
**incremental against the previous layer**, never the cumulative diff against
the default branch. Each layer must remain a sensible review unit; put the
tests needed to trust a layer in that layer.

1. Choose one privacy-safe stack id. Every branch starts `stack/<stack-id>/`,
   followed by an ordered descriptive suffix: `stack/<stack-id>/01-<layer>`,
   `.../02-<layer>`, `.../03-<layer>`.
2. Prepare layer 1 from the freshly fetched default-branch base SHA, layer 2
   from layer 1's exact `head_sha`, and so on, with one durable review
   checkout per record under `/data/contrib/<record-id>/worktree`
   ([branch.md](branch.md)).
3. Set the connected owner's repo-local author/committer identity **before every
   commit**. Standalone send can normalize one tip commit; stack send cannot
   rewrite a parent without invalidating every child's reviewed ancestry.
4. Store the canonical `base_sha..head_sha` diff and hash for each layer exactly
   as for a standalone PR.
5. Put this additive object in every plan (positions are 1-based and complete):

```json
"stack": {
  "id": "<stack-id>",
  "name": "<Stack name>",
  "position": 2,
  "total": 3,
  "parent_record_id": "<stack-id>-01",
  "base_branch": "stack/<stack-id>/01-<layer>"
}
```

Layer 1 has an empty `parent_record_id` and `base_branch` equal to upstream's
default branch. Every later `parent_record_id` names the immediately preceding
ledger record, `base_branch` equals that record's branch, and its `base_sha`
equals that record's `head_sha`. Re-read all records and diffs as one review
unit before saying the stack is ready.

### Send a stack

When 2–12 prepared PR records carry one complete `plan.stack` chain,
Contribute groups them into one visual review and shows the current **Update
stack** or **Send stack** action.
The second, explicit confirmation lists every title and `base → branch` pair
in the current public phase; that click approves exactly those enumerated
pushes and PR creations. An explicit, unambiguous chat instruction accepting
the same current list is equally valid; do not require both approval surfaces.
Any record carrying `plan.stack` is stack-only: malformed or incomplete chains
stay visible for feedback, but neither the app nor the platform may fall back
to sending one layer through the standalone PR path.

A reviewed chain may start with existing pull requests whose branches need an
update and end with new unpublished children. Keep that as one stack, but use
two exact public phases: first confirm and update the consecutive `pr_update`
prefix; after a fresh ledger read proves those updates settled, separately
confirm and open the `pr` suffix. The confirmation enumerates only the current
phase, while the full chain remains visible and is revalidated on both calls.
Never place an existing-PR update after a new private layer, and never let one
phase claim, hide, or inherit approval for the deferred phase.

Before the first public push, the platform rechecks every record, every stored
diff, every parent SHA, the full branch topology, commit attribution, and the
whole stack's ability to merge with current upstream. It then publishes the
branches and opens the PRs from parent to child. If a later layer fails after a
parent PR was already created, the successful record remains open and every
unsent record returns to `prepared` with the durable error — retry never hides
the partial public state. Draft and open parents remain valid reviewed links,
but their upstream branch must still point at the exact reviewed commit before
another layer can be sent. If a parent has merged, rebuild the remaining private
layers on current upstream and review them again; never silently retarget an old
child, because squash/rebase merges can change the diff GitHub would show.

### Let GitHub accept a public stack

Once the reviewed layers are public, GitHub owns their acceptance through the
repository's ordinary review, protection, and merge-queue rules. Contribute
observes those results and keeps the related records together; it does not
advance a repository ref directly or bypass the repository's merge policy.

Sending a stack never authorizes merging it. Any later queue or merge action is
a separate exact approval against the current public head, performed through a
repository-owned GitHub operation. For a dependent chain, advance parent-first
and re-read the remaining layers after each accepted parent because their base
or topology may have changed. Contribute then reconciles merged, closed, or
superseded outcomes from GitHub without manufacturing a second public action.

## Review or merge selected public PRs

Contribute's **Review** and **Review & merge** controls select existing public
PRs, independently of authorship or assignment. Assignment is additive and
public, and needs the owner's explicit assignment action. It never starts a
review implicitly.

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
When a selected PR's checks have failed, read them as in
[ci.md](ci.md) rather than dumping full logs.

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

## Publish an app into its own repository

When the contribution publishes a local Möbius app into its own canonical
`mobius-os/app-<id>` repository, add one reviewed `after_merge` handoff to the
plan:
`{"action":"connect_app","app_id":<live numeric app id>,
"manifest_url":"https://raw.githubusercontent.com/mobius-os/app-<id>/main/mobius.json"}`.
Use it only when `source_repo_path` is that exact live app source,
`source_sha` is its captured revision, and the reviewed manifest id matches the
target app repository (or declares the live id as `previous_id`). Never use it
for platform changes, an unrelated app, a non-`app-*` repository, or as a
workaround for an ordinary App Store update. Contribute shows this handoff
inside the private review. Approval to send the exact reviewed app publication
also approves this exact post-merge connection; it is one publication outcome,
not a later public or destructive action. Send binds it to the exact reviewed
source and capability digests and stores an immutable publication witness in
the live app repo (private local provenance; the PR is unchanged), but the
connection does not run until GitHub confirms the reviewed change has merged.

### After the app PR merges: connect the same local app

A merged record with a reviewed `after_merge.action: connect_app` finishes the
local connection automatically. This is the completion step of the exact app
publication the owner already approved; never present a second **Link app**
decision or count it among owner actions. The scheduled reconciler retries any
interrupted handoff until it either completes or has a concrete recovery error.

The platform then checks GitHub's actual merge commit, the stored reviewed diff,
the durable landed witness, the immutable merged source and permission digests,
and the intended live app row. Only an exact match installs that merged commit
under the stable App Store identity. The existing numeric app row and its saved
data remain in place, so later App Store updates target the same installation
instead of creating a second app. If the local source advanced after review,
the ordinary update merge may report conflicts; Contribute keeps the app
connected and sends those source conflicts back to its owning chat for
deliberate resolution.

Do not call the publication complete until the local connection is recorded.
When the intended catalog identity is already attached to the same numeric app
row, the guarded route may reconcile that already-true connection without
rewriting the app or its source. Any other proof failure stays visible in
Working and must not be relabelled as connected. If Contribute reports that the
connection route is unavailable, a platform update is needed; never fall back
to App Store **Install** of the public package.
