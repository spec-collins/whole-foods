const { getPool } = require('./_db');

function toCsv(rows) {
  const headers = [
    'vendor_id', 'vendor_name', 'choice', 'choice_label', 'choice_submitted_at',
    'timeframe', 'timeframe_label', 'timeframe_submitted_at', 'created_at', 'updated_at',
  ];

  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n');
}

function getBearerToken(req) {
  const header = req.headers['authorization'] || '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(500).json({ error: 'ADMIN_TOKEN is not configured on the server' });
  }

  const providedToken = getBearerToken(req);
  if (!providedToken || providedToken !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let pool;
  try {
    pool = getPool();
  } catch (err) {
    console.error('responses handler config error:', err.message);
    return res.status(500).json({ error: 'Server is not configured' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT vendor_id, vendor_name, choice, choice_label, choice_submitted_at,
              timeframe, timeframe_label, timeframe_submitted_at, created_at, updated_at
       FROM vendor_responses
       ORDER BY updated_at DESC`
    );

    const format = (req.query && req.query.format) || '';
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vendor_responses.csv"');
      return res.status(200).send(toCsv(rows));
    }

    return res.status(200).json({ count: rows.length, rows });
  } catch (err) {
    console.error('responses handler db error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
