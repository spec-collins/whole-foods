/**
 * Automated version of Task 2 and Task 5 in CURSOR_BUILD_SPEC.md.
 * Serves index.html against a mock webhook and drives it in headless Chrome.
 * See tests/README.md for how to run it.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public/index.html');

// The repo has no package.json by design, so puppeteer is expected to live in
// a scratch directory. Resolve it from PUPPETEER_DIR or the current working
// directory before falling back to normal resolution.
const puppeteer = await (async () => {
  const from = process.env.PUPPETEER_DIR || process.cwd();
  try {
    const resolved = createRequire(path.join(from, 'noop.js')).resolve('puppeteer');
    return (await import(pathToFileURL(resolved).href)).default;
  } catch {
    return (await import('puppeteer')).default;
  }
})();
const REAL_SCHEDULING_URL = 'https://calendly.example-booking-host.test/specinsite/working-session';

let received = [];
let webhookMode = 'ok'; // 'ok' | 'fail'

const webhook = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (webhookMode === 'fail') {
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
      return res.end('{"ok":false}');
    }
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* record raw below */ }
    received.push({ contentType: req.headers['content-type'], body, parsed });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, scheduling_url: REAL_SCHEDULING_URL }));
  });
});
await new Promise((r) => webhook.listen(0, '127.0.0.1', r));
const WEBHOOK_URL = `http://127.0.0.1:${webhook.address().port}/hook`;

const CONFIGURED_URL = '"/api/respond"';

/**
 * "live" points the page at the mock webhook; "unconfigured" swaps in an
 * unreplaced placeholder to prove the page fails safely when nobody has set
 * the endpoint. Also covers pointing the page at an external webhook (n8n or
 * Apps Script) rather than the bundled API.
 */
function buildPage(mode) {
  const html = fs.readFileSync(SRC, 'utf8');
  if (!html.includes(CONFIGURED_URL)) {
    throw new Error(`index.html no longer contains ${CONFIGURED_URL}; update this test.`);
  }
  if (mode === 'live') return html.replace(CONFIGURED_URL, JSON.stringify(WEBHOOK_URL));
  return html.replace(CONFIGURED_URL, '"REPLACE_WITH_WEBHOOK_URL"');
}

