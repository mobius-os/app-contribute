# Contributing: build the review branch

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The `plan` fields and review
contract live in [prepare.md](prepare.md); ledger writes
in [ledger.md](ledger.md).

Run these during preparation, after the partner agrees to stage a PR for review.
Do not fork, push, or create a PR here.

## Cleanup ownership

Resource cleanup is part of the work, not an unrelated maintenance favor.

- The agent that creates a temporary clone, worktree, dependency install,
  browser profile, build output, or test environment owns it through success,
  failure, cancellation, and interruption. Preserve the reviewed source,
  durable record, exact diff, receipts, and provenance; release regenerable
  artifacts as soon as their check or handoff is complete.
- The contributing/integrating agent inherits ownership of the durable staging
  checkout while a contribution is prepared, open, or awaiting reconciliation.
  Once the record is terminal, call its `cleanup-staging` endpoint and verify
  the checkout is gone. A pushed or merged change is not a complete handoff if
  its disposable local copy remains behind.
- A nonterminal record may need its source checkout for safe review or repair,
  but it does not need copied `node_modules`, virtual environments, caches, or
  build output while idle. Remove those after verification when no process is
  using them; record an owner and expiry for any exceptional long-lived
  artifact.
- For platform checks, use `scripts/wt-pytest.sh` and `scripts/wt-npm.sh` from
  the staged checkout. The Python wrapper uses the shared test runtime, and the
  npm wrapper temporarily borrows the primary checkout's dependency tree only
  when `package-lock.json` matches exactly. Do not run a direct `npm ci` or
  create a checkout-local `.venv` when either wrapper can supply the exact
  environment. If a dependency change genuinely requires a new install, make
  that install temporary and remove it in the same turn on success, failure,
  cancellation, or interruption.
- The Contribute scheduled job retries missed terminal cleanup. Reflection may
  identify ambiguous residue and produce a bounded housekeeping plan. Both are
  repair backstops, never substitutes for the lifecycle owner and never grounds
  for deleting an unmatched or dirty checkout blindly.

## Refresh upstream before review

Fetch the canonical default branch immediately before constructing the review
checkout. Base the isolated review on that freshly fetched commit, then replay
only the attributable local commits and working diff. Use three-way application
where upstream moved; never copy an older complete tree over newer upstream
source, and never move the branch or worktree currently served to the partner.
If the replay conflicts and the combined intent is not unambiguous, stop with
the exact overlap instead of guessing. Run the same tests after replay that the
change would have run on the older base.

Before staging, inspect untracked and generated-looking paths. A clearly
repository-wide generated path earns the smallest reusable `.gitignore` rule;
review that rule as source and settle the generated path locally. Ambiguous
files remain an owner decision—do not grow a hidden ignore mechanism.

## Keep exploration out of durable staging

`/data/contrib` is the final review boundary, not a general Git workspace. Until
the partner has approved **Prepare privately** and one exact review + record id
have been chosen, keep review clones, rebase trials, integration carriers,
builds, and candidate fixes under the current turn's `$TMPDIR`. That scratch is
owned by the chat run and swept after it becomes idle.

Use independent clones whose `.git` directory lives inside the scratch clone.
Do not create linked worktrees there: the scratch sweeper removes directories
recursively and cannot unregister a linked worktree from its source repository.
Once the review is exact, create only its record-bound checkout at
`/data/contrib/<record-id>/worktree`; keep alternate candidates ephemeral and
remove them in the turn that created them.

**Use a linked worktree for every staged review checkout.** Its `.git` marker is
a file pointing at the installed app/platform repo, not a nested `.git`
directory. That keeps the live source on `main`, makes the review checkout
restart-safe even on older images whose baked boot cleaner removes nested Git
directories, and still gives Contribute a durable path to verify. Put it at
`/data/contrib/<record-id>/worktree` and store that exact path as `repo_path`.

## An app with a real origin (most catalog apps)

`git -C /data/apps/<slug> remote get-url origin` succeeds → build one clean
review commit in a linked worktree while the live app stays on `main`:

