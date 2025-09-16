# PDFme Editor on Railway (editor-only repo)

This repo hosts a simple PDFme Designer UI and an Express API with Postgres storage.

## Deploy on Railway
1. Create a new service from this repo.
2. Attach a **PostgreSQL** plugin (Railway-managed DB). `DATABASE_URL` will be injected automatically.
3. Set env vars:
   - `EDITOR_AUTH_TOKEN` (optional, recommended)
   - `CORS_ORIGIN` (e.g. your domain or `*` while testing)
4. Open the service URL:
   - `/api/health` → `{"ok":true}`
   - `/` → PDFme Editor page

## API
- `GET /api/templates`, `GET /api/templates/:id`
- `POST /api/templates`, `PUT /api/templates/:id`, `DELETE /api/templates/:id`
- `POST /api/render` → returns a PDF (server-side using @pdfme/generator)
