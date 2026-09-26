# Contributing: the GitHub repository adapter

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. The generic review-checkout recipe
is in [branch.md](branch.md).

Use this adapter for any GitHub repository that is not a Möbius target: the
owner's own project or a third-party open-source project.

## The five facts

- **Working source:** the owner's durable clone at `/data/worktrees/<name>` — a
  primary checkout directly under `/data/worktrees`, not a linked worktree.
  Send requires it as `plan.source_repo_path`, so a review with no working
  source cannot be sent. If the owner has none yet, clone the repository there
  (a read-only fetch). Each review is a linked, locked worktree of it at
  `/data/contrib/<record-id>/worktree`.
- **Shared source:** the fetched default branch. Discover it; never assume
  `main`:

  ```bash
  DEFAULT="$(gh repo view <owner>/<repo> --json defaultBranchRef --jq .defaultBranchRef.name)"
  git -C /data/worktrees/<name> fetch origin "$DEFAULT"
  BASE_SHA="$(git -C /data/worktrees/<name> rev-parse "origin/$DEFAULT")"
  ```

- **Publication:** **Send PR** ([publish.md](publish.md)).
  The platform pushes the topic branch to the target itself when the connected
  owner owns it or has push permission there, and otherwise to the owner's
  fork; the PR targets the default branch either way.
- **Local update path:** fetch only. `git fetch` the working source and report
  what landed; never pull, rebase, reset, or switch the owner's checkout on
  their behalf.
- **Private material:** nothing beyond the core allowlist. Untracked files,
  local configuration, and anything outside the reviewed diff stay local.

Contribute Projects does not list these repositories; their records still
appear in Contribute.

## Build the review

The owner's change must be committed in the working source; `source_sha` is
that commit and Send verifies it contains the reviewed change. Produce
`LOCAL_DIFF` from exactly the attributable commits:

```bash
SOURCE=/data/worktrees/<name>
FORK_POINT="$(git -C "$SOURCE" merge-base HEAD "origin/$DEFAULT")"
LOCAL_DIFF=/tmp/<record-id>.local.diff
git -C "$SOURCE" -c core.quotePath=false diff --no-ext-diff --no-color \
  --binary --full-index "$FORK_POINT..HEAD" > "$LOCAL_DIFF"
```

Then follow *The durable review checkout* in
[branch.md](branch.md) with a generic `fix/<topic>`
branch — or the project's own branch convention. Set the repo-local identity to the connected
owner before committing: a same-repository PR is pushed with its commit
attribution unchanged.

## Respect the target's rules

Before preparing, read the target's contribution guidance: `CONTRIBUTING.md`
(root, `.github/`, or `docs/`), the pull-request template, the code of conduct,
and any policy on AI-assisted contributions. The project's rules win over
Contribute defaults:

- **Issue first:** if the project asks for an issue or discussion before a PR,
  prepare that instead.
- **Form:** follow its commit-message, branch-name, and PR-template
  conventions; `body_draft` fills the template.
- **Sign-off (DCO):** if required, commit with `git commit -s` under the
  owner's identity. The sign-off is the owner's certification, so name it in
  the approval summary.
- **AI disclosure:** if the project asks for disclosure, keep the co-author
  trailer and add whatever else the policy asks to `body_draft`. If it forbids
  the trailer, set `plan.coauthor_trailer: false` as described in
  [prepare.md](prepare.md). If it forbids AI-assisted
  contributions, do not prepare one; tell the owner.
- **Labels:** propose only labels the repository already has, and only when it
  expects contributors to label; otherwise omit `plan.labels`.
- **Checks:** run the project's documented test commands in the review
  checkout. Keep any install temporary (cleanup ownership in
  [branch.md](branch.md)); the target's required checks
  are the final gate.