let currentHtml = buildPage('unconfigured');
const site = http.createServer((req, res) => {
  // Mirror Vercel: only the page path exists, everything else 404s.
  const path = new URL(req.url, 'http://x').pathname;
  if (path !== '/' && path !== '/index.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not Found');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(currentHtml);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

async function newPage() {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.pageErrors = pageErrors;
  return page;
}

const visible = (page, sel) =>
  page.$eval(sel, (el) => window.getComputedStyle(el).display !== 'none');

// ---------------------------------------------------------------------------
// Task 2: dead-webhook smoke test (placeholder WEBHOOK_URL still in place)
// ---------------------------------------------------------------------------
currentHtml = buildPage('unconfigured');

{
  const page = await newPage();
  await page.goto(`${SITE}/?vid=TEST123&name=Test%20Vendor`);
  check(
    'unconfigured: vendor name renders from ?name=',
    (await page.$eval('#vendorName', (el) => el.textContent)) === 'Test Vendor'
  );

  for (const choice of ['template', 'ehalo_self', 'working_session', 'send_docs']) {
    await page.goto(`${SITE}/?vid=TEST123&name=Test%20Vendor`);
    await page.click(`[data-choice="${choice}"]`);
    await page.waitForFunction(() => document.querySelector('#status').className === 'error', { timeout: 5000 });
    const fallbackShown = await visible(page, '#fallback');
    const reEnabled = await page.$$eval('#stepChoice .option-btn', (b) => b.every((x) => !x.disabled));
    const stillOnChoice = await visible(page, '#stepChoice');
    check(`unconfigured: ${choice} shows error + fallback + re-enabled buttons`, fallbackShown && reEnabled && stillOnChoice,
      `fallback=${fallbackShown} reEnabled=${reEnabled} onChoice=${stillOnChoice}`);
  }
  check('unconfigured: no unhandled page errors', page.pageErrors.length === 0, page.pageErrors.join(' | '));
  await page.close();
}

// Regression: URLSearchParams already decodes, so a literal % in the vendor
// name used to throw URIError and kill the whole script.
{
  const page = await newPage();
  await page.goto(`${SITE}/?vid=T1&name=${encodeURIComponent('100% Juice Co & Sons')}`);
  const name = await page.$eval('#vendorName', (el) => el.textContent);
  check("percent sign in vendor name doesn't break the page", name === '100% Juice Co & Sons' && page.pageErrors.length === 0,
    `name=${JSON.stringify(name)} errors=${page.pageErrors.join(' | ')}`);
  await page.close();
}

// ---------------------------------------------------------------------------
// Task 5: end-to-end against a live mock webhook
// ---------------------------------------------------------------------------
currentHtml = buildPage('live');
webhookMode = 'ok';

check('live build: real scheduling URL is NOT in page source', !currentHtml.includes(REAL_SCHEDULING_URL));

for (const choice of ['template', 'ehalo_self']) {
  received = [];
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-${choice}&name=Acme%20Foods`);
  await page.click(`[data-choice="${choice}"]`);
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepTimeframe')).display !== 'none', { timeout: 5000 });
  const p = received[0]?.parsed;
  check(`live: ${choice} posts stage=choice and advances to timeframe`,
    p?.stage === 'choice' && p?.choice === choice && p?.vendor_id === `V-${choice}` &&
    p?.vendor_name === 'Acme Foods' && typeof p?.choice_label === 'string' && p.choice_label.length > 0 &&
    !Number.isNaN(Date.parse(p?.submitted_at)),
    JSON.stringify(p));
  check(`live: ${choice} no page errors`, page.pageErrors.length === 0, page.pageErrors.join(' | '));
  await page.close();
}

for (const tf of ['this_week', 'next_two_weeks', 'need_more_time']) {
  received = [];
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-tf&name=Acme%20Foods`);
  await page.click('[data-choice="template"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepTimeframe')).display !== 'none', { timeout: 5000 });
  await page.click(`[data-timeframe="${tf}"]`);
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepDone')).display !== 'none', { timeout: 5000 });
  const p = received[1]?.parsed;
  check(`live: timeframe "${tf}" posts stage=timeframe`,
    p?.stage === 'timeframe' && p?.timeframe === tf && p?.vendor_id === 'V-tf' &&
    !Number.isNaN(Date.parse(p?.timeframe_submitted_at)),
    JSON.stringify(p));
  const done = await page.$eval('#doneMessage', (el) => el.textContent);
  check(`live: timeframe "${tf}" shows done message`, done.length > 0, done);
  await page.close();
}

{
  received = [];
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-date&name=Acme%20Foods`);
  await page.click('[data-choice="ehalo_self"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepTimeframe')).display !== 'none', { timeout: 5000 });

  await page.click('#useDateBtn');
  const guardFired = await page.$eval('#status', (el) => el.className === 'error');
  check('live: "Use this date" with no date shows a guard message, posts nothing',
    guardFired && received.length === 1, `guard=${guardFired} posts=${received.length}`);

  await page.$eval('#timeframeDate', (el) => {
    el.value = '2026-09-15';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#useDateBtn');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepDone')).display !== 'none', { timeout: 5000 });
  const p = received[1]?.parsed;
  check('live: date picker posts stage=timeframe with the ISO date',
    p?.stage === 'timeframe' && p?.timeframe === '2026-09-15' && p?.timeframe_label.includes('2026-09-15'),
    JSON.stringify(p));
  await page.close();
}

{
  received = [];
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-ws&name=Acme%20Foods`);
  const hrefBefore = await page.$eval('#calendlyLink', (el) => el.getAttribute('href'));
  await page.click('[data-choice="working_session"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepSchedule')).display !== 'none', { timeout: 5000 });
  const hrefAfter = await page.$eval('#calendlyLink', (el) => el.href);
  check('live: working_session shows schedule step and only then sets the real href',
    hrefBefore === '#' && hrefAfter === REAL_SCHEDULING_URL && received[0]?.parsed?.choice === 'working_session',
    `before=${hrefBefore} after=${hrefAfter}`);
  await page.close();
}

