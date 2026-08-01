import { query, UNDEFINED_TABLE, resolveConnectionString } from '../lib/db.js';
import { sendJson } from '../lib/http.js';

/**
 * Deployment check. Reports whether the database is reachable, whether the
 * migration has run, and which optional features are switched on. Deliberately
 * exposes no response data, so it needs no auth.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const url = resolveConnectionString();
  const config = {
    database_url_set: Boolean(url),
    // Serverless should be on the provider's pooled endpoint. Flagging this
    // here turns a subtle connection-exhaustion problem under load into
    // something visible before the first email goes out.
    database_pooled: url ? url.includes('-pooler') : null,
    admin_token_set: Boolean(process.env.ADMIN_TOKEN),
    scheduling_url_set: Boolean(process.env.SCHEDULING_URL),
    link_signing_enabled: Boolean(process.env.LINK_SIGNING_SECRET),
  };

  if (!config.database_url_set) {
    return sendJson(res, 503, { ok: false, error: 'DATABASE_URL is not set.', config });
  }

  try {
    const { rows } = await query('SELECT count(*)::int AS vendors FROM vendor_responses');
    return sendJson(res, 200, { ok: true, migrated: true, vendors: rows[0].vendors, config });
  } catch (err) {
    if (err && err.code === UNDEFINED_TABLE) {
      return sendJson(res, 503, {
        ok: false,
        migrated: false,
        error: 'Tables are missing. Run: npm run migrate',
        config,
      });
    }
    console.error('Health check failed:', err);
    return sendJson(res, 503, { ok: false, error: 'Database is unreachable.', config });
  }
}
