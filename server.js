import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const EDITOR_AUTH_TOKEN = process.env.EDITOR_AUTH_TOKEN || '';
const N8N_PREVIEW_WEBHOOK_URL = process.env.N8N_PREVIEW_WEBHOOK_URL || '';

// Security: Basic Auth for Editor UI
const EDITOR_USERNAME = process.env.EDITOR_USERNAME || '';
const EDITOR_PASSWORD = process.env.EDITOR_PASSWORD || '';

app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json({ limit: '10mb' }));

// Session-based auth middleware for editor UI
const sessionAuthMiddleware = (req, res, next) => {
  // Skip auth if no credentials configured
  if (!EDITOR_USERNAME || !EDITOR_PASSWORD) return next();

  // Allow access to login page, health check, debug endpoint, fonts, and index.html
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (req.path === '/api/health') return next(); // Public healthcheck for Railway
  if (req.path === '/api/debug/auth-config') return next();
  if (req.path.startsWith('/fonts/')) return next(); // Allow font files and fonts.json
  if (req.path === '/index.html' || req.path === '/') {
    // Allow index.html to load - it will check sessionStorage and redirect if needed
    return next();
  }

  // Skip Basic Auth for API endpoints EXCEPT /api/auth/verify
  // /api/auth/verify must check Basic Auth credentials
  // All other /api/* endpoints use Bearer token (handled by separate `auth` middleware)
  if (req.path.startsWith('/api/') && req.path !== '/api/auth/verify') return next();

  // Check for Basic Auth header (for static files like CSS, JS, etc.)
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    // Redirect to login page
    return res.redirect('/login.html');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username === EDITOR_USERNAME && password === EDITOR_PASSWORD) {
    console.log('[AUTH SUCCESS] User authenticated:', username);
    return next();
  }

  console.log('[AUTH FAILED] Invalid credentials for:', username);
  // Invalid credentials - redirect to login
  if (req.path === '/' || req.path === '/index.html') {
    return res.redirect('/login.html');
  }
  return res.status(401).send('Invalid credentials');
};

// Simple rate limiting for failed auth attempts
const authAttempts = new Map();
const MAX_AUTH_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

const rateLimitMiddleware = (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();

  if (!authAttempts.has(ip)) {
    authAttempts.set(ip, { count: 0, firstAttempt: now });
  }

  const record = authAttempts.get(ip);

  // Reset if window expired
  if (now - record.firstAttempt > ATTEMPT_WINDOW) {
    record.count = 0;
    record.firstAttempt = now;
  }

  // Block if too many attempts
  if (record.count >= MAX_AUTH_ATTEMPTS) {
    const timeLeft = Math.ceil((ATTEMPT_WINDOW - (now - record.firstAttempt)) / 60000);
    return res.status(429).send(`Too many failed attempts. Try again in ${timeLeft} minutes.`);
  }

  // Track failed attempts
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode === 401) {
      record.count++;
    } else if (res.statusCode === 200 && !req.path.startsWith('/api/')) {
      // Successful auth - reset counter
      authAttempts.delete(ip);
    }
    return originalSend.call(this, data);
  };

  next();
};

app.use(rateLimitMiddleware);
app.use(sessionAuthMiddleware);

// Set proper MIME types for font files before serving static files
app.use((req, res, next) => {
  if (req.path.endsWith('.otf')) {
    res.type('font/otf');
  } else if (req.path.endsWith('.ttf')) {
    res.type('font/ttf');
  } else if (req.path.endsWith('.woff')) {
    res.type('font/woff');
  } else if (req.path.endsWith('.woff2')) {
    res.type('font/woff2');
  }
  next();
});

app.use(express.static('public'));

// ---- TEMP request logger (za debug) ----
app.use((req, _res, next) => {
  console.log('[REQ]', req.method, req.url);
  next();
});

// Če nekdo zadene GET /api/render, vrnemo 405 da jasno vidimo metodo
app.get('/api/render', (_req, res) => {
  res.status(405).json({ error: 'Use POST /api/render' });
});

// ---- Postgres ----
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDb() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      template JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function auth(req, res, next) {
  if (!EDITOR_AUTH_TOKEN) return next(); // open access if no token set
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && token === EDITOR_AUTH_TOKEN) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ---- Variable interpolation helpers ----
function getByPath(source, path) {
  if (!source || !path) return undefined;
  const normalized = String(path).replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined;
  }, source);
}

