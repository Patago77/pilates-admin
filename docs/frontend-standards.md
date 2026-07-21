---
description: Frontend development standards for pilates-admin (StudioAdmin) — static HTML/JS, no build step, no framework
globs: ["public/**/*.{html,js,css}"]
alwaysApply: true
---

# Frontend Standards — pilates-admin (StudioAdmin)

## Overview

The frontend is **static HTML + vanilla JavaScript**, served directly from `public/` by Express (and mirrored to Nginx in production). There is no build step, no bundler, no framework (no React/Vue), no npm frontend dependencies — everything is loaded via `<script>` tags. Do not introduce a build pipeline, JSX, or a frontend framework without an explicit decision to do so; it would be a large, unrequested architectural change.

## Pages

- `public/index.html` — admin/instructora panel (single page, all sections toggled via JS, not routed).
- `public/mi-agenda.html` — alumna portal (separate JWT/session, see `docs/backend-standards.md` — two auth systems).
- `public/qr-portal.html` — standalone QR entry point.
- `public/script.js` — all admin panel logic (~1500+ lines). Keep new admin-panel logic here unless it's genuinely portal-specific.

## External libraries (via CDN/vendored, no package manager)

- **Bootstrap 5** — layout, modals (`bootstrap.Modal.getOrCreateInstance(...)`).
- **SweetAlert2** (`Swal.fire(...)`) — all confirmations, toasts, and error dialogs. Use it instead of `alert()`/`confirm()`.

## API calls

- `API_URL` is computed once at the top of `script.js` based on `window.location.hostname` (localhost → `http://localhost:3005/api`, anything else → `/api`, same-origin via Nginx in production). Always build requests off `API_URL`, never hardcode a host.
- A global `fetch` interceptor auto-adds `credentials: 'include'` for any request to `API_URL` — this is what makes the httpOnly `admin_token` cookie ride along. Don't manually set `credentials` per call; it already happens globally.
- `getAuthHeaders()` currently only sets `Content-Type: application/json` — the cookie carries auth, not a header. If you're adding an alumna-portal call, that side sends the JWT explicitly instead (see `mi-agenda.html`/`agenda`-related JS) — don't confuse the two patterns.
- Standard call shape:
  ```js
  const resp = await fetch(`${API_URL}/recurso`, { headers: getAuthHeaders() });
  if (!resp.ok) throw new Error("Mensaje de error en español.");
  const data = await resp.json();
  ```
- Wrap user-triggered actions in `try { ... } catch (err) { handleError(err); }`. `handleError()` shows a SweetAlert2 error dialog (or a silent toast when `silent=true`) and logs to console — don't roll your own error UI.

## DOM & rendering

- No virtual DOM, no templating engine — HTML is built with template literals and injected via `.innerHTML`.
- **Always run any user-supplied or DB-sourced string through `escapeHtml()` before interpolating into `.innerHTML`** (see the helper at the top of `script.js`). This is the project's only defense against stored XSS from fields like `nombre`, `documento`, `comentarios` — don't skip it, and don't assume data from the DB is safe just because it came from your own API.
- Functions meant to be called from inline `onclick="..."` handlers in generated HTML must be attached to `window` (e.g. `window.toggleActivoAlumno = async function(...) {...}`) — a plain `function` declaration won't be reachable from an `onclick` string injected via `innerHTML`.

## Naming & language

- Function and variable names mix English (`handleError`, `getAuthHeaders`) and Spanish (`cargarAsistenciasHoy`, `abrirModalMovimiento`) — this reflects the existing codebase, not a rule. Match whichever convention the surrounding code already uses in that section of `script.js`.
- All user-facing text (labels, confirmations, error messages) is in Spanish (Argentina) — that's the real audience. Keep it that way.

## Manual backups before large edits

You'll find files like `script.js.bak.2026-01-08_1456` in `public/` — a manual "copy before a big change" habit already in use for this single large file. When making a large, risky edit to `script.js` (not a one-line fix), consider proposing the same: copy to `script.js.bak.<date>` first, or rely on git if the working tree is clean — check with the user which they'd prefer for the specific change.

## Testing

No Cypress/Playwright/E2E infra exists for the frontend. Verification is manual: load the page in a browser (or describe the exact click-path to the user) and confirm the network request/response and the resulting UI state, per `docs/base-standards.md` §7. Don't claim a UI fix works without having actually exercised the button/flow it touches — see the attendance-URL bug (2026-07-21) for what silent frontend/backend drift looks like in this codebase.
