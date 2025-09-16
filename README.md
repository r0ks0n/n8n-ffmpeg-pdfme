# PDFme + n8n monorepo for Railway

- `apps/editor` → PDFme Editor + API (Express, Postgres)
- `apps/n8n` → n8n with pdfme libraries (Dockerfile)

## Deploy (same Railway project)
1. Push this repo to GitHub.
2. In Railway project, create **Service A**: Deploy from this repo → set **Root Directory** to `apps/editor`. Attach PostgreSQL and set env vars.
3. Create **Service B**: Deploy from the same repo again → set **Root Directory** to `apps/n8n`. Set n8n env vars.
4. Open both URLs: `/api/health` for editor; `/` for n8n login.

See each app's README and `.env.example` for variables.
