# AGENTS.md

## Cursor Cloud specific instructions

This repo is a tiny Whole Foods vendor-response tool: static pages (`index.html`,
`admin.html`) plus two Vercel serverless functions (`api/submit.js`,
`api/responses.js`) backed by Postgres. There is **no build step**, **no lint
config**, and **no automated test suite** in the repo — do not go looking for
`npm test`/`npm run lint`; they don't exist.

### Running the app locally (`node dev-server.js`)

- Production uses Vercel (`vercel dev` / `vercel deploy`). `vercel dev` requires an
  interactive Vercel account login, which is **not available in the cloud agent
  environment**. Do not rely on it here.
- Instead use `node dev-server.js` (added for local/CI/agent use). It serves the
  static pages and mounts the **same** `api/*.js` handlers on
  `http://localhost:3000`, so it exercises the real product code without any
  external account. It does not modify product code.
- It auto-loads `.env.local` (see below). Start it in the background, e.g. via a
  tmux session, then hit `http://localhost:3000/?vid=demo&name=Demo` and
  `http://localhost:3000/admin.html`.

### Postgres (required for the API)

- A local Postgres 16 cluster is used. If it isn't running:
  `sudo pg_ctlcluster 16 main start`.
- App database/user (recreate only if missing):
  ```bash
  sudo -u postgres psql -c "CREATE ROLE wfuser LOGIN PASSWORD 'wfpass';"
  sudo -u postgres psql -c "CREATE DATABASE wf_vendor OWNER wfuser;"
  PGPASSWORD=wfpass psql -h localhost -U wfuser -d wf_vendor -f db/schema.sql
  ```
- `api/_db.js` disables SSL only when the connection string points at
  `localhost`/`127.0.0.1`; keep the local `DATABASE_URL` host as `localhost`.

### Environment variables (`.env.local`, gitignored)

`dev-server.js` reads these from `/workspace/.env.local`:

```
DATABASE_URL=postgresql://wfuser:wfpass@localhost:5432/wf_vendor
ADMIN_TOKEN=dev-admin-token-123
```

`ADMIN_TOKEN` is the value pasted into `admin.html` (sent as
`Authorization: Bearer <token>`) to load/export responses.

### Quick end-to-end sanity check

`POST /api/submit` with `{"stage":"choice","vendor_id":"x",...}` then
`{"stage":"timeframe",...}` upserts a single row keyed by `vendor_id`;
`GET /api/responses` (with the bearer token) returns it as JSON, and
`?format=csv` returns the CSV export.
