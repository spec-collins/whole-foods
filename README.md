# Whole Foods Vendor Response Tool

A single static page that a Whole Foods vendor reaches from a link in an outreach email.
They pick one of four ways to provide their packaging component data, that click posts to a
webhook immediately, and three of the four choices lead to a short second screen (a
timeframe pick, a scheduling link, or a reply-to-email note). The fourth is a dead end by
design. No framework, no build step, no dependencies — everything the vendor sees is in
`index.html`.

Full background and the acceptance checklist are in [`CURSOR_BUILD_SPEC.md`](./CURSOR_BUILD_SPEC.md).

```
index.html                      the entire vendor-facing application
vercel.json                     security headers + noindex
backend/google-apps-script.gs   optional backend that logs responses to a Google Sheet
tests/                          automated version of the spec's test checklists
```

## Configure before deploying

Four placeholders are intentionally left as obviously-fake strings. The page will not
work until at least the first is replaced.

| Placeholder | Where | What it is |
| --- | --- | --- |
| `REPLACE_WITH_N8N_PRODUCTION_WEBHOOK_URL` | `WEBHOOK_URL`, script CONFIG block | The endpoint both payloads POST to. Must be an absolute `https://` URL. |
| `REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL` | `CALENDLY_URL`, script CONFIG block | Booking link shown after the "working session" choice. Only used as a fallback (see below). |
| `REPLACE_WITH_PHONE` | `#fallbackPhone`, fallback div | Phone number shown only when a submission fails. |
| `wholefoods@specinsite.com` | fallback div and the `send_docs` screen | Already set; change it if the mailbox address differs. |

There is also a `WEBHOOK_CONTENT_TYPE` constant, which stays `application/json` for n8n and
must become `text/plain;charset=utf-8` for the Google Apps Script backend.

### The booking link and page source

The spec's checklist asks that the real booking URL not be visible in page source before
the vendor clicks. Anything in the `CALENDLY_URL` constant *is* in page source, so the page
prefers a `scheduling_url` field returned by the webhook's JSON response and only falls back
to the constant when the webhook doesn't supply one. To satisfy the checklist, return the
URL from the webhook and leave the constant as the placeholder. Non-`http(s)` values in that
response field are rejected.

### CORS

The page is on one origin and the webhook is on another, so the webhook must allow it.
For n8n, set **Allowed Origins (CORS)** on the Webhook node to the site's origin (or `*`).
Without it the browser blocks the response and every click shows the error state even though
n8n received the data. This is the single most likely thing to go wrong on first deploy.

## Run locally

Open `index.html` directly in a browser — no server needed. Add the query params the
outreach email would include:

```
file:///path/to/index.html?vid=TEST123&name=Test%20Vendor
```

With the webhook placeholder still in place, every click should fail gracefully: red error
message, fallback contact line appears, buttons re-enable, nothing thrown in the console.

To run the checklists automatically, see [`tests/README.md`](./tests/README.md).

## Deploy

```bash
npm install -g vercel
vercel login
vercel          # first run: new project, e.g. wf-vendor-response, current dir as source
vercel --prod
```

Re-running `vercel` after any edit redeploys; there's no build step. Adding
`respond.specinsite.com` happens in the Vercel dashboard plus a DNS record at the registrar,
not here.

## Where responses are stored

Both payload shapes POST to the same `WEBHOOK_URL` and are distinguished by `stage`. The
receiver is expected to **upsert on `vendor_id`** so a vendor's choice and timeframe land on
one row instead of two. The full payload contract is in the build spec.

Two receivers work:

- **n8n** (the spec's assumption) — the webhook and its tracker-write logic are built
  separately. Nothing in this repo needs to change beyond `WEBHOOK_URL`.
- **Google Apps Script** (`backend/google-apps-script.gs`) — a no-infrastructure
  alternative that writes straight into a Google Sheet, which downloads as `.xlsx`. It keeps
  one upserted row per vendor on a `Responses` tab plus an append-only `Log` tab of every
  raw payload. Setup instructions are in the file's header comment. Remember to switch
  `WEBHOOK_CONTENT_TYPE` to `text/plain;charset=utf-8` for this route.

Note that the webhook URL is visible in page source, which is unavoidable for a static page
posting directly to it. Anyone who finds it can post junk. The audit log and upsert-by-vendor
behaviour make that recoverable rather than destructive, but if the tracker needs to be
trustworthy, put a signed token in the emailed link and validate it server-side.
