# Contributing: legacy `mobius-bot` records

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Read this only for a record whose
`submission_mode` is `"mobius-bot"`. New contributions use the connected
owner's GitHub account; never add this marker to a record.

## Fields

A bot record may carry `submission_mode: "mobius-bot"`,
`relay_contribution_id`, `relay_revision`, `relay_status`, and
`relay_publication_repo` beside the ordinary ledger fields
([ledger.md](ledger.md)). It retains the Möbius service
identity and recovery path; it may continue without a connected GitHub
account.

When refreshing a bot record that already has a PR, keep the same record id
and preserve its `relay_contribution_id`, `relay_revision`,
`relay_publication_repo`, and PR URL/number. Replace the plan/diff and
invalidate the old `quality_review`; the instance assigns the next revision
only after it has built the exact new merge snapshot.

A bot record stuck in `submitting` is reconciled by its saved relay id and
exact revision — never search GitHub and invent a new record.

## Sending

The instance proves the same exact reviewed head, merge-tests it against the
configured current target, and sends an exact file snapshot through a one-use
body-bound capability. The launcher writes only to the configured bot
publication repository, opens or updates one draft PR in the target, and
returns the stable PR URL. `local_record_id` stays stable while
`relay_revision` increases for each changed reviewed snapshot, so a refresh can
update the same PR without discarding comments. Exact retries reuse the same
revision and cannot create a duplicate. Status polling is a fallback behind
launcher webhooks. The partner may explicitly **Withdraw PR**; that closes the
PR and removes only its bot-owned branch, never an upstream branch and never a
merge. The co-author trailer is always required on this path.
