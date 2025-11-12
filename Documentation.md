# Documentation

## Overview
This project bundles a minimal PDF template editor (powered by PDFme Designer) together with an Express-based API that stores templates in PostgreSQL and renders PDFs on-demand. It is designed to be deployed on Railway but can run in any Node.js environment with PostgreSQL access.

## Environment & Startup
- Node.js service running `node server.js` (ESM syntax enabled via `"type": "module"`).
- Required environment variables:
  - `DATABASE_URL` – PostgreSQL connection string (Railway injects this automatically when the PostgreSQL plugin is attached).
  - `CORS_ORIGIN` – Allowed origin for the editor UI (`*` for testing, restrict in production).
  - `EDITOR_AUTH_TOKEN` – Optional bearer token required for CRUD/render endpoints when set.
  - `N8N_PREVIEW_WEBHOOK_URL` – Optional; if set, `/api/preview` proxies requests to n8n for legacy preview flows.
  - **`EDITOR_USERNAME`** – Optional; if set (with `EDITOR_PASSWORD`), enables HTTP Basic Auth for the editor UI.
  - **`EDITOR_PASSWORD`** – Optional; if set (with `EDITOR_USERNAME`), enables HTTP Basic Auth for the editor UI.
- Static assets are served from `public/` (the editor UI).

### Security Features
The editor includes multiple layers of security:

1. **HTTP Basic Auth** (Optional, recommended for production)
   - Set `EDITOR_USERNAME` and `EDITOR_PASSWORD` to enable
   - Browser will prompt for credentials when accessing the editor UI
   - API endpoints use separate Bearer token auth (`EDITOR_AUTH_TOKEN`)
   - Example: `EDITOR_USERNAME=admin` and `EDITOR_PASSWORD=secure_password_123`

2. **Rate Limiting**
   - Automatically blocks IPs after 5 failed authentication attempts
   - 15-minute cooldown period after blocking
   - Prevents brute-force attacks

3. **Bearer Token for API**
   - `EDITOR_AUTH_TOKEN` protects all `/api/*` endpoints
   - Independent from Basic Auth (UI and API can use different credentials)
   - Required for n8n integration and programmatic access

To run locally:
```bash
npm install
npm start
```

## Server API (`server.js`)
The Express server exposes the following routes (all behind `auth` if `EDITOR_AUTH_TOKEN` is configured):

- `GET /api/health` – Liveness probe, returns `{ "ok": true }`.
- `GET /api/templates` – List latest templates (id, name, timestamps) sorted by `updated_at`.
- `GET /api/templates/:id` – Fetch a complete template record.
- `POST /api/templates` – Create a template `{ name, template }`.
- `PUT /api/templates/:id` – Update template name and/or template JSON.
- `DELETE /api/templates/:id` – Remove a template; responds with `204` on success.
- `POST /api/render` – Render a template into PDF using `@pdfme/generator`. Accepts either inline `template` or `templateId`. Requires a non-empty `inputs` array. Optional body keys:
  - `usePlugins` – truthy to load `@pdfme/schemas` image/qrcode plugins.
  - `fileName` – Suggested filename for `Content-Disposition` header.
  - `context` – Optional object merged into each input item before interpolation (see below).
- `POST /api/preview` – (Optional) Forwards body to `N8N_PREVIEW_WEBHOOK_URL` and streams the resulting PDF.

### Variable Interpolation Layer
Before generating a PDF, `/api/render` now interpolates placeholders in every string field of each `inputs` item:

```txt
{{ path.to.value }}
{{ quiz.answers[0].value }}
```

Rules:
- Dot notation and bracket notation (`foo.bar`, `foo[0].bar`) are supported. Brackets are normalized internally.
- If `context` is supplied in the request body, each input item is merged over the context object (input values win).
- For objects, every nested string is processed. Non-string values are left untouched.
- Missing placeholders resolve to an empty string. Object values serialize as JSON strings if referenced directly.

This allows text blocks inside the editor to contain `{{variable}}` placeholders referencing fields produced by n8n (e.g., Parse JSON node outputs).

## Frontend (`public/index.html`)
A single static HTML file implements the PDFme Designer UI and auxiliary controls:

- **Top bar** – Template CRUD actions (`New`, `Save`, `Save As`, `Load`, `Delete`, `Preview`), token management (`Set Token`, `Logout`), and template selector.
- **Sub bar** – Controls for uploading/clearing/downloading base PDFs for page 1 and page 2+.
- **Designer Canvas** – Renders PDFme Designer via ES module imports from CDN (esm.sh/cdn.jsdelivr/unpkg fallbacks).
- **Variables Panel** – Newly added sidebar listing placeholders derived from a sample JSON payload:
  - `Set JSON` prompts for sample JSON (e.g., response of n8n Parse JSON node).
  - `Clear` removes stored sample data.
  - The sample is persisted in `localStorage` under `PDFME_SAMPLE_JSON`.
  - A search box filters placeholders by path or preview value.
  - Clicking a variable copies `{{path}}` to the clipboard (with fallback for browsers without Clipboard API).
  - Array fields display the structure of the first element (`[0]`) to illustrate placeholder notation.

### Using the Variable Panel
1. Click **Set JSON**, paste a sample payload (see example below), and confirm.
2. The panel populates with detected scalar fields. Each entry shows `{{path}}` and a truncated preview value.
3. Click an item to copy the placeholder and paste it into a text field inside the Designer (e.g., text schema).
4. Save the template as usual.

