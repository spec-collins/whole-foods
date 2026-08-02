/**
 * Full-stack test: the real page in headless Chrome, talking to the real
 * serverless handlers, writing to a real Postgres database.
 *
 * tests/page.test.mjs covers the page against a mock webhook; this covers the
 * whole path end to end. Requires TEST_DATABASE_URL pointing at a scratch
 * database, and puppeteer. See tests/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, ROOT } from '../lib/env.js';
import { useScratchDatabase } from './support/scratch-db.mjs';

loadLocalEnv();

useScratchDatabase();

const SCHEDULING_URL = 'https://booking.example.test/specinsite/working-session';
process.env.ADMIN_TOKEN = 'e2e-admin-token';
process.env.SCHEDULING_URL = SCHEDULING_URL;
process.env.RATE_LIMIT_PER_MINUTE = '0';
delete process.env.LINK_SIGNING_SECRET;

const puppeteer = await (async () => {
  const from = process.env.PUPPETEER_DIR || process.cwd();
  try {
    const resolved = createRequire(path.join(from, 'noop.js')).resolve('puppeteer');
    return (await import(pathToFileURL(resolved).href)).default;
  } catch {
    return (await import('puppeteer')).default;
  }
})();

const { query, closePool } = await import('../lib/db.js');
const { createServer } = await import('../scripts/dev-server.mjs');
const { signVendorId } = await import('../lib/signing.js');

await query('DROP TABLE IF EXISTS vendor_responses, response_events');
await query(fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8'));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const errors = [];

async function open(qs) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${qs}`);
  return page;
}
const shown = (page, sel) =>
  page.waitForFunction((s) => window.getComputedStyle(document.querySelector(s)).display !== 'none', { timeout: 5000 }, sel);
const rowFor = async (id) => (await query('SELECT * FROM vendor_responses WHERE vendor_id = $1', [id])).rows[0];

// A vendor picks the template, then a timeframe.
{
  const page = await open('vid=E2E-1&name=Sunridge%20Organic%20Farms');
  await page.click('[data-choice="template"]');
  await shown(page, '#stepTimeframe');
  check('choosing the template advances to the timeframe screen', true);

  let row = await rowFor('E2E-1');
  check('the choice reached Postgres',
    row.choice === 'template' && row.vendor_name === 'Sunridge Organic Farms', JSON.stringify(row));

  await page.click('[data-timeframe="next_two_weeks"]');
  await shown(page, '#stepDone');
  row = await rowFor('E2E-1');
  check('the timeframe merged onto the same row',
    row.choice === 'template' && row.timeframe === 'next_two_weeks', JSON.stringify(row));
  await page.close();
}

// The date picker path.
{
  const page = await open('vid=E2E-date&name=Acme');
  await page.click('[data-choice="ehalo_self"]');
  await shown(page, '#stepTimeframe');
  await page.$eval('#timeframeDate', (el) => {
    el.value = '2026-10-01';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#useDateBtn');
  await shown(page, '#stepDone');
  const row = await rowFor('E2E-date');
  check('a specific date from the picker is stored',
    row.choice === 'ehalo_self' && row.timeframe === '2026-10-01', JSON.stringify(row));
  await page.close();
}

// The booking URL is served by the API, not baked into the page.
{
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  check('the booking URL is absent from the page source', !html.includes(SCHEDULING_URL));

  const page = await open('vid=E2E-ws&name=Acme');
  await page.click('[data-choice="working_session"]');
  await shown(page, '#stepSchedule');
  const href = await page.$eval('#calendlyLink', (el) => el.href);
  check('the booking link is populated from the API response', href === SCHEDULING_URL, href);
  check('the working session choice was stored', (await rowFor('E2E-ws')).choice === 'working_session');
  await page.close();
}

// The shipping configuration for this round: no booking tool, so the step must
// ask for availability by email rather than render a dead button.
{
  const original = process.env.SCHEDULING_URL;
  delete process.env.SCHEDULING_URL;

  const page = await open('vid=E2E-nolink&name=Acme');
  await page.click('[data-choice="working_session"]');
  await shown(page, '#stepSchedule');

  const state = await page.evaluate(() => ({
    linkHidden: window.getComputedStyle(document.querySelector('#calendlyLink')).display === 'none',
    message: document.querySelector('#scheduleNoLink').textContent.replace(/\s+/g, ' ').trim(),
    messageShown: window.getComputedStyle(document.querySelector('#scheduleNoLink')).display !== 'none',
    mailto: document.querySelector('#scheduleNoLink a').getAttribute('href'),
  }));
  check('with no booking tool, the dead button is hidden and availability is requested by email',
    state.linkHidden && state.messageShown && /reply to this email/i.test(state.message) &&
    /times that work/i.test(state.message),
    state.message);
  check('the working session step gives the contact address',
    state.mailto === 'mailto:wfm-amazongrocery@specinsite.com', state.mailto);
  check('the working session choice is recorded even without a booking tool',
    (await rowFor('E2E-nolink')).choice === 'working_session');
  await page.close();

  process.env.SCHEDULING_URL = original;
}

// The dead-end choice.
{
  const page = await open('vid=E2E-docs&name=Acme');
  await page.click('[data-choice="send_docs"]');
  await shown(page, '#stepDocsReply');
  check('send_docs stores the choice and shows the reply-to-email screen',
    (await rowFor('E2E-docs')).choice === 'send_docs');

  const contact = await page.$eval('#stepDocsReply', (el) => el.textContent);
  const mailto = await page.$eval('#stepDocsReply a', (el) => el.getAttribute('href'));
  check('the send-documents screen names the current contact address',
    contact.includes('wfm-amazongrocery@specinsite.com') && mailto === 'mailto:wfm-amazongrocery@specinsite.com',
    mailto);
  await page.close();
}

// Signed links.
{
  process.env.LINK_SIGNING_SECRET = 'e2e-signing-secret';

  const unsigned = await open('vid=E2E-unsigned&name=Acme');
  await unsigned.click('[data-choice="template"]');
  await unsigned.waitForFunction(() => document.querySelector('#status').className === 'error', { timeout: 5000 });
  const fallback = await unsigned.$eval('#fallback', (el) => window.getComputedStyle(el).display !== 'none');
  check('an unsigned link is refused and the page shows the fallback contact line',
    fallback && !(await rowFor('E2E-unsigned')));
  await unsigned.close();

  const token = signVendorId('E2E-signed', 'e2e-signing-secret');
  const signed = await open(`vid=E2E-signed&name=Acme&t=${encodeURIComponent(token)}`);
  await signed.click('[data-choice="template"]');
  await shown(signed, '#stepTimeframe');
  check('a signed link is accepted and stored', (await rowFor('E2E-signed')).choice === 'template');
  await signed.close();

  delete process.env.LINK_SIGNING_SECRET;
}

// The database is down.
{
  const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = original;
  await query('DROP TABLE response_events');

  const page = await open('vid=E2E-broken&name=Acme');
  await page.click('[data-choice="template"]');
  await page.waitForFunction(() => document.querySelector('#status').className === 'error', { timeout: 5000 });
  const reEnabled = await page.$$eval('#stepChoice .option-btn', (b) => b.every((x) => !x.disabled));
  const fallback = await page.evaluate(() => ({
    shown: window.getComputedStyle(document.querySelector('#fallback')).display !== 'none',
    text: document.querySelector('#fallback').textContent.trim(),
  }));
  check('a backend failure shows the error state and re-enables the buttons', reEnabled);
  check('the failure fallback gives the contact address and no placeholder phone number',
    fallback.shown && fallback.text.includes('wfm-amazongrocery@specinsite.com') && !/REPLACE_WITH/.test(fallback.text),
    fallback.text);
  await page.close();

  await query(fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8'));
}

// The export reflects what the browser produced.
{
  const res = await fetch(`${BASE}/api/export?format=json&token=e2e-admin-token`);
  const body = await res.json();
  const ids = body.responses.map((r) => r.vendor_id).sort();
  check('the export lists every vendor the browser submitted',
    ids.join(',') === 'E2E-1,E2E-date,E2E-docs,E2E-nolink,E2E-signed,E2E-ws', ids.join(','));

  const xlsx = Buffer.from(
    await (await fetch(`${BASE}/api/export?format=xlsx&token=e2e-admin-token`)).arrayBuffer()
  );
  check('the xlsx export downloads as a valid zip', xlsx.subarray(0, 2).toString() === 'PK', `${xlsx.length} bytes`);
}

check('no unhandled JavaScript errors in any scenario', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
await closePool();

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
