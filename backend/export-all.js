// Exports ALL companies to CSV in the EXACT format of /home/harsh/Documents/format.csv
// Columns/order/quoting match our ExportService.flat(). Run: node export-all.js
const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

const OUT = process.env.EXPORT_OUT || '/home/harsh/Documents/companies_export.csv';
const HEADERS = ['Name','CIN','LLPIN','Website','Emails','Phones','Founders','Address','Social',
  'StartupIndia','DPIIT','Industry','Stage','MCAStatus','Sources','Description'];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const arr = (a) => (Array.isArray(a) ? a.join('; ') : '');
const social = (o) => (o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => `${k}:${v}`).join('; ') : '');

function row(c) {
  return [
    c.name, c.cin || '', c.llpin || '', c.website || '', arr(c.emails), arr(c.phones),
    arr(c.founders), c.address || '', social(c.socialLinks),
    c.startupIndiaRecognised ? 'Yes' : 'No', c.dpiitNumber || '', c.industry || '',
    c.stage || '', c.status || '', arr(c.sources), c.description || '',
  ].map(esc).join(',');
}

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows: [{ count }] } = await client.query('SELECT count(*)::int AS count FROM companies');
  const total = count;
  fs.writeFileSync(OUT, HEADERS.join(',') + '\n');
  const PAGE = 2000;
  const t0 = Date.now();
  let done = 0;
  for (let offset = 0; offset < total; offset += PAGE) {
    const { rows } = await client.query(
      `SELECT name,cin,llpin,website,emails,phones,founders,address,"socialLinks",
              "startupIndiaRecognised","dpiitNumber",industry,stage,status,sources,description
       FROM companies ORDER BY "updatedAt" DESC LIMIT $1 OFFSET $2`, [PAGE, offset]);
    fs.appendFileSync(OUT, rows.map(row).join('\n') + '\n');
    done += rows.length;
    const el = (Date.now() - t0) / 1000;
    const rate = done / Math.max(el, 1);
    const eta = rate > 0 ? Math.round((total - done) / rate) : 0;
    process.stdout.write(`\rprocessed ${done}/${total} (${((done / total) * 100).toFixed(1)}%) · ${rate.toFixed(0)}/s · ETA ${eta}s   `);
  }
  await client.end();
  console.log(`\nDONE → ${OUT} (${done} companies)`);
})().catch((e) => { console.error('export error', e); process.exit(1); });