### Sample JSON (for testing)
Paste this payload via **Set JSON**:

```json
{
  "quiz": {
    "firstName": "Ana",
    "lastName": "Kovač",
    "email": "ana.kovac@example.com",
    "answers": [
      { "question": "Najljubša barva?", "value": "Modra" },
      { "question": "Najljubši kraj?", "value": "Ljubljana" }
    ],
    "scorePercent": 92,
    "completedAt": "2024-05-14T09:32:00Z"
  },
  "ai": {
    "summary": "Ana dosega nadpovprečen rezultat in je pripravljena za naslednji modul.",
    "score": 4.6,
    "nextSteps": [
      "Ponovi poglavje 2.1",
      "Pripravi vprašanja za mentorja"
    ]
  },
  "meta": {
    "webhookId": "wh_12345",
    "receivedAt": "2024-05-14T09:33:10Z"
  }
}
```

The panel will surface placeholders such as:
- `{{quiz.firstName}}`
- `{{quiz.answers[0].question}}`
- `{{ai.summary}}`
- `{{ai.nextSteps[0]}}`
- `{{meta.receivedAt}}`

### Using placeholders in the editor
Within any text schema, include placeholders directly in the content, e.g.:

```
Pozdravljen/a {{quiz.firstName}} {{quiz.lastName}}!
Tvoj rezultat je {{quiz.scorePercent}} %.
Naslednji korak: {{ai.nextSteps[0]}}.
```

When `/api/render` receives `inputs` containing the same structure as the sample, the text will resolve to the real values from n8n.

## n8n Integration Notes
- Configure your workflow so that the JSON data you need is present on the `inputs` array passed to `/api/render` (each item represents one generated document/page).
- If you have global data common to all inputs, pass it under `context` in the request body:

```json
{
  "templateId": "...",
  "inputs": [ { "quiz": { "firstName": "Ana" } } ],
  "context": { "ai": { "summary": "..." } }
}
```

- The server merges each `inputs[i]` over the supplied context before interpolation, so `{{ai.summary}}` is available even if it sits outside the item.

## Persisted keys & storage
- `localStorage.PDFME_SAMPLE_JSON` – Stores the raw sample JSON string for the Variables panel between sessions.
- `localStorage.EDITOR_TOKEN` – Saves bearer token for authenticated sessions.

## Deployment
- Railway deployment is configured via `railway.json` (Nixpacks builder, health check against `/api/health`, auto-restart on failure).
- No build step required; static assets are served as-is.

## Testing Suggestions
- Manually run `npm start` and visit `http://localhost:3000/`.
- If Basic Auth is enabled, browser will prompt for username/password.
- Paste the sample JSON, insert placeholders into a text schema, and click **Preview**. If `EDITOR_AUTH_TOKEN` is set, ensure it matches the value entered via **Set Token**.
- Verify the downloaded PDF contains real interpolated values.

## Production Deployment Checklist

Before deploying to production, ensure these security measures are in place:

### ✅ Required
- [ ] Set `EDITOR_USERNAME` and `EDITOR_PASSWORD` for UI access
- [ ] Set `EDITOR_AUTH_TOKEN` for API access (used by n8n)
- [ ] Set `CORS_ORIGIN` to your n8n domain (not `*`)
- [ ] Verify `DATABASE_URL` points to production PostgreSQL

### ✅ Recommended
- [ ] Use strong passwords (16+ characters, mixed case, numbers, symbols)
- [ ] Store credentials in Railway's environment variables (never in code)
- [ ] Enable HTTPS (Railway handles this automatically)
- [ ] Monitor failed authentication attempts in logs
- [ ] Regularly rotate passwords and tokens

### Example Railway Environment Variables
```bash
# Database (auto-injected by Railway PostgreSQL plugin)
DATABASE_URL=postgresql://user:pass@host:5432/db

# CORS (restrict to your n8n instance)
CORS_ORIGIN=https://your-n8n-instance.app

# Editor UI Protection (Basic Auth)
EDITOR_USERNAME=admin
EDITOR_PASSWORD=Str0ng!P@ssw0rd_2024

# API Protection (Bearer Token for n8n)
EDITOR_AUTH_TOKEN=secret_token_for_n8n_api_calls_xyz123

# Optional
N8N_PREVIEW_WEBHOOK_URL=https://your-n8n.app/webhook/preview
PORT=3000
```

### Security Architecture
```
┌─────────────────────────────────────────┐
│  Internet                               │
└──────────────┬──────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  Railway (HTTPS)                         │
│  ┌────────────────────────────────────┐  │
│  │  PDFme Editor Service              │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │ Rate Limiter                 │ │  │
│  │  │ (5 attempts / 15min)         │ │  │
│  │  └──────────────────────────────┘ │  │
│  │              │                     │  │
│  │              ▼                     │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │ UI Path (/*)                 │ │  │
│  │  │ → Basic Auth                 │ │  │
│  │  │   (EDITOR_USERNAME/PASSWORD) │ │  │
│  │  └──────────────────────────────┘ │  │
│  │              │                     │  │
│  │              ▼                     │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │ API Path (/api/*)            │ │  │
│  │  │ → Bearer Token               │ │  │
│  │  │   (EDITOR_AUTH_TOKEN)        │ │  │
│  │  └──────────────────────────────┘ │  │
│  └────────────────────────────────────┘  │
│                 │                        │
│                 ▼                        │
│  ┌────────────────────────────────────┐  │
│  │  PostgreSQL Database               │  │
│  │  (templates storage)               │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

