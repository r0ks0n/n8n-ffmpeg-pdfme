# Project Overview

This repository delivers a self-contained PDF template editor + rendering API built around the PDFme ecosystem. The backend is a small Express service with PostgreSQL persistence; the frontend is a static HTML/JS app that loads PDFme Designer from CDN.

## Stack Snapshot
- Node.js (ES modules) + Express + `pg`
- PDFme packages: `@pdfme/ui`, `@pdfme/common`, `@pdfme/generator`, optional `@pdfme/schemas`
- PostgreSQL for template storage
- Vanilla JS frontend served from `public/index.html`

## Key Responsibilities
1. Persist templates (CRUD) in the `templates` table (`id`, `name`, `template`, timestamps).
2. Render PDFs on the server via `/api/render`, with optional plugin loading and a custom placeholder interpolation layer that resolves `{{var.path}}` values using request inputs/context.
3. Provide an editor UI featuring:
   - Template CRUD controls and base PDF management.
   - Dynamic Variables panel fed by sample JSON pasted by the user (persisted in `localStorage`).
   - Clipboard-friendly placeholder list and search capability.

## Important Files
- `server.js` – Express app, DB init, REST API, interpolation helpers.
- `public/index.html` – Entire frontend (UI layout, Designer bootstrapping, Variables panel logic, auth token handling).
- `Documentation.md` – Full usage/deployment guide with sample payloads.
- `railway.json` – Deployment config for Railway (Nixpacks build, health checks).
- `package.json` – Service metadata and dependencies (`npm start` runs the server).

## Runtime Notes
- Authentication is via optional `EDITOR_AUTH_TOKEN` bearer token.
- Sample JSON for placeholder discovery is manual (user paste) and stored in `localStorage.PDFME_SAMPLE_JSON`.
- Interpolation supports dot & bracket notation (`foo.bar`, `foo[0].baz`). Missing values collapse to empty strings.

## Recommended Workflow for Changes
1. Install deps (`npm install`) and run locally (`npm start`).
2. Visit the editor UI, set a sample JSON to expose placeholders, update templates, and verify `Preview` output.
3. When modifying server routes or interpolation logic, favor pure JS (no extra deps) and back existing helper functions.

