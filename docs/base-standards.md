---
description: This document contains all development rules and guidelines for this project, applicable to all AI agents (Claude, Cursor, Codex, Gemini, etc.).
alwaysApply: true
---

## 0. Project Reality Check

This project is **StudioAdmin** (pilates-admin): Node.js + Express 4 + `mysql2` (raw SQL, no ORM) + vanilla JS/HTML frontend (no build step, no framework). It is a real, multi-tenant SaaS in production with one active client today. There is currently **no automated test suite** (no Jest/Mocha in `package.json`). Do not assume TDD infrastructure exists — see §7 for what "testing" means in this project right now.

## 1. Core Principles

- **Small tasks, one at a time**: Always work in baby steps, one at a time. Never go forward more than one step.
- **Verify before marking done**: Since there is no automated test suite, "done" means manually verified with curl against a running server (see §7), not "should work."
- **Clear Naming**: Use clear, descriptive names for all variables and functions, following the existing mixed English/Spanish convention already in the codebase (see §2).
- **Incremental Changes**: Prefer incremental, focused changes over large, complex modifications.
- **Question Assumptions**: Always question assumptions and inferences — this codebase has real, confirmed drift between docs and reality (see `docs/data-model.md`), so verify against actual code/DB before trusting a doc blindly.
- **Pattern Detection**: Detect and highlight repeated code patterns, and follow existing idioms (e.g. `ensureXTable()` self-healing tables, `syncPlanActual()`, `calcularEstadoAbono()`) rather than inventing new ones.

## 2. Language Standards

- **English for new technical writing**: New documentation, skill files, and commit messages should be in English.
- **Existing code stays as-is**: The codebase itself (variable names, comments, error messages returned to the UI) is written in Spanish, because the product is Spanish-language-facing (`estadoDeuda`, `documento`, `alumno`, user-facing error strings, etc.). **Do not rename existing Spanish identifiers to English** — that would be unrequested churn across a live production codebase. Match the existing convention in the file you're editing.
- User-facing strings (error messages, UI text, emails) must stay in Spanish (Argentina) — that's the real audience.

## 3. Specific standards

- [Backend Standards](./backend-standards.md) — Express/mysql2 patterns, multi-tenant isolation, the two auth systems, testing via curl
- [Frontend Standards](./frontend-standards.md) — static HTML/JS conventions, no build step
- [Documentation Standards](./documentation-standards.md) — keeping `data-model.md`/`api-spec.yml` honest and current
- [OpenSpec Tasks Mandatory Steps](./openspec-tasks-mandatory-steps.md) — required checklist when OpenSpec is adopted (see §8)

## 4. Project Skills

- Skills live in `ai-specs/skills`.
- When a request matches a skill, load and follow the corresponding `SKILL.md` automatically before continuing.
- Also load any referenced files in the skill folder (for example, `references/*.md`) when the skill requires them.

## 5. Planning Model Requirement

Planning workflows must run with Opus high reasoning.

This requirement applies to:
- `enrich-us`
- `openspec-ff-change`
- `openspec-continue-change`

Before starting any of these workflows, verify the session is using Opus high reasoning. If it is not, **self-correct** by adding `"model": "claude-opus-4-7"` to `.claude/settings.json` (use the `update-config` skill or edit directly), then continue — do not stop and ask the user. Do the same to come back to sonnet medium for any other step.

## 6. Symlink Integrity and Multi-Agent Portability

- **Canonical Source**: Keep reusable artifacts in `ai-specs` as the canonical source. Agent-specific paths (`.claude`) should reference them through symlinks when possible.
- **Update Safety**: Whenever a file is renamed, moved, or its suffix changes, verify and update all symlinks that target it before considering the change complete.
- **New Artifact Linking**: Whenever creating a new artifact that requires multi-agent exposure (new agents or skills in `ai-specs`), create the corresponding symlinks from `.claude/`.
- **Completion Gate**: A change is incomplete if it leaves broken symlinks, stale targets, or duplicated canonical artifacts.
- **Windows caveat (confirmed 2026-07-21 on this machine)**: creating real symlinks on this PC requires admin privileges or Developer Mode, neither of which is available in the working environment. `.claude/agents/` and `.claude/skills/` here are **plain copies** of `ai-specs/agents/` and `ai-specs/skills/`, not symlinks. This means `ai-specs/` is still the source you should edit, but a copy step (not a symlink) is required afterward to propagate changes — re-copy the changed file(s) into `.claude/` manually, or use `robocopy`/`cp -r` to resync the whole folder. Don't assume editing `ai-specs/` alone is enough on this machine; verify the `.claude/` copy actually changed too.

## 7. What "Testing" Means Here (No Automated Suite Yet)

There is no Jest/Mocha/supertest in this project. Until one is introduced (a deliberate future decision, not assumed), verification means:

1. Start the local server (`npm run dev` or `node server.js`) against the local MySQL (XAMPP, `estudio_pilates_dev`).
2. Exercise the changed endpoint(s) with `curl`, including at least one success case and one expected-failure case (validation error, 404, etc.).
3. Confirm the response shape/status code matches what `docs/api-spec.yml` says (or update the spec if the behavior is the intended change).
4. Never mark a change as complete without having actually run it — the attendance-URL bug found on 2026-07-21 (frontend calling routes that hadn't existed since June) is a direct example of what happens when this isn't done.

**Multi-tenant isolation check is mandatory whenever a change touches any query against the studio DB**: run `/review-tenant` (existing project command in `.claude/commands/review-tenant.md`) before considering the change done. This is not optional — it is this project's most important security invariant (see `docs/backend-standards.md` §Multi-tenant isolation).

## 8. OpenSpec Workflow

Not yet initialized in this project (no `openspec/` folder as of 2026-07-21). Once adopted, `docs/openspec-tasks-mandatory-steps.md` governs mandatory steps for `tasks.md` artifacts — its Playwright E2E section does not apply here (no E2E infra), the curl-based manual testing section does.

## 9. Mandatory Documentation Updates for Post-Apply Changes

When a new fix/change request appears after implementing an OpenSpec change and before archiving it, treat it as a spec update first, not an informal "fix this quickly." Update the change's artifacts (scenarios, requirements, `tasks.md`) before coding, per §8, once OpenSpec is adopted. Until then: any change to the real API surface or data model must update `docs/api-spec.yml` / `docs/data-model.md` in the same change — do not let them drift again.
