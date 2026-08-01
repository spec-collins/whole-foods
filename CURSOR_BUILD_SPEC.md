# Whole Foods Vendor Response Tool — Cursor Build Spec

Drop this file into a new empty folder, open it in Cursor, and ask Cursor to read this file and start with Task 1. It has everything needed to build and deploy the static site. It does not cover the Microsoft 365 mailbox, DNS, or n8n workflow setup, since those happen outside a code editor; that separate walkthrough already exists and is noted at the bottom.

---

## What This Is

A single static landing page. A Whole Foods vendor clicks a link in an outreach email, lands here, and clicks one of four buttons to say how they'll provide packaging data. The click posts to an n8n webhook instantly. Three of the four buttons lead to a short second screen (a timeframe pick, a scheduling link, or a reply-to-email note); the fourth choice is a dead end by design, since it doesn't need one.

No framework, no build step, no dependencies. One HTML file, deployed to Vercel, eventually served from a specinsite.com subdomain.

---

## Tech Stack (deliberately minimal)

- Plain HTML, CSS, and vanilla JavaScript in a single file
- No React, no bundler, no npm packages. This is a weekend build for a static page with four buttons and two POST calls; a framework would add build complexity for zero benefit here.
- Hosting: Vercel (static)
- Backend: an existing n8n instance, reached via a webhook URL. Cursor is not building the backend; the webhook already exists or is being built in parallel. Cursor's job is to make sure the page calls it correctly.

---

## File Structure

```
/
├── index.html              (the entire application)
├── README.md                (deploy + config instructions, Cursor should generate this)
└── vercel.json               (optional, only if custom headers/redirects are needed)
```

Keep it to one HTML file unless there's a concrete reason to split it. Do not create a package.json, a src/ folder, or a component structure for this.

---

## Task 1: Build `index.html`

Use the reference implementation below as the starting point. It already exists and works; the job is to drop it in as `index.html`, verify it, and be ready to modify it if requirements change.