function interpolateString(str, ctx) {
  if (!ctx) return String(str);
  return String(str).replace(/{{\s*([^}]+?)\s*}}/g, (_match, expr) => {
    const value = getByPath(ctx, expr.trim());
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); }
      catch { return ''; }
    }
    return String(value);
  });
}

function interpolateAll(obj, ctx) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return interpolateString(obj, ctx);
  if (Array.isArray(obj)) return obj.map((item) => interpolateAll(item, ctx));
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, interpolateAll(value, ctx)]));
  }
  return obj;
}

// Normalize spaces around punctuation to avoid leading .,!? on new lines
function normalizeTextSpacing(str) {
  if (typeof str !== 'string') return str;
  let s = str;
  // Remove space(s) before punctuation
  s = s.replace(/\s+([.,;:!?])/g, '$1');
  // Ensure single space after punctuation (except end of string/line)
  s = s.replace(/([.,;:!?])([^\s])/g, '$1 $2');
  // Collapse multiple spaces
  s = s.replace(/\s{2,}/g, ' ');
  return s.trim();
}

// ---- Multi-page text splitting helpers ----

/**
 * RENDER-BASED text capacity calculation using actual PDF font metrics
 * This simulates PDFme's text rendering to determine EXACTLY how much text fits
 * @param {string} text - Full text to measure
 * @param {number} widthMm - Frame width in mm
 * @param {number} heightMm - Frame height in mm
 * @param {number} fontSize - Font size in pt
 * @param {number} lineHeight - Line height multiplier
 * @param {Object} fontData - Optional embedded font data (from PDFme)
 * @returns {Promise<number>} - Actual character capacity based on rendering
 */
async function calculateTextCapacityWithRendering(text, widthMm, heightMm, fontSize = 11, lineHeight = 1.5, fontData = null, characterSpacing = 0) {
  try {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const fontkit = (await import('fontkit')).default;

    // Create temporary PDF to measure text
    const pdfDoc = await PDFDocument.create();

    // Register fontkit for custom font support (CRITICAL for accurate measurements)
    pdfDoc.registerFontkit(fontkit);

    // Load font (use standard font or custom if provided)
    let font;
    if (fontData && fontData.data) {
      // Custom font provided
      console.log('[CAPACITY] Loading custom font with fontkit support');
      const fontBytes = typeof fontData.data === 'string'
        ? await fetch(fontData.data).then(r => r.arrayBuffer())
        : fontData.data;
      font = await pdfDoc.embedFont(fontBytes);
      console.log('[CAPACITY] ✓ Custom font loaded successfully');
    } else {
      // Use standard Helvetica as fallback
      console.log('[CAPACITY] Using standard Helvetica font (no custom font)');
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    // Convert mm to pt, add 2mm padding (PDFme adds internal padding)
    const paddingPt = 2 * 2.83465; // 2mm padding top/bottom
    const widthPt = widthMm * 2.83465;
    const heightPt = (heightMm * 2.83465) - (paddingPt * 2); // Subtract padding from height
    const lineHeightPt = fontSize * lineHeight;

    // Calculate maximum number of lines that can fit (with padding consideration)
    const maxLines = Math.floor(heightPt / lineHeightPt);

    console.log(`[CAPACITY] Frame: ${widthMm}×${heightMm}mm (${widthPt.toFixed(2)}×${(heightMm * 2.83465).toFixed(2)}pt with ${paddingPt.toFixed(2)}pt padding)`);
    console.log(`[CAPACITY] Font: ${fontSize}pt, Line height: ${lineHeight}x (${lineHeightPt.toFixed(2)}pt per line)`);
    console.log(`[CAPACITY] Character spacing: ${characterSpacing}pt`);
    console.log(`[CAPACITY] Max lines available: ${maxLines}`);

    // Split text into paragraphs first (respect \n\n and \n)
    const paragraphs = text.split(/\n/);
    let lines = [];
    let charCount = 0;

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        // Empty line (paragraph break)
        if (lines.length < maxLines) {
          lines.push('');
          charCount += 1; // Count the newline
        } else {
          break;
        }
        continue;
      }

      // Word-wrap this paragraph
      const words = paragraph.split(/\s+/).filter(w => w.length > 0);
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;

        // Measure actual width with character spacing
        let testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (characterSpacing > 0) {
          testWidth += testLine.length * characterSpacing;
        }

        if (testWidth > widthPt && currentLine) {
          // Line is full - save it and start new line
          if (lines.length >= maxLines) {
            console.log(`[CAPACITY] Reached max lines (${maxLines}), stopping`);
            return charCount;
          }
          lines.push(currentLine);
          charCount += currentLine.length + 1; // +1 for space between lines
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      // Add last line of paragraph if we have room
      if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
        charCount += currentLine.length + 1; // +1 for newline at end of paragraph
      } else if (currentLine) {
        // No room for this line - return current capacity
        console.log(`[CAPACITY] No room for last line, stopping at ${charCount} chars`);
        return charCount;
      }
    }

    console.log(`[CAPACITY] ✓ Fits ${lines.length} lines, ${charCount} chars total`);
    console.log(`[CAPACITY] First 3 lines: ${lines.slice(0, 3).map(l => `"${l.substring(0, 40)}..."`).join(' | ')}`);
    console.log(`[CAPACITY] Last 3 lines: ${lines.slice(-3).map(l => `"${l.substring(0, 40)}..."`).join(' | ')}`);

    return charCount;
  } catch (error) {
    console.warn('[CAPACITY] Measurement failed, using estimation:', error.message);
    // Fallback to old calculation if rendering fails
    return calculateTextCapacityEstimate(widthMm, heightMm, fontSize, lineHeight);
  }
}

