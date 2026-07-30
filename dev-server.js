#!/usr/bin/env node
/*
 * Local development server for the Whole Foods vendor response tool.
 *
 * Production runs on Vercel (`vercel dev` / `vercel deploy`), which serves the
 * static pages and turns each file in `api/` into a serverless function.
 * `vercel dev` requires a logged-in Vercel account, which isn't available in
 * every environment (CI, cloud agents, offline hacking). This script provides
 * an equivalent local experience with zero external accounts: it serves the
 * static HTML and mounts the SAME `api/*.js` handlers, shimming just enough of
 * the Vercel/Node request/response contract that the handlers rely on.
 *
 * It does not change any product code. Run with:
 *   DATABASE_URL=... ADMIN_TOKEN=... node dev-server.js
 * or put those in a local `.env.local` (auto-loaded here) and just run:
 *   node dev-server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// --- Minimal .env.local loader (no dependency on dotenv) ---
function loadEnvFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (_) {
    return;
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '.env.local'));

const submit = require('./api/submit');
const responses = require('./api/responses');

const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/admin': { file: 'admin.html', type: 'text/html; charset=utf-8' },
  '/admin.html': { file: 'admin.html', type: 'text/html; charset=utf-8' },
};

const API_ROUTES = {
  '/api/submit': submit,
  '/api/responses': responses,
};

function decorateResponse(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(obj) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  const originalSend = res.send && res.send.bind(res);
  res.send = function send(body) {
    if (originalSend) return originalSend(body);
    res.end(body);
    return res;
  };
  return res;
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try {
          return resolve(JSON.parse(raw));
        } catch (_) {
          return resolve({});
        }
      }
      resolve(raw);
    });
  });
}

const server = http.createServer(async (req, res) => {
  decorateResponse(res);
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  const apiHandler = API_ROUTES[pathname];
  if (apiHandler) {
    req.query = Object.fromEntries(parsed.searchParams.entries());
    req.body = await readBody(req);
    try {
      await apiHandler(req, res);
    } catch (err) {
      console.error('handler threw:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
    return;
  }

  const staticEntry = STATIC_FILES[pathname];
  if (staticEntry) {
    fs.readFile(path.join(__dirname, staticEntry.file), (err, data) => {
      if (err) {
        res.status(404).send('Not found');
        return;
      }
      res.setHeader('Content-Type', staticEntry.type);
      res.status(200).send(data);
    });
    return;
  }

  res.status(404).send('Not found');
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Dev server running: http://localhost:${port}`);
  console.log(`  vendor page: http://localhost:${port}/?vid=demo-vendor&name=Demo%20Vendor`);
  console.log(`  admin page:  http://localhost:${port}/admin.html`);
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.warn('WARNING: DATABASE_URL/POSTGRES_URL not set; API calls will fail.');
  }
});
