# Whole Foods Vendor Response Tool

A landing page for Whole Foods packaging-data outreach. A vendor clicks a
personalized link (`?vid=...&name=...`), lands on this page, and picks one of
four ways they'll provide their packaging component data. Each click posts a
JSON payload to a small serverless API (`api/submit.js`) that upserts the
response into a Postgres database, keyed by `vendor_id` — so every follow-up
click for the same vendor updates one row instead of creating duplicates. Two
of the four choices (template, eHalo self-entry) lead to a short second
screen asking for a rough timeframe; the other two lead to a scheduling link
or a reply-to-email note.

There's no framework and no build step for the page itself — `index.html` is
plain HTML/CSS/JS. The tracking layer is two small Vercel serverless
functions plus a Postgres table; no n8n or other external workflow tool is
required.

## How it's put together

```
index.html        the vendor-facing page (Task 1 of the build spec)
admin.html         a token-gated page to view/export tracked responses
api/submit.js      POST endpoint the page calls on every click; upserts a row
api/responses.js   GET endpoint (admin-token protected) that returns all
                    responses as JSON, or as a CSV download for Excel
api/_db.js         shared Postgres connection pool helper
db/schema.sql       the one table this project needs; run once against your DB
```

## Environment variables

Set these in the Vercel project settings (Project → Settings →
Environment Variables), not in the code:

| Variable | Required | What it's for |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string. If you provision a database through Vercel's own Storage tab (Postgres, powered by Neon), its default `POSTGRES_URL` is picked up automatically — you don't need to also set `DATABASE_URL` in that case. |
| `ADMIN_TOKEN` | Yes, to use `admin.html` | A secret string you make up. Whoever opens `admin.html` needs to paste this in to view or export responses. Treat it like a password — anyone with it can read all vendor responses. |

## Provisioning the database

Any hosted Postgres works. The easiest path since you're already deploying to
Vercel:

1. In the Vercel dashboard, open the project → **Storage** → **Create
   Database** → **Postgres**. Connect it to this project; Vercel sets the
   connection env vars for you automatically.
2. Run the schema once, either by pasting `db/schema.sql` into the database's
   SQL editor in the Vercel/Neon dashboard, or from your machine:
   ```bash
   npm run db:migrate   # runs: psql "$DATABASE_URL" -f db/schema.sql
   ```
3. Set `ADMIN_TOKEN` to any long random string (e.g. `openssl rand -hex 24`).

(Neon and Supabase work the same way if you'd rather provision the database
outside Vercel — just put their connection string in `DATABASE_URL`. Use the
*pooled* connection string if the provider offers one, since each serverless
invocation opens its own connection.)

## Config placeholders left in `index.html`

The page no longer needs a webhook URL — it posts to its own `/api/submit`
on whatever domain it's deployed to. Two placeholders remain, left as
honestly-fake strings until real values exist:

| Placeholder | Location | What it is |
| --- | --- | --- |
| `REPLACE_WITH_PHONE` | fallback contact line | Phone number vendors can call if the page/API fails. |
| `REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL` | `CALENDLY_URL` in the `<script>` CONFIG block | Scheduling link shown after "I'd like a working session." Only assigned to the link's `href` after a successful API call, so it never appears in the raw page source before that. |

## Running locally

The frontend alone can be opened directly as a file (no server needed) to
check layout and copy, but the API calls will fail since there's no local
server handling `/api/submit`. To exercise the full flow locally:

```bash
npm install
vercel login
vercel env pull .env.local   # pulls DATABASE_URL / ADMIN_TOKEN from the linked project
vercel dev
```

`vercel dev` serves `index.html`, `admin.html`, and the `/api` functions
together on `localhost`, using the same env vars as production.

## Deploying to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

Answer the prompts: set up and deploy = yes, default scope, new project
(don't link an existing one), give it a name (e.g. `wf-vendor-response`), and
use the current directory as the source. Vercel returns a live `*.vercel.app`
URL and automatically deploys the `api/` functions alongside the static
pages — no separate build step to configure. Re-run `vercel` after any file
change to redeploy.

Adding a custom subdomain (e.g. `respond.specinsite.com`) is done in the
Vercel dashboard plus a DNS record at whichever registrar manages
`specinsite.com`; that's outside this repo/CLI flow.

## Viewing and exporting tracked responses

Open `/admin.html` on the deployed site, paste in the `ADMIN_TOKEN` value,
and click **Load responses** to see a live table, or **Download CSV** to get
a spreadsheet with every vendor's latest choice and timeframe — open that CSV
directly in Excel. The token is only ever sent as an `Authorization: Bearer`
header, never in the URL, so it won't end up in server logs or browser
history.

## More context

The full original build spec — including the local test checklist, the
end-to-end verification checklist, and the payload contract — lives in
`CURSOR_BUILD_SPEC_2947.md` in this repo. Note the spec's original design
assumed an external n8n webhook for the backend; this project instead uses
its own Postgres-backed API (`api/submit.js` / `api/responses.js`) for
tracking, so the webhook-specific parts of that spec no longer apply.
Anyone picking this project up later should read both files.