/**
 * FALLBACK: Estimate character capacity (used if render-based fails)
 * @param {number} width - Frame width in mm
 * @param {number} height - Frame height in mm
 * @param {number} fontSize - Font size in pt
 * @param {number} lineHeight - Line height multiplier
 * @returns {number} - Estimated character capacity
 */
function calculateTextCapacityEstimate(width, height, fontSize = 11, lineHeight = 1.5) {
  const widthPt = width * 2.83465;
  const heightPt = height * 2.83465;

  // Less aggressive character width estimation (0.42 instead of 0.48)
  // This allows MORE characters per line for better frame filling
  const avgCharWidth = fontSize * 0.42;

  // Use full width (removed 0.95 factor)
  const usableWidthPt = widthPt;
  const charsPerLine = Math.floor(usableWidthPt / avgCharWidth);

  const lineHeightPt = fontSize * lineHeight;

  // Use more of available height (0.95 instead of 0.90)
  const usableHeightPt = heightPt * 0.95;
  const linesPerPage = Math.floor(usableHeightPt / lineHeightPt);

  // Less aggressive capacity reduction (0.92 instead of 0.85)
  const capacity = Math.floor(charsPerLine * linesPerPage * 0.92);

  console.log(`[ESTIMATED CAPACITY] ${width}mm×${height}mm → ${capacity} chars (fallback mode - less conservative)`);
  return capacity;
}

/**
 * Split text intelligently at word/paragraph boundaries
 * @param {string} text - Full text to split
 * @param {number} firstPageCapacity - Character capacity for first page
 * @param {number} continuationPageCapacity - Character capacity for continuation pages
 * @returns {string[]} - Array of text chunks for each page
 */
