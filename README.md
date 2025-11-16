# PDFme Multi-Page Editor & Rendering API

Professional PDF template editor with multi-page support, variable interpolation, and automatic text splitting. Built for n8n integration with AI-generated content.

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](CHANGELOG.md)
[![Status](https://img.shields.io/badge/status-production-green.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)]()

---

## 🎯 Key Features

### ✨ Multi-Page Support
- **Dual Base PDFs**: Different layouts for Page 1 (header/logo) and Page 2+ (continuation)
- **Automatic Text Splitting**: Long text intelligently breaks across pages at paragraph/sentence boundaries
- **Page Layout Editor**: Design each page layout independently with visual switch buttons

### 📝 Variable Text System
- **Dynamic Content**: Use `{{variable}}` placeholders in templates
- **n8n Integration**: Seamlessly fill PDFs with AI-generated content
- **Variable Detection**: Automatic scanning and n8n config generation

### 🎨 Professional Designer
- **Visual Editor**: Drag-and-drop field positioning powered by PDFme
- **Custom Fonts**: Upload and use custom fonts (OTF/TTF/WOFF)
- **Live Preview**: Test rendering with sample data before deploying

### 🔒 Enterprise Security
- **Dual Authentication**: Basic Auth for UI + Bearer token for API
- **Rate Limiting**: Automatic protection against brute-force attacks
- **CORS Control**: Restrict access to specific domains

---

## 🚀 Quick Start

### 1. Deploy to Railway

1. **Create new service** from this repo
2. **Attach PostgreSQL plugin** (auto-injects `DATABASE_URL`)
3. **Set environment variables**:
```bash
EDITOR_USERNAME=admin            # UI login username
EDITOR_PASSWORD=secure_pass      # UI login password
EDITOR_AUTH_TOKEN=secret_token   # API Bearer token
CORS_ORIGIN=https://your-n8n.app # Restrict API access
```

### 2. Create Your First Template

1. **Login**: Visit your Railway URL, enter credentials
2. **Upload Base PDFs**:
   - Page 1: Your header/logo PDF
   - Page 2+: Continuation page PDF
3. **Add Dynamic Field**:
   - Click "⚡ Quick Add AI Field"
   - Name it: `content`
4. **Adjust Layout**:
   - Use "📄 Page 1" and "📑 Page 2+" buttons to design each page
5. **Save & Copy ID**: Click "Save", copy the Template ID

### 3. Connect from n8n

**HTTP Request Node:**
```json
{
  "method": "POST",
  "url": "https://your-app.railway.app/api/render",
  "authentication": "headerAuth",
  "headerAuth": {
    "name": "Authorization",
    "value": "Bearer YOUR_EDITOR_AUTH_TOKEN"
  },
  "body": {
    "templateId": "YOUR_TEMPLATE_ID",
    "inputs": [
      {
        "content": "={{ $json.aiOutput }}"
      }
    ],
    "fileName": "report"
  },
  "options": {
    "response": {
      "responseFormat": "file"
    }
  }
}
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [CHANGELOG.md](CHANGELOG.md) | Version history and migration guides |
| [Documentation.md](Documentation.md) | Complete API reference and deployment guide |
| [MULTI_PAGE_TROUBLESHOOTING.md](docs/MULTI_PAGE_TROUBLESHOOTING.md) | Debugging guide for common issues |
| [N8N_INTEGRATION_GUIDE.md](docs/N8N_INTEGRATION_GUIDE.md) | n8n workflow examples and best practices |

---

## 🔧 API Endpoints

### Core Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | Public | Health check (Railway probe) |
| `GET` | `/api/templates` | Bearer | List all templates |
| `GET` | `/api/templates/:id` | Bearer | Get single template |
| `POST` | `/api/templates` | Bearer | Create new template |
| `PUT` | `/api/templates/:id` | Bearer | Update template |
| `DELETE` | `/api/templates/:id` | Bearer | Delete template |
| `POST` | `/api/render` | Bearer | Generate PDF from template |
| `POST` | `/api/compose` | Bearer | Merge multiple PDFs |

### Render API (Most Important)

**Request:**
```json
POST /api/render
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "templateId": "uuid-of-template",
  "inputs": [
    {
      "content": "AI-generated text...",
      "firstName": "Ana",
      "lastName": "Kovač"
    }
  ],
  "context": {
    "generatedAt": "2024-11-16T10:30:00Z"
  },
  "fileName": "report"
}
```

**Response:**
```
Content-Type: application/pdf
Content-Disposition: inline; filename="report.pdf"

<PDF binary data>
```

**Multi-Page Behavior:**
- If text fits on 1 page → Single page PDF
- If text exceeds capacity → Automatic splitting across multiple pages
- Page 2+ uses `_secondBasePdf` layout automatically

---

## 🐛 Troubleshooting

### Common Issues

#### 1. `Invalid argument: template.basePdf` Error

**Cause**: Incompatible basePdf format

**Solution**: Fixed in v0.3.0 - Update to latest version

**Details**: [MULTI_PAGE_TROUBLESHOOTING.md](docs/MULTI_PAGE_TROUBLESHOOTING.md#error-1)

---

#### 2. `invalid JSON string for variables` Error

**Cause**: multiVariableText validation issue

**Solution**: Fixed in v0.3.0 - Update to latest version

**Details**: [MULTI_PAGE_TROUBLESHOOTING.md](docs/MULTI_PAGE_TROUBLESHOOTING.md#error-2)

---

#### 3. Text Not Splitting Across Pages

**Checklist:**
- [ ] "Page 2+ base" PDF uploaded?
- [ ] Template saved after upload?
- [ ] Field type is `multiVariableText`?
- [ ] Page 2 layout configured?

**Debug**: Check server logs for `[MULTI-PAGE]` messages

---

#### 4. Slovenian Characters (č, š, ž) Display as �

**Solution**: Upload custom font that supports UTF-8

1. Get Roboto/Noto font (supports all Latin characters)
2. Upload to `public/fonts/Roboto-Regular.ttf`
3. Create `public/fonts/fonts.json`:
   ```json
   {
     "Roboto": "Roboto-Regular.ttf"
   }
   ```
4. In designer: Set field `fontName: "Roboto"`
5. Restart server

---

## 🧪 Testing

### Manual Test Flow

```bash
# 1. Start server
npm start

# 2. Create template in UI
open http://localhost:3000

# 3. Test render
curl -X POST http://localhost:3000/api/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @tests/test-multipage-render.json \
  -o output.pdf

# 4. Check output
open output.pdf
```

### Test Cases

| Test | Input | Expected Output |
|------|-------|-----------------|
| Single page | 500 chars | 1-page PDF |
| Multi-page | 5000 chars | 2-3 page PDF |
| Very long | 15000 chars | 5-6 page PDF |
| Special chars | "č, š, ž" | Correct display |
| Empty | "" | Blank page |
| Variables | `{{firstName}}` | Interpolated value |

---

## 📦 Tech Stack

- **Backend**: Node.js 18+, Express, PostgreSQL
- **Frontend**: Vanilla JS, PDFme Designer (CDN)
- **PDF Generation**: @pdfme/generator v5.3.0
- **Database**: PostgreSQL with JSONB for templates
- **Deployment**: Railway (Nixpacks)
- **Authentication**: Basic Auth + Bearer tokens

---

## 📄 License

Private and proprietary. All rights reserved.

---

<p align="center">
  Made with ❤️ for seamless PDF generation
</p>
