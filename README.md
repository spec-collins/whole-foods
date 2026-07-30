# Whole Foods Vendor Response Tool

A single static page that a Whole Foods vendor reaches from a link in an outreach email.
They pick one of four ways to provide their packaging component data, that click is recorded
immediately, and three of the four choices lead to a short second screen (a timeframe pick, a
scheduling link, or a reply-to-email note). The fourth is a dead end by design.

Responses go into a Postgres database behind a serverless function that deploys alongside the
page. Because the API and the page share an origin, there is no CORS to configure and no
third-party automation platform in the path.

Background and the original acceptance checklist are in [`CURSOR_BUILD_SPEC.md`](./CURSOR_BUILD_SPEC.md).

```
public/index.html               the entire vendor-facing app; no framework, no build step
public/admin.html               dashboard for reading and exporting responses
api/respond.js                  records a submission
api/export.js                   downloads the tracker as xlsx, csv, or json
api/health.js                   deployment check
lib/                            database, validation, signing, and the xlsx writer
scripts/migrate.mjs             creates the tables
scripts/make-links.mjs          generates the per-vendor links for the outreach email
scripts/dev-server.mjs          local stand-in for `vercel dev`
backend/google-apps-script.gs   alternative backend that writes to a Google Sheet instead
tests/                          five suites, 109 checks
```

Only `public/` is served as static content, which is why the page lives there: at the repo
root, Vercel would also publish `lib/`, `package.json`, and everything else alongside it.

## Setup

### 1. A database

Any Postgres works. [Neon](https://neon.tech) has a free tier and integrates with Vercel in a
few clicks; Supabase, Railway, or an existing instance are all fine.

Use the provider's **pooled** connection string, not the direct one — Neon's `-pooler` host,
Supabase's port 6543. Serverless functions open connections from many short-lived instances
and will exhaust a direct connection limit.

### 2. Environment variables

Copy [`.env.example`](./.env.example) to `.env` for local work, and set the same values in
Vercel under Project Settings → Environment Variables.

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled Postgres connection string. |
| `ADMIN_TOKEN` | for exports | Bearer token for `/api/export`. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `SCHEDULING_URL` | recommended | Booking link, returned by the API after the working-session choice so it stays out of page source. |
| `LINK_SIGNING_SECRET` | optional | Turns on signed links. See below. |
| `IP_HASH_SALT` | optional | Salt for the hashed client IP stored with each event. |
| `RATE_LIMIT_PER_MINUTE` | optional | Submissions per client per minute; defaults to 20, `0` disables. |
| `BASE_URL` | for link generation | Used by `npm run links`. |

### 3. Create the tables

```bash
npm install
npm run migrate
```

Safe to re-run. [`lib/schema.sql`](./lib/schema.sql) is the single source of truth.

### 4. Run it locally

```bash
npm run dev     # http://localhost:3000/?vid=TEST123&name=Test%20Vendor
```

`GET /api/health` reports whether the database is reachable, whether the migration has run,
and which optional features are switched on. Check it first when something looks wrong.

### 5. Deploy

```bash
npm install -g vercel
vercel login
vercel          # first run: new project, current directory as source
vercel --prod
```

No build step. Vercel serves `public/` as the site and turns each file in `api/` into a
function automatically.

The remaining placeholders in `public/index.html` are `REPLACE_WITH_PHONE` in the fallback
contact line and `REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL`, which is only a fallback for when
`SCHEDULING_URL` isn't set.

## How responses are stored

Two tables, described in [`lib/schema.sql`](./lib/schema.sql):

- **`vendor_responses`** — one row per vendor, upserted on `vendor_id`. A vendor's choice and
  their timeframe merge onto the same row, and a `COALESCE` on every column means a later
  submission never blanks out an earlier one. This is what the export reads.
- **`response_events`** — append-only, one row per payload received, with the raw JSON, a
  hashed client IP, and a user agent. Nothing here is ever updated or deleted, so a duplicate
  or mistaken submission can always be reconstructed.

## Getting the data out

Visit **`/admin.html`** and paste the `ADMIN_TOKEN`. It shows counts by response type and
completion, a searchable and filterable table with a follow-up status per vendor, and buttons
to download the tracker as Excel or CSV. The token is held in `sessionStorage` for the tab
and sent as a bearer header, so it never lands in a URL, browser history, or referrer. The
page itself is only a shell — every byte of data requires the token.

For scripting, hit the endpoint directly:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://your-deployment/api/export?format=xlsx" -o vendor-responses.xlsx
```

`format` accepts `xlsx` (a real Excel workbook), `csv`, or `json`. The token can also be
passed as `?token=` when a header is inconvenient. The workbook is generated by
[`lib/xlsx.js`](./lib/xlsx.js) rather than a spreadsheet library, which keeps the project on
one runtime dependency.

## Keeping the tracker clean

Anyone who views the page source can see that it posts to `/api/respond`, so by default a
stranger could submit responses for made-up vendor IDs. Three things push back on that:

1. **Signed links.** Set `LINK_SIGNING_SECRET`, then generate the outreach links with
   `BASE_URL=https://respond.specinsite.com npm run links -- vendors.csv`, where the CSV has a
   `vendor_id` column and an optional `vendor_name`. Each link carries an HMAC that
   `/api/respond` verifies, and one vendor's token won't work for another. With the secret
   unset, the check is skipped entirely.
2. **Rate limiting.** Submissions per client per minute, counted against the hashed IP in
   `response_events`.
3. **Validation.** `choice` must be one of the four known values and `timeframe` must be a
   known preset or a `YYYY-MM-DD` date, so the tracker can't be filled with arbitrary text.

## Alternative backends

The page posts JSON to whatever `WEBHOOK_URL` in `public/index.html` points at, so it can be
retargeted without touching anything else:

- **n8n** — set `WEBHOOK_URL` to the production webhook URL. The workflow must upsert on
  `vendor_id`, and the Webhook node needs its **Allowed Origins (CORS)** field set to the
  site's origin, or every click shows an error even though n8n received the data.
- **Google Sheets** — [`backend/google-apps-script.gs`](./backend/google-apps-script.gs)
  writes to a spreadsheet with no infrastructure at all. Set `WEBHOOK_URL` to the `/exec` URL
  and `WEBHOOK_CONTENT_TYPE` to `text/plain;charset=utf-8`.

The payload contract is unchanged across all three and is documented in the build spec, with
one addition: a `token` field carrying the signed-link token when there is one.

## Tests

See [`tests/README.md`](./tests/README.md). `npm test` needs a scratch Postgres;
`npm run test:browser` also needs puppeteer.