function splitTextIntelligently(text, firstPageCapacity, continuationPageCapacity) {
  if (!text || typeof text !== 'string') return [text || ''];

  // If text fits on first page, no splitting needed
  if (text.length <= firstPageCapacity) {
    console.log(`[TEXT SPLIT] Text fits on single page (${text.length} chars <= ${firstPageCapacity} capacity)`);
    return [text];
  }

  const pages = [];
  let remainingText = text;
  let currentCapacity = firstPageCapacity;
  let pageNum = 1;

  while (remainingText.length > 0) {
    console.log(`[TEXT SPLIT] Page ${pageNum}: Capacity=${currentCapacity}, Remaining=${remainingText.length} chars`);

    if (remainingText.length <= currentCapacity) {
      // Remaining text fits on this page
      pages.push(remainingText);
      break;
    }

    // Find a good break point (prefer paragraph, then sentence, then word)
    let breakPoint = currentCapacity;

    // Look for paragraph break (double newline) within capacity
    const paragraphBreak = remainingText.lastIndexOf('\n\n', currentCapacity);
    if (paragraphBreak > currentCapacity * 0.5) {
      // Found paragraph break in reasonable position (> 50% of capacity)
      breakPoint = paragraphBreak + 2; // Include the newlines
      console.log(`[TEXT SPLIT] Page ${pageNum}: Breaking at paragraph (pos ${breakPoint})`);
    }
    // Look for sentence break (. or ! or ?) within capacity
    else {
      const sentenceBreak = Math.max(
        remainingText.lastIndexOf('. ', currentCapacity),
        remainingText.lastIndexOf('! ', currentCapacity),
        remainingText.lastIndexOf('? ', currentCapacity)
      );
      if (sentenceBreak > currentCapacity * 0.6) {
        // Found sentence break in reasonable position (> 60% of capacity)
        breakPoint = sentenceBreak + 2; // Include period and space
        console.log(`[TEXT SPLIT] Page ${pageNum}: Breaking at sentence (pos ${breakPoint})`);
      }
      // Look for word break (space) within capacity
      else {
        const wordBreak = remainingText.lastIndexOf(' ', currentCapacity);
        if (wordBreak > currentCapacity * 0.7) {
          // Found word break in reasonable position (> 70% of capacity)
          breakPoint = wordBreak + 1; // Include the space
          console.log(`[TEXT SPLIT] Page ${pageNum}: Breaking at word (pos ${breakPoint})`);
        } else {
          // Fallback: hard break at capacity (avoid cutting words if possible)
          console.log(`[TEXT SPLIT] Page ${pageNum}: Hard break at capacity (no good break point found)`);
        }
      }
    }

    // Extract chunk for this page
    const chunk = remainingText.substring(0, breakPoint).trim();
    pages.push(chunk);

    // Update remaining text
    remainingText = remainingText.substring(breakPoint).trim();

    // Switch to continuation page capacity for subsequent pages
    currentCapacity = continuationPageCapacity;
    pageNum++;
  }

  console.log(`[TEXT SPLIT] Split into ${pages.length} pages: ${pages.map((p, i) => `Page${i + 1}=${p.length}chars`).join(', ')}`);

  return pages;
}

// Load custom fonts from public/fonts directory
function loadCustomFonts() {
  try {
    const fontsJsonPath = join(__dirname, 'public', 'fonts', 'fonts.json');
    if (!existsSync(fontsJsonPath)) {
      console.log('[FONTS] No fonts.json found, using default fonts');
      return {};
    }

    const fontConfig = JSON.parse(readFileSync(fontsJsonPath, 'utf-8'));
    const fonts = {};
    let fallbackSet = false;

    for (const [fontName, fontPath] of Object.entries(fontConfig)) {
      const fullPath = join(__dirname, 'public', 'fonts', fontPath);
      if (existsSync(fullPath)) {
        console.log(`[FONTS] Loading ${fontName} from ${fontPath}...`);
        // First valid font becomes fallback
        const isFallback = !fallbackSet;
        fonts[fontName] = {
          data: readFileSync(fullPath),
          fallback: isFallback
        };
        if (isFallback) {
          fallbackSet = true;
          console.log(`[FONTS] Set ${fontName} as fallback font`);
        }
      } else {
        console.warn(`[FONTS] Font file not found: ${fullPath}`);
      }
    }

    // If no fonts loaded, return empty object (PDFme will use default)
    if (Object.keys(fonts).length === 0) {
      console.log('[FONTS] No valid fonts found, using PDFme defaults');
      return {};
    }

    // Ensure exactly one font has fallback: true
    if (!fallbackSet) {
      const firstFont = Object.keys(fonts);
      if (firstFont.length > 0) {
        fonts[firstFont[0]].fallback = true;
        console.log(`[FONTS] Set ${firstFont[0]} as fallback font`);
      }
    }

    console.log('[FONTS] Loaded fonts:', Object.keys(fonts));
    return fonts;
  } catch (e) {
    console.warn('[FONTS] Error loading fonts:', e.message);
    return {};
  }
}

