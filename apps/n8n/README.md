# n8n on Railway (with pdfme)

This service packages n8n with `@pdfme/*` and `pdf-lib` preinstalled so you can use them in the **Code** node.

## Railway settings (Service → Variables)
Required:
- `N8N_HOST` = `<your-n8n-subdomain>.up.railway.app`
- `N8N_PORT` = `5678`
- `N8N_PROTOCOL` = `https`
- `WEBHOOK_URL` = `https://<your-n8n-subdomain>.up.railway.app`
- `N8N_ENCRYPTION_KEY` = a long random string
- `GENERIC_TIMEZONE` = `Europe/Ljubljana`

Optional (recommended):
- `N8N_DIAGNOSTICS_ENABLED` = `false`
- `N8N_BASIC_AUTH_ACTIVE` = `true`
- `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD`

Persistence note: default n8n uses SQLite which is ephemeral on Railway. For production, configure PostgreSQL for n8n or attach a Volume.