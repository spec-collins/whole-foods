# Whole Foods Vendor Response Tool

A single static landing page for Whole Foods packaging-data outreach. A vendor
clicks a personalized link (`?vid=...&name=...`), lands on this page, and
picks one of four ways they'll provide their packaging component data. Each
click posts a JSON payload straight to an n8n webhook, which is responsible
for logging the response (e.g. into a Google Sheet, Excel file, Airtable
base, or database) and driving any follow-up automation. Two of the four
choices (template, eHalo self-entry) lead to a short second screen asking for
a rough timeframe; the other two lead to a scheduling link or a
reply-to-email note.

There is no framework, no build step, and no backend in this repo — it's one
HTML file with inline CSS/JS, deployed as-is.

## Config placeholders

Before deploying for real, replace these four literal placeholder strings in
`index.html`:

| Placeholder | Location | What it is |
| --- | --- | --- |
| `REPLACE_WITH_PHONE` | fallback contact line | The phone number vendors can call if the page/webhook fails. |
| `REPLACE_WITH_N8N_PRODUCTION_WEBHOOK_URL` | `WEBHOOK_URL` in the `<script>` CONFIG block | The production n8n webhook URL that receives both the `choice` and `timeframe` payloads (see the payload contract in the build spec). |
| `REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL` | `CALENDLY_URL` in the `<script>` CONFIG block | The scheduling link shown after a vendor picks "I'd like a working session." Only assigned to the link's `href` after a successful webhook call, so it never appears in the raw page source before that. |

If real values aren't available yet, leave the placeholders as-is rather than
substituting a fake-but-plausible-looking URL — an honest placeholder is
easier to spot and fix later.

## Running locally

No server needed. Open `index.html` directly in a browser, appending a query
string to test personalization, e.g.:

```
file:///path/to/index.html?vid=TEST123&name=Test%20Vendor
```

With `WEBHOOK_URL` still a placeholder, every button click will fail
gracefully (red error message, fallback contact line, buttons re-enable) —
that's expected until a real webhook is wired up.

## Deploying to Vercel

```bash
npm install -g vercel
vercel login
vercel
```

Answer the prompts: set up and deploy = yes, default scope, new project
(don't link an existing one), give it a name (e.g. `wf-vendor-response`), and
use the current directory as the source. Vercel returns a live `*.vercel.app`
URL. Re-run `vercel` after any file change to redeploy — there's no separate
build step for a static file like this.

Adding a custom subdomain (e.g. `respond.specinsite.com`) is done in the
Vercel dashboard plus a DNS record at whichever registrar manages
`specinsite.com`; that's outside this repo/CLI flow.

## More context

The full build spec — including the local test checklist, end-to-end
verification checklist, and the exact payload contract the webhook must
accept — lives in `CURSOR_BUILD_SPEC_2947.md` in this project's chat/folder.
Anyone picking this project up later should read that first.
