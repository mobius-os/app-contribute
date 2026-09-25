# Contributing: build the review branch

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The `plan` fields and review
contract live in [prepare.md](prepare.md); ledger writes
in [ledger.md](ledger.md). The target's adapter names
the working source, accepted base, and any target-specific recipe.

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
- Prefer the environment the adapter names for checks (the Möbius adapter has
  checkout-local wrappers). If a check genuinely requires a new install, make
  that install temporary and remove it in the same turn on success, failure,
  cancellation, or interruption.
- The Contribute scheduled job retries missed terminal cleanup. Reflection may
  identify ambiguous residue and produce a bounded housekeeping plan. Both are
  repair backstops, never substitutes for the lifecycle owner and never grounds
  for deleting an unmatched or dirty checkout blindly.

## Refresh upstream before review

Fetch the target's default branch immediately before constructing the review
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

## The durable review checkout

Every staged review lives at `/data/contrib/<record-id>/worktree`, stored as
`plan.repo_path`. Make it a **linked worktree of the working source** so its
`.git` is a file pointing at that repository (when an adapter has no local
repository to link, it clones with `--separate-git-dir` instead); never create
a nested `.git` directory under `/data/contrib`. The working source stays on its own branch —
only the review worktree is on the topic branch, so live edits and updates
cannot land on the review.

```bash
SOURCE=<working source named by the adapter>
WORKTREE=/data/contrib/<record-id>/worktree
SOURCE_SHA="$(git -C "$SOURCE" rev-parse HEAD)"
git -C "$SOURCE" worktree add -b fix/<topic> "$WORKTREE" "$BASE_SHA"
git -C "$SOURCE" worktree lock \
  --reason "Contribute review <record-id>" "$WORKTREE"
cd "$WORKTREE"
git apply --3way --index --binary "$LOCAL_DIFF"   # the attributable change only
git_email="$(git config --global --get user.email || true)"
if [ -n "$git_email" ] && [ "$git_email" != "agent@mobius" ]; then
  git config user.name "$(git config --global --get user.name)"
  git config user.email "$git_email"
fi
git commit -m "<one line, generic>" \
  -m "Co-authored-by: Möbius Agent <mobius-agent@users.noreply.github.com>"
HEAD_SHA="$(git rev-parse HEAD)"
git -c core.quotePath=false diff --no-ext-diff --no-color --binary \
  --full-index --src-prefix=a/ --dst-prefix=b/ \
  "$BASE_SHA..$HEAD_SHA" > /tmp/<record-id>.diff
DIFF_SHA256="$(sha256sum /tmp/<record-id>.diff | awk '{print $1}')"
```

`$BASE_SHA` is the freshly fetched accepted base and `$LOCAL_DIFF` the owner's
attributable change, both as the adapter describes. Then write
the ledger record with `repo_path: "$WORKTREE"`, `branch`,
`base_sha: "$BASE_SHA"`, `head_sha: "$HEAD_SHA"`,
`source_repo_path: "$SOURCE"`, `source_sha: "$SOURCE_SHA"`, `diff_sha256` from
`$DIFF_SHA256`, and `diff_stat` (required).

The co-author trailer is the default on every contributed commit: the partner
stays author, Möbius is the visible co-author. Omit it only as the reviewed
`plan.coauthor_trailer: false` choice described in
[prepare.md](prepare.md).

Lock every linked review immediately after creation, before applying or
committing its diff. The record-specific lock keeps an unrelated
`git worktree prune` from stranding reviewed owner work; terminal contribution
cleanup verifies the reciprocal Git pointer and releases that exact lock.

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

To change a public title or description itself, see *Editing a PR's title or
description* in [publish.md](publish.md).
