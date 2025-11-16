# n8n Integration Guide - PDFme Multi-Page Rendering

## 🚀 Quick Start (5 minutes)

### Prerequisites
- PDFme Editor running (Railway or local)
- n8n instance with HTTP Request node
- Template with multi-page support configured

### Step 1: Create Template in PDFme Editor

1. **Upload Base PDFs**
   - Page 1 base: Your header/logo PDF
   - Page 2+ base: Continuation page PDF

2. **Add Dynamic Field**
   - Click "⚡ Quick Add AI Field"
   - Enter variable name: `content`
   - Adjust field size/position

3. **Configure Page 2 Layout** (optional)
   - Click "📑 Page 2+" button
   - Adjust field position for continuation pages
   - Click "📄 Page 1" to return

4. **Save Template**
   - Click "Save"
   - Copy Template ID (shows in UI)

### Step 2: Configure n8n Workflow

#### Option A: Simple HTTP Request Node

```json
{
  "method": "POST",
  "url": "https://your-pdfme.railway.app/api/render",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "httpHeaderAuth": {
    "name": "Authorization",
    "value": "Bearer YOUR_EDITOR_AUTH_TOKEN"
  },
  "jsonParameters": true,
  "options": {
    "response": {
      "response": {
        "responseFormat": "file"
      }
    }
  },
  "bodyParameters": {
    "parameters": [
      {
        "name": "templateId",
        "value": "YOUR_TEMPLATE_ID"
      },
      {
        "name": "inputs",
        "value": [
          {
            "content": "={{ $json.output }}"
          }
        ]
      },
      {
        "name": "fileName",
        "value": "report"
      }
    ]
  }
}
```

#### Option B: Advanced with Variable Mapping

```json
{
  "method": "POST",
  "url": "https://your-pdfme.railway.app/api/render",
  "authentication": "genericCredentialType",
  "genericAuthType": "httpHeaderAuth",
  "httpHeaderAuth": {
    "name": "Authorization",
    "value": "Bearer YOUR_EDITOR_AUTH_TOKEN"
  },
  "jsonParameters": true,
  "options": {
    "response": {
      "response": {
        "responseFormat": "file"
      }
    }
  },
  "body": {
    "templateId": "177137c7-cec4-4d95-93ee-516a5b185444",
    "inputs": [
      {
        "firstName": "={{ $json.firstName }}",
        "lastName": "={{ $json.lastName }}",
        "content": "={{ $json.aiAnalysis }}"
      }
    ],
    "context": {
      "generatedAt": "={{ $now.toISO() }}",
      "webhookId": "={{ $('Webhook').item.json.webhookId }}"
    },
    "fileName": "report_{{ $json.lastName }}"
  }
}
```

---

## 📋 Complete Workflow Example

### Scenario: AI-Generated Numerology Report

```
┌─────────────┐
│  Webhook    │ → Receives form data
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Parse JSON  │ → Extract user data
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ OpenAI API  │ → Generate numerology analysis
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ HTTP Request│ → PDFme /api/render
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Send Email  │ → Attach PDF to email
└─────────────┘
```

### Node 1: Webhook (Trigger)
```json
{
  "firstName": "Ana",
  "lastName": "Kovač",
  "email": "ana@example.com",
  "birthDate": "1990-05-14"
}
```

### Node 2: OpenAI Assistant
```
Prompt: "Generate a personalized numerology report for {{ $json.firstName }} born on {{ $json.birthDate }}. Include life path analysis, personality traits, and recommendations. Write in Slovenian. Length: 2000-3000 characters."

Output field: "output"
```

### Node 3: HTTP Request (PDFme Render)
```json
{
  "method": "POST",
  "url": "https://your-pdfme.railway.app/api/render",
  "headers": {
    "Authorization": "Bearer secret_token_xyz"
  },
  "body": {
    "templateId": "177137c7-cec4-4d95-93ee-516a5b185444",
    "inputs": [
      {
        "content": "={{ $json.output }}"
      }
    ],
    "context": {
      "firstName": "={{ $('Webhook').item.json.firstName }}",
      "lastName": "={{ $('Webhook').item.json.lastName }}",
      "generatedAt": "={{ $now.toISO() }}"
    },
    "fileName": "numerology_report_{{ $('Webhook').item.json.lastName }}"
  },
  "options": {
    "responseFormat": "file"
  }
}
```

