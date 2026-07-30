import pg from 'pg';

const { Pool } = pg;

let pool;

function isLocal(connectionString) {
  try {
    const host = new URL(connectionString).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function sslConfig(connectionString) {
  if (process.env.PGSSL === 'disable' || isLocal(connectionString)) return false;
  // Neon, Supabase's pooler, and Vercel Postgres all present certificates that
  // chain to a public CA, so verification stays on. PGSSL_NO_VERIFY exists for
  // providers that still serve a self-signed cert on the direct endpoint.
  return { rejectUnauthorized: process.env.PGSSL_NO_VERIFY !== '1' };
}

export function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }

  pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    // Each warm serverless instance holds its own pool, so keeping this at 1
    // avoids multiplying connections across instances. Use the provider's
    // pooled connection string (Neon's -pooler host, Supabase port 6543).
    max: Number(process.env.PG_POOL_MAX || 1),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // Without a listener, a dropped idle connection would surface as an
  // unhandled 'error' event and take the whole instance down.
  pool.on('error', (err) => console.error('Idle Postgres client error:', err));

  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres error for "relation does not exist" — i.e. migrations never ran. */
export const UNDEFINED_TABLE = '42P01';

export async function closePool() {
  if (pool) {
    const closing = pool.end();
    pool = undefined;
    await closing;
  }
}
