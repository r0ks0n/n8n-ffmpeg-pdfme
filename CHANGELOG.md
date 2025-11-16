# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2024-11-16 - Multi-Page Fix & Enhancement

### 🔥 Critical Fixes

#### Fixed `[@pdfme/common] Invalid argument: template.basePdf` Error
- **Issue**: PDFme v5 rejected `basePdf` as array `[pdf1, pdf2]`
- **Solution**: Convert to object format `{ '0': pdf1, '1': pdf2 }` before generation
- **Files Changed**:
  - `server.js:642-651` - Automatic array→object conversion with safety check
  - `index.html:850-853` - Template saving now uses object format
  - `index.html:937-956` - Template loading handles both array and object formats

#### Fixed `invalid JSON string for variables in field content` Error
- **Issue**: PDFme's `multiVariableText` validates `content` field as JSON
- **Root Cause**: We were passing plain text strings which failed JSON validation
- **Solution**: Remove `content` field from schemas before generation; provide all data via `inputs` array
- **Files Changed**:
  - `server.js:523-538` - Clean schemas by removing `content` field
  - `server.js:512-516` - Fallback to use schema content if no input provided

### ✨ New Features

#### Enhanced basePdf Format Handling
- Support for 3 formats: string (single PDF), array (legacy), object (v5 standard)
- Automatic conversion between formats for backward compatibility
- Detailed debug logging for troubleshooting

#### Improved Input Data Mapping
- Direct mapping: `inputs[0].fieldName` → schema field
- Variable interpolation: `{{variable}}` in schema → resolved from inputs
- Schema content fallback: Use schema content if no input provided

### 🔧 Improvements

#### Better Debugging
- Added `[BASEPDF DEBUG]` logs with detailed format inspection
- Added `[RENDER]` logs showing field mapping process
- Added `[MULTI-PAGE]` logs for page generation tracking

#### Code Quality
- Deep clone template before modification (prevents mutation)
- Preserve original content as `_originalContent` for reference
- Consistent string key format for basePdf object (`'0'`, `'1'` not `/0`, `/1`)

### 📚 Documentation

#### New Documents
- `docs/MULTI_PAGE_TROUBLESHOOTING.md` - Comprehensive debugging guide
- `docs/N8N_INTEGRATION_GUIDE.md` - n8n workflow examples and API reference
- `tests/test-multipage-render.json` - Sample test payload

#### Updated Documents
- `Documentation.md` - Added troubleshooting section
- `README.md` - Added changelog reference

---

## [0.2.0] - 2024-11-15 - Multi-Page Support

### ✨ Features Added

#### Multi-Page Base PDF Support
- Upload different PDFs for Page 1 and Page 2+
- Page Layout Switch UI for editing individual page layouts
- Template stores both PDFs: `basePdf` (Page 1) and `_secondBasePdf` (Page 2+)

#### Automatic Text Splitting
- Intelligent text splitting at paragraph/sentence/word boundaries
- Dynamic page generation based on text length
- Capacity calculation from field dimensions + font size

#### Template Variable Detection
- Scan template for `{{variable}}` placeholders
- Generate n8n config with variable mapping
- Quick Add AI Field button for rapid setup

### 🔧 Improvements

#### UI Enhancements
- Dual base PDF upload controls in subbar
- Page switch buttons (Page 1 / Page 2+) when multi-page enabled
- Status badges showing which PDFs are loaded

#### Backend Logic
- Text capacity calculation: `calculateTextCapacity()`
- Intelligent splitting: `splitTextIntelligently()`
- Multi-page schema generation with dynamic continuation pages

---

## [0.1.0] - 2024-11-10 - Initial Release

### ✨ Core Features

#### PDFme Designer Integration
- Web-based template editor using PDFme Designer
- Template CRUD (Create, Read, Update, Delete)
- PostgreSQL persistence

#### Variable Interpolation
- `{{variable}}` syntax for dynamic content
- Dot notation support: `{{user.firstName}}`
- Array indexing: `{{items[0].value}}`

#### Security
- HTTP Basic Auth for editor UI (optional)
- Bearer token auth for API endpoints
- Rate limiting (5 attempts / 15 minutes)

#### n8n Integration
- REST API for PDF generation
- Preview endpoint (optional n8n webhook proxy)
- Custom font support

---

## Version History Summary

| Version | Date | Key Features |
|---------|------|--------------|
| 0.3.0 | 2024-11-16 | 🔥 Critical basePdf format fix, multiVariableText validation fix |
| 0.2.0 | 2024-11-15 | ✨ Multi-page support, text splitting, page layout editor |
| 0.1.0 | 2024-11-10 | 🎉 Initial release with basic template editor and n8n integration |

---

## Migration Guides

### Upgrading from 0.2.0 to 0.3.0

**No breaking changes** - All existing templates will automatically work.

**What's different:**
- Templates saved with array `basePdf` are automatically converted to object format on render
- Old templates will continue to load correctly

**Action required:**
- None - Update is transparent

**Recommended:**
- Re-save existing multi-page templates to use new object format (optional)
- Test rendering with your existing templates
- Review new debugging logs if issues occur

### Upgrading from 0.1.0 to 0.2.0

**Breaking changes:**
- None for single-page templates
- Multi-page requires uploading Page 2+ base PDF

**Action required:**
1. For multi-page templates: Upload "Page 2+ base" PDF in editor
2. Save template (sets `_multiPageEnabled: true`)
3. Test rendering with long text

---

## Known Issues & Limitations

### Current Limitations
- Text splitting works only for `multiVariableText` fields (not plain `text`)
- Maximum ~20 pages per document (performance degrades after)
- Custom fonts must be uploaded manually (no UI for font management)
- Page 2+ uses same PDF for all continuation pages (can't vary by page number)

### Planned Features (Future Releases)
- [ ] UI for custom font upload/management
- [ ] Per-page base PDF control (different PDF for pages 3, 4, 5...)
- [ ] Template preview with sample data before saving
- [ ] Batch PDF generation (multiple documents in one request)
- [ ] PDF composition API improvements (merge multiple templates)
- [ ] Background job queue for large documents

---

## Deprecation Notices

### Deprecated (will be removed in 1.0.0)
- `/api/preview` endpoint (legacy n8n webhook proxy)
  - **Alternative**: Use `/api/render` directly
  - **Reason**: Redundant, adds unnecessary complexity

### Removed in 0.3.0
- None

---

## Contributors

- **Rok** - Initial development and multi-page implementation
- **Claude** - Code assistance, debugging, documentation

---

## License

This project is private and proprietary.

---

## Support

For issues, bugs, or feature requests:
1. Check [MULTI_PAGE_TROUBLESHOOTING.md](docs/MULTI_PAGE_TROUBLESHOOTING.md)
2. Review [N8N_INTEGRATION_GUIDE.md](docs/N8N_INTEGRATION_GUIDE.md)
3. Check server logs for error details
4. Open GitHub issue (if repository is public)
