import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv, ROOT } from '../lib/env.js';
import { query, closePool, resolveConnectionString } from '../lib/db.js';

loadLocalEnv();

if (!resolveConnectionString()) {
  console.error('DATABASE_URL is not set. Put it in .env or export it before running.');
  process.exit(1);
}

const sql = fs.readFileSync(path.join(ROOT, 'lib/schema.sql'), 'utf8');

try {
  await query(sql);
  const { rows } = await query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('vendor_responses', 'response_events')
      ORDER BY table_name`
  );
  console.log(`Migration complete. Tables present: ${rows.map((r) => r.table_name).join(', ')}`);
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
