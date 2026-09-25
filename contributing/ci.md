# Contributing: checks and CI

Mode file of the `contributing` skill. The core
([SKILL.md](SKILL.md): Hard stops, privacy allowlist,
approval gate, file table) always applies. Target-specific suites, local test
wrappers, and browser-test rules are in the target's adapter (for Möbius:
[adapter-mobius.md](adapter-mobius.md)).

## What runs upstream

The target repository's own CI begins after the owner explicitly sends the pull
request. Contribute has one public path for a prepared change: **Send PR**.
Preparation and local verification stay private; there is no second push or
workflow-dispatch action to reconcile. Read a PR's check state with:

```bash
gh pr checks <pr-number> -R <owner/repo>
```

## Checks before staging

Before staging, run the cheapest focused checks that cover the changed files.
Classify the evidence honestly: local focused checks are fast implementation
feedback; a hosted run proves the exact reviewed revision in the full
environment; the target repository's required checks are the final gate.

## Inspecting failed CI

When a hosted run or PR check fails, prefer the platform's summarizer over
`gh run view --log` or other full-log dumps. It works for any GitHub
repository; always pass the PR's own repository:

```bash
/data/platform/scripts/ci-failures.sh <owner/repo> <pr-number|run-id>
```

It saves the full logs to a file and prints only the failing jobs and their
failure lines. Open the saved log file only for the specific job and region
those lines point to. Diagnosing CI is read-only; any repair is private
preparation and any new public push needs its own exact approval.
