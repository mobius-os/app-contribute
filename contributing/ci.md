# Contributing: platform CI and checks

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Checkout-local test wrappers
(`scripts/wt-pytest.sh`, `scripts/wt-npm.sh`) and install cleanup are under
*Cleanup ownership* in [branch.md](branch.md).

## What runs upstream

For `mobius-os/mobius` PRs, upstream CI runs backend pytest, frontend unit
`npm test`, `packager-unit`, `core-apps-unit`, `core-apps-sync` via
`scripts/check-core-apps-sync.sh`, and comprehensive Playwright e2e.

The complete upstream suite begins after the owner explicitly sends the pull
request. Contribute has one public path for a prepared change: **Send PR**.
Preparation and local verification stay private; there is no second fork-push
or workflow-dispatch action to reconcile.

## Checks before staging

Before staging, run the cheapest focused checks that cover the changed files.
Classify the evidence honestly: local focused checks are fast implementation
feedback; a lock-matched hosted run proves the exact reviewed revision in the
full environment; the merge queue is the unconditional final gate.

## Inspecting failed CI

When a hosted run or PR check fails, prefer the platform's summarizer over
`gh run view --log` or other full-log dumps. Run it from `/data/platform` or a
platform worktree:

```bash
scripts/ci-failures.sh <pr-number|run-id>
```

It saves the full logs to a file and prints only the failing jobs and their
failure lines. Open the saved log file only for the specific job and region
those lines point to. Diagnosing CI is read-only; any repair is private
preparation and any new public push needs its own exact approval.

## Playwright

Do **not** run Playwright locally by default. The Möbius app container does not
have Docker, so agents normally diagnose browser failures from the hosted CI
report (summarized as above). On a Docker-capable contributor host, a CI failure
can be reproduced by first committing the exact revision, then using the
disposable runner with the narrowest spec or grep possible:

```bash
scripts/playwright-local.sh --allow-local-e2e <spec or --grep arguments>
```

The runner makes a standalone temporary clone, then builds a separate backend,
database, credentials, ports, and browser session from that same commit. It
uses one worker and tears everything down. It refuses tracked uncommitted edits
instead of testing them against an older runtime. Never point Playwright,
`auth.setup.mjs`, or a preview proxy at the live backend — localhost alone does
not prove isolation.
