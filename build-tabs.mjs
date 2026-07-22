#!/usr/bin/env node
/* build-tabs.mjs — bake dfw-commercial.json from TDLR TABS (Texas Architectural Barriers)
 * plus the Comptroller active sales-tax outlet feed.
 *
 * TABS: every commercial construction/renovation project in Texas >= $50k must register with
 * TDLR before construction. Public record (TX PIA); /TABS/ is not restricted by robots.txt;
 * no auth. The search page's DataTables endpoint is the machine path (no bulk download exists).
 * Detail pages carry the location address, square footage, scope, OWNER and TENANT names.
 *
 * What ships:
 *   list[] — the DFW commercial pipeline: new construction >= $100k (retail shells = future
 *            leasable space) + finish-outs at named centers (= committed tenants), with
 *            estimated start/completion dates, cost, sqft, owner, tenant.
 *   vets[] — the competitor early-warning feed: TABS projects matching a veterinary vocabulary
 *            (visible months pre-opening) + Comptroller sales-tax outlets with veterinary
 *            NAICS 541940 (confirms actual opening; statewide, ~weekly refresh upstream).
 *
 * Politeness: sequential fetches, 400ms between TABS detail pages, 1.15s between Nominatim
 * geocodes (their hard limit is 1/s), identifying User-Agent. First full run ~45-70 min;
 * checkpointed (.tabs-checkpoint.json / .tabs-geocache.json, both git-ignored) so reruns and
 * resumes are cheap and only new records cost anything.
 *
 * Run: node build-tabs.mjs [--fresh]     (Node 18+)
 * Then: bump ?v= on the dfw-commercial.json fetch in index.html; update VF_DATASETS.
 */
import fs from 'fs';

const UA = { 'User-Agent': 'Vetric/1.0 (+https://vetric.co; data pipeline)' };
const COUNTIES = { 2043: 'Collin', 2057: 'Dallas', 2061: 'Denton', 2220: 'Tarrant', 2199: 'Rockwall', 2070: 'Ellis', 2129: 'Kaufman', 2126: 'Johnson', 2184: 'Parker' };
const REG_MONTHS = 15;                        // registration look-back window
const FRESH = process.argv.includes('--fresh');
const CKPT = '.tabs-checkpoint.json', GEO = '.tabs-geocache.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const VET_RE = /\bvet(?:erinar\w*)?\b|animal|\bpaws?\b|\bpets?\b|canine|feline|k-?9\b|\bspay\b|neuter/i;
const RETAIL_RE = /shops?|plaza|center|centre|crossing|marketplace|towne?\b|\bpad\b|commons|square|village|station|retail|shell/i;

// ---- city-code lookup, scraped live from the search page's <option> tags -------------------
async function cityLookup() {
  const r = await fetch('https://www.tdlr.texas.gov/TABS/Search/', { headers: UA });
  const s = await r.text();
  const map = {};
  for (const m of s.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)) map[m[1]] = m[2].trim();
  if (!map['763']) throw new Error('city lookup parse failed');
  return map;
}

