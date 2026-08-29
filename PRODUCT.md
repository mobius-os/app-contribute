# Contribute product context

<!-- impeccable:product-schema 1 -->

## Platform

Web app inside the Möbius workspace, responsive from phone to wide desktop.

## Users

The owner of a local Möbius instance today, and people collaborating on their own projects through the same workflow in future.

## Product Purpose

Move changes from local work into private review, public collaboration, and safe local reconciliation without making people restate the process every time.

## Positioning

A contribution run, not a Git client or project tracker. It gathers the work
that belongs together, handles private preparation quietly, and brings back
only the decisions the owner must make.

## Operating Context

The common journey begins in the chat where work happened. One trusted action
prepares and reviews that work without making the owner leave the conversation.
Independent overlaps may run in attached background helpers, but their progress
and result return to the source chat. Contribute shows the same cross-project
run as one snapshot: decisions first, work already moving second, and recent
outcomes last. Projects are a filter and inspection aid, never a prerequisite
for acting.

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
3. Group the current run by decision; use projects only to orient or filter.
4. Make detail and diffs immediate once an item is selected.
5. Keep one deliberate owner checkpoint for public actions.
6. Let the source chat start and complete its work, Changes preserve that
   lifecycle, and Contribute project the cross-project run without inventing a
   second workflow.
7. Automate facts; reserve agent work for intent, grouping, review, and repair.
8. Completed intent disappears; failures continue automatically unless a real
   owner or account decision is required.

## Accessibility & Inclusion

Keyboard-accessible controls, state labels that do not depend on color, readable contrast, practical touch targets, and an adaptive list-to-detail flow on small screens.
