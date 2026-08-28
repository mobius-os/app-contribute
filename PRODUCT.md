# Contribute product context

<!-- impeccable:product-schema 1 -->

## Platform

Web app inside the Möbius workspace, responsive from phone to wide desktop.

## Users

The owner of a local Möbius instance today, and people collaborating on their own projects through the same workflow in future.

## Product Purpose

Move changes from local work into private review, public collaboration, and safe local reconciliation without making people restate the process every time.

## Positioning

A project-shaped contribution workspace rather than a Git client. It keeps preparation and review private until the owner explicitly approves a public action.

## Operating Context

The core journey is prepare, review, fix or suggest, mark all clear, send, follow, and align. Projects show local and shared positions; Reviews shows pull-request work by project and stage; Requests keeps issues separate.

## Capabilities and Constraints

- Public GitHub actions always retain an exact owner approval checkpoint.
- An all-clear review belongs to the exact reviewed version and becomes stale when that version changes.
- Existing local and private work must be preserved during reconciliation.
- Project status can establish source relationships, but it cannot always infer whether local differences are reusable, personal, or already covered. The UI must distinguish clear preparation candidates from work that needs sorting.
- The same workflow should extend beyond Möbius-owned projects as project adapters grow.
- Chat keeps only decisions and attention above the composer; healthy public and settled work belongs in the chat's persistent Changes view and in Contribute.
- Recorded edits may prompt one lightweight preparation card. The card never performs private preparation until the owner presses it.
- Deterministic status refresh, landing recognition, duplicate detection, and lost-response reconciliation run automatically; they never summon an agent merely to repeat the ledger.
- One changed-work conversation owns the remaining private judgment. Repeated actions reuse it until the represented source or contribution head changes.

## Brand Commitments

Quiet, inviting, high-level, concise, and icon-led. Show the next meaningful action before technical detail.

## Evidence on Hand

Live local project status, private contribution records and stored diffs, and connected GitHub review state.

## Product Principles

1. Lead with the next action.
2. Never overstate certainty.
3. Group work by project and stage.
4. Make detail and diffs immediate once an item is selected.
5. Keep one deliberate owner checkpoint for public actions.
6. Let chat prompt the next decision, Changes preserve the chat lifecycle, and Contribute own the cross-project view.
7. Automate facts; reserve agent work for intent, grouping, review, and repair.

## Accessibility & Inclusion

Keyboard-accessible controls, state labels that do not depend on color, readable contrast, practical touch targets, and an adaptive list-to-detail flow on small screens.
