#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { compressImage } from './compress.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8');

const app = new Hono();

app.get('/', (c) => c.html(indexHtml));

const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

function resultCard(name, result) {
  const outName = name.replace(/\.[^.]*$/, '') + '.' + (result.format === 'jpeg' ? 'jpg' : result.format);
  const saved = result.originalSize - result.compressedSize;
  const pct = result.originalSize ? Math.round((saved / result.originalSize) * 100) : 0;
  const dataUri = `data:${MIME[result.format]};base64,${result.buffer.toString('base64')}`;
  const badge = result.alreadyOptimized
    ? '<span class="badge muted">already optimized</span>'
    : `<span class="badge">&minus;${pct}%</span>`;
  return `
  <li class="card">
    <img class="thumb" src="${dataUri}" alt="" loading="lazy">
    <div class="meta">
      <div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="sizes">${fmtBytes(result.originalSize)} &rarr; <strong>${fmtBytes(result.compressedSize)}</strong>
        <span class="fmt">${result.format.toUpperCase()}</span>
      </div>
    </div>
    ${badge}
    <a class="dl" href="${dataUri}" download="${escapeHtml(outName)}" data-zip="1">Download</a>
  </li>`;
}

function errorCard(name, message) {
  return `
  <li class="card error">
    <div class="meta">
      <div class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="sizes">${escapeHtml(message)}</div>
    </div>
  </li>`;
}

app.post('/compress', async (c) => {
  const form = await c.req.formData();
  const format = String(form.get('format') || 'auto');
  const mode = String(form.get('mode') || 'balanced');
  const files = form.getAll('files').filter((f) => typeof f === 'object' && f.size > 0);

  if (files.length === 0) {
    return c.html('<li class="card error"><div class="meta"><div class="name">No files received</div></div></li>');
  }

  const cards = [];
  for (const file of files) {
    try {
      if (file.size > MAX_FILE_BYTES) {
        cards.push(errorCard(file.name, `File exceeds ${fmtBytes(MAX_FILE_BYTES)} limit`));
        continue;
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const result = await compressImage(buf, { format, mode });
      cards.push(resultCard(file.name, result));
    } catch (err) {
      cards.push(errorCard(file.name, err.message || 'Compression failed'));
    }
  }
  return c.html(cards.join('\n'));
});

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`free-image-compress running at http://localhost:${info.port}`);
});
