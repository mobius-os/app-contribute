# Contribute product context

<!-- impeccable:product-schema 1 -->

## Platform

Web app inside the Möbius workspace, responsive from phone to wide desktop.

## Users

The owner of a local Möbius instance today, and people collaborating on their own projects through the same workflow in future.

## Product Purpose

Move changes from local work into private review, public collaboration, and safe local reconciliation without making people restate the process every time.

## Positioning

A project control board, not a Git client. See what remains local, what is
shared for review, and whether shared updates have been checked. Choose one project, then prepare or review its work; approve exact public actions when ready.

## Operating Context

Changes still begin in their source chats. Chat-specific preparation remains
there; Contribute is the cross-chat project overview. Current code establishes
what needs preparation; chat diffs are provenance, not a second source tree.

The landing view is a searchable project index, without global mutation controls. Each project shows
local/private/public work and its last-known shared-version relationship.
Selecting a project keeps those facts and scoped controls visible, with its
questions, ready batch, incoming requests, progress and history underneath.
A contribution opens within that project; Back and Forward preserve the same
project and contribution. No separate Reviews room or second ledger exists.

Main controls must not disappear into catch-all overflow menus. Simplicity
means fewer steps and clearer information, not smaller type or hidden project
position. Agent work progresses in place; only actual questions need the owner.

## Capabilities and Constraints

- Public GitHub actions always retain an exact owner approval checkpoint.
- One approval may cover a mixed set of standalone and stacked pull requests,
  but it must enumerate every exact public action and preserve stack order.
- An all-clear review belongs to the exact reviewed version and becomes stale when that version changes.
- Existing local and private work must be preserved during reconciliation.
- Project status can establish source relationships, but it cannot always infer whether local differences are reusable, personal, or already covered. The UI must distinguish clear preparation candidates from work that needs sorting.
- The same workflow should extend beyond Möbius-owned projects as project adapters grow.
- Chat keeps only decisions and attention above the composer; healthy public and settled work belongs in the chat's persistent Changes view and in Contribute.
- Recorded edits may prompt one lightweight preparation card. The card never performs private preparation until the owner presses it.
- Deterministic status refresh, accepted-work recognition, duplicate detection, and lost-response reconciliation run automatically; they never summon an agent merely to repeat the ledger.
- One changed-work conversation owns the remaining private judgment. Repeated actions reuse it until the represented source or contribution head changes.
- The normal personal-GitHub publication opens reviewed pull requests ready for
  review. Draft is an intentional exception, not a mandatory extra stage.
- Publication never implies merge. Queueing or merging is a later, separate,
  exact approval against the current public head.
- Source chats remain the durable home of their work. Background workers may
  contribute evidence or independent edits, but they never become the owner-facing source.

## Brand Commitments

Quiet, inviting, high-level, concise, and icon-led. Show the next meaningful action before technical detail.

## Evidence on Hand

Live local project status, private contribution records and stored diffs, and connected GitHub review state.

## Product Principles

1. Lead with the next action.
2. Never overstate certainty.
3. Lead with project position; group the same review run by decision within the selected scope.
4. Make detail and diffs immediate once an item is selected.
5. Keep one deliberate owner checkpoint for public actions.
6. Let the source chat start and complete its work, Changes preserve that
   lifecycle, and Contribute project the project-scoped run without inventing a
   second workflow.
7. Automate facts; reserve agent work for intent, grouping, review, and repair.
8. Completed intent disappears; failures continue automatically unless a real
   owner or account decision is required.

## Accessibility & Inclusion

Keyboard-accessible controls, state labels that do not depend on color, readable contrast, practical touch targets, and an adaptive list-to-detail flow on small screens.
