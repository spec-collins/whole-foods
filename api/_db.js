const { Pool } = require('pg');

let pool;

// Reused across warm serverless invocations. `max: 1` keeps each function
// instance's own footprint small; rely on the database provider's own
// connection pooler (Neon's pooled host, Supabase's port 6543, Vercel
// Postgres's default POSTGRES_URL) rather than pooling heavily here, since
// each concurrent invocation gets its own instance of this module.
function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL (or POSTGRES_URL) environment variable is not set. ' +
      'Set it in the Vercel project settings or a local .env.local file.'
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

  pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  return pool;
}

module.exports = { getPool };
