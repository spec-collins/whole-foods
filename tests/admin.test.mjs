/**
 * Drives public/admin.html in headless Chrome against the real API and a real
 * Postgres database. Requires TEST_DATABASE_URL pointing at a scratch
 * database, plus puppeteer. See tests/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, ROOT } from '../lib/env.js';
import { useScratchDatabase } from './support/scratch-db.mjs';

loadLocalEnv();

useScratchDatabase();

process.env.ADMIN_TOKEN = 'admin-ui-token';
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

const submit = (payload) =>
  fetch(`${BASE}/api/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

// One vendor of each shape, so every status badge is exercised.
await submit({ stage: 'choice', vendor_id: 'V-complete', vendor_name: 'Sunridge Organic Farms', choice: 'template', choice_label: 'Template', submitted_at: new Date().toISOString() });
await submit({ stage: 'timeframe', vendor_id: 'V-complete', timeframe: 'this_week', timeframe_label: 'This week', timeframe_submitted_at: new Date().toISOString() });
await submit({ stage: 'choice', vendor_id: 'V-pending', vendor_name: 'Harbor Provisions', choice: 'ehalo_self', choice_label: 'eHalo', submitted_at: new Date().toISOString() });
await submit({ stage: 'choice', vendor_id: 'V-booking', vendor_name: 'Cedar & Vine', choice: 'working_session', choice_label: 'Session', submitted_at: new Date().toISOString() });
await submit({ stage: 'choice', vendor_id: 'V-docs', vendor_name: 'Northfield Dairy', choice: 'send_docs', choice_label: 'Docs', submitted_at: new Date().toISOString() });
await submit({ stage: 'timeframe', vendor_id: 'V-nochoice', vendor_name: 'Orphan Timeframe Co', timeframe: 'need_more_time', timeframe_label: 'Need more time', timeframe_submitted_at: new Date().toISOString() });

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const pageErrors = [];
const page = await browser.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));
await page.setViewport({ width: 1280, height: 900 });
await page.goto(`${BASE}/admin.html`);

const rowCount = () => page.$$eval('#tbody tr:not(.test-separator)', (rows) => rows.length);
const badges = () => page.$$eval('#tbody .badge', (b) => b.map((x) => x.textContent));
const tiles = () =>
  page.$$eval('#tiles .tile', (t) => Object.fromEntries(t.map((x) => [x.querySelector('.k').textContent, x.querySelector('.n').textContent])));

// A wrong token must not reveal anything.
{
  await page.type('#token', 'wrong-token');
  await page.click('#loadBtn');
  await page.waitForFunction(() => document.querySelector('#message').className === 'error', { timeout: 5000 });
  const message = await page.$eval('#message', (e) => e.textContent);
  const hidden = await page.$eval('#dashboard', (e) => e.hidden);
  check('a wrong token is rejected and no data is shown', hidden && /not accepted/i.test(message), message);
}

{
  await page.$eval('#token', (el) => { el.value = ''; });
  await page.type('#token', 'admin-ui-token');
  await page.click('#loadBtn');
  await page.waitForFunction(() => !document.querySelector('#dashboard').hidden, { timeout: 5000 });
  check('the correct token loads the dashboard', (await rowCount()) === 5, `rows=${await rowCount()}`);
}

{
  const t = await tiles();
  check('summary tiles count vendors and completion',
    t['Real vendors'] === '5' && t['Complete (real)'] === '1' && t['Need follow-up (real)'] === '4', JSON.stringify(t));
  check('summary tiles break down by choice',
    t['Spreadsheet template'] === '1' && t['Working session'] === '1' && t['Sending documents'] === '1',
    JSON.stringify(t));
}

{
  const list = await badges();
  check('each vendor gets the right status badge',
    list.includes('Complete') && list.includes('Timeframe pending') &&
    list.includes('Awaiting booking') && list.includes('Awaiting documents') &&
    list.includes('No choice recorded'),
    list.join(' | '));
}

{
  await page.type('#search', 'harbor');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 1, { timeout: 5000 });
  const text = await page.$eval('#tbody tr:not(.test-separator)', (r) => r.textContent);
  check('search filters by vendor name', text.includes('Harbor Provisions'), text.trim().slice(0, 40));

  await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('#search', 'V-docs');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 1, { timeout: 5000 });
  check('search also matches the vendor ID', (await page.$eval('#tbody tr:not(.test-separator)', (r) => r.textContent)).includes('Northfield'));

  await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
}

{
  await page.select('#filterStatus', 'complete');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 1, { timeout: 5000 });
  check('the status filter isolates completed vendors',
    (await page.$eval('#tbody .badge.complete', (b) => b.textContent)) === 'Complete');

  await page.select('#filterStatus', '');
  await page.select('#filterChoice', '__none');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 1, { timeout: 5000 });
  check('the choice filter can isolate vendors with no choice recorded',
    (await page.$eval('#tbody tr:not(.test-separator)', (r) => r.textContent)).includes('Orphan Timeframe Co'));

  await page.select('#filterChoice', '');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 5, { timeout: 5000 });
  check('clearing the filters restores every row', (await rowCount()) === 5);
}

{
  // Mark one vendor as Test; it should move below all Real rows.
  await page.$$eval('#tbody tr:not(.test-separator)', (rows) => {
    const harbor = rows.find((r) => r.textContent.includes('Harbor Provisions'));
    if (harbor) harbor.querySelector('button.flag-btn').click();
  });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#tbody tr:not(.test-separator)')];
    if (rows.length !== 5) return false;
    const last = rows[rows.length - 1];
    const sep = document.querySelector('#tbody tr.test-separator');
    return last.classList.contains('is-test')
      && last.textContent.includes('Harbor Provisions')
      && !!sep;
  }, { timeout: 5000 });
  check('Mark Test sinks that vendor below all Real vendors', true);
  check('a separator row divides Real vendors from Test vendors',
    (await page.$eval('#tbody tr.test-separator', (r) => r.textContent)).includes('Test vendors'));

  const t = await tiles();
  check('tiles exclude Test vendors from Real counts',
    t['Real vendors'] === '4' && t['Test vendors'] === '1', JSON.stringify(t));

  await page.select('#filterKind', 'test');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 1, { timeout: 5000 });
  check('Vendor type filter can show Test only',
    (await page.$eval('#tbody tr:not(.test-separator)', (r) => r.textContent)).includes('Harbor Provisions'));

  await page.select('#filterKind', 'real');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 4, { timeout: 5000 });
  check('Vendor type filter can show Real only', (await rowCount()) === 4);
  check('Real-only filter hides the Test separator',
    (await page.$$('#tbody tr.test-separator')).length === 0);

  await page.select('#filterKind', '');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 5, { timeout: 5000 });

  // Toggle back so later checks that expect 5 unmarked rows stay simple.
  await page.$$eval('#tbody tr:not(.test-separator)', (rows) => {
    const harbor = rows.find((r) => r.textContent.includes('Harbor Provisions'));
    if (harbor) harbor.querySelector('button.flag-btn').click();
  });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('#tbody tr:not(.test-separator)')];
    return rows.length === 5
      && rows.every((r) => !r.classList.contains('is-test'))
      && !document.querySelector('#tbody tr.test-separator');
  }, { timeout: 5000 });
}

{
  const empty = await page.evaluate(async () => {
    const search = document.querySelector('#search');
    search.value = 'zzzz-no-such-vendor';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const state = document.querySelector('#emptyState');
    return { hidden: state.hidden, text: state.textContent };
  });
  check('an empty filter result explains itself', !empty.hidden && /No vendors match/.test(empty.text), empty.text);
  await page.$eval('#search', (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
}

// Downloads are fetched with the token as a header, so it must not appear in
// any request URL.
{
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  const authHeaders = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/export')) authHeaders.push(r.headers().authorization || '');
  });

  await page.click('#xlsxBtn');
  await page.waitForFunction(() => !document.querySelector('#xlsxBtn').disabled, { timeout: 5000 });

  check('the export request carries the token as a bearer header',
    authHeaders.some((h) => h === 'Bearer admin-ui-token'), authHeaders.join(','));
  check('the token never appears in a request URL',
    !urls.some((u) => u.includes('admin-ui-token')));
}

{
  const stored = await page.evaluate(() => sessionStorage.getItem('wf_admin_token'));
  check('the token is kept in sessionStorage, not localStorage',
    stored === 'admin-ui-token' && (await page.evaluate(() => localStorage.length)) === 0);
}

{
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#dashboard').hidden, { timeout: 5000 });
  check('a reload restores the session without retyping the token', (await rowCount()) === 5);
  check('the token prompt is out of the way once signed in',
    await page.$eval('#authCard', (e) => e.hidden));
}

{
  await page.click('#signOutBtn');
  await page.waitForFunction(() => document.querySelector('#dashboard').hidden, { timeout: 5000 });
  const cleared = await page.evaluate(() => sessionStorage.getItem('wf_admin_token'));
  check('signing out clears the stored token and hides the data', cleared === null);

  await page.reload();
  await new Promise((r) => setTimeout(r, 300));
  check('after signing out, a reload does not load data', await page.$eval('#dashboard', (e) => e.hidden));

  await page.type('#token', 'admin-ui-token');
  await page.click('#loadBtn');
  await page.waitForFunction(() => !document.querySelector('#dashboard').hidden, { timeout: 5000 });
}

// A vendor name containing markup must be rendered as text.
{
  await submit({
    stage: 'choice', vendor_id: 'V-xss', vendor_name: '<img src=x onerror=alert(1)>',
    choice: 'template', choice_label: 'Template', submitted_at: new Date().toISOString(),
  });
  await page.click('#refreshBtn');
  await page.waitForFunction(() => document.querySelectorAll('#tbody tr:not(.test-separator)').length === 6, { timeout: 5000 });
  const injected = await page.$$eval('#tbody img', (imgs) => imgs.length);
  const shownAsText = await page.$$eval('#tbody tr:not(.test-separator)', (rows) =>
    rows.some((r) => r.textContent.includes('<img src=x onerror=alert(1)>')));
  check('a vendor name containing markup is escaped, not rendered',
    injected === 0 && shownAsText, `imgs=${injected} asText=${shownAsText}`);
}

{
  await page.setViewport({ width: 390, height: 800, isMobile: true });
  await page.reload();
  await page.waitForFunction(() => !document.querySelector('#dashboard').hidden, { timeout: 5000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('the dashboard does not overflow a phone viewport', overflow <= 0, `overflow=${overflow}px`);
}

check('no unhandled JavaScript errors', pageErrors.length === 0, pageErrors.join(' | '));

await browser.close();
server.close();
await closePool();

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
