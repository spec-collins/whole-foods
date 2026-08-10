import { query, UNDEFINED_TABLE } from '../lib/db.js';
import { matchesSecret } from '../lib/signing.js';
import { sendJson, readJsonBody } from '../lib/http.js';

/**
 * Admin-only: mark a vendor response row as Test or Real.
 * POST { vendor_id, is_test: true|false }
 */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return sendJson(res, 503, { ok: false, error: 'ADMIN_TOKEN is not configured.' });
  }

  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!matchesSecret(bearer, adminToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return sendJson(res, body.status || 400, { ok: false, error: body.error });
  }

  const vendorId = String(body.value?.vendor_id || '').trim();
  if (!vendorId || vendorId.length > 120) {
    return sendJson(res, 400, { ok: false, error: 'vendor_id is required.' });
  }

  if (typeof body.value?.is_test !== 'boolean') {
    return sendJson(res, 400, { ok: false, error: 'is_test must be true or false.' });
  }
  const isTest = body.value.is_test;

  try {
    const { rows } = await query(
      `UPDATE vendor_responses
          SET is_test = $2
        WHERE vendor_id = $1
        RETURNING vendor_id, vendor_name, is_test`,
      [vendorId, isTest]
    );

    if (!rows.length) {
      return sendJson(res, 404, { ok: false, error: 'Vendor not found.' });
    }

    return sendJson(res, 200, { ok: true, vendor: rows[0] });
  } catch (err) {
    if (err && err.code === UNDEFINED_TABLE) {
      return sendJson(res, 500, { ok: false, error: 'Tracker is not initialised. Run: npm run migrate' });
    }
    console.error('vendor-flag failed:', err);
    return sendJson(res, 500, { ok: false, error: 'Could not update vendor flag.' });
  }
}
