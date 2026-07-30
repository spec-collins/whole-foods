const { getPool } = require('./_db');

const VALID_STAGES = new Set(['choice', 'timeframe']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const stage = body.stage;
  const vendorId = body.vendor_id;

  if (!vendorId || typeof vendorId !== 'string') {
    return res.status(400).json({ error: 'vendor_id is required' });
  }
  if (!VALID_STAGES.has(stage)) {
    return res.status(400).json({ error: 'stage must be "choice" or "timeframe"' });
  }

  let pool;
  try {
    pool = getPool();
  } catch (err) {
    console.error('submit handler config error:', err.message);
    return res.status(500).json({ error: 'Server is not configured' });
  }

  try {
    if (stage === 'choice') {
      const vendorName = body.vendor_name || null;
      const choice = body.choice || null;
      const choiceLabel = body.choice_label || null;
      const submittedAt = body.submitted_at || null;

      await pool.query(
        `INSERT INTO vendor_responses
           (vendor_id, vendor_name, choice, choice_label, choice_submitted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (vendor_id) DO UPDATE SET
           vendor_name         = EXCLUDED.vendor_name,
           choice               = EXCLUDED.choice,
           choice_label         = EXCLUDED.choice_label,
           choice_submitted_at  = EXCLUDED.choice_submitted_at,
           updated_at           = now()`,
        [vendorId, vendorName, choice, choiceLabel, submittedAt]
      );
    } else {
      const vendorName = body.vendor_name || null;
      const timeframe = body.timeframe || null;
      const timeframeLabel = body.timeframe_label || null;
      const timeframeSubmittedAt = body.timeframe_submitted_at || null;

      await pool.query(
        `INSERT INTO vendor_responses
           (vendor_id, vendor_name, timeframe, timeframe_label, timeframe_submitted_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (vendor_id) DO UPDATE SET
           vendor_name             = COALESCE(EXCLUDED.vendor_name, vendor_responses.vendor_name),
           timeframe               = EXCLUDED.timeframe,
           timeframe_label         = EXCLUDED.timeframe_label,
           timeframe_submitted_at  = EXCLUDED.timeframe_submitted_at,
           updated_at              = now()`,
        [vendorId, vendorName, timeframe, timeframeLabel, timeframeSubmittedAt]
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit handler db error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
