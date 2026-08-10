import { query, UNDEFINED_TABLE } from '../lib/db.js';
import { matchesSecret } from '../lib/signing.js';
import { buildXlsx, buildCsv } from '../lib/xlsx.js';
import { sendJson, getQuery } from '../lib/http.js';

const COLUMNS = [
  'vendor_id',
  'vendor_name',
  'choice',
  'choice_label',
  'choice_submitted_at',
  'timeframe',
  'timeframe_label',
  'timeframe_submitted_at',
  'is_test',
  'notes',
  'first_seen_at',
  'last_updated_at',
];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const params = getQuery(req);
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return sendJson(res, 503, { ok: false, error: 'ADMIN_TOKEN is not configured.' });
  }

  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const provided = bearer || params.get('token') || '';
  if (!matchesSecret(provided, adminToken)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
  }

  const format = (params.get('format') || 'xlsx').toLowerCase();
  if (!['xlsx', 'csv', 'json'].includes(format)) {
    return sendJson(res, 400, { ok: false, error: 'format must be xlsx, csv, or json.' });
  }

  let rows;
  try {
    ({ rows } = await query(
      `SELECT ${COLUMNS.join(', ')}
         FROM vendor_responses
        ORDER BY is_test ASC, last_updated_at DESC`
    ));
  } catch (err) {
    if (err && err.code === UNDEFINED_TABLE) {
      return sendJson(res, 500, { ok: false, error: 'Tracker is not initialised. Run: npm run migrate' });
    }
    console.error('Export failed:', err);
    return sendJson(res, 500, { ok: false, error: 'Export failed.' });
  }

  if (format === 'json') {
    return sendJson(res, 200, { ok: true, count: rows.length, responses: rows });
  }

  const table = {
    sheetName: 'Responses',
    headers: COLUMNS,
    rows: rows.map((row) => COLUMNS.map((col) => formatCell(row[col]))),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const isCsv = format === 'csv';
  const file = isCsv ? buildCsv(table) : buildXlsx(table);

  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    isCsv
      ? 'text/csv; charset=utf-8'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="vendor-responses-${stamp}.${format}"`);
  res.setHeader('Content-Length', String(file.length));
  res.setHeader('Cache-Control', 'no-store');
  res.end(file);
}

function formatCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value instanceof Date ? value.toISOString() : String(value);
}
