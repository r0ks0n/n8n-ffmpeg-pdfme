# PDFme Editor on Railway

A secure, self-hosted PDF template editor with PostgreSQL storage and n8n integration support.

## Features
- 🎨 Visual template editor powered by PDFme Designer
- 🔐 Multi-layer security (Basic Auth + Bearer Token + Rate Limiting)
- 💾 PostgreSQL template storage
- 🔗 n8n workflow integration with variable interpolation
- 📋 Auto-detect template variables
- 🚀 One-click Railway deployment

## Quick Deploy on Railway

1. **Create a new service** from this repo
2. **Attach PostgreSQL plugin** (Railway auto-injects `DATABASE_URL`)
3. **Set environment variables**:
   ```bash
   # Required for production security
   EDITOR_USERNAME=admin
   EDITOR_PASSWORD=strong_password_here
   EDITOR_AUTH_TOKEN=secret_token_for_api
   CORS_ORIGIN=https://your-n8n-instance.app
   ```
4. **Deploy and access**:
   - `/api/health` → Health check endpoint
   - `/` → PDFme Editor (requires Basic Auth)

## Security

### Multi-layer Protection
- **HTTP Basic Auth** for UI access (username/password)
- **Bearer Token** for API endpoints (n8n integration)
- **Rate Limiting** (5 failed attempts = 15min block)
- **CORS restrictions** for API security

### Environment Variables
See [.env.example](.env.example) for complete configuration options.

**Required:**
- `EDITOR_USERNAME` - Basic Auth username for UI
- `EDITOR_PASSWORD` - Basic Auth password for UI
- `EDITOR_AUTH_TOKEN` - Bearer token for API calls
- `CORS_ORIGIN` - Allowed origin for API requests

## API Endpoints

### Template Management
- `GET /api/templates` - List all templates
- `GET /api/templates/:id` - Get template by ID
- `POST /api/templates` - Create new template
- `PUT /api/templates/:id` - Update template
- `DELETE /api/templates/:id` - Delete template

### PDF Rendering
- `POST /api/render` - Generate PDF from template with variable interpolation

## Documentation

For detailed usage, n8n integration, and security best practices, see [Documentation.md](Documentation.md).
