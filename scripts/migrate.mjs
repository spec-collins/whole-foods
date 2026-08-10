import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv, ROOT } from '../lib/env.js';
import { query, closePool, resolveConnectionString } from '../lib/db.js';

loadLocalEnv();

if (!resolveConnectionString()) {
  console.error('DATABASE_URL is not set. Put it in .env or export it before running.');
  process.exit(1);
}

// The columns the API actually reads and writes. Checked after migrating rather
// than assumed, because a pre-existing table of the same name with a different
// shape would otherwise let this script report success while leaving the API
// broken at the first vendor click.
const REQUIRED = {
  vendor_responses: [
    'vendor_id', 'vendor_name',
    'choice', 'choice_label', 'choice_submitted_at',
    'timeframe', 'timeframe_label', 'timeframe_submitted_at',
    'is_test',
    'notes',
    'first_seen_at', 'last_updated_at',
  ],
  response_events: ['id', 'vendor_id', 'stage', 'payload', 'ip_hash', 'user_agent', 'received_at'],
};

const sql = fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8');

try {
  await query(sql);

  const { rows } = await query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1)`,
    [Object.keys(REQUIRED)]
  );

  const found = new Map(Object.keys(REQUIRED).map((t) => [t, new Set()]));
  for (const row of rows) found.get(row.table_name)?.add(row.column_name);

  const problems = [];
  for (const [table, columns] of Object.entries(REQUIRED)) {
    const present = found.get(table);
    if (!present || present.size === 0) {
      problems.push(`table "${table}" is missing entirely`);
      continue;
    }
    const missing = columns.filter((c) => !present.has(c));
    if (missing.length) {
      problems.push(`table "${table}" is missing: ${missing.join(', ')}`);
    }
  }

  if (problems.length) {
    console.error('Migration ran but the schema is not usable:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      '\nThis usually means a table of the same name already exists from a different\n' +
      'project. If it holds nothing worth keeping, drop it and re-run:\n' +
      '  DROP TABLE IF EXISTS vendor_responses, response_events;'
    );
    process.exitCode = 1;
  } else {
    for (const table of Object.keys(REQUIRED)) {
      console.log(`${table}: ${found.get(table).size} columns, all required ones present`);
    }
    console.log('Migration complete.');
  }
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
