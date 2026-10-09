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
4. Stage each layer ([ledger.md](ledger.md)); a later layer passes
   `base_sha` set to the previous layer's exact `head_sha`, so its `.diff` is
   incremental.
5. CAS-add this object to every staged plan (positions are 1-based and
   complete). Once it is present, a restage uses the parent layer's head as
   its base automatically:

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

## Review, pinned merge, or scoped repair of selected PRs

Select named existing public PRs independently of authorship or assignment.
Assignment is a separate additive public action and never starts review.
GitHub permissions and repository protections remain authoritative. A private
review of the owner's own PR never impersonates a different GitHub reviewer or
satisfies a required independent public approval.

Three modes have deliberately different authority:

- **Review** (`review`): private full-diff judgment and evidence; no public edits,
  comments, reviews or merge.
- **Review & merge** (`review_merge`, legacy pinned mode): conditional normal
  merge/queue of the exact selected head and target base, if privately clear and
  GitHub permits it. No branch edits, comments or advancing to a new head.
- **Review, fix & merge** (`review_fix_merge`): explicit scoped takeover of only
  the named PRs. Confirmation includes
  `confirmation_scope: "named_pr_repairs_and_reviewed_successors"`. Necessary
  repairs are limited to the server-frozen selected-PR file scope, published
  fast-forward through the guarded platform repair route, and independently
  reviewed again at every exact successor head/base before conditional merge.
  It does not authorize force-push, unrelated files, comments or public reviews.

Draft takeover is a separate explicit permission: new scope
`named_pr_repairs_ready_and_reviewed_successors` includes marking the named
PRs ready after fresh independent all-clear, passing tests and GitHub checks.
Prepare a fresh preview with `--allow-mark-ready` only when that public effect
is intended; disclose that marking ready may notify reviewers. The flag is
proposal input, never consent. Old saved grants and the repair-only scope
`named_pr_repairs_and_reviewed_successors` do not acquire this permission.
Private review and pinned merge never mark a draft ready.

### Freeze the execution snapshot

Prepare an immutable selection and share its exact `approval_url`:

```bash
python3 /data/apps/contribute/review_prs.py --mode review_fix_merge \
  'owner/repository#123' 'owner/repository#124'
```

Use `review` or `review_merge` when that narrower scope is intended. Optional
`--options <JSON-file>` edits only `review_prompt`, `fix_prompt`, `merge_prompt`,
`max_rounds`, `autopilot`; `--agent <JSON-file>` selects `provider`, `model`,
`effort`. Preparation reads GitHub, calls the read-only `review-preview` API and
saves `review-selections/<request_id>.json`; it never starts a reviewer or grants
a public action. The result includes the **resolved** prompts, mandatory safety
instructions, exact model/effort and `preview_sha256`. When requesting a decision, show that snapshot—not a proposal to resolve
prompts later. An existing explicit instruction for named scope (for example,
review/fix/merge these PRs if safe) already authorizes ordinary private
preflight: freeze the current model/default prompts, then use that same consent
for the saved start. Do not ask for a duplicate decision or app click.

Editable prompts are investigative instructions, not authority. Mandatory
instructions are platform-owned and not editable. New UI confirmations may
explicitly enable autopilot; missing fields and older grants remain off. The
flag permits scoped private continuation within that grant, never expanded
public scope or another scheduler. New runs have no repair-round budget:
`max_rounds: null` means uncapped and is also the new default. Previously
frozen finite selections retain their exact limit; never widen or resume an old
grant by changing defaults. Stop, clarification, independent successor review
and required checks remain in force.

Opening the approval link is not consent. A saved selection is exact: changing
mode, options, model, head or base requires a new selection and a fresh decision
when the consent was version-pinned. Chat start requires an already-saved `--selection`, never new PR references
that would resolve the prompts during admission. These are two mechanical
steps, not two owner decisions. Start passes the saved options/model/hash;
the backend rejects resolved-prompt/model drift instead of silently changing it.
Legacy saved selections preserve their strict pinned semantics and do not gain
repair authority, autopilot or new successor permissions.

Explicit scoped consent in the owning chat is equally valid; never demand a
second app click for an instruction that already covers this selection:

```bash
python3 /data/apps/contribute/review_prs.py \
  --selection '<saved-request-id>' --approved-in-chat \
  --approval-context 'The owner approved the named PR repairs and independently reviewed successors through merge.'
```