// ---- phase 1: list pull per county ---------------------------------------------------------
async function listCounty(code) {
  const d = new Date(); d.setMonth(d.getMonth() - REG_MONTHS);
  const from = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const rows = []; let start = 0;
  for (;;) {
    const body = `draw=1&start=${start}&length=100&LocationCounty=${code}&RegistrationDateBegin=${encodeURIComponent(from)}`;
    const r = await fetch('https://www.tdlr.texas.gov/TABS/Search/SearchProjects', {
      method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    if (!r.ok) throw new Error('TABS list HTTP ' + r.status);
    const j = await r.json();
    rows.push(...(j.data || []));
    if (start === 0) process.stdout.write(`  ${COUNTIES[code]}: ${j.recordsTotal} registered since ${from}`);
    start += 100;
    if (start >= (j.recordsTotal || 0)) break;
    await sleep(120);
  }
  console.log(` -> pulled ${rows.length}`);
  return rows;
}

// ---- which records earn a detail fetch -----------------------------------------------------
function wantDetail(r) {
  const name = (r.ProjectName || '') + ' ' + (r.FacilityName || '');
  if (VET_RE.test(name)) return 'vet';
  const cost = r.EstimatedCost || 0;
  if (r.TypeOfWork === 9001 && cost >= 100000) return 'new';
  const facReal = r.FacilityName && r.FacilityName !== '-';
  if ((r.TypeOfWork === 9002 || r.TypeOfWork === 9003) && cost >= 40000 && (facReal || RETAIL_RE.test(name))) return 'tenant';
  return null;
}

// ---- phase 2: detail page parse ------------------------------------------------------------
function parseDetail(html) {
  const out = {}; let lastDt = '';
  for (const m of html.matchAll(/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gs)) {
    const k = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim().replace(/:+$/, '');
    const v = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (!k || !v || v === '-') { lastDt = k; continue; }
    if (k === 'Location Address') out.addr = v;
    else if (k === 'Square Footage') { const n = parseInt(v.replace(/[^\d]/g, ''), 10); if (n > 0) out.sf = n; }
    else if (k === 'Scope of Work') out.scope = v.slice(0, 140);
    else if (k === 'Tenant Name') out.tenant = v;
    else if (k === 'Owner Name') out.owner = v;
    else if (k === 'Current Status') out.status = v;
    lastDt = k;
  }
  return out;
}
async function detail(num) {
  const r = await fetch('https://www.tdlr.texas.gov/TABS/Search/Print/' + num, { headers: UA });
  if (!r.ok) return null;
  return parseDetail(await r.text());
}

// ---- phase 3: geocode (Nominatim, cached, 1.15s hard spacing) ------------------------------
const geoCache = fs.existsSync(GEO) ? JSON.parse(fs.readFileSync(GEO, 'utf8')) : {};
let geoDirty = 0;
async function geocode(addr, city) {
  if (!addr || !city) return null;
  // suite/unit fragments hurt Nominatim's hit rate — strip them for the query
  const clean = addr.replace(/[,#]?\s*(ste|suite|unit|bldg|#)\.?\s*[\w-]+\s*$/i, '').trim();
  const key = (clean + '|' + city).toLowerCase();
  if (key in geoCache) return geoCache[key];
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' +
    encodeURIComponent(`${clean}, ${city}, TX`);
  let res = null;
  try {
    const r = await fetch(url, { headers: UA });
    if (r.ok) { const j = await r.json(); if (j[0]) res = [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)]; }
  } catch (e) { /* leave null */ }
  geoCache[key] = res; geoDirty++;
  if (geoDirty % 25 === 0) fs.writeFileSync(GEO, JSON.stringify(geoCache));
  await sleep(1150);
  return res;
}

// ---- main ----------------------------------------------------------------------------------
const cities = await cityLookup();
console.log('city lookup: ' + Object.keys(cities).length + ' entries');

let ck = (!FRESH && fs.existsSync(CKPT)) ? JSON.parse(fs.readFileSync(CKPT, 'utf8')) : { rows: null, det: {} };

if (!ck.rows) {
  console.log('\nphase 1 — county list pulls');
  ck.rows = [];
  for (const code of Object.keys(COUNTIES)) ck.rows.push(...await listCounty(+code));
  fs.writeFileSync(CKPT, JSON.stringify(ck));
} else console.log(`\nphase 1 — checkpoint reuse (${ck.rows.length} rows)`);

const picked = ck.rows.map(r => ({ r, kind: wantDetail(r) })).filter(x => x.kind);
console.log(`phase 2 — detail fetch: ${picked.length} of ${ck.rows.length} qualify ` +
  `(vet ${picked.filter(x => x.kind === 'vet').length} / new ${picked.filter(x => x.kind === 'new').length} / tenant ${picked.filter(x => x.kind === 'tenant').length})`);
let dn = 0;
for (const { r } of picked) {
  if (ck.det[r.ProjectNumber]) { dn++; continue; }
  const d = await detail(r.ProjectNumber);
  ck.det[r.ProjectNumber] = d || { fail: 1 };
  dn++;
  if (dn % 50 === 0) { fs.writeFileSync(CKPT, JSON.stringify(ck)); console.log(`  ${dn}/${picked.length}`); }
  await sleep(400);
}
fs.writeFileSync(CKPT, JSON.stringify(ck));

console.log('phase 3 — geocode (vet + new construction get pins; tenants roll up under centers)');
const TW = { 9001: 'new', 9002: 'reno', 9003: 'add', 9005: 'row' };
const rows = []; let gn = 0;
for (const { r, kind } of picked) {
  const d = ck.det[r.ProjectNumber] || {};
  if (d.fail) continue;
  const city = cities[String(r.City)] || null;
  const row = {
    id: r.ProjectNumber, n: (r.ProjectName || '').trim(), kind,
    fac: (r.FacilityName && r.FacilityName !== '-') ? r.FacilityName.trim() : null,
    city, cty: COUNTIES[r.County] || null, addr: d.addr || null,
    cost: r.EstimatedCost || null, sf: d.sf || null,
    tw: TW[r.TypeOfWork] || null,
    start: (r.EstimatedStartDate || '').slice(0, 10) || null,
    end: (r.EstimatedEndDate || '').slice(0, 10) || null,
    status: d.status || null, owner: d.owner || null, tenant: d.tenant || null,
    scope: d.scope || null
  };
  if (kind === 'vet' || kind === 'new') {
    const g = await geocode(row.addr, city);
    if (g) { row.la = g[0]; row.lo = g[1]; }
    if (++gn % 50 === 0) console.log(`  geocoded ${gn}`);
  }
  rows.push(row);
}
fs.writeFileSync(GEO, JSON.stringify(geoCache));

console.log('phase 4 — Comptroller sales-tax vet outlets (NAICS 541940, statewide)');
const vets = [];
try {
  const r = await fetch("https://data.texas.gov/resource/jrea-zgmq.json?$limit=5000&$where=" +
    encodeURIComponent("outlet_naics_code='541940' AND outlet_permit_issue_date>='2025-01-01'"), { headers: UA });
  if (r.ok) {
    for (const o of await r.json()) {
      vets.push({
        n: (o.outlet_name || o.taxpayer_name || '').trim(),
        addr: (o.outlet_address || '').trim() || null, city: (o.outlet_city || '').trim() || null,
        zip: o.outlet_zip_code || null, cty: o.outlet_county_code || null,
        permit: (o.outlet_permit_issue_date || '').slice(0, 10) || null,
        first: (o.outlet_first_sales_date || '').slice(0, 10) || null,
        src: 'cpa'
      });
    }
  }
} catch (e) { console.log('  comptroller fetch failed (non-fatal): ' + e.message); }
// DFW-county comptroller outlets get pins too (county code = TDLR code - 2000, zero-padded)
const DFW_CPA = new Set(Object.keys(COUNTIES).map(c => String(c - 2000).padStart(3, '0')));
let cg = 0;
for (const v of vets) {
  if (!DFW_CPA.has(v.cty)) continue;
  const g = await geocode(v.addr, v.city);
  if (g) { v.la = g[0]; v.lo = g[1]; }
  cg++;
}
fs.writeFileSync(GEO, JSON.stringify(geoCache));
console.log(`  ${vets.length} statewide vet outlets since 2025 (${cg} DFW geocode attempts)`);

const out = {
  v: 1, built: new Date().toISOString().slice(0, 10),
  note: 'TDLR TABS registrations (last ' + REG_MONTHS + ' mo, 9 DFW counties; estimates are applicant-reported) + Comptroller active sales-tax outlets NAICS 541940. Public records.',
  list: rows, vets
};
fs.writeFileSync('dfw-commercial.json', JSON.stringify(out));
const pinned = rows.filter(r => r.la != null).length;
console.log(`\nwrote dfw-commercial.json (${(fs.statSync('dfw-commercial.json').size / 1024).toFixed(0)} KB): ` +
  `${rows.length} projects (${pinned} pinned) · ${vets.length} vet outlets · vet-flagged TABS ${rows.filter(r => r.kind === 'vet').length}`);
