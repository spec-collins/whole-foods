/**
 * Round-trip tests for the hand-rolled xlsx writer in lib/xlsx.js.
 *
 * Reads the produced zip back with nothing but node:zlib, so the suite has no
 * dependencies. Verified independently against openpyxl during development;
 * this guards the escaping and container details that would silently corrupt a
 * workbook -- a vendor named "Bob & Co" is enough to do it.
 */
import zlib from 'node:zlib';
import { buildXlsx, buildCsv } from '../lib/xlsx.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

/** Reads a zip via its central directory and returns { name: contents }. */
function unzip(buf) {
  const eocdSig = 0x06054b50;
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== eocdSig) eocd--;
  if (eocd < 0) throw new Error('No end-of-central-directory record found.');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = {};

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('Bad central directory signature.');
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Bad local header signature.');
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const headers = ['vendor_id', 'vendor_name', 'note'];
const rows = [
  ['V-1', 'Bob & Co', 'a < b > c'],
  ['V-2', 'The "Quoted" Farm', "It's fine"],
  ['V-3', 'Café Niño — ünïcode', ''],
  ['V-4', '', null],
];

const buf = buildXlsx({ sheetName: 'Responses', headers, rows });

check('output starts with the zip magic bytes', buf.subarray(0, 2).toString() === 'PK');

let files;
try {
  files = unzip(buf);
  check('zip parses back cleanly', true, `${Object.keys(files).length} parts`);
} catch (err) {
  check('zip parses back cleanly', false, err.message);
  process.exit(1);
}

const required = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
];
check('all required workbook parts are present',
  required.every((p) => p in files), Object.keys(files).join(', '));

// Excel expects the content-types part first in the archive.
check('[Content_Types].xml is the first entry', Object.keys(files)[0] === '[Content_Types].xml');

const sheet = files['xl/worksheets/sheet1.xml'];

check('every part is well-formed XML with a single root',
  Object.values(files).every((xml) => xml.trim().startsWith('<?xml') && !xml.includes('\u0000')));

check('ampersands are escaped', sheet.includes('Bob &amp; Co') && !/Bob & Co/.test(sheet));
check('angle brackets are escaped', sheet.includes('a &lt; b &gt; c'));
check('double quotes are escaped in cell text', sheet.includes('The &quot;Quoted&quot; Farm'));
check('apostrophes survive unescaped', sheet.includes("It's fine"));
check('non-ASCII characters survive', sheet.includes('Café Niño — ünïcode'));

check('the header row is styled and the body is not',
  sheet.includes('<c r="A1" s="1"') && sheet.includes('<c r="A2" t="inlineStr">'));
check('empty and null cells are omitted rather than written blank',
  !sheet.includes('<c r="B5"') && !sheet.includes('<c r="C5"'));
check('the header pane is frozen', sheet.includes('state="frozen"'));
check('the sheet name reaches the workbook part', files['xl/workbook.xml'].includes('name="Responses"'));

{
  const wide = buildXlsx({ headers: Array.from({ length: 30 }, (_, i) => `c${i}`), rows: [[]] });
  const xml = unzip(wide)['xl/worksheets/sheet1.xml'];
  check('column letters continue past Z into AA/AD',
    xml.includes('<c r="Z1"') && xml.includes('<c r="AA1"') && xml.includes('<c r="AD1"'));
}

{
  const sanitised = buildXlsx({ sheetName: 'Bad/Name:With*Chars?[x]', headers: ['a'], rows: [['b']] });
  const workbook = unzip(sanitised)['xl/workbook.xml'];
  check('characters Excel forbids in a sheet name are replaced',
    !/[\\/?*[\]:]/.test(workbook.match(/name="([^"]*)"/)[1]),
    workbook.match(/name="([^"]*)"/)[1]);
}

{
  const csv = buildCsv({ headers, rows }).toString('utf8');
  check('CSV starts with a BOM so Excel reads UTF-8 on double-click', csv.charCodeAt(0) === 0xfeff);
  check('CSV quotes fields containing commas and quotes',
    csv.includes('"The ""Quoted"" Farm"'), csv.split('\r\n')[2]);
  check('CSV renders null as an empty field', csv.trim().split('\r\n')[4] === 'V-4,,');
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
