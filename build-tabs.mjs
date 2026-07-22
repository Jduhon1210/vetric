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
const PRIORITY = process.argv.includes('--priority');   // interim ship: vets + top-200 new only, then exit
const CKPT = '.tabs-checkpoint.json', GEO = '.tabs-geocache.json';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// One flaky TLS read must never kill a 2-hour run (it did once — ETIMEDOUT at detail 2,362).
async function fetchRetry(url, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      if (i === tries - 1) return r;
    } catch (e) { if (i === tries - 1) throw e; }
    await sleep([1000, 4000, 10000][i] || 10000);
  }
}
const VET_RE = /\bvet(?:erinar\w*)?\b|animal|\bpaws?\b|\bpets?\b|canine|feline|k-?9\b|\bspay\b|neuter/i;
// Same philosophy as build-clinics.mjs classify(): definitive junk overrides the vet signal.
// Municipal shelters/adoption centers, animal control, police K9 facilities, and human medical
// "PET/CT" imaging all match VET_RE but are not competitors. (They can still ship as plain
// commercial projects if they qualify on cost — that's honest; they're just not paw pins.)
const VET_JUNK_RE = /shelter|adoption|animal control|animal services|humane|bomb|police|swat|pet\s*[\/-]?\s*ct\b|imaging|groom|boarding|day\s?care|kennel|resort|lounge|quarantine|pet\s?(store|shop|suppl\w*)/i;
// ...but a STRONG clinic signal overrides junk (build-clinics.mjs rule) — "Towne Center Animal
// Hospital and Pet Hotel" is a clinic; "K9 Kind Resort" is not.
const VET_STRONG_RE = /animal\s+(hospital|clinic|medical)|veterinar|pet\s+hospital|vet\s+(care|clinic|hospital)/i;
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
    const r = await fetchRetry('https://www.tdlr.texas.gov/TABS/Search/SearchProjects', {
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
  if (VET_RE.test(name) && (!VET_JUNK_RE.test(name) || VET_STRONG_RE.test(name))) return 'vet';
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
  try {
    const r = await fetchRetry('https://www.tdlr.texas.gov/TABS/Search/Print/' + num, { headers: UA });
    if (!r || !r.ok) return null;
    return parseDetail(await r.text());
  } catch (e) { return null; }   // persistent network failure -> skip record, keep the run alive
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
    const r = await fetchRetry(url, { headers: UA }, 2);
    if (r && r.ok) { const j = await r.json(); if (j[0]) res = [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)]; }
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
// vet early-warning first, then new construction biggest-first — the most valuable pins exist
// within minutes of a cold start instead of after two hours
const KIND_PRI = { vet: 0, new: 1, tenant: 2 };
picked.sort((a, b) => KIND_PRI[a.kind] - KIND_PRI[b.kind] || (b.r.EstimatedCost || 0) - (a.r.EstimatedCost || 0));
const RUNSET = PRIORITY
  ? picked.filter(x => x.kind === 'vet').concat(picked.filter(x => x.kind === 'new').slice(0, 200))
  : picked;
if (PRIORITY) console.log('PRIORITY mode: ' + RUNSET.length + ' records (vets + top-200 new construction)');
console.log(`phase 2 — detail fetch: ${picked.length} of ${ck.rows.length} qualify ` +
  `(vet ${picked.filter(x => x.kind === 'vet').length} / new ${picked.filter(x => x.kind === 'new').length} / tenant ${picked.filter(x => x.kind === 'tenant').length})`);

const TW = { 9001: 'new', 9002: 'reno', 9003: 'add', 9005: 'row' };
function assembleRows() {
  // Build the full output list from whatever details exist RIGHT NOW. Rows whose detail hasn't
  // been fetched yet ship without addr/sf/tenant and gain them on the next flush.
  const rows = [];
  for (const { r, kind } of RUNSET) {
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
    if (d.geo) { row.la = d.geo[0]; row.lo = d.geo[1]; }
    rows.push(row);
  }
  return rows;
}
let vets = [];
function flushOutput(tag) {
  const rows = assembleRows();
  const out = {
    v: 1, built: new Date().toISOString().slice(0, 10),
    note: 'TDLR TABS registrations (last ' + REG_MONTHS + ' mo, 9 DFW counties; estimates are applicant-reported) + Comptroller active sales-tax outlets NAICS 541940. Public records.',
    list: rows, vets
  };
  fs.writeFileSync('dfw-commercial.json', JSON.stringify(out));
  const pinned = rows.filter(r => r.la != null).length;
  console.log(`  [flush ${tag}] dfw-commercial.json: ${rows.length} projects, ${pinned} pinned, ${vets.length} vet outlets`);
  return rows;
}

let dn = 0;
for (const { r } of RUNSET) {
  if (ck.det[r.ProjectNumber]) { dn++; continue; }
  const d = await detail(r.ProjectNumber);
  ck.det[r.ProjectNumber] = d || { fail: 1 };
  dn++;
  if (dn % 50 === 0) { fs.writeFileSync(CKPT, JSON.stringify(ck)); console.log(`  ${dn}/${RUNSET.length}`); }
  if (dn % 500 === 0) flushOutput('detail ' + dn);
  await sleep(400);
}
fs.writeFileSync(CKPT, JSON.stringify(ck));

console.log('phase 3 — Comptroller sales-tax vet outlets (NAICS 541940, statewide)');
try {
  const r = await fetchRetry("https://data.texas.gov/resource/jrea-zgmq.json?$limit=5000&$where=" +
    encodeURIComponent("outlet_naics_code='541940' AND outlet_permit_issue_date>='2025-01-01'"), { headers: UA });
  if (r && r.ok) {
    const seen = new Set();
    for (const o of await r.json()) {
      // a permit can be re-issued at a long-established clinic — "newly open" requires a recent
      // (or not-yet-started) first-sales date, and multi-permit outlets collapse to one row
      const first = (o.outlet_first_sales_date || '').slice(0, 10);
      if (first && first < '2025-01-01') continue;
      const dk = ((o.outlet_name || '') + '|' + (o.outlet_address || '')).toLowerCase();
      if (seen.has(dk)) continue; seen.add(dk);
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
console.log(`  ${vets.length} statewide vet outlets since 2025`);

console.log('phase 4 — geocode (priority: TABS vets -> Comptroller DFW vets -> new construction by cost)');
// DFW-county comptroller outlets get pins (county code = TDLR code - 2000, zero-padded)
const DFW_CPA = new Set(Object.keys(COUNTIES).map(c => String(c - 2000).padStart(3, '0')));
const cpaDfw = vets.filter(v => DFW_CPA.has(v.cty));
const cpaRun = PRIORITY ? cpaDfw.slice(0, 120) : cpaDfw;
let gn = 0;
for (const v of cpaRun) {                 // small set, most valuable, goes first
  const g = await geocode(v.addr, v.city);
  if (g) { v.la = g[0]; v.lo = g[1]; }
}
flushOutput('cpa-vets');
for (const { r, kind } of RUNSET) {
  if (kind !== 'vet' && kind !== 'new') continue;
  const d = ck.det[r.ProjectNumber];
  if (!d || d.fail || d.geo !== undefined) continue;
  const g = await geocode(d.addr, cities[String(r.City)] || null);
  d.geo = g;                               // null is a valid "tried, no hit" marker
  gn++;
  if (gn % 100 === 0) { fs.writeFileSync(CKPT, JSON.stringify(ck)); flushOutput('geo ' + gn); }
}
fs.writeFileSync(CKPT, JSON.stringify(ck));
fs.writeFileSync(GEO, JSON.stringify(geoCache));

const rows = flushOutput('final');
console.log(`\ndone: ${rows.length} projects (${rows.filter(r => r.la != null).length} pinned) · ` +
  `${vets.length} vet outlets · vet-flagged TABS ${rows.filter(r => r.kind === 'vet').length}`);
