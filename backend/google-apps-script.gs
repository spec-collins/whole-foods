/**
 * Optional no-n8n backend for the Whole Foods vendor response page.
 *
 * Receives the two payload shapes defined in CURSOR_BUILD_SPEC.md and writes
 * them to a Google Sheet: one upserted row per vendor on "Responses", plus an
 * append-only "Log" of every raw payload for auditing. The sheet downloads as
 * .xlsx, so this satisfies the "track responses in a database or Excel file"
 * requirement without standing up any server.
 *
 * SETUP
 *   1. Create a Google Sheet. Extensions > Apps Script.
 *   2. Paste this file in, replacing the default Code.gs. Save.
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      Copy the /exec URL it gives you.
 *   4. In index.html set WEBHOOK_URL to that /exec URL and set
 *      WEBHOOK_CONTENT_TYPE to "text/plain;charset=utf-8".
 *   5. Optional: Project Settings > Script Properties > add SCHEDULING_URL so
 *      the booking link is served from here instead of sitting in page source.
 *
 * Re-deploy (Deploy > Manage deployments > edit > New version) after any edit;
 * the /exec URL stays the same.
 */

var RESPONSES_SHEET = 'Responses';
var LOG_SHEET = 'Log';

var RESPONSE_HEADERS = [
  'vendor_id',
  'vendor_name',
  'choice',
  'choice_label',
  'choice_submitted_at',
  'timeframe',
  'timeframe_label',
  'timeframe_submitted_at',
  'first_seen_at',
  'last_updated_at'
];

var LOG_HEADERS = ['received_at', 'stage', 'vendor_id', 'vendor_name', 'raw_payload'];

function doGet() {
  return jsonResponse({ ok: true, service: 'wf-vendor-response', message: 'POST JSON here.' });
}

function doPost(e) {
  try {
    var payload = parsePayload(e);
    if (!payload) {
      return jsonResponse({ ok: false, error: 'Empty or unparseable request body.' });
    }

    var vendorId = String(payload.vendor_id || '').trim() || 'unknown';
    var stage = String(payload.stage || '').trim();
    if (stage !== 'choice' && stage !== 'timeframe') {
      return jsonResponse({ ok: false, error: 'Unknown stage: ' + stage });
    }

    // Two payloads for the same vendor can land within milliseconds of each
    // other, and a read-modify-write without a lock would drop one of them.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      appendLog(stage, vendorId, payload);
      upsertResponse(stage, vendorId, payload);
    } finally {
      lock.releaseLock();
    }

    return jsonResponse({
      ok: true,
      vendor_id: vendorId,
      stage: stage,
      scheduling_url: getSchedulingUrl()
    });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function parsePayload(e) {
  if (!e) return null;

  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      // Fall through to form-encoded parameters below.
    }
  }
  if (e.parameter && Object.keys(e.parameter).length) {
    return e.parameter;
  }
  return null;
}

function upsertResponse(stage, vendorId, payload) {
  var sheet = getSheet(RESPONSES_SHEET, RESPONSE_HEADERS);
  var now = new Date().toISOString();
  var rowIndex = findRowByVendorId(sheet, vendorId);

  var row;
  if (rowIndex > 0) {
    row = sheet.getRange(rowIndex, 1, 1, RESPONSE_HEADERS.length).getValues()[0];
  } else {
    row = RESPONSE_HEADERS.map(function () { return ''; });
    row[colIndex('vendor_id')] = vendorId;
    row[colIndex('first_seen_at')] = now;
  }

  if (payload.vendor_name) {
    row[colIndex('vendor_name')] = payload.vendor_name;
  }

  if (stage === 'choice') {
    row[colIndex('choice')] = payload.choice || '';
    row[colIndex('choice_label')] = payload.choice_label || '';
    row[colIndex('choice_submitted_at')] = payload.submitted_at || now;
  } else {
    row[colIndex('timeframe')] = payload.timeframe || '';
    row[colIndex('timeframe_label')] = payload.timeframe_label || '';
    row[colIndex('timeframe_submitted_at')] = payload.timeframe_submitted_at || now;
  }

  row[colIndex('last_updated_at')] = now;

  var target = rowIndex > 0 ? rowIndex : sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, RESPONSE_HEADERS.length).setValues([row]);
}

function appendLog(stage, vendorId, payload) {
  var sheet = getSheet(LOG_SHEET, LOG_HEADERS);
  sheet.appendRow([
    new Date().toISOString(),
    stage,
    vendorId,
    payload.vendor_name || '',
    JSON.stringify(payload)
  ]);
}

function findRowByVendorId(sheet, vendorId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  var ids = sheet.getRange(2, colIndex('vendor_id') + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === vendorId) {
      return i + 2;
    }
  }
  return -1;
}

function colIndex(name) {
  return RESPONSE_HEADERS.indexOf(name);
}

function getSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getSchedulingUrl() {
  return PropertiesService.getScriptProperties().getProperty('SCHEDULING_URL') || '';
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
