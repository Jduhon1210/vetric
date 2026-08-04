#!/usr/bin/env node
/* build-pipeline.mjs — bake dfw-pipeline.json from NCTCOG's Development Monitoring layer.
 *
 * Source: North Central Texas Council of Governments, Development Monitoring program —
 *   https://geospatial.nctcog.org/map/rest/services/Features/Features/MapServer/1
 *   License: "no use constraints"; credit line requested (embedded below and shown in the UI).
 *   Continuously maintained (newspapers, developer sites, cities, CADs) — verified 2026-07-22:
 *   1,429 of 1,740 forward-pipeline records LastEdited in 2026.
 *
 * Keeps the FORWARD pipeline only (Under Construction / Announced / Conceptual) for the
 * Residential + Commercial classes. Existing development is what the rest of the app already
 * models; Special Use (schools/civic) is out of scope. Records whose LastEdited is older than
 * STALE_YEAR ship flagged stale:1 — a 2016-edited "Under Construction" strip center is probably
 * finished or dead, and the map dims it rather than presenting it as live intelligence.
 *
 * Run: node build-pipeline.mjs        (Node 18+; ~5s, one HTTP call)
 * Then: bump the ?v= on the dfw-pipeline.json fetch in index.html and update VF_DATASETS.
 */
import fs from 'fs';

const SVC = 'https://geospatial.nctcog.org/map/rest/services/Features/Features/MapServer/1/query';
const STALE_YEAR = 2024;

const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

async function fetchAll() {
  const rows = [];
  let offset = 0;
  for (;;) {
    const url = SVC + '?' + qs({
      where: "DevStatus IN ('Under Construction','Announced','Conceptual') AND Class IN ('Residential','Commercial')",
      outFields: 'Name,Type,SubClass,Class,Address,City,Zip,DevType,DevStatus,SqFeet,Acreage,Units,Doors,Completed,LastEdited,StartDate,Developer,Website,IsMixedUse',
      resultOffset: offset, resultRecordCount: 2000,
      returnGeometry: true, outSR: 4326, f: 'geojson'
    });
    const r = await fetch(url);
    if (!r.ok) throw new Error('NCTCOG HTTP ' + r.status);
    const j = await r.json();
    const fs_ = j.features || [];
    rows.push(...fs_);
    console.log(`  fetched ${fs_.length} (total ${rows.length})`);
    if (fs_.length < 2000) break;
    offset += 2000;
  }
  return rows;
}

const STATUS = { 'Under Construction': 'uc', 'Announced': 'an', 'Conceptual': 'co' };

function compact(f) {
  const p = f.properties || {}, g = f.geometry;
  if (!g || g.type !== 'Point') return null;
  const [lo, la] = g.coordinates;
  if (!isFinite(la) || !isFinite(lo)) return null;
  const editY = (() => { const m = /(\d{4})/.exec(p.LastEdited || ''); return m ? +m[1] : null; })();
  const row = {
    n: (p.Name || '').trim() || null,
    ty: p.Type || null, sc: p.SubClass || null, cl: p.Class === 'Residential' ? 'R' : 'C',
    city: p.City || null, addr: p.Address || null,
    la: +la.toFixed(5), lo: +lo.toFixed(5),
    st: STATUS[p.DevStatus] || 'an',
  };
  if (p.Units > 0) row.u = p.Units;
  if (p.Doors > 0 && !row.u) row.u = p.Doors;          // some MF rows carry Doors instead of Units
  if (p.SqFeet > 0) row.sf = p.SqFeet;
  if (p.Acreage > 0) row.ac = p.Acreage;
  if (p.Developer) row.dev = String(p.Developer).trim().slice(0, 80);
  if (p.StartDate) { const d = new Date(p.StartDate); if (!isNaN(d)) row.start = d.getFullYear(); }
  if (p.IsMixedUse === 'Yes') row.mx = 1;
  if (editY) row.ed = editY;
  if (editY && editY < STALE_YEAR) row.stale = 1;
  return row.n ? row : null;
}

const feats = await fetchAll();
const list = feats.map(compact).filter(Boolean);
list.sort((a, b) => (b.u || 0) - (a.u || 0) || (b.sf || 0) - (a.sf || 0));

const R = list.filter(r => r.cl === 'R'), C = list.filter(r => r.cl === 'C');
const uSum = R.reduce((s, r) => s + (r.u || 0), 0);
const stale = list.filter(r => r.stale).length;
console.log(`\nresidential ${R.length} (${uSum.toLocaleString()} units) · commercial ${C.length} · stale-flagged ${stale}`);
console.log('top:', list.slice(0, 5).map(r => `${r.n} (${r.city}, ${r.u || r.sf || '?'})`).join(' | '));

const out = {
  v: 1,
  built: new Date().toISOString().slice(0, 10),
  credit: 'Data from the North Central Texas Council of Governments (Development Monitoring program) was used in the production of this layer.',
  src: 'https://geospatial.nctcog.org/map/rest/services/Features/Features/MapServer/1',
  list
};
fs.writeFileSync('dfw-pipeline.json', JSON.stringify(out));
console.log(`\nwrote dfw-pipeline.json (${(fs.statSync('dfw-pipeline.json').size / 1024).toFixed(0)} KB, ${list.length} records)`);
