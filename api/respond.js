import { withTransaction, UNDEFINED_TABLE, query } from '../lib/db.js';
import { validateSubmission } from '../lib/validate.js';
import { verifyVendorToken, hashIp } from '../lib/signing.js';
import { sendJson, readJsonBody, clientIp } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    // The page is served from the same origin, so this only matters if the
    // API is ever called from somewhere else.
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return sendJson(res, body.status || 400, { ok: false, error: body.error });
  }

  const parsed = validateSubmission(body.value);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, error: parsed.error });
  }
  const submission = parsed.value;

  const signingSecret = process.env.LINK_SIGNING_SECRET;
  if (signingSecret && !verifyVendorToken(submission.vendor_id, submission.token, signingSecret)) {
    return sendJson(res, 403, { ok: false, error: 'Invalid or missing link token.' });
  }

  const ipHash = hashIp(clientIp(req), process.env.IP_HASH_SALT);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null;

  try {
    if (await isRateLimited(ipHash)) {
      res.setHeader('Retry-After', '60');
      return sendJson(res, 429, { ok: false, error: 'Too many submissions. Try again shortly.' });
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO response_events (vendor_id, stage, payload, ip_hash, user_agent)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [submission.vendor_id, submission.stage, JSON.stringify(body.value), ipHash, userAgent]
      );

      // COALESCE keeps whichever stage already landed: a timeframe submission
      // carries no choice fields and must not blank them out, and vice versa.
      await client.query(
        `INSERT INTO vendor_responses (
           vendor_id, vendor_name,
           choice, choice_label, choice_submitted_at,
           timeframe, timeframe_label, timeframe_submitted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (vendor_id) DO UPDATE SET
           vendor_name            = COALESCE(EXCLUDED.vendor_name, vendor_responses.vendor_name),
           choice                 = COALESCE(EXCLUDED.choice, vendor_responses.choice),
           choice_label           = COALESCE(EXCLUDED.choice_label, vendor_responses.choice_label),
           choice_submitted_at    = COALESCE(EXCLUDED.choice_submitted_at, vendor_responses.choice_submitted_at),
           timeframe              = COALESCE(EXCLUDED.timeframe, vendor_responses.timeframe),
           timeframe_label        = COALESCE(EXCLUDED.timeframe_label, vendor_responses.timeframe_label),
           timeframe_submitted_at = COALESCE(EXCLUDED.timeframe_submitted_at, vendor_responses.timeframe_submitted_at),
           last_updated_at        = now()`,
        [
          submission.vendor_id,
          submission.vendor_name,
          submission.choice,
          submission.choice_label,
          submission.choice_submitted_at,
          submission.timeframe,
          submission.timeframe_label,
          submission.timeframe_submitted_at,
        ]
      );
    });
  } catch (err) {
    if (err && err.code === UNDEFINED_TABLE) {
      console.error('Tables are missing. Run: npm run migrate');
      return sendJson(res, 500, { ok: false, error: 'Tracker is not initialised.' });
    }
    console.error('Failed to record submission:', err);
    return sendJson(res, 500, { ok: false, error: 'Could not record your response.' });
  }

  return sendJson(res, 200, {
    ok: true,
    stage: submission.stage,
    vendor_id: submission.vendor_id,
    // Served from here so the booking link stays out of the page source.
    scheduling_url: process.env.SCHEDULING_URL || '',
  });
}

async function isRateLimited(ipHash) {
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE || 20);
  if (!ipHash || limit <= 0) return false;
  const { rows } = await query(
    `SELECT count(*)::int AS recent
       FROM response_events
      WHERE ip_hash = $1
        AND received_at > now() - interval '1 minute'`,
    [ipHash]
  );
  return rows[0].recent >= limit;
}
