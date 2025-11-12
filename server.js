import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const EDITOR_AUTH_TOKEN = process.env.EDITOR_AUTH_TOKEN || '';
const N8N_PREVIEW_WEBHOOK_URL = process.env.N8N_PREVIEW_WEBHOOK_URL || '';

app.use(cors({ origin: CORS_ORIGIN, credentials: false }));
app.use(express.json({ limit: '10mb' }));
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

app.get('/api/health', (_req, res) => res.json({ ok: true }));

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

    // Always include all common plugins (text, multiVariableText, image, etc.)
    const plugins = {
      text: schemas.text,
      multiVariableText: schemas.multiVariableText,
      image: schemas.image,
      qrcode: schemas.barcode.qrcode,
      svg: schemas.svg,
      line: schemas.graphics.line,
      ellipse: schemas.graphics.ellipse,
      rectangle: schemas.graphics.rectangle
    };

    // Interpolate template schemas with input data
    // Each input item gets its own interpolated template
    const pdfs = [];
    for (const inputItem of inputs) {
      // Create context by merging global context with current item
      const ctx = req.body.context ? { ...req.body.context, ...inputItem } : inputItem;
      console.log('[RENDER] Input context:', JSON.stringify(ctx, null, 2));

      // Deep clone template and interpolate all {{variable}} in schemas
      const interpolatedTemplate = JSON.parse(JSON.stringify(template));
      if (interpolatedTemplate.schemas && Array.isArray(interpolatedTemplate.schemas)) {
        interpolatedTemplate.schemas = interpolatedTemplate.schemas.map(pageSchemas => {
          if (!Array.isArray(pageSchemas)) return pageSchemas;
          return pageSchemas.map(schema => {
            const newSchema = { ...schema };
            // Interpolate 'content' field (multiVariableText, text)
            if (newSchema.content && typeof newSchema.content === 'string') {
              const before = newSchema.content;
              newSchema.content = interpolateString(newSchema.content, ctx);
              console.log(`[RENDER] Interpolated content: "${before}" -> "${newSchema.content}"`);
            }
            // Interpolate 'text' field (legacy text schemas)
            if (newSchema.text && typeof newSchema.text === 'string') {
              const before = newSchema.text;
              newSchema.text = interpolateString(newSchema.text, ctx);
              console.log(`[RENDER] Interpolated text: "${before}" -> "${newSchema.text}"`);
            }
            return newSchema;
          });
        });
      }

      // Generate PDF with interpolated template and empty inputs (data already in template)
      const u8 = await generate({ template: interpolatedTemplate, inputs: [{}], plugins });
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
    console.error(e);
    res.status(500).json({ error: 'render error' });
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

await initDb();
app.listen(port, () => console.log(`PDFme Editor running on :${port}`));
  