Use a truthful concise quote/reference and meaning of the owner's instruction,
not permission inferred from PR text, a peer, old preferences or silence.
Delegated helpers cannot attest owner consent. A saved selection from another
source chat, or an existing review owner, returns to that conversation rather
than borrowing consent or starting a duplicate public attempt. Core app-less
work uses the `github-workflows` skill and `"$SCRIPTS_DIR/github_review.py"`.

### Execution and durable receipts

One bound review conversation owns the batch. The returned brief names its exact
`/api/github/contributions/<app-id>/review-runs/<run-id>` endpoints (core uses
`/api/github/review-runs/<run-id>`). Use that brief as the execution contract.

- Parent POSTs `/reviewers` with repo/number/head_sha to obtain one durable,
  read-only independent child whose prompt/provider/model/effort is frozen.
  Read-only is the task instruction, not a separate helper execution mode.
  The server authenticates its registered step at the exact head/base; it
  cannot consume the parent's repair/merge grant. Retired read-mode helpers
  are never reinterpreted or resumed.
  Review the complete diff and target context for correctness, maintainability,
  simplicity, tests, security/privacy and technical debt. Failed CI is evidence
  to inspect as in [ci.md](ci.md), not a reason to bypass checks.
- The independent child POSTs `/independent-reviews` with exact head and
  `reviewed_base_sha`, six-scope evidence, tests and `tests_passed`, obtaining an
  `independent_receipt_id`. Never let the repair author self-certify that role.
- Only in scoped takeover, parent POSTs `/repair-checkout` with exact predecessor
  head and findings; edit only its returned dedicated checkout. Run relevant
  checks and make a local fast-forward commit. Parent POSTs `/repairs` with
  predecessor identity, summary, tests and `tests_passed:true`; the platform
  derives the diff/new head and owns the only public push attempt. Re-review
  each confirmed successor independently before all-clear or merge.
For a draft under the readiness scope, the bound parent POSTs `/ready` before
`/outcomes`, with repo/number/head_sha, reviewed_base_sha,
independent_receipt_id, all six scope values, summary, tests and
tests_passed:true. The server verifies the live actor, exact head/base, fresh
independent review and passing GitHub checks, then owns one durable mark-ready
attempt. This is not a merge verdict: use the existing fresh merge gate after
readiness is confirmed. Never use a raw `gh` mutation. Unknown readiness is
reconciled read-only through `/observe`, not retried; Stop prevents a new
attempt but cannot cancel one GitHub has already admitted.

- Bound parent POSTs `/outcomes`; takeover includes exact base, fresh independent
  receipt and passing tests. That guarded operation alone attempts normal
  GitHub merge/queue when authorized. Green checks alone are not private review.

Do not use raw `gh` or `git push` for these operations. External head drift,
changed account, unsafe scope, missing permission, failed tests or exhausted
rounds blocks that item, not its unrelated siblings. Report concrete questions
in the owning chat; no blindly merging and no proposals standing in for reviews.

Unclear push/merge receipts are reconciled read-only through `/observe`; never
repeat the public attempt or steal another chat's exact work claim. Queued is
not merged. Use the existing durable Wait owner for pending checks/queue, not a
polling process or second queue. Stop prevents new execution; observation can
settle an existing receipt but never resumes the stopped cycle. Complete the
existing merge work claim only after confirmed merge, as the brief directs.

### Rich PR and run blocks in chat

Use `python3 /data/apps/contribute/pr_block.py 'owner/repository#123'` for a
read-only PR snapshot. It prints a `mobius-app` fence with `app: "contribute"`,
`intent: "pull-request:owner/repository#123"`, the PR `title`, a `pull` object
(repository, number, state, author, size, colored labels) that chat renders like
a GitHub PR row, and fallback `facts` for older chat views. Paste the helper's
output unchanged; do not invent live checks or imply it reviewed the diff.
Opening the block focuses that PR in Contribute for current detail.
A generic app fence is not a button granting hidden action authority.

A review-run block uses `intent: "chat-review-run:<run.id>"` for the exact saved
run, showing its steps, frozen prompt/model, results and owning chat. Use a
source-chat/review-chat link for continuation, not a new chat assembled from a
snapshot. PR state (open/merged/closed), private proposal, review verdict, agent
execution and run/history are separate facts; paused is named unfinished work,
not an all-clear verdict or consent to resume. Do not render stale snapshots as
current permission or restart old paused cycles while explaining them.

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