```bash
SOURCE=/data/apps/<slug>
WORKTREE=/data/contrib/<record-id>/worktree
BASE_SHA="$(git -C "$SOURCE" merge-base main upstream)"
SOURCE_SHA="$(git -C "$SOURCE" rev-parse main)"
git -C "$SOURCE" -c core.quotePath=false diff --no-ext-diff --no-color \
  --binary --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..main" > /tmp/<record-id>.diff
git -C "$SOURCE" worktree add -b fix/<slug>-<short> "$WORKTREE" "$BASE_SHA"
git -C "$SOURCE" worktree lock \
  --reason "Contribute review <record-id>" "$WORKTREE"
cd "$WORKTREE"
git apply --index --binary /tmp/<record-id>.diff
git_email="$(git config --global --get user.email || true)"
if [ -n "$git_email" ] && [ "$git_email" != "agent@mobius" ]; then
  git config user.name "$(git config --global --get user.name)"
  git config user.email "$git_email"
fi
git commit -m "<one line, generic>" \
  -m "Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>"
HEAD_SHA="$(git rev-parse HEAD)"
# The one fingerprint Send and /update re-verify; never hash your own diff.
python3 /data/apps/contribute/review_diff.py \
  "$WORKTREE" "$BASE_SHA" "$HEAD_SHA" /tmp/<record-id>.diff
```

`review_diff.py` prints `diff_sha256`, `bytes`, and `diff_stat` for exactly the
bytes it wrote.

Then write the ledger record with `repo_path: "$WORKTREE"`, `branch`,
`base_sha: "$BASE_SHA"`, `head_sha: "$HEAD_SHA"`,
`source_repo_path: "$SOURCE"`, `source_sha: "$SOURCE_SHA"`, and `diff_sha256`
and `diff_stat` (required) from that output. `diff_excerpt` is legacy — omit it.

Two invariants: the
**`Co-authored-by: Möbius Agent` trailer on every contributed commit** (the
visible Möbius mark on GitHub — partner stays author, Möbius co-author), and the
**live source repo remains on `main`** — only the separate review worktree stays
on `fix/…`, so watcher edits and store updates cannot land on the review branch.
Lock every linked review immediately after creation, before applying or
committing its diff. The record-specific lock keeps an unrelated
`git worktree prune` from stranding reviewed owner work; terminal contribution
cleanup verifies the reciprocal Git pointer and releases that exact lock.

## An app with no origin, or platform/shell

**No origin** (installed from a manifest): derive the repo from `manifest_url`
(`.../<org>/<repo>/<ref>/mobius.json` → `github.com/<org>/<repo>`), clone it into
`/data/contrib/<record-id>/worktree` with
`--separate-git-dir=/data/contrib/<record-id>/git`, `checkout -b fix/…`, copy
the changed source over (re-read vs the allowlist), and commit with the
co-author trailer. Before cloning, capture the installed app's live source path
as `source_repo_path` and its exact `main` commit as `source_sha`; the reviewed
commit identities may differ, and the submit path handles that safely. The
separate Git directory is deliberately named `git`, not `.git`, so older boot
cleaners leave it intact. Use the worktree as `repo_path`.

**Platform/shell**: only when `/data/platform` has a real origin — create the
review branch with `git -C /data/platform worktree add -b fix/…
/data/contrib/<record-id>/worktree <base-sha>`, then immediately lock it with
`git -C /data/platform worktree lock --reason "Contribute review <record-id>"
/data/contrib/<record-id>/worktree`. Apply only the reviewed source diff there,
and record that worktree path with `repo: "mobius-os/mobius"`.
Capture `SOURCE_SHA="$(git -C /data/platform rev-parse HEAD)"` before creating
the review worktree and store `source_repo_path: "/data/platform"` beside
`plan.source_sha`; `/data/platform` itself remains on its current live branch.
No origin → be honest: platform
contributions need the updated platform bootstrap; app contributions still work.

## Choose a stack by default for coherent dependent work

Before preparing two or more PRs for one goal, explicitly decide whether they
form a stack. Use a stack by default when every layer is independently coherent
and later layers genuinely depend on earlier ones, or when an ordered split
makes review substantially clearer. This lets CI start on the foundation and on
the cumulative result at the same time.

Do not manufacture layers from one indivisible fix just to obtain more CI, and
do not stack unrelated changes: independent work should stay as independent PRs
to `main` so one failure, review, or delay cannot block the others. A stack's
direction is parent-first: PR A targets `main`; PR B targets A's upstream
branch, so B's check covers A+B; PR C targets B, and so on. Mention the stack
choice in `prior_work.summary` or the record summary when it helps the partner
understand the review shape.

## Prepare a linked PR stack

Use a stack when the default decision above finds a real dependency or review
order. Each layer is its own complete, reviewed commit and its `.diff` is
**incremental against the previous layer**, never the cumulative diff against
`main`. Each layer must remain a sensible review unit; put the tests needed to
trust a layer in that layer rather than postponing all coverage to the end.

