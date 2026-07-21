---
description: Standards for technical documentation in pilates-admin, including update triggers and language rules
globs:
alwaysApply: true
---
# Rules and Patterns for Documentation and AI Specs

## Introduction

Technical documentation covers `docs/data-model.md`, `docs/api-spec.yml`, `docs/backend-standards.md`, `docs/frontend-standards.md`, and this file set in general — anything describing how the project is structured, runs, and operates. AI specs (`ai-specs/`) are the documents that tell AI agents how to behave, plan, and code for this project.

## Language

- New documentation and AI specs: written in English.
- Do **not** translate existing code, comments, or user-facing strings to English — this project's code and product are Spanish-facing by design (see `docs/base-standards.md` §2). Documentation *about* the Spanish code can and should still be in English for consistency across tools.

## When to Update Technical Documentation

Before any commit that changes behavior, check whether these need updating:

- **Schema change** (new table, new column, renamed column) → update `docs/data-model.md`. If you find the real schema differs from what's documented, fix the doc immediately and flag it — don't let another drift like the `students.nombre` vs `fullName` one happen silently again.
- **API change** (new/changed/removed endpoint) → update `docs/api-spec.yml`.
- **New dependency, new pattern, changed provisioning script** → update `docs/backend-standards.md` or `docs/frontend-standards.md`.
- **Infra/deploy detail change** (paths, DB names, server) → update the project memory (this repo doesn't have a `development_guide.md` yet; infra facts currently live in the assistant's memory system for this project — keep it in sync when things change, like the 2026-07-21 correction of the real VPS path and DB names).

## Process

1. Review what actually changed in the code (don't guess from memory — re-read the file).
2. Identify which doc(s) are affected using the triggers above.
3. Update them, keeping the existing structure and tone.
4. If you find an inconsistency between a doc and the real code/DB while doing this, **report it explicitly** rather than silently "fixing" it into whatever seems more plausible — verify against the real system first (see the 2026-07-21 investigation in `docs/data-model.md` for the standard of evidence expected: confirmed via live DB query, not inferred from a stale `.sql` file).
5. Report which files were updated and what changed.

## Learning From Feedback

When the user gives explicit or implicit feedback about how they want to work (e.g. "ask me before big changes," "don't touch production until validated locally"), that's a signal to update the assistant's memory for this project, not just comply once. Don't modify these standards files based on a single interaction without the user's explicit review — propose the change, don't apply it silently.
