import fs from 'node:fs';
import { loadLocalEnv } from '../lib/env.js';
import { signVendorId } from '../lib/signing.js';

/**
 * Generates the per-vendor links that go into the outreach email.
 *
 * Usage:
 *   BASE_URL=https://respond.specinsite.com npm run links -- vendors.csv
 *
 * The input is a CSV with a vendor_id column and an optional vendor_name
 * column, with or without a header row. Output is CSV on stdout so it can be
 * pasted straight into a mail-merge tool:
 *
 *   vendor_id,vendor_name,link
 *
 * When LINK_SIGNING_SECRET is set, each link carries a token that /api/respond
 * verifies, so only vendors you emailed can write to the tracker.
 */

loadLocalEnv();

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: npm run links -- <vendors.csv>');
  process.exit(1);
}

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error('BASE_URL is not set (for example https://respond.specinsite.com).');
  process.exit(1);
}

const secret = process.env.LINK_SIGNING_SECRET;
if (!secret) {
  console.error('Warning: LINK_SIGNING_SECRET is not set, so links will be unsigned.');
}

/** Handles quoted fields and embedded commas; enough for a vendor list. */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

const lines = fs.readFileSync(inputPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
if (!lines.length) {
  console.error('Input file is empty.');
  process.exit(1);
}

let idCol = 0;
let nameCol = 1;
const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
const hasHeader = header.includes('vendor_id');
if (hasHeader) {
  idCol = header.indexOf('vendor_id');
  nameCol = header.indexOf('vendor_name');
  lines.shift();
}

const escapeCsv = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

console.log('vendor_id,vendor_name,link');
let count = 0;

for (const line of lines) {
  const fields = parseCsvLine(line);
  const vendorId = fields[idCol];
  if (!vendorId) continue;
  const vendorName = nameCol >= 0 ? fields[nameCol] || '' : '';

  const url = new URL(baseUrl);
  url.searchParams.set('vid', vendorId);
  if (vendorName) url.searchParams.set('name', vendorName);
  if (secret) url.searchParams.set('t', signVendorId(vendorId, secret));

  console.log([escapeCsv(vendorId), escapeCsv(vendorName), escapeCsv(url.toString())].join(','));
  count++;
}

console.error(`Generated ${count} link${count === 1 ? '' : 's'}.`);