{
  received = [];
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-docs&name=Acme%20Foods`);
  await page.click('[data-choice="send_docs"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepDocsReply')).display !== 'none', { timeout: 5000 });
  const text = await page.$eval('#stepDocsReply', (el) => el.textContent);
  check('live: send_docs posts choice and shows the reply-to-email dead end',
    received[0]?.parsed?.choice === 'send_docs' && text.includes('reply to this email'), text.trim().slice(0, 60));
  const hasTimeframe = await visible(page, '#stepTimeframe');
  check('live: send_docs does not advance to timeframe', !hasTimeframe);
  await page.close();
}

// Content type actually sent on the wire (matters for the Apps Script route).
check('live: webhook receives application/json by default',
  (received[0]?.contentType || '').includes('application/json'), received[0]?.contentType);

// Webhook returns 500
{
  webhookMode = 'fail';
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-500&name=Acme%20Foods`);
  await page.click('[data-choice="template"]');
  await page.waitForFunction(() => document.querySelector('#status').className === 'error', { timeout: 5000 });
  const fallbackShown = await visible(page, '#fallback');
  const reEnabled = await page.$$eval('#stepChoice .option-btn', (b) => b.every((x) => !x.disabled));
  check('live: webhook 500 shows error, re-enables buttons, reveals fallback',
    fallbackShown && reEnabled && page.pageErrors.length === 0);
  await page.close();
  webhookMode = 'ok';
}

// Timeframe-stage failure keeps the reassuring copy about the saved choice
{
  const page = await newPage();
  await page.goto(`${SITE}/?vid=V-tf500&name=Acme%20Foods`);
  await page.click('[data-choice="template"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepTimeframe')).display !== 'none', { timeout: 5000 });
  webhookMode = 'fail';
  await page.click('[data-timeframe="this_week"]');
  await page.waitForFunction(() => document.querySelector('#status').className === 'error', { timeout: 5000 });
  const msg = await page.$eval('#status', (el) => el.textContent);
  const reEnabled = await page.$$eval('#stepTimeframe .option-btn[data-timeframe]', (b) => b.every((x) => !x.disabled));
  check('live: timeframe failure reassures that the choice is already saved and retries are possible',
    msg.includes('already saved') && reEnabled, msg);
  await page.close();
  webhookMode = 'ok';
}

// Mobile viewport
{
  const page = await newPage();
  await page.setViewport({ width: 320, height: 640, isMobile: true });
  await page.goto(`${SITE}/?vid=V-m&name=A%20Fairly%20Long%20Vendor%20Name%20LLC`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const minH = await page.$$eval('#stepChoice .option-btn', (b) => Math.min(...b.map((x) => x.getBoundingClientRect().height)));
  check('mobile 320px: no horizontal overflow', overflow <= 0, `overflow=${overflow}px`);
  check('mobile 320px: choice buttons stay tappable (>=44px)', minH >= 44, `min=${Math.round(minH)}px`);

  await page.click('[data-choice="template"]');
  await page.waitForFunction(() => window.getComputedStyle(document.querySelector('#stepTimeframe')).display !== 'none', { timeout: 5000 });
  const rowOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('mobile 320px: date row does not overflow', rowOverflow <= 0, `overflow=${rowOverflow}px`);
  await page.close();
}

await browser.close();
webhook.close();
site.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