<details>
<summary>Reference implementation (click to expand in your head, but just create the file with this content)</summary>

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Whole Foods Packaging Data - Response</title>
<style>
  :root {
    --forest-green: #2D6B2F;
    --leaf-green: #52A83A;
    --navy: #1D3461;
    --sage: #A8CEA8;
    --pale-green: #EFF6EF;
    --off-white: #F5F8F2;
    --charcoal: #1A2A1A;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--off-white);
    color: var(--charcoal);
    display: flex;
    justify-content: center;
    padding: 24px 16px;
    min-height: 100vh;
  }
  .card {
    background: #fff;
    border: 1px solid var(--sage);
    border-radius: 10px;
    max-width: 560px;
    width: 100%;
    padding: 32px 28px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06);
  }
  h1 { font-size: 20px; color: var(--forest-green); margin: 0 0 4px; }
  .vendor-name { font-size: 15px; color: var(--charcoal); margin: 0 0 20px; }
  p.intro, p.step-intro { font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
  .option-btn {
    display: block; width: 100%; text-align: left;
    background: var(--pale-green); border: 1px solid var(--sage); border-radius: 8px;
    padding: 16px; margin-bottom: 12px; font-size: 15px; color: var(--charcoal);
    cursor: pointer; transition: background 0.15s, border-color 0.15s; text-decoration: none;
  }
  .option-btn:hover:not(:disabled) { background: var(--sage); border-color: var(--forest-green); }
  .option-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .option-btn strong { display: block; color: var(--navy); margin-bottom: 2px; }
  .date-row { display: flex; gap: 8px; margin-top: 4px; }
  .date-row input[type="date"] { flex: 1; padding: 12px; border: 1px solid var(--sage); border-radius: 8px; font-size: 14px; }
  .date-row button { background: var(--forest-green); color: #fff; border: none; border-radius: 8px; padding: 0 18px; font-size: 14px; cursor: pointer; }
  .date-row button:disabled { opacity: 0.5; cursor: not-allowed; }
  #status { margin-top: 20px; font-size: 14px; display: none; }
  #status.success { color: var(--forest-green); font-weight: 600; display: block; }
  #status.error { color: #B3261E; display: block; }
  #status.loading { color: var(--navy); display: block; }
  .fallback { margin-top: 16px; font-size: 13px; color: var(--charcoal); display: none; }
  .done-message { font-size: 15px; color: var(--forest-green); font-weight: 600; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Whole Foods Packaging Data</h1>
    <p class="vendor-name" id="vendorName"></p>

    <div id="stepChoice">
      <p class="intro">Let us know how you would like to provide your packaging component data. One click and you are done; we will follow up based on what you choose.</p>
      <button class="option-btn" data-choice="template">
        <strong>I'll fill out the spreadsheet template</strong>
        Send me the template. I'll complete it and send it back.
      </button>
      <button class="option-btn" data-choice="ehalo_self">
        <strong>I'll enter the data into eHalo myself</strong>
        I already have, or can get, eHalo access.
      </button>
      <button class="option-btn" data-choice="working_session">
        <strong>I'd like a working session</strong>
        Walk me through entering the data live, together.
      </button>
      <button class="option-btn" data-choice="send_docs">
        <strong>I'll send you our documents</strong>
        Send spec sheets or PDFs and let SpecInsite enter the data for us.
      </button>
    </div>

    <div id="stepTimeframe" style="display:none;">
      <p class="step-intro">Good. One more quick one: when do you think you'll have this done? An estimate is fine, and picking one of these does not lock you in.</p>
      <button class="option-btn" data-timeframe="this_week"><strong>This week</strong></button>
      <button class="option-btn" data-timeframe="next_two_weeks"><strong>Next 2 weeks</strong></button>
      <button class="option-btn" data-timeframe="need_more_time"><strong>Need more time</strong></button>
      <p class="step-intro" style="margin-top:16px; margin-bottom:8px;">Or pick a specific date:</p>
      <div class="date-row">
        <input type="date" id="timeframeDate">
        <button id="useDateBtn" type="button">Use this date</button>
      </div>
    </div>

    <div id="stepSchedule" style="display:none;">
      <p class="step-intro">Got it. Grab a time that works for you and we'll walk through it together.</p>
      <a id="calendlyLink" class="option-btn" href="#" target="_blank" rel="noopener" style="text-align:center;">
        <strong>Schedule your working session</strong>
      </a>
    </div>

    <div id="stepDocsReply" style="display:none;">
      <p class="done-message">Just reply to this email with your documents attached (spec sheets or PDFs) and we'll take it from there.</p>
    </div>

    <div id="stepDone" style="display:none;">
      <p class="done-message" id="doneMessage"></p>
    </div>

    <div id="status"></div>
    <div class="fallback" id="fallback">
      Having trouble? Email <a href="mailto:wholefoods@specinsite.com">wholefoods@specinsite.com</a> or call <span id="fallbackPhone">REPLACE_WITH_PHONE</span> and we will take care of it.
    </div>
  </div>

<script>
  // ===== CONFIG =====
  const WEBHOOK_URL = "REPLACE_WITH_N8N_PRODUCTION_WEBHOOK_URL";
  const CALENDLY_URL = "REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL";
  // ===================

  const params = new URLSearchParams(window.location.search);
  const vendorId = params.get('vid') || 'unknown';
  const vendorNameRaw = params.get('name') || '';
  const vendorName = vendorNameRaw ? decodeURIComponent(vendorNameRaw) : '';

  if (vendorName) {
    document.getElementById('vendorName').textContent = vendorName;
  }

  const steps = {
    choice: document.getElementById('stepChoice'),
    timeframe: document.getElementById('stepTimeframe'),
    schedule: document.getElementById('stepSchedule'),
    docsReply: document.getElementById('stepDocsReply'),
    done: document.getElementById('stepDone')
  };

  const statusEl = document.getElementById('status');
  const fallbackEl = document.getElementById('fallback');
  const doneMessageEl = document.getElementById('doneMessage');
  const calendlyLink = document.getElementById('calendlyLink');

  function showStep(name) {
    Object.keys(steps).forEach(function (key) {
      steps[key].style.display = (key === name) ? 'block' : 'none';
    });
  }

  function setStatus(type, message) {
    statusEl.className = type || '';
    statusEl.textContent = message || '';
  }

  function clearStatus() {
    statusEl.className = '';
    statusEl.textContent = '';
  }

  async function postToWebhook(payload) {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error('Server responded with ' + response.status);
    }
  }

  const choiceButtons = steps.choice.querySelectorAll('.option-btn');

  choiceButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const choice = btn.getAttribute('data-choice');
      const label = btn.querySelector('strong').textContent;
      submitChoice(choice, label);
    });
  });

  async function submitChoice(choice, label) {
    choiceButtons.forEach(function (b) { b.disabled = true; });
    setStatus('loading', 'Sending your response...');

    const payload = {
      stage: 'choice',
      vendor_id: vendorId,
      vendor_name: vendorName,
      choice: choice,
      choice_label: label,
      submitted_at: new Date().toISOString()
    };

    try {
      await postToWebhook(payload);
      clearStatus();

      if (choice === 'template' || choice === 'ehalo_self') {
        showStep('timeframe');
      } else if (choice === 'working_session') {
        calendlyLink.href = CALENDLY_URL;
        showStep('schedule');
      } else if (choice === 'send_docs') {
        showStep('docsReply');
      } else {
        showStep('done');
        doneMessageEl.textContent = 'Thanks, that is recorded.';
      }
    } catch (err) {
      setStatus('error', 'Something went wrong sending your response. Please try again in a moment.');
      fallbackEl.style.display = 'block';
      choiceButtons.forEach(function (b) { b.disabled = false; });
    }
  }

  const timeframeButtons = steps.timeframe.querySelectorAll('.option-btn[data-timeframe]');
  const timeframeDateInput = document.getElementById('timeframeDate');
  const useDateBtn = document.getElementById('useDateBtn');

  timeframeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      const value = btn.getAttribute('data-timeframe');
      const label = btn.querySelector('strong').textContent;
      submitTimeframe(value, label);
    });
  });

  useDateBtn.addEventListener('click', function () {
    if (!timeframeDateInput.value) {
      setStatus('error', 'Pick a date first, then click Use this date.');
      return;
    }
    submitTimeframe(timeframeDateInput.value, 'Specific date: ' + timeframeDateInput.value);
  });

  async function submitTimeframe(value, label) {
    timeframeButtons.forEach(function (b) { b.disabled = true; });
    useDateBtn.disabled = true;
    setStatus('loading', 'Saving your timeframe...');

    const payload = {
      stage: 'timeframe',
      vendor_id: vendorId,
      vendor_name: vendorName,
      timeframe: value,
      timeframe_label: label,
      timeframe_submitted_at: new Date().toISOString()
    };

    try {
      await postToWebhook(payload);
      clearStatus();
      showStep('done');
      doneMessageEl.textContent = 'Thanks. We will follow up around then.';
    } catch (err) {
      setStatus('error', 'Your response method is already saved. We had trouble saving the timeframe; feel free to try again, or we will just follow up directly.');
      fallbackEl.style.display = 'block';
      timeframeButtons.forEach(function (b) { b.disabled = false; });
      useDateBtn.disabled = false;
    }
  }
