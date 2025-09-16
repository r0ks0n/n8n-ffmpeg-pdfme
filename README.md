# PDFme Editor on Railway

This service hosts a simple PDFme Designer UI and a tiny API (Express + Postgres) to save/load templates.

## Quick start
1. Deploy this repo to Railway.
2. Attach a PostgreSQL plugin (Railway-managed). `DATABASE_URL` will be injected automatically.
3. Set env vars:
   - `EDITOR_AUTH_TOKEN` (optional, recommended)
   - `CORS_ORIGIN` (e.g., your editor domain or `*` while testing)
   - (optional) `N8N_PREVIEW_WEBHOOK_URL` if you want Preview button to call n8n.
4. Open the public URL and design templates.

## API
- `GET /api/health`
- `GET /api/templates`
- `GET /api/templates/:id`
- `POST /api/templates` `{ name, template }`
- `PUT /api/templates/:id` `{ name?, template? }`

Security: send `Authorization: Bearer <EDITOR_AUTH_TOKEN>` if set.
