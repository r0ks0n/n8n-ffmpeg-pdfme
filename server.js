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

  // Allow access to login page, health check, debug endpoint, and index.html
  if (req.path === '/login.html' || req.path === '/login') return next();
  if (req.path === '/api/health') return next(); // Public healthcheck for Railway
  if (req.path === '/api/debug/auth-config') return next();
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
        fonts[fontName] = {
          data: readFileSync(fullPath),
          fallback: !fallbackSet && fontName === 'NotoSerifJP' // Only first valid font gets fallback
        };
        if (fontName === 'NotoSerifJP') fallbackSet = true;
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
              pdfInputData[fieldName] = interpolatedValue;
              console.log(`[RENDER] Field "${fieldName}": "${content}" -> "${interpolatedValue}"`);
            } else if (ctx[fieldName] !== undefined) {
              // Direct mapping: use value from context if it exists
              pdfInputData[fieldName] = ctx[fieldName];
              console.log(`[RENDER] Field "${fieldName}": direct mapping -> "${ctx[fieldName]}"`);
            }
          });
        });
      }

      console.log('[RENDER] Final PDFme inputs:', JSON.stringify(pdfInputData, null, 2));

      // Generate PDF with original template, custom inputs, and custom fonts
      const u8 = await generate({
        template,
        inputs: [pdfInputData],
        plugins,
        options: { font: customFonts }
      });
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
      return res.status(400).json({ error: 'pages must be a non-empty array' });
    }

    console.log(`[COMPOSE] Merging ${pages.length} pages...`);

    const { PDFDocument } = await import('pdf-lib');
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      // Each page can be { pdf: base64-string } or { pdf: Buffer } or { repeat: N, pdf: ... }
      let pdfData = page.pdf;
      if (!pdfData) {
        console.warn(`[COMPOSE] Page ${i + 1} missing 'pdf' property, skipping...`);
        continue;
      }

      // Convert base64 to Buffer if needed
      let pdfBuffer;
      if (typeof pdfData === 'string') {
        // Assume base64
        pdfBuffer = Buffer.from(pdfData, 'base64');
      } else if (Buffer.isBuffer(pdfData)) {
        pdfBuffer = pdfData;
      } else if (pdfData.type === 'Buffer' && Array.isArray(pdfData.data)) {
        // Serialized Buffer from JSON
        pdfBuffer = Buffer.from(pdfData.data);
      } else {
        console.warn(`[COMPOSE] Page ${i + 1} has invalid pdf format, skipping...`);
        continue;
      }

      // Load PDF
      const srcPdf = await PDFDocument.load(pdfBuffer);
      const srcPages = await mergedPdf.copyPages(srcPdf, srcPdf.getPageIndices());

      // Add pages (handle repeat if specified)
      const repeat = Number(page.repeat) || 1;
      for (let r = 0; r < repeat; r++) {
        for (const copiedPage of srcPages) {
          mergedPdf.addPage(copiedPage);
        }
      }
    }

    const mergedPdfBytes = await mergedPdf.save();
    const buf = Buffer.from(mergedPdfBytes);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${(fileName || 'composed')}.pdf"`);
    res.send(buf);

    console.log('[COMPOSE] Success! Total pages:', mergedPdf.getPageCount());
  } catch (e) {
    console.error('[COMPOSE ERROR]', e);
    res.status(500).json({ error: 'compose error', message: e.message });
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
