import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv, ROOT } from '../lib/env.js';

/**
 * Local stand-in for `vercel dev`: serves public/ as the site root and
 * dispatches /api/<name> to the matching module in api/, which is how Vercel
 * lays this project out. Useful when you want to run the whole thing against a
 * local Postgres without a Vercel login.
 *
 *   DATABASE_URL=postgres://... npm run dev
 */

loadLocalEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const handlers = new Map();
async function getHandler(name) {
  if (handlers.has(name)) return handlers.get(name);
  const file = path.join(ROOT, 'api', `${name}.js`);
  if (!fs.existsSync(file)) return null;
  const mod = await import(`${file}?v=${Date.now()}`);
  handlers.set(name, mod.default);
  return mod.default;
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice('/api/'.length).replace(/\/+$/, '');
      const handler = /^[a-z0-9_-]+$/i.test(name) ? await getHandler(name) : null;
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'No such endpoint.' }));
      }
      try {
        return await handler(req, res);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Unhandled error.' }));
      }
    }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_DIR, relative);

    // Only ever serve out of public/, the same scope Vercel would.
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found');
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(filePath));
  });
}

// Only listen when run directly, so tests can import createServer().
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  createServer().listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`  page    http://localhost:${PORT}/?vid=TEST123&name=Test%20Vendor`);
    console.log(`  health  http://localhost:${PORT}/api/health`);
  });
}