// Public health check endpoint for Railway healthcheck
// Does NOT require authentication
app.get('/api/health', (req, res) => {
  console.log('[HEALTH CHECK] Public endpoint');
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Authentication verification endpoint for login.html
// This endpoint REQUIRES Basic Auth and is used to verify credentials
app.get('/api/auth/verify', (req, res) => {
  console.log('[AUTH VERIFY] Credentials verified successfully');
  res.json({ ok: true, authenticated: true });
});

// Debug endpoint to check environment variables (remove in production)
app.get('/api/debug/auth-config', (req, res) => {
  res.json({
    hasUsername: !!EDITOR_USERNAME,
    hasPassword: !!EDITOR_PASSWORD,
    usernameLength: EDITOR_USERNAME ? EDITOR_USERNAME.length : 0,
    passwordLength: EDITOR_PASSWORD ? EDITOR_PASSWORD.length : 0,
    authEnabled: !!(EDITOR_USERNAME && EDITOR_PASSWORD)
  });
});

// List
app.get('/api/templates', auth, async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, created_at, updated_at FROM templates ORDER BY updated_at DESC LIMIT 200'
  );
  res.json(rows);
});

// Read one
app.get('/api/templates/:id', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, template, created_at, updated_at FROM templates WHERE id = $1',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Create
app.post('/api/templates', auth, async (req, res) => {
  const { name, template } = req.body || {};
  if (!name || !template) return res.status(400).json({ error: 'name and template required' });
  const { rows } = await pool.query(
    'INSERT INTO templates (name, template) VALUES ($1, $2) RETURNING id, name, template, created_at, updated_at',
    [name, template]
  );
  res.status(201).json(rows[0]);
});

// Update
app.put('/api/templates/:id', auth, async (req, res) => {
  const { name, template } = req.body || {};
  const { id } = req.params;
  const sets = [];
  const vals = [];
  if (name) { sets.push(`name = $${sets.length + 1}`); vals.push(name); }
  if (template) { sets.push(`template = $${sets.length + 1}`); vals.push(template); }
  if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE templates SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length}
     RETURNING id, name, template, created_at, updated_at`,
    vals
  );
  res.json(rows[0]);
});

// Delete
app.delete('/api/templates/:id', auth, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM templates WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Not found' });
  return res.status(204).send();
});

// Render (server-side PDF generation without n8n)
app.post('/api/render', auth, async (req, res) => {
  try {
    const { template: tplFromBody, templateId, inputs, usePlugins, fileName } = req.body || {};
    if (!tplFromBody && !templateId) {
      return res.status(400).json({ error: 'Provide either template or templateId' });
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return res.status(400).json({ error: 'inputs must be a non-empty array' });
    }

    // Load template from DB if needed
    let template = tplFromBody;
    if (!template && templateId) {
      const { rows } = await pool.query('SELECT template FROM templates WHERE id = $1', [templateId]);
      if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
      template = rows[0].template;
    }

    const { generate } = await import('@pdfme/generator');
    const schemas = await import('@pdfme/schemas');

    // Only include plugins that exist in @pdfme/schemas v5.3.0
    const plugins = {
      text: schemas.text,
      multiVariableText: schemas.multiVariableText,
      image: schemas.image,
      svg: schemas.svg
    };

    // Load custom fonts
    const customFonts = loadCustomFonts();

    // Build inputs object that matches schema names with interpolated content
    const pdfs = [];
    for (const inputItem of inputs) {
      // Create context by merging global context with current item
      const ctx = req.body.context ? { ...req.body.context, ...inputItem } : inputItem;
      console.log('[RENDER] Input context:', JSON.stringify(ctx, null, 2));

      // Build PDFme inputs by scanning schemas and creating matching keys
      const pdfInputData = {};

      if (template.schemas && Array.isArray(template.schemas)) {
        template.schemas.forEach(pageSchemas => {
          if (!Array.isArray(pageSchemas)) return;
          pageSchemas.forEach(schema => {
            // Get the field name (PDFme matches inputs by schema.name)
            const fieldName = schema.name;
            if (!fieldName) return;

            // Check if content has {{variable}} syntax
            const content = schema.content || schema.text || '';
            if (typeof content === 'string' && content.includes('{{')) {
              // Interpolate the content with context data
              const interpolatedValue = interpolateString(content, ctx);
              pdfInputData[fieldName] = normalizeTextSpacing(interpolatedValue);
              console.log(`[RENDER] Field "${fieldName}": "${content}" -> "${interpolatedValue}"`);
            } else if (ctx[fieldName] !== undefined) {
              // Direct mapping: use value from context if it exists
              const mapped = ctx[fieldName];
              pdfInputData[fieldName] = typeof mapped === 'string' ? normalizeTextSpacing(mapped) : mapped;
              console.log(`[RENDER] Field "${fieldName}": direct mapping -> "${pdfInputData[fieldName]}"`);
            } else if (content && typeof content === 'string') {
              // If schema has content but no matching variable, use it directly
              pdfInputData[fieldName] = normalizeTextSpacing(content);
              console.log(`[RENDER] Field "${fieldName}": using schema content directly`);
            }
          });
        });
      }

      console.log('[RENDER] Final PDFme inputs:', JSON.stringify(pdfInputData, null, 2));

      // CRITICAL FIX: Clean template schemas before processing
      // Remove 'content' field from text/multiVariableText schemas to prevent JSON validation errors
      // PDFme expects content to be provided via inputs array, not in schema
      const cleanedTemplate = JSON.parse(JSON.stringify(template)); // Deep clone
      if (cleanedTemplate.schemas && Array.isArray(cleanedTemplate.schemas)) {
        cleanedTemplate.schemas.forEach(pageSchemas => {
          if (!Array.isArray(pageSchemas)) return;
          pageSchemas.forEach(schema => {
            if ((schema.type === 'text' || schema.type === 'multiVariableText') && schema.content) {
              // Store original content for reference but remove from schema
              schema._originalContent = schema.content;
              delete schema.content;
              console.log(`[RENDER] Initial cleaning: removed content from ${schema.name} (${schema.type})`);
            }
          });
        });
      }

      // Extract base PDFs as strings
      let firstBasePdfString, secondBasePdfString;

      if (typeof template.basePdf === 'string') {
        firstBasePdfString = template.basePdf;
      } else if (Array.isArray(template.basePdf)) {
        firstBasePdfString = template.basePdf[0];
      } else if (typeof template.basePdf === 'object' && template.basePdf !== null) {
        firstBasePdfString = template.basePdf['0'] || template.basePdf[0] || Object.values(template.basePdf)[0];
      } else {
        firstBasePdfString = template.basePdf;
      }

      secondBasePdfString = template._secondBasePdf;

      console.log('[RENDER] First basePdf type:', typeof firstBasePdfString);
      console.log('[RENDER] Second basePdf exists:', !!secondBasePdfString);
      console.log('[RENDER] Multi-page enabled:', !!template._multiPageEnabled);

      // Check if multi-page text layout is enabled
      const schemas = cleanedTemplate.schemas || [[]];
      let generateMultiplePDFs = false;
      let textChunks = [];

      if (template._multiPageEnabled && schemas.length >= 2 && secondBasePdfString) {
        console.log('[MULTI-PAGE] Multi-page layout detected with', schemas.length, 'pages');

        const firstPageSchema = schemas[0] || [];
        const secondPageSchema = schemas[1] || [];

        // Find text fields in both pages (support both 'text' and 'multiVariableText' types)
        const firstPageTextField = firstPageSchema.find(field => field.type === 'text' || field.type === 'multiVariableText');
        const secondPageTextField = secondPageSchema.find(field => field.type === 'text' || field.type === 'multiVariableText');

        if (firstPageTextField && secondPageTextField) {
          const fieldName = firstPageTextField.name;
          const fieldText = normalizeTextSpacing(pdfInputData[fieldName]);
          pdfInputData[fieldName] = fieldText; // Keep normalized for rendering and capacity calc

          if (fieldText && typeof fieldText === 'string') {
            console.log(`[MULTI-PAGE] Processing field "${fieldName}" with ${fieldText.length} characters`);

            // Calculate text capacity using RENDER-BASED measurement (actual font metrics)
            // This simulates PDFme's rendering to determine EXACTLY how much text fits
            const firstPageCapacity = await calculateTextCapacityWithRendering(
              fieldText, // Pass actual text for measurement
              firstPageTextField.width || 170,
              firstPageTextField.height || 180,
              firstPageTextField.fontSize || firstPageTextField.size || 11, // Support both fontSize and size
              firstPageTextField.lineHeight || 1.5,
              customFonts[firstPageTextField.fontName] || null, // Pass custom font if available
              firstPageTextField.characterSpacing || 0 // Pass character spacing
            );

            const continuationCapacity = await calculateTextCapacityWithRendering(
              fieldText, // Pass actual text for measurement
              secondPageTextField.width || 170,
              secondPageTextField.height || 260,
              secondPageTextField.fontSize || secondPageTextField.size || 11, // Support both fontSize and size
              secondPageTextField.lineHeight || 1.5,
              customFonts[secondPageTextField.fontName] || null, // Pass custom font if available
              secondPageTextField.characterSpacing || 0 // Pass character spacing
            );

            // Split text if it exceeds first page capacity
            if (fieldText.length > firstPageCapacity) {
              textChunks = splitTextIntelligently(fieldText, firstPageCapacity, continuationCapacity);
              console.log(`[MULTI-PAGE] Split text into ${textChunks.length} pages - will generate separate PDFs and merge`);
              generateMultiplePDFs = true;
            } else {
              console.log(`[MULTI-PAGE] Text fits on single page, using Page 1 layout only`);
            }
          }
        } else {
          console.log('[MULTI-PAGE] No multiVariableText fields found on both pages');
        }
      }

      // Generate PDF(s) - use different strategy for multi-page with different base PDFs
      let u8;

      if (generateMultiplePDFs) {
        // NEW APPROACH: Generate separate PDFs and merge with pdf-lib
        console.log('[MULTI-PAGE-MERGE] Generating separate PDFs for each page');

        const { PDFDocument } = await import('pdf-lib');
        const mergedPdf = await PDFDocument.create();

        // Get field name and schemas (ALREADY CLEANED - no content fields!)
        const firstPageSchema = schemas[0];
        const secondPageSchema = schemas[1];
        const fieldName = firstPageSchema.find(f => f.type === 'text' || f.type === 'multiVariableText')?.name;

        console.log('[MULTI-PAGE-MERGE] First page schema fields:', firstPageSchema.map(f => `${f.name} (${f.type}) content=${!!f.content}`));
        console.log('[MULTI-PAGE-MERGE] Second page schema fields:', secondPageSchema.map(f => `${f.name} (${f.type}) content=${!!f.content}`));

        // CRITICAL: Ensure no content fields exist in schemas before generation
        const cleanFirstPageSchema = firstPageSchema.map(field => {
          if ((field.type === 'text' || field.type === 'multiVariableText') && field.content) {
            const { content, ...cleanField } = field;
            console.log(`[MULTI-PAGE-MERGE] Removed content from ${field.name} (${field.type}) in Page 1 schema`);
            return cleanField;
          }
          return field;
        });

        const cleanSecondPageSchema = secondPageSchema.map(field => {
          if ((field.type === 'text' || field.type === 'multiVariableText') && field.content) {
            const { content, ...cleanField } = field;
            console.log(`[MULTI-PAGE-MERGE] Removed content from ${field.name} (${field.type}) in Page 2 schema`);
            return cleanField;
          }
          return field;
        });

        // Generate options
        const generateOptions = {};
        if (Object.keys(customFonts).length > 0) {
          generateOptions.font = customFonts;
        }

        // Generate Page 1
        console.log('[MULTI-PAGE-MERGE] Generating Page 1 with first basePdf');
        const page1InputData = { [fieldName]: textChunks[0] };
        const page1Template = {
          basePdf: firstBasePdfString, // STRING format - valid!
          schemas: [cleanFirstPageSchema] // CLEANED schema without content field
        };
        const page1Pdf = await generate({
          template: page1Template,
          inputs: [page1InputData],
          plugins,
          options: generateOptions
        });
        const page1Doc = await PDFDocument.load(page1Pdf);
        const page1Pages = await mergedPdf.copyPages(page1Doc, page1Doc.getPageIndices());
        page1Pages.forEach(page => mergedPdf.addPage(page));
        console.log('[MULTI-PAGE-MERGE] Added Page 1');

        // Generate continuation pages (Page 2, 3, 4, ...)
        for (let i = 1; i < textChunks.length; i++) {
          console.log(`[MULTI-PAGE-MERGE] Generating Page ${i + 1} with second basePdf`);
          const pageInputData = { [fieldName]: textChunks[i] };
          const pageTemplate = {
            basePdf: secondBasePdfString, // STRING format - valid!
            schemas: [cleanSecondPageSchema] // CLEANED schema without content field
          };
          const pagePdf = await generate({
            template: pageTemplate,
            inputs: [pageInputData],
            plugins,
            options: generateOptions
          });
          const pageDoc = await PDFDocument.load(pagePdf);
          const pagePages = await mergedPdf.copyPages(pageDoc, pageDoc.getPageIndices());
          pagePages.forEach(page => mergedPdf.addPage(page));
          console.log(`[MULTI-PAGE-MERGE] Added Page ${i + 1}`);
        }

        u8 = await mergedPdf.save();
        console.log(`[MULTI-PAGE-MERGE] Successfully merged ${textChunks.length} pages into single PDF`);
      } else {
        // Standard single-page generation
        console.log('[RENDER] Generating single-page PDF');

        // CRITICAL: Clean schema to remove content field
        const cleanSinglePageSchema = schemas[0].map(field => {
          if ((field.type === 'text' || field.type === 'multiVariableText') && field.content) {
            const { content, ...cleanField } = field;
            console.log(`[RENDER] Removed content from ${field.name} (${field.type}) in single-page schema`);
            return cleanField;
          }
          return field;
        });

        const singlePageTemplate = {
          basePdf: firstBasePdfString, // STRING format - valid!
          schemas: [cleanSinglePageSchema] // CLEANED schema without content field
        };

        const generateOptions = {};
        if (Object.keys(customFonts).length > 0) {
          generateOptions.font = customFonts;
        }

        u8 = await generate({
          template: singlePageTemplate,
          inputs: [pdfInputData],
          plugins,
          options: generateOptions
        });
        console.log('[RENDER] Single-page PDF generated successfully');
      }

      pdfs.push(u8);
    }

    // If single input, return single PDF; otherwise merge PDFs
    let finalPdf;
    if (pdfs.length === 1) {
      finalPdf = pdfs[0];
    } else {
      // For multiple inputs, concatenate PDFs (simple approach - just return first for now)
      // TODO: Implement proper PDF merging if needed
      finalPdf = pdfs[0];
    }

    const buf = Buffer.from(finalPdf);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${(fileName || 'output')}.pdf"`);
    res.send(buf);
  } catch (e) {
    console.error('[RENDER ERROR] Full error:', e);
    console.error('[RENDER ERROR] Stack:', e.stack);
    res.status(500).json({
      error: 'render error',
      message: e.message,
      details: e.toString()
    });
  }
});

