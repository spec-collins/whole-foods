/**
 * Migration tests against a real Postgres database.
 *
 * The case that matters: an earlier prototype of this project created a
 * vendor_responses table with the same name but created_at/updated_at instead
 * of first_seen_at/last_updated_at. CREATE TABLE IF NOT EXISTS is a no-op
 * against it, so without the ALTER statements the migration would report
 * success and every vendor click would then fail on a missing column.
 *
 * Requires TEST_DATABASE_URL pointing at a scratch database. See
 * tests/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLocalEnv, ROOT } from '../lib/env.js';
import { useScratchDatabase } from './support/scratch-db.mjs';

loadLocalEnv();

useScratchDatabase();

const run = promisify(execFile);
const { query, closePool } = await import('../lib/db.js');

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const migrate = () =>
  run(process.execPath, [path.join(ROOT, 'scripts/migrate.mjs')], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  }).then(
    (out) => ({ code: 0, ...out }),
    (err) => ({ code: err.code ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' })
  );

const columnsOf = async (table) =>
  (await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )).rows.map((r) => r.column_name);

// The earlier prototype's schema, verbatim in shape.
const LEGACY_SCHEMA = `
  CREATE TABLE vendor_responses (
    vendor_id              TEXT PRIMARY KEY,
    vendor_name            TEXT,
    choice                 TEXT,
    choice_label           TEXT,
    choice_submitted_at    TIMESTAMPTZ,
    timeframe              TEXT,
    timeframe_label        TEXT,
    timeframe_submitted_at TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

// --- from empty -------------------------------------------------------------
await query('DROP TABLE IF EXISTS vendor_responses, response_events');
{
  const out = await migrate();
  check('migrating an empty database succeeds', out.code === 0, out.stderr.trim() || out.stdout.trim());
  check('both tables are created',
    (await columnsOf('vendor_responses')).length > 0 && (await columnsOf('response_events')).length > 0);
}

// --- re-running -------------------------------------------------------------
{
  const out = await migrate();
  check('re-running the migration is safe', out.code === 0, out.stderr.trim());
}

// --- over the earlier prototype's table ------------------------------------
await query('DROP TABLE IF EXISTS vendor_responses, response_events');
await query(LEGACY_SCHEMA);
await query(
  `INSERT INTO vendor_responses (vendor_id, vendor_name, choice, choice_label, choice_submitted_at)
   VALUES ('LEGACY-1', 'Pre-existing Vendor', 'template', 'Template', now())`
);
{
  const legacyBefore = await columnsOf('vendor_responses');
  check('the prototype table lacks the columns this project needs',
    !legacyBefore.includes('first_seen_at') && legacyBefore.includes('created_at'),
    legacyBefore.join(', '));

  const out = await migrate();
  check('migrating over the prototype table succeeds', out.code === 0, out.stderr.trim() || out.stdout.trim());

  const after = await columnsOf('vendor_responses');
  check('the missing columns are added',
    after.includes('first_seen_at') && after.includes('last_updated_at'), after.join(', '));
  check("the prototype's own columns are left alone rather than dropped",
    after.includes('created_at') && after.includes('updated_at'));
  check('the event log table is created alongside', (await columnsOf('response_events')).length > 0);

  const { rows } = await query(`SELECT vendor_name FROM vendor_responses WHERE vendor_id = 'LEGACY-1'`);
  check('existing rows survive the migration', rows[0]?.vendor_name === 'Pre-existing Vendor');
}

// The real proof: the API's upsert must work against the converged table.
{
  process.env.RATE_LIMIT_PER_MINUTE = '0';
  delete process.env.LINK_SIGNING_SECRET;
  const { createServer } = await import('../scripts/dev-server.mjs');
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const post = (body) =>
    fetch(`${base}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const choice = await post({
    stage: 'choice', vendor_id: 'AFTER-MIGRATE', vendor_name: 'New Vendor',
    choice: 'ehalo_self', choice_label: 'eHalo', submitted_at: new Date().toISOString(),
  });
  check('the API can write to the converged table', choice.status === 200, `status=${choice.status}`);

  const timeframe = await post({
    stage: 'timeframe', vendor_id: 'AFTER-MIGRATE', timeframe: 'this_week',
    timeframe_label: 'This week', timeframe_submitted_at: new Date().toISOString(),
  });
  const { rows } = await query(`SELECT * FROM vendor_responses WHERE vendor_id = 'AFTER-MIGRATE'`);
  check('both stages still merge onto one row after migrating',
    timeframe.status === 200 && rows[0].choice === 'ehalo_self' && rows[0].timeframe === 'this_week',
    JSON.stringify(rows[0]));

  // Updating a row the prototype wrote must not fail on its NOT NULL columns.
  const legacyUpdate = await post({
    stage: 'timeframe', vendor_id: 'LEGACY-1', timeframe: 'need_more_time',
    timeframe_label: 'Need more time', timeframe_submitted_at: new Date().toISOString(),
  });
  const legacy = (await query(`SELECT * FROM vendor_responses WHERE vendor_id = 'LEGACY-1'`)).rows[0];
  check('a row inherited from the prototype can still be updated',
    legacyUpdate.status === 200 && legacy.timeframe === 'need_more_time' && legacy.choice === 'template',
    JSON.stringify(legacy));

  server.close();
}

// --- an unrelated table of the same name -----------------------------------
await query('DROP TABLE IF EXISTS vendor_responses, response_events');
await query('CREATE TABLE vendor_responses (something_else TEXT)');
{
  const out = await migrate();
  const message = `${out.stdout}${out.stderr}`;
  check('an incompatible table of the same name fails loudly instead of reporting success',
    out.code !== 0 && /not usable/i.test(message), message.trim().split('\n')[0]);
  check('the failure names the missing column and suggests a fix',
    /vendor_id/.test(message) && /DROP TABLE/.test(message));
}

await query('DROP TABLE IF EXISTS vendor_responses, response_events');
await query(fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8'));
await closePool();

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
