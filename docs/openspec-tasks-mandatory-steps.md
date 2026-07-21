---
description: Enforce mandatory steps when creating tasks.md artifacts and ensure agent executes all manual tests — adapted for pilates-admin (no automated tests, no E2E infra)
alwaysApply: true
---

# OpenSpec Tasks: Mandatory Steps Enforcement (pilates-admin)

**Applies once OpenSpec is initialized in this project** (`openspec init` has not been run yet as of 2026-07-21 — see `docs/base-standards.md` §8). Keep this file ready for when that happens.

Adapted from the generic `lidr-specboot` template: the Playwright E2E section was **removed** (no E2E infra exists here) and a **multi-tenant isolation check** was added as mandatory, since that's this project's actual highest-risk area.

## 1. Read openspec/config.yaml First

Before creating or updating any `tasks.md`, read `openspec/config.yaml` for branch naming, task structure, and testing requirements specific to this project.

## 2. Mandatory Steps, In Order

- **Step 0**: Create feature branch (`feature/[change-name]`) — always first.
- Implementation steps.
- **Manual endpoint testing with curl (MANDATORY, agent must execute)** — see §3.
- **Multi-tenant isolation check (MANDATORY when the change touches any DB query)** — run `/review-tenant`, apply fixes with `/fix-tenant` if it reports findings.
- **Update technical documentation (MANDATORY)** — `docs/data-model.md` / `docs/api-spec.yml` per `docs/documentation-standards.md`.

## 3. Manual Testing Requirements — Agent Must Execute

**The agent must run these tests itself, never delegate to the user.**

1. Start the local server against local MySQL (`estudio_pilates_dev`).
2. Test each new/changed endpoint with `curl`: at least one success case and one expected-failure case (validation, 404, or 401/403 depending on auth).
3. For CREATE/UPDATE/DELETE operations, restore local DB state after testing (delete the test row, revert the test update) so local dev data stays clean.
4. Save a short report in the change's spec folder: commands run, responses received, restoration performed.
5. Only mark the task complete in `tasks.md` after this is done and documented.

**If local MySQL isn't running, say so explicitly and ask the user to start it (XAMPP) rather than skipping verification or guessing that it works.** This happened on 2026-07-21 during the attendance-URL fix — the routes could only be confirmed as "registered" (401 instead of 404), not fully verified against real data.

## 4. Multi-Tenant Isolation Check

Whenever a task touches a query against a studio database:
1. Run `/review-tenant` after implementing.
2. If it reports findings, run `/fix-tenant <finding-number>` for each, reviewing the diff before confirming.
3. Only mark the task complete once `/review-tenant` reports no findings (or documented, accepted exceptions).

## 5. No Playwright / E2E Step

This project has no frontend build step and no E2E test runner. Frontend changes are verified manually: describe the exact click-path and expected result, and either exercise it yourself if you have browser access, or ask the user to confirm the specific flow. Do not claim a UI fix works without this.

## 6. Documentation Update Step

Before marking a change task complete:
- If the change added/removed/changed an endpoint → update `docs/api-spec.yml`.
- If the change added/removed/changed a table or column → update `docs/data-model.md`.
- If a discrepancy between doc and reality is found in the process, report it — don't silently paper over it.

## Failure to Follow

If tasks are created or implemented without curl verification and (when applicable) a clean `/review-tenant` pass, the change is not done — regardless of whether the code "looks right."