// Optional legacy: proxy Preview to n8n webhook if you ever set N8N_PREVIEW_WEBHOOK_URL
app.post('/api/preview', auth, async (req, res) => {
  try {
    if (!N8N_PREVIEW_WEBHOOK_URL) return res.status(400).json({ error: 'N8N_PREVIEW_WEBHOOK_URL not set' });
    const r = await fetch(N8N_PREVIEW_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) });
    if (!r.ok) return res.status(r.status).json({ error: 'n8n preview failed' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'preview error' });
  }
});

// Compose - merge multiple PDFs into one
app.post('/api/compose', auth, async (req, res) => {
  try {
    const { pages, fileName } = req.body || {};
    if (!Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages array is required' });
    }

    console.log(`[Compose API] Composing ${pages.length} pages`);

    // Use pdf-lib to merge PDFs
    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // Extract PDF data from data URL
      let pdfData;
      if (page.staticPdfDataUrl && page.staticPdfDataUrl.startsWith('data:')) {
        // Extract base64 data from data URL
        const base64Data = page.staticPdfDataUrl.split(',')[1];
        if (!base64Data) {
          console.error(`[Compose API] Page ${i}: Invalid data URL format`);
          continue;
        }
        pdfData = Buffer.from(base64Data, 'base64');
      } else {
        console.error(`[Compose API] Page ${i}: Missing staticPdfDataUrl`);
        continue;
      }

      try {
        const sourcePdf = await PDFDocument.load(pdfData);
        const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        console.log(`[Compose API] Added page ${i + 1} (${copiedPages.length} pages from source)`);
      } catch (error) {
        console.error(`[Compose API] Error loading page ${i}:`, error.message);
      }
    }

    const pdfBytes = await mergedPdf.save();
    console.log(`[Compose API] Final PDF size: ${pdfBytes.length} bytes, total pages: ${mergedPdf.getPageCount()}`);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${fileName || 'document'}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('[Compose API] Error:', e);
    res.status(500).json({
      error: 'compose error',
      message: e.message,
      details: e.toString()
    });
  }
});

// Initialize database (skip if DB not available for local testing)
try {
  await initDb();
  console.log('[DB] PostgreSQL connected and initialized');
} catch (e) {
  console.warn('[DB] PostgreSQL connection failed - running without database (templates won\'t persist)');
  console.warn('[DB] Error:', e.message);
}

app.listen(port, () => console.log(`PDFme Editor running on :${port}`));
  
