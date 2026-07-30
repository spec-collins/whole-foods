# Tests

Five suites, 109 checks. Three need nothing but Node; two also need a browser.

```bash
npm test           # xlsx writer, API against Postgres, Apps Script backend
npm run test:browser   # the real page in headless Chrome (see setup below)
```

## Setup

The API and end-to-end suites **drop and recreate their two tables**, so point them at
a scratch database, never the production one. Either set `TEST_DATABASE_URL` or let them
fall back to `DATABASE_URL` from your `.env`.

A local Postgres is enough:

```bash
sudo apt-get install -y postgresql-16
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "create role wf login password 'wfpass' superuser;" \
                     -c "create database wf_vendor owner wf;"
export TEST_DATABASE_URL=postgres://wf:wfpass@127.0.0.1:5432/wf_vendor
```

Puppeteer is kept out of `package.json` so Vercel deployments don't install a browser.
Put it in a scratch directory instead:

```bash
mkdir -p /tmp/wf-test && cd /tmp/wf-test && npm init -y && npm install puppeteer
npx puppeteer browsers install chrome
cd -
PUPPETEER_DIR=/tmp/wf-test npm run test:browser
```

## What each suite covers

**`api.test.mjs`** — the serverless handlers against real Postgres. A choice and a
timeframe for one vendor merging onto a single upserted row; a resubmitted choice not
wiping an existing timeframe; a new `vendor_id` inserting; every payload landing in the
append-only event log with a hashed rather than raw IP; rejection of unknown stages,
out-of-range choices, malformed timeframes, bad JSON, oversized bodies and wrong methods,
with nothing written on rejection; the export's auth, formats and download headers;
signed-link enforcement, including that one vendor's token can't be reused for another;
and the rate limit engaging and being disableable.

**`e2e.test.mjs`** — the real page in headless Chrome against the real handlers and a real
database. Both screens, the date picker, the booking link arriving from the API rather
than page source, signed and unsigned links, a deliberately broken backend still producing
the error state, and the export reflecting exactly what the browser submitted.

**`page.test.mjs`** — the page against a mock webhook, which is how it behaves when pointed
at n8n or Apps Script instead of the bundled API. Covers the Task 2 and Task 5 checklists in
`../CURSOR_BUILD_SPEC.md`: unconfigured-endpoint safety, per-choice branching, payload
contracts, failure handling at both stages, and a 320px viewport.

**`xlsx.test.mjs`** — round-trips the hand-rolled workbook writer using only `node:zlib`.
Guards the escaping that a vendor named "Bob & Co" would otherwise break, plus the
container details Excel is strict about. Output was also verified independently against
openpyxl during development.

**`apps-script.test.mjs`** — the optional Google Sheets backend against stubbed Google
services, for the deployment that doesn't use Postgres.
