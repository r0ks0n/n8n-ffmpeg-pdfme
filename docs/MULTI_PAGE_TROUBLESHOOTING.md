# Multi-Page PDF Rendering - Troubleshooting Guide

## 🎯 Overview

This document explains how multi-page PDF rendering works in our PDFme implementation and how to debug common issues.

## 🔧 Key Features

### 1. **Variable Text (Dynamic Content)**
- Text fields use `{{variable}}` syntax
- Data flows from n8n → `/api/render` → interpolated into PDF
- Example: `{{quiz.firstName}}` → "Ana"

### 2. **Multi-Page Support**
- **Page 1**: Different base PDF (e.g., with header/logo)
- **Page 2+**: Different base PDF (e.g., continuation pages without header)
- Configured via UI: Upload both "Page 1 base" and "Page 2+ base"

### 3. **Text Splitting (Automatic Page Overflow)**
- `multiVariableText` fields automatically split across pages
- Intelligent breaking at: paragraphs → sentences → words
- Capacity calculated from field dimensions + font size

## 🐛 Common Errors & Solutions

### Error 1: `[@pdfme/common] Invalid argument: template.basePdf`

**Cause**: PDFme v5 doesn't accept `basePdf` as array format.

**Old (broken)**:
```javascript
basePdf: [pdfDataUrl1, pdfDataUrl2]  // ❌ Invalid
```

**New (fixed)**:
```javascript
basePdf: {
  '0': pdfDataUrl1,
  '1': pdfDataUrl2
}  // ✅ Valid
```

**Where fixed**:
- [server.js:643-651](server.js:643-651) - Automatic array→object conversion
- [index.html:850-853](index.html:850-853) - Template saving with object format

---

### Error 2: `invalid JSON string '...' for variables in field content`

**Cause**: PDFme's `multiVariableText` validates `content` field as JSON, but we pass plain text.

**Solution**: Remove `content` field from schema before rendering; provide data via `inputs` array only.

**Where fixed**: [server.js:523-538](server.js:523-538)

```javascript
// Before generation, clean schemas:
if (schema.type === 'multiVariableText' && schema.content) {
  schema._originalContent = schema.content;  // Backup for reference
  delete schema.content;  // Remove to prevent validation
}
```

**How it works**:
1. User creates field with `{{content}}` placeholder in designer
2. On save: schema stores `content: "{{content}}"`
3. On render:
   - Server extracts `content` value from `inputs`
   - Server removes `schema.content` field
   - PDFme receives clean schema + data in `inputs` array

---

### Error 3: Text not splitting across pages

**Debug checklist**:

1. **Is `_multiPageEnabled` set?**
   ```javascript
   console.log(template._multiPageEnabled);  // Should be true
   ```

2. **Is `_secondBasePdf` present?**
   ```javascript
   console.log(!!template._secondBasePdf);  // Should be true
   ```

3. **Are there 2+ schema pages?**
   ```javascript
   console.log(template.schemas.length);  // Should be >= 2
   ```

4. **Is field type `multiVariableText`?**
   ```javascript
   console.log(schema.type);  // Should be 'multiVariableText'
   ```

5. **Check text capacity calculation**:
   Look for logs:
   ```
   [TEXT CAPACITY] Width:170mm Height:180mm Font:11pt -> 65 chars/line × 40 lines = 2600 chars
   ```

---

## 📊 How Multi-Page Rendering Works

### Step-by-Step Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. n8n sends request to /api/render                         │
│    {                                                         │
│      "templateId": "...",                                    │
│      "inputs": [{ "content": "Long text..." }]              │
│    }                                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Server loads template from DB                            │
│    - Check if _multiPageEnabled: true                       │
│    - Check if _secondBasePdf exists                         │
│    - Extract schemas array (Page 1, Page 2 layouts)         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Clean template schemas                                   │
│    - Remove 'content' field from multiVariableText schemas  │
│    - Store original content as _originalContent             │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Build pdfInputData from inputs array                     │
│    - Scan schemas for field names                           │
│    - Match inputs by field name                             │
│    - Interpolate {{variables}} if present                   │
│    Result: { content: "Long text..." }                      │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Check if text splitting needed                           │
│    - Calculate field capacity (chars per page)              │
│    - If text.length > capacity → split                      │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Generate dynamic schemas for continuation pages          │
│    - Page 1: Original schema with text chunk 1              │
│    - Page 2: Cloned schema with text chunk 2                │
│    - Page 3: Cloned schema with text chunk 3                │
│    - ...                                                     │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Build basePdf object                                     │
│    basePdf = {                                              │
│      '0': firstBasePdf,     // Page 1 PDF                   │
│      '1': secondBasePdf,    // Page 2 PDF                   │
│      '2': secondBasePdf,    // Page 3 PDF (same as page 2)  │
│      ...                                                     │
│    }                                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Final safety check: Convert array→object if needed       │
│    if (Array.isArray(basePdf)) {                            │
│      basePdf = { '0': basePdf[0], '1': basePdf[1], ... }   │
│    }                                                         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. Call PDFme generator                                     │
│    generate({                                               │
│      template: { basePdf: {...}, schemas: [[...], [...]] }, │
│      inputs: [{ content: "chunk1", content_page2: "..." }], │
│      plugins: { text, multiVariableText, image, ... }       │
│    })                                                        │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. Return PDF to n8n                                       │
│     Content-Type: application/pdf                           │
│     Content-Disposition: inline; filename="output.pdf"      │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Debugging Tips

