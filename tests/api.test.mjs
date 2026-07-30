/**
 * Integration tests for the serverless API against a real Postgres database.
 *
 * Requires TEST_DATABASE_URL (or DATABASE_URL) pointing at a database you are
 * happy to have wiped -- the suite drops and recreates its two tables. See
 * tests/README.md for a local Postgres recipe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv, ROOT } from '../lib/env.js';

loadLocalEnv();

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!process.env.DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL or DATABASE_URL to run the API tests.');
  process.exit(1);
}

process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.SCHEDULING_URL = 'https://booking.example.test/working-session';
process.env.IP_HASH_SALT = 'test-salt';
process.env.RATE_LIMIT_PER_MINUTE = '0';
delete process.env.LINK_SIGNING_SECRET;

const { query, closePool } = await import('../lib/db.js');
const { createServer } = await import('../scripts/dev-server.mjs');
const { signVendorId } = await import('../lib/signing.js');

await query('DROP TABLE IF EXISTS vendor_responses, response_events');
await query(fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8'));

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

const post = (body, headers = {}) =>
  fetch(`${BASE}/api/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const choicePayload = (over = {}) => ({
  stage: 'choice',
  vendor_id: 'V-1',
  vendor_name: 'Acme Foods',
  choice: 'template',
  choice_label: "I'll fill out the spreadsheet template",
  submitted_at: new Date().toISOString(),
  ...over,
});

const timeframePayload = (over = {}) => ({
  stage: 'timeframe',
  vendor_id: 'V-1',
  vendor_name: 'Acme Foods',
  timeframe: 'this_week',
  timeframe_label: 'This week',
  timeframe_submitted_at: new Date().toISOString(),
  ...over,
});

const rowFor = async (vendorId) =>
  (await query('SELECT * FROM vendor_responses WHERE vendor_id = $1', [vendorId])).rows[0];

// --- health ----------------------------------------------------------------
{
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  check('health reports a migrated, reachable database',
    res.status === 200 && body.ok === true && body.migrated === true && body.vendors === 0,
    JSON.stringify(body));
  check('health reports which optional features are on',
    body.config.admin_token_set === true && body.config.link_signing_enabled === false,
    JSON.stringify(body.config));
}

// --- happy path ------------------------------------------------------------
{
  const res = await post(choicePayload());
  const body = await res.json();
  check('choice is accepted', res.status === 200 && body.ok === true, JSON.stringify(body));
  check('response carries scheduling_url from the environment',
    body.scheduling_url === 'https://booking.example.test/working-session');

  const row = await rowFor('V-1');
  check('choice row written',
    row.choice === 'template' && row.vendor_name === 'Acme Foods' && row.choice_submitted_at instanceof Date,
    JSON.stringify(row));
  check('timeframe columns still empty', row.timeframe === null && row.timeframe_label === null);
}

{
  await post(timeframePayload());
  const row = await rowFor('V-1');
  check('timeframe merges onto the same row, preserving the choice',
    row.choice === 'template' && row.timeframe === 'this_week' && row.timeframe_label === 'This week',
    JSON.stringify(row));

  const { rows } = await query('SELECT count(*)::int AS n FROM vendor_responses');
  check('still one vendor row after two stages', rows[0].n === 1, `rows=${rows[0].n}`);
}

{
  // The vendor goes back and picks a different method.
  await post(choicePayload({ choice: 'ehalo_self', choice_label: 'eHalo' }));
  const row = await rowFor('V-1');
  check('re-submitting a choice updates it without clearing the timeframe',
    row.choice === 'ehalo_self' && row.timeframe === 'this_week', JSON.stringify(row));
}

{
  await post(choicePayload({ vendor_id: 'V-2', vendor_name: 'Second Co', choice: 'send_docs' }));
  const { rows } = await query('SELECT count(*)::int AS n FROM vendor_responses');
  check('a new vendor_id inserts a separate row', rows[0].n === 2, `rows=${rows[0].n}`);
}

{
  const { rows } = await query('SELECT count(*)::int AS n FROM response_events');
  check('every submission is captured in the append-only event log', rows[0].n === 4, `events=${rows[0].n}`);
  const { rows: hashed } = await query('SELECT ip_hash FROM response_events LIMIT 1');
  check('events store a hashed IP, not a raw address',
    /^[0-9a-f]{32}$/.test(hashed[0].ip_hash), hashed[0].ip_hash);
}

{
  await post(timeframePayload({ vendor_id: 'V-date', timeframe: '2026-09-15', timeframe_label: 'Specific date: 2026-09-15' }));
  const row = await rowFor('V-date');
  check('a specific date is accepted as a timeframe', row.timeframe === '2026-09-15', JSON.stringify(row));
}

// --- validation ------------------------------------------------------------
const badRequests = [
  ['unknown stage', { ...choicePayload(), stage: 'nonsense' }],
  ['choice outside the allowed set', choicePayload({ choice: 'drop table' })],
  ['timeframe that is neither preset nor date', timeframePayload({ timeframe: 'someday' })],
  ['malformed date as timeframe', timeframePayload({ timeframe: '2026-13-45' })],
  ['array instead of object', []],
];
for (const [label, payload] of badRequests) {
  const res = await post(payload);
  check(`rejects ${label} with 400`, res.status === 400, `status=${res.status}`);
}

{
  const res = await post('{not json');
  check('rejects malformed JSON with 400', res.status === 400, `status=${res.status}`);
}
{
  const res = await post(choicePayload({ vendor_name: 'x'.repeat(50_000) }));
  check('rejects an oversized body with 413', res.status === 413, `status=${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/respond`);
  check('rejects GET on /api/respond with 405', res.status === 405, `status=${res.status}`);
}
{
  const before = (await query('SELECT count(*)::int AS n FROM response_events')).rows[0].n;
  await post({ ...choicePayload(), stage: 'nonsense' });
  const after = (await query('SELECT count(*)::int AS n FROM response_events')).rows[0].n;
  check('a rejected submission writes nothing to the database', before === after, `${before} -> ${after}`);
}

{
  // Long, whitespace-padded and control-character input should be normalised.
  await post(choicePayload({ vendor_id: '  V-3  ', vendor_name: ' Messy\tName\n Co ' }));
  const row = await rowFor('V-3');
  check('input is trimmed and control characters collapsed',
    row && row.vendor_name === 'Messy Name Co', JSON.stringify(row));
}

// --- export ----------------------------------------------------------------
{
  const res = await fetch(`${BASE}/api/export?format=json`);
  check('export without a token is rejected', res.status === 401, `status=${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/export?format=json&token=wrong-token`);
  check('export with the wrong token is rejected', res.status === 401, `status=${res.status}`);
}
{
  const res = await fetch(`${BASE}/api/export?format=json`, {
    headers: { Authorization: 'Bearer test-admin-token' },
  });
  const body = await res.json();
  check('export as JSON returns every vendor',
    res.status === 200 && body.count === 4 && body.responses.length === 4, `count=${body.count}`);
}
{
  const res = await fetch(`${BASE}/api/export?format=csv&token=test-admin-token`);
  const text = await res.text();
  const lines = text.trim().split('\r\n');
  check('export as CSV has a header and one line per vendor',
    res.status === 200 && lines[0].endsWith('last_updated_at') && lines.length === 5,
    `lines=${lines.length}`);
  check('CSV is sent as a download',
    (res.headers.get('content-disposition') || '').includes('attachment') &&
    (res.headers.get('content-type') || '').includes('text/csv'));
}
{
  const res = await fetch(`${BASE}/api/export?format=xlsx&token=test-admin-token`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync('/tmp/wf-export.xlsx', buf);
  check('export as XLSX returns a zip container with the right content type',
    res.status === 200 && buf.subarray(0, 2).toString() === 'PK' &&
    (res.headers.get('content-type') || '').includes('spreadsheetml'),
    `${buf.length} bytes`);
}
{
  const res = await fetch(`${BASE}/api/export?format=pdf&token=test-admin-token`);
  check('an unsupported export format is rejected', res.status === 400, `status=${res.status}`);
}

// --- signed links ----------------------------------------------------------
{
  process.env.LINK_SIGNING_SECRET = 'test-signing-secret';

  const unsigned = await post(choicePayload({ vendor_id: 'V-signed' }));
  check('with signing on, an unsigned submission is rejected', unsigned.status === 403, `status=${unsigned.status}`);

  const wrong = await post(choicePayload({ vendor_id: 'V-signed', token: 'not-the-token' }));
  check('with signing on, a forged token is rejected', wrong.status === 403, `status=${wrong.status}`);

  const otherVendorToken = signVendorId('V-other', 'test-signing-secret');
  const reused = await post(choicePayload({ vendor_id: 'V-signed', token: otherVendorToken }));
  check("another vendor's token cannot be reused", reused.status === 403, `status=${reused.status}`);

  const good = await post(choicePayload({
    vendor_id: 'V-signed',
    token: signVendorId('V-signed', 'test-signing-secret'),
  }));
  check('a correctly signed submission is accepted', good.status === 200, `status=${good.status}`);

  delete process.env.LINK_SIGNING_SECRET;
}

// --- rate limiting ---------------------------------------------------------
{
  process.env.RATE_LIMIT_PER_MINUTE = '3';
  await query('DELETE FROM response_events');

  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await post(choicePayload({ vendor_id: `V-rl-${i}` }));
    statuses.push(res.status);
  }
  check('rate limit kicks in after the configured number of submissions',
    statuses.slice(0, 3).every((s) => s === 200) && statuses.slice(3).every((s) => s === 429),
    statuses.join(','));

  process.env.RATE_LIMIT_PER_MINUTE = '0';
  const after = await post(choicePayload({ vendor_id: 'V-rl-off' }));
  check('rate limit can be disabled with 0', after.status === 200, `status=${after.status}`);
}

server.close();
await closePool();

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