</script>
</body>
</html>
```

</details>

**After creating the file, fix the two placeholders that are still literal strings in this reference:**
- `REPLACE_WITH_PHONE` in the fallback div
- `REPLACE_WITH_N8N_PRODUCTION_WEBHOOK_URL` and `REPLACE_WITH_CALENDLY_OR_BOOKINGS_URL` in the script's CONFIG block

Leave them as obviously-fake placeholders if the real values aren't available yet; do not invent plausible-looking fake URLs, since a fake webhook URL that looks real is harder to spot later than an honest placeholder.

---

## Task 2: Local Test Pass

Before touching Vercel, open `index.html` directly in a browser (no server needed) and verify:

1. Load it with `?vid=TEST123&name=Test%20Vendor` appended to the file URL. Confirm "Test Vendor" renders under the heading.
2. Click each of the four primary buttons in turn (reloading with the query string between clicks). Since `WEBHOOK_URL` is still a placeholder, every click should fail gracefully: the status area shows the red error message, the fallback contact line appears, and the buttons re-enable. It should not throw an unhandled JS error in the console. Open the browser console and confirm this.
3. Confirm the "template" and "ehalo_self" choices are the only two that would advance to the timeframe screen (you can verify this by reading the branching logic in `submitChoice` rather than needing a working webhook yet).

This is a dead-webhook smoke test, not a full test. Full end-to-end testing happens after the webhook is live and is covered in Task 5.

---

## Task 3: Write `README.md`

Generate a README covering:
- What this project is (one paragraph)
- The four config placeholders and what each one is for
- How to run it locally (open the file directly, no server needed)
- How to deploy (Vercel CLI commands, see Task 4)
- A link back to this build spec file for anyone picking the project up later

Keep it short. This is a four-button static page, not a platform.

---

## Task 4: Deploy to Vercel

Cursor can run these in its integrated terminal. This assumes `npm` and Node are already installed; if not, that's a one-time manual install outside Cursor's control (nodejs.org).

```bash
npm install -g vercel
vercel login
vercel
```

Answer the CLI prompts: set up and deploy yes, default scope, new project (not linking an existing one), a project name like `wf-vendor-response`, and the current directory as the source. Vercel returns a live `*.vercel.app` URL.

Re-running `vercel` after any file change redeploys instantly; no separate build step exists for a static file like this.

**Custom domain (respond.specinsite.com or similar):** adding a subdomain and its DNS record happens in the Vercel dashboard and at whichever registrar manages specinsite.com, not in Cursor. That's covered in the separate human-executed build track referenced at the bottom of this file.

---

## Task 5: End-to-End Verification Checklist

Once a real `WEBHOOK_URL` is in place (from n8n, set up separately), verify all of the following. This is the full acceptance test for the page itself:

- [ ] Loading the page with a `vid` and `name` param displays the vendor's name correctly
- [ ] Clicking "template" logs a `stage: "choice"` payload and advances to the timeframe screen
- [ ] Clicking "ehalo_self" does the same
- [ ] Clicking "working_session" logs its choice and shows the scheduling link, with the link's `href` only set after a successful response (view page source before clicking anything and confirm the real Calendly/Bookings URL is *not* present in the raw HTML; it should only appear in the DOM after the click succeeds)
- [ ] Clicking "send_docs" logs its choice and shows the reply-to-email message with the correct address
- [ ] On the timeframe screen, each of the three preset buttons and the date picker all successfully log a `stage: "timeframe"` payload
- [ ] Killing network access (or pointing `WEBHOOK_URL` at a bad address temporarily) and clicking any button shows the red error state, re-enables the buttons, and reveals the fallback contact line, without a broken or blank page
- [ ] No unhandled errors appear in the browser console across any of the above
- [ ] The page renders correctly on a narrow mobile viewport (use the browser's device toolbar); buttons should stack cleanly and remain tappable

---

## Payload Contract (what the webhook receives)

Two payload shapes hit the same `WEBHOOK_URL`, distinguished by `stage`. This is the contract; do not change the field names without also updating whatever n8n workflow is consuming them.

**Primary choice** (fires on any of the four button clicks):
```json
{
  "stage": "choice",
  "vendor_id": "string, from the ?vid= URL param",
  "vendor_name": "string, from the ?name= URL param",
  "choice": "template | ehalo_self | working_session | send_docs",
  "choice_label": "string, the button's visible label",
  "submitted_at": "ISO 8601 timestamp"
}
```

**Timeframe** (fires only after template or ehalo_self, from the second screen):
```json
{
  "stage": "timeframe",
  "vendor_id": "string, same value as the choice payload for this vendor",
  "vendor_name": "string",
  "timeframe": "this_week | next_two_weeks | need_more_time | an ISO date string",
  "timeframe_label": "string, human-readable version",
  "timeframe_submitted_at": "ISO 8601 timestamp"
}
```

The receiving n8n workflow is expected to upsert on `vendor_id` (match existing row, update if found, insert if not) so both payloads for the same vendor land on one row rather than two.

---

## What Cursor Is Not Building

These happen outside a code editor and are covered in a separate, already-written step-by-step document (ask for it if it's not in this same folder or chat):

- Creating the wholefoods@specinsite.com mailbox in Microsoft 365
- Setting up the n8n webhook, its tracker-write logic, and the outreach email workflow
- Adding the specinsite.com subdomain in Vercel's dashboard and the matching DNS record at the registrar
- Creating the actual Calendly or Microsoft Bookings event

If asked to help troubleshoot any of those from within Cursor (for example, debugging why a webhook call fails), that's fair game; building them from scratch is not this project's job.