### Enable Verbose Logging

All logs are prefixed for easy filtering:

```bash
# Filter multi-page logs
grep "\[MULTI-PAGE\]" logs.txt

# Filter basePdf conversion logs
grep "\[BASEPDF DEBUG\]" logs.txt

# Filter render logs
grep "\[RENDER\]" logs.txt

# Filter text splitting logs
grep "\[TEXT SPLIT\]" logs.txt
```

### Check Request Payload

```bash
curl -X POST http://localhost:3000/api/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d @tests/test-multipage-render.json \
  -o output.pdf
```

### Inspect Template Structure

```javascript
// Get template from DB
const template = await fetch('/api/templates/YOUR_ID').then(r => r.json());

// Check critical fields
console.log({
  hasSecondBasePdf: !!template._secondBasePdf,
  multiPageEnabled: !!template._multiPageEnabled,
  basePdfType: typeof template.basePdf,
  basePdfIsArray: Array.isArray(template.basePdf),
  schemasLength: template.schemas?.length,
  firstPageFields: template.schemas[0]?.length,
  secondPageFields: template.schemas[1]?.length
});
```

---

## 📝 Best Practices

### 1. **Always Use multiVariableText for Dynamic Content**
```javascript
// ✅ Good
{
  type: 'multiVariableText',
  name: 'content',
  // Don't set 'content' field - provide via inputs
}

// ❌ Bad
{
  type: 'text',  // Static text type
  content: '{{content}}'  // Won't interpolate
}
```

### 2. **Set Appropriate Field Dimensions**
```javascript
// Page 1: Less height (header takes space)
{
  width: 170,  // mm
  height: 180, // mm (e.g., if header is 50mm)
  fontSize: 11,
  lineHeight: 1.5
}

// Page 2+: Full height (no header)
{
  width: 170,
  height: 260, // mm (full content area)
  fontSize: 11,
  lineHeight: 1.5
}
```

### 3. **Test Text Capacity**
```javascript
// Formula: (width_mm * 2.83465) / (fontSize * 0.5) * (height_mm * 2.83465) / (fontSize * lineHeight)

// Example for 170mm x 180mm, 11pt font, 1.5 line height:
// Width: 170 * 2.83 / (11 * 0.5) ≈ 87 chars/line
// Height: 180 * 2.83 / (11 * 1.5) ≈ 30 lines
// Capacity: 87 * 30 ≈ 2600 characters

// Test with sample text of known length
```

### 4. **Upload Both Base PDFs in UI**
1. Click "Page 1 base" → Upload → Set your header PDF
2. Click "Page 2+ base" → Upload → Set your continuation PDF
3. Save template (this sets `_multiPageEnabled: true`)

### 5. **Use "Edit Layout" Buttons to Design Each Page**
- Click "📄 Page 1" to design first page layout
- Click "📑 Page 2+" to design continuation page layout
- Each page can have different field positions/sizes

---

## 🧪 Testing Checklist

Before deploying, verify:

- [ ] Single-page render works (text fits on 1 page)
- [ ] Multi-page render works (text overflows to page 2)
- [ ] Text splits at paragraph boundaries (not mid-word)
- [ ] Page 2+ uses correct base PDF
- [ ] Custom fonts load correctly
- [ ] Variable interpolation works (`{{variable}}` → value)
- [ ] n8n integration works (webhook receives PDF)
- [ ] Authentication works (Basic Auth + Bearer token)

---

## 📚 Related Files

- **Backend Logic**: [server.js:450-714](server.js:450-714) (render endpoint)
- **Text Splitting**: [server.js:200-314](server.js:200-314) (split helpers)
- **Frontend Template Builder**: [index.html:828-863](index.html:828-863) (getCompleteTemplate)
- **Frontend Template Loading**: [index.html:922-969](index.html:922-969) (loadTemplate)
- **Test Payload**: [tests/test-multipage-render.json](tests/test-multipage-render.json)

---

## 🆘 Still Having Issues?

1. **Check server logs** for `[RENDER ERROR]` messages
2. **Verify template structure** in database (use `/api/templates/:id`)
3. **Test with minimal payload** (single short text)
4. **Gradually increase complexity** (add variables, then multi-page)
5. **Compare with working example** (see test files)

If error persists, capture:
- Full request payload
- Server logs (from startup to error)
- Template JSON from database
- Browser console errors (if using UI)
