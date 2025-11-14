# Custom Fonts for PDFme Editor

## Quick Start

By default, PDFme uses **Roboto Regular** font. To add custom fonts:

### 1. Download Font Files

Get TTF or OTF font files from:
- **Google Fonts**: https://fonts.google.com (free, open source)
- **Font Squirrel**: https://www.fontsquirrel.com (free for commercial use)
- **Adobe Fonts**: https://fonts.adobe.com (subscription)

### 2. Place Font Files Here

Copy your `.ttf` or `.otf` files to this directory:

```
public/fonts/
├── fonts.json          ← Configuration file
├── Roboto-Bold.ttf     ← Your font file
└── OpenSans-Regular.ttf ← Another font file
```

### 3. Update fonts.json

Edit `fonts.json` to register your fonts:

```json
{
  "RobotoBold": "Roboto-Bold.ttf",
  "OpenSans": "OpenSans-Regular.ttf"
}
```

**Key rules:**
- Use any name you want as the key (e.g., `"RobotoBold"`)
- Value must match the exact filename
- First font in the list becomes the fallback font

### 4. Restart Server

```bash
npm start
```

### 5. Use in Templates

Fonts are now available in:
- PDFme Designer UI font dropdown
- Template schemas via `fontName` property:
  ```javascript
  {
    type: "text",
    fontName: "RobotoBold",  // Matches key in fonts.json
    content: "Hello World"
  }
  ```

## Example Configuration

Here's a complete example with multiple fonts:

**fonts.json:**
```json
{
  "NotoSerifJP": "NotoSerifJP-Regular.ttf",
  "RobotoBold": "Roboto-Bold.ttf",
  "OpenSans": "OpenSans-Regular.ttf"
}
```

**Directory structure:**
```
public/fonts/
├── fonts.json
├── NotoSerifJP-Regular.ttf
├── Roboto-Bold.ttf
└── OpenSans-Regular.ttf
```

## Default Fallback Font

The font marked with `fallback: true` in the configuration will be used when:
- No font is specified in a field
- A specified font is not found
- Characters are not supported by the current font

By default, `NotoSerifJP` is set as the fallback font. You can change this by:
1. Editing `loadCustomFonts()` in `server.js` (line ~202)
2. Editing `loadCustomFonts()` in `index.html` (line ~234)

## Recommended Fonts for Multilingual Support

- **Japanese**: Noto Serif JP, Noto Sans JP
- **Chinese**: Noto Sans SC, Noto Serif SC
- **Korean**: Noto Sans KR, Noto Serif KR
- **Arabic**: Noto Sans Arabic, Noto Naskh Arabic
- **Western**: Roboto, Open Sans, Lato, Montserrat

## Troubleshooting

### Font not showing in dropdown
- Check that `fonts.json` is valid JSON
- Verify font file path in `fonts.json` matches actual filename
- Restart the server after adding new fonts
- Check browser console for font loading errors

### Font not rendering in PDF
- Ensure font supports the characters you're using
- Check server logs for font loading errors
- Verify font file is not corrupted (test in Font Book on Mac, or Font Viewer on Windows)
- Make sure font file size is reasonable (< 5MB recommended)

### Characters showing as boxes (Tofu)
- Current font doesn't support those characters
- Add a fallback font that supports those characters
- Use a comprehensive font like Noto Sans

## Font Subsetting (Performance)

PDFme automatically subsets fonts by default to reduce PDF file size. This means only the characters used in your document are embedded.

To disable subsetting (include entire font in PDF):
```javascript
// In fonts.json or font configuration
{
  "MyFont": {
    "data": "MyFont.ttf",
    "subset": false  // Disable subsetting
  }
}
```

## License Considerations

⚠️ **Important**: Make sure you have the right to use and distribute any fonts you add!

- Check the font license before using it in production
- Google Fonts are generally free and open source
- Commercial fonts may require licensing for server use
- Some free fonts are only for personal use

## Example fonts.json

```json
{
  "NotoSerifJP": "NotoSerifJP-Regular.ttf",
  "NotoSansJP": "NotoSansJP-Regular.ttf",
  "Roboto": "Roboto-Regular.ttf",
  "RobotoBold": "Roboto-Bold.ttf",
  "OpenSans": "OpenSans-Regular.ttf",
  "Montserrat": "Montserrat-Regular.ttf"
}
```