### Node 4: Send Email
```json
{
  "fromEmail": "noreply@example.com",
  "toEmail": "={{ $('Webhook').item.json.email }}",
  "subject": "Your Personalized Numerology Report",
  "text": "Hi {{ $('Webhook').item.json.firstName }},\n\nPlease find your personalized numerology report attached.",
  "attachments": "={{ $binary.data }}"
}
```

---

## 🔧 API Reference

### POST `/api/render`

Generates PDF from template with dynamic data.

**Headers:**
```
Authorization: Bearer YOUR_EDITOR_AUTH_TOKEN
Content-Type: application/json
```

**Body:**
```typescript
{
  // Option 1: Use template from database
  templateId: string;  // UUID of saved template

  // Option 2: Pass inline template
  template: {
    basePdf: { '0': string, '1': string },  // Base PDFs as data URLs
    schemas: Array<Array<SchemaField>>,      // Field definitions per page
    _secondBasePdf?: string,                 // Optional: Continuation base PDF
    _multiPageEnabled?: boolean              // Enable multi-page mode
  };

  // Data to fill into template
  inputs: Array<{
    [fieldName: string]: string | number;
  }>;

  // Optional: Global context merged with each input
  context?: {
    [key: string]: any;
  };

  // Optional: Output filename
  fileName?: string;

  // Optional: Load additional plugins
  usePlugins?: boolean;
}
```

**Response:**
```
Content-Type: application/pdf
Content-Disposition: inline; filename="output.pdf"

<PDF binary data>
```

**Example - Minimal Request:**
```bash
curl -X POST https://your-pdfme.railway.app/api/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "177137c7-cec4-4d95-93ee-516a5b185444",
    "inputs": [
      {
        "content": "Short text for testing"
      }
    ]
  }' \
  -o output.pdf
```

**Example - Multi-Page with Context:**
```bash
curl -X POST https://your-pdfme.railway.app/api/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "177137c7-cec4-4d95-93ee-516a5b185444",
    "inputs": [
      {
        "content": "Long AI-generated text that will span multiple pages..."
      }
    ],
    "context": {
      "firstName": "Ana",
      "lastName": "Kovač",
      "generatedAt": "2024-05-14T10:30:00Z"
    },
    "fileName": "numerology_report_Kovač"
  }' \
  -o output.pdf
```

---

## 💡 Tips & Best Practices

### 1. **Variable Naming**

Use consistent variable names across template and n8n:

**In PDFme Template:**
```
Field name: content
Field content: {{content}}
```

**In n8n HTTP Request:**
```json
"inputs": [
  {
    "content": "={{ $json.output }}"
  }
]
```

### 2. **Error Handling**

Add error handling in n8n:

```javascript
// In "Code" node after HTTP Request
if ($binary.data === undefined) {
  throw new Error('PDF generation failed: ' + JSON.stringify($json));
}
return { json: { success: true }, binary: { data: $binary.data } };
```

### 3. **Text Length Management**

For very long AI outputs, consider:

```javascript
// Truncate if needed
const maxLength = 10000;  // ~4-5 pages
const content = $json.output.substring(0, maxLength);

// Or split into multiple PDFs
const chunk1 = $json.output.substring(0, 5000);
const chunk2 = $json.output.substring(5000);
```

### 4. **Caching Templates**

For high-volume workflows:
- Load template once with GET `/api/templates/:id`
- Store in n8n variable
- Pass inline `template` instead of `templateId`
- Reduces DB queries

### 5. **Batch Processing**

Generate multiple PDFs in parallel:

```javascript
// Split Loop node
items.map(item => ({
  templateId: "...",
  inputs: [{ content: item.json.text }],
  fileName: `report_${item.json.id}`
}))

// Then: HTTP Request node with "Execute Once for Each Item"
```

---

## 🐛 Common Issues

### Issue 1: "Unauthorized" Error

**Symptoms:**
```json
{ "error": "Unauthorized" }
```

**Solution:**
- Check `EDITOR_AUTH_TOKEN` in Railway environment
- Verify Bearer token in n8n HTTP Request node
- Format: `Authorization: Bearer YOUR_TOKEN` (not `Token YOUR_TOKEN`)

---

### Issue 2: Empty PDF Generated

**Symptoms:**
- PDF file created but no content visible

**Solution:**
1. Check field name matches: `inputs[0].content` = schema field name
2. Verify data reaches n8n node: Add "Set" node before HTTP Request
3. Check template has fields configured

---

### Issue 3: Text Not Splitting Across Pages

**Symptoms:**
- Long text truncated instead of continuing on page 2

**Solution:**
1. Verify "Page 2+ base" is uploaded in editor
2. Check template `_multiPageEnabled: true`
3. Field type must be `multiVariableText` (not `text`)
4. Ensure Page 2 schema has matching field

---

### Issue 4: Special Characters Broken

**Symptoms:**
- Slovenian characters (č, š, ž) display as �

**Solution:**
1. Verify custom font supports UTF-8
2. Upload font to `public/fonts/`
3. Add to `fonts.json`:
   ```json
   {
     "Roboto": "Roboto-Regular.ttf"
   }
   ```
4. Set field `fontName: "Roboto"` in designer

---

## 📊 Performance Considerations

### Optimization Tips

1. **Use templateId instead of inline template** (faster DB lookup vs. large payload)
2. **Minimize basePdf size** (compress PDFs, use low-res backgrounds)
3. **Batch requests** when generating multiple PDFs
4. **Set appropriate timeout** in n8n (default 300s may be too short for large documents)

### Expected Performance

| Scenario | Time | PDF Size |
|----------|------|----------|
| Single page, no images | ~500ms | ~50KB |
| 2-3 pages with text | ~1-2s | ~150KB |
| 5+ pages with images | ~3-5s | ~500KB |
| 10+ pages with splitting | ~5-10s | ~1MB |

---

## 🧪 Testing Your Integration

### Test Checklist

- [ ] **Test 1**: Short text (fits on 1 page)
- [ ] **Test 2**: Long text (splits to 2-3 pages)
- [ ] **Test 3**: Very long text (5+ pages)
- [ ] **Test 4**: Special characters (č, š, ž, ć, đ)
- [ ] **Test 5**: Empty input (should generate blank page)
- [ ] **Test 6**: Multiple variables (firstName, lastName, content)
- [ ] **Test 7**: Context merging (global + per-input data)
- [ ] **Test 8**: Error handling (invalid templateId)

### Sample Test Data

```json
{
  "short_text": "Kratko besedilo za testiranje.",
  "long_text": "Lorem ipsum dolor sit amet... (2000+ characters)",
  "very_long_text": "Lorem ipsum dolor sit amet... (10000+ characters)",
  "special_chars": "Testiranje šumnikov: č, š, ž, ć, đ, Č, Š, Ž",
  "empty": "",
  "with_newlines": "Odstavek 1.\n\nOdstavek 2.\n\nOdstavek 3."
}
```

---

## 📞 Support

If you encounter issues not covered in this guide:

1. Check [MULTI_PAGE_TROUBLESHOOTING.md](MULTI_PAGE_TROUBLESHOOTING.md)
2. Review server logs for `[RENDER ERROR]` messages
3. Test with minimal payload to isolate issue
4. Compare with working examples in `tests/` directory

---

## 📚 Additional Resources

- **PDFme Documentation**: https://pdfme.com/docs
- **n8n Documentation**: https://docs.n8n.io
- **Railway Deployment**: https://railway.app/docs
- **Project Repository**: (your GitHub repo link here)
