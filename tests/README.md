# Tests

Optional dev tooling. The site itself has no dependencies and no build step; these scripts
exist so the Task 2 and Task 5 checklists in `../CURSOR_BUILD_SPEC.md` can be re-run
automatically after any edit, rather than clicked through by hand every time.

They deliberately live outside the deployed site and there is no `package.json` in this
repo, so install the one dependency in a scratch directory:

```bash
mkdir -p /tmp/wf-test && cd /tmp/wf-test
npm init -y && npm install puppeteer
npx puppeteer browsers install chrome
cd -                       # back to the repo root

PUPPETEER_DIR=/tmp/wf-test node tests/page.test.mjs
node tests/apps-script.test.mjs   # no dependencies at all
```

## `page.test.mjs`

Starts a mock webhook and a static server, then drives `index.html` in headless Chrome:

- **Dead webhook (Task 2)** — vendor name renders from `?name=`; all four choices show the
  red error state, reveal the fallback contact line, and re-enable the buttons; no unhandled
  JS errors.
- **Live webhook (Task 5)** — both `stage: "choice"` and `stage: "timeframe"` payloads match
  the contract; `template` and `ehalo_self` are the only choices that advance to the
  timeframe screen; the three presets and the date picker all post; `working_session` sets
  the booking `href` only after a successful response and the real URL is absent from page
  source; `send_docs` is a dead end.
- **Failure handling** — a 500 from the webhook at either stage shows the error state and
  re-enables the buttons.
- **Mobile** — no horizontal overflow at 320px and choice buttons stay at least 44px tall.

## `apps-script.test.mjs`

Runs `backend/google-apps-script.gs` against stubbed `SpreadsheetApp`, `LockService`,
`PropertiesService`, and `ContentService`. Verifies that a choice and a timeframe for the
same `vendor_id` land on one upserted row, that a different vendor inserts a new row, that
re-submitting a choice does not wipe an existing timeframe, that every payload is captured
in the audit log, and that malformed input is rejected without throwing.

Neither script touches the network beyond localhost, so both are safe to run offline.
