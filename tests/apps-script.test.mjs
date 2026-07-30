/**
 * Exercises backend/google-apps-script.gs against stubbed Google services so
 * the upsert-on-vendor_id behaviour can be verified without deploying.
 * See tests/README.md for how to run it.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal fakes for the Google Apps Script services the backend touches, so
// the upsert/logging logic can be exercised outside Google's runtime.
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  setFrozenRows() {}
  appendRow(values) { this.rows.push(values.slice()); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      setValues(values) {
        for (let r = 0; r < numRows; r++) {
          const target = row - 1 + r;
          while (sheet.rows.length <= target) sheet.rows.push([]);
          for (let c = 0; c < numCols; c++) sheet.rows[target][col - 1 + c] = values[r][c];
        }
        return this;
      },
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.rows[row - 1 + r] || [];
          out.push(Array.from({ length: numCols }, (_, c) => src[col - 1 + c] ?? ''));
        }
        return out;
      },
      setFontWeight() { return this; },
    };
  }
}

const sheets = new Map();
const sandbox = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (n) => sheets.get(n) || null,
      insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (k) => (k === 'SCHEDULING_URL' ? 'https://booking.example.test/session' : null) }),
  },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }),
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'backend/google-apps-script.gs'), 'utf8'), sandbox);

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const post = (payload) =>
  JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify(payload) } }).text);

const r1 = post({
  stage: 'choice', vendor_id: 'V-1', vendor_name: 'Acme Foods',
  choice: 'template', choice_label: "I'll fill out the spreadsheet template",
  submitted_at: '2026-07-30T10:00:00.000Z',
});
check('choice payload accepted', r1.ok === true, JSON.stringify(r1));
check('response carries scheduling_url from Script Properties', r1.scheduling_url === 'https://booking.example.test/session');

const r2 = post({
  stage: 'timeframe', vendor_id: 'V-1', vendor_name: 'Acme Foods',
  timeframe: 'this_week', timeframe_label: 'This week',
  timeframe_submitted_at: '2026-07-30T10:01:00.000Z',
});
check('timeframe payload accepted', r2.ok === true, JSON.stringify(r2));

const responses = sheets.get('Responses');
const header = responses.rows[0];
const body = responses.rows.slice(1);
check('both stages upserted onto a single row', body.length === 1, `rows=${body.length}`);

const row = Object.fromEntries(header.map((h, i) => [h, body[0][i]]));
check('row merges choice and timeframe fields',
  row.vendor_id === 'V-1' && row.vendor_name === 'Acme Foods' &&
  row.choice === 'template' && row.choice_submitted_at === '2026-07-30T10:00:00.000Z' &&
  row.timeframe === 'this_week' && row.timeframe_label === 'This week' &&
  row.timeframe_submitted_at === '2026-07-30T10:01:00.000Z' &&
  !!row.first_seen_at && !!row.last_updated_at,
  JSON.stringify(row));

post({ stage: 'choice', vendor_id: 'V-2', vendor_name: 'Second Co', choice: 'send_docs', choice_label: 'Docs', submitted_at: '2026-07-30T10:02:00.000Z' });
check('a different vendor_id inserts a new row', responses.rows.length - 1 === 2, `rows=${responses.rows.length - 1}`);

post({ stage: 'choice', vendor_id: 'V-1', vendor_name: 'Acme Foods', choice: 'ehalo_self', choice_label: 'eHalo', submitted_at: '2026-07-30T10:03:00.000Z' });
const updated = responses.rows[1];
check('re-submitting a choice updates in place and keeps the timeframe',
  responses.rows.length - 1 === 2 && updated[header.indexOf('choice')] === 'ehalo_self' && updated[header.indexOf('timeframe')] === 'this_week',
  JSON.stringify(updated));

check('audit log captured every payload', sheets.get('Log').rows.length - 1 === 4, `log rows=${sheets.get('Log').rows.length - 1}`);

const bad = JSON.parse(sandbox.doPost({ postData: { contents: JSON.stringify({ stage: 'nonsense' }) } }).text);
check('unknown stage rejected', bad.ok === false, JSON.stringify(bad));

const empty = JSON.parse(sandbox.doPost({}).text);
check('empty body rejected without throwing', empty.ok === false, JSON.stringify(empty));

const missingId = post({ stage: 'choice', choice: 'template', choice_label: 'T', submitted_at: '2026-07-30T10:04:00.000Z' });
check('missing vendor_id falls back to "unknown"', missingId.vendor_id === 'unknown', JSON.stringify(missingId));

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