1. Choose one privacy-safe stack id, for example `chat-settlement`. Every branch
   must start `stack/<stack-id>/`, followed by an ordered descriptive suffix:
   `stack/chat-settlement/01-runtime`, `.../02-ui`, `.../03-tests`.
2. Prepare layer 1 from the current upstream/default base SHA. Prepare layer 2
   from layer 1's exact `head_sha`, and so on. Use one durable linked worktree
   per record under `/data/contrib/<record-id>/worktree`.
3. Set the connected owner's repo-local author/committer identity **before every
   commit**. Standalone send can normalize one tip commit; stack send cannot
   rewrite a parent without invalidating every child's reviewed ancestry.
4. Store the canonical `base_sha..head_sha` diff and hash for each layer exactly
   as for a standalone PR.
5. Put this additive object in every plan (positions are 1-based and complete):

```json
"stack": {
  "id": "chat-settlement",
  "name": "Chat settlement",
  "position": 2,
  "total": 3,
  "parent_record_id": "chat-settlement-01",
  "base_branch": "stack/chat-settlement/01-runtime"
}
```

Layer 1 has an empty `parent_record_id` and `base_branch` equal to upstream's
default branch (normally `main`). Every later `parent_record_id` names the
immediately preceding ledger record, `base_branch` equals that record's branch,
and its `base_sha` equals that record's `head_sha`. Re-read all records and diffs
as one review unit before saying the stack is ready. Sending the stack is in
[publish.md](publish.md).

## Updating an existing open PR

When a new owner-authored change belongs on a PR that is already open, update
that contribution's existing record instead of opening a duplicate or pushing
around Contribute. This is still a private preparation until the owner
explicitly approves the exact update in chat or presses **Update PR**.

1. Refresh GitHub read-only and require that the recorded repository, PR
   number, public head repository, and topic branch still name one open PR.
   Re-anchor the durable review worktree at the public pushed head before
   applying the new local patch. Never build on an unpushed local attempt.
2. Keep the same record id, PR URL, number, branch, `head_repository`, original
   `submitted_at`, and original PR base. Set the record back to `prepared` and
   set `plan.action` to `pr_update`; update `plan.head_sha`, the complete
   base-to-new-head diff/hash/stat, source witness, and timestamps.
   The stored diff is the complete current PR, not only the new delta, because
   the all-clear verdict must describe exactly what maintainers will review.
   For every `pr_update`, store the exact live values observed during
   preparation as `plan.pr_metadata.old_title` and
   `plan.pr_metadata.old_body`, and copy those same exact bytes into the
   reviewed `plan.title` and `plan.body_draft`. Do not normalize, summarize, or
   reconstruct the text. For an existing PR update, this equality is a
   publication precondition rather than a request to edit public metadata.
3. Re-run the full private review on the new head and pin
   `quality_review.reviewed_head_sha` to it. The ordinary local review-status
   endpoint understands both `pr` and `pr_update`; a changed review checkout,
   diff, ancestry, or upstream conflict blocks the public action regardless of
   where the owner approved it. An ordinary PR does not require its changes to
   be installed locally. A reviewed app-connection promise still requires its
   installed-source proof.
4. Stop for explicit public approval. **Update PR** in Contribute is one
   approval surface; an explicit, unambiguous chat instruction approving this
   same record and exact new head is equally valid. Do not require both. The
   guarded update route rechecks the live PR identity and requires the public
   title and body to exactly match `plan.title` and `plan.body_draft` before any
   branch mutation. It does not PATCH the pull request's title or body: GitHub
   does not expose an expected-version guard for that unsafe metadata update,
   so treating previously observed text as overwrite authority could erase a
   maintainer edit. Any mismatch stops for a fresh private review. The route
   allows only the exact reviewed fast-forward, and a restarted attempt must
   prove the same metadata precondition again. Ordinary **Send PR** continues
   to reject a branch that already has a PR, and raw `git push` is never a
   substitute.
5. After a successful update, the same record returns to `open`, retains its
   original submission time, records `last_updated_pr_at`, and advances an
   existing Autopilot grant to the new public head without creating, enabling,
   or retargeting a grant.

If the installed platform does not yet expose the reviewed update route, keep
the record privately prepared and say that a restart or platform update is
needed. Do not fall back to a duplicate PR or an unguarded branch rewrite.
