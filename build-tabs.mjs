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
// Paid last-mile geocoders, env-gated — keys NEVER live in the repo. Preference order:
//   GEOCODIO_KEY   — ToS-clean for Vetric (permanent storage + display on any map allowed;
//                    free tier 2,500/day covers the residue). RECOMMENDED.
//   GOOGLE_PLACES_KEY + --google — works, but Google's terms require display on a Google map
//                    and cap coordinate caching at 30 days; Vetric is Leaflet/OSM. Only runs
//                    behind the explicit flag so the trade-off is a deliberate choice.
const GEOCODIO_KEY = process.env.GEOCODIO_KEY || null;
const GOOGLE_OK = !!process.env.GOOGLE_PLACES_KEY && process.argv.includes('--google');
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
// ---- crash-safety ---------------------------------------------------------------------------
// Atomic writes: a kill arriving mid-write must never truncate the checkpoint (a corrupt
// checkpoint would orphan every fetched detail). Write to a sibling .tmp, then rename —
// rename is atomic on the same filesystem, so the target is always either old or new, whole.
function writeAtomic(path, data) {
  const tmp = path + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path);
}
// Safe load: if the main file is somehow corrupt, fall back to its .tmp sibling before giving
// up — and NEVER die on a parse error, that would block every future resume.
function loadJson(path, fallback) {
  for (const cand of [path, path + '.tmp']) {
    try { if (fs.existsSync(cand)) return JSON.parse(fs.readFileSync(cand, 'utf8')); }
    catch (e) { console.log('  WARN: ' + cand + ' unreadable (' + e.message + ') — trying fallback'); }
  }
  return fallback;
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
// TABS uses several no-facility placeholders — "-", "n/a", "none"… A placeholder must read as
// NO facility, or the tenant rollup groups every placeholder row under one phantom center
// (caught live: road projects listed as "committed tenants" of an apartment tower).
const FAC_NULL_RE = /^\s*(-+|n\/?a|na|none|null|unknown|tbd|x+)\s*$/i;
function facOf(r) {
  const f = (r.FacilityName || '').trim();
  return (f && !FAC_NULL_RE.test(f)) ? f : null;
}
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
  const facReal = !!facOf(r);
  // sub-$100k "New Construction" AT a named center is a tenant finish-out inside a shell
  // (e.g. a $90k donut shop at "Shops at Trinity Falls") — a committed tenant, not a building
  if (r.TypeOfWork === 9001 && facReal) return 'tenant';
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

// ---- phase 3: geocode ladder (cached, polite) ----------------------------------------------
// Lane 1: Nominatim free-text. Lane 2: Nominatim after TX-specific cleanup (corner prefixes,
// highway abbreviations, intersections). Lane 3: Census TIGER (free, no key) — TIGER learns
// NEWLY-PLATTED streets from county filings long before OSM maps them, so it has a different
// failure profile; construction sites in brand-new subdivisions are exactly its win case.
// Lane 4 (vet rows only): city-centroid, flagged approximate — a coming competitor pinned at
// city level with a disclosure beats an invisible one; ordinary projects skip this lane so the
// map never grows misleading blobs at city centers.
// Cache values: [la,lo] = precise · {a:[la,lo]} = approx · {x:1} = all lanes failed (final) ·
// null = legacy v1 miss (retryable by the ladder exactly once).
const geoCache = loadJson(GEO, {});
let geoDirty = 0;
function _geoSave() { geoDirty++; if (geoDirty % 25 === 0) writeAtomic(GEO, JSON.stringify(geoCache)); }
const _cleanAddr = a => a.replace(/[,#]?\s*(ste|suite|unit|bldg|#)\.?\s*[\w-]+\s*$/i, '').trim();

async function _nominatim(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
  try {
    const r = await fetchRetry(url, { headers: UA }, 2);
    await sleep(1150);
    if (r && r.ok) { const j = await r.json(); if (j[0]) return [+(+j[0].lat).toFixed(5), +(+j[0].lon).toFixed(5)]; }
  } catch (e) { await sleep(1150); }
  return null;
}
async function _censusTiger(addr, city) {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' +
    encodeURIComponent(`${addr}, ${city}, TX`);
  try {
    const r = await fetchRetry(url, { headers: UA }, 2);
    await sleep(300);
    if (r && r.ok) {
      const j = await r.json();
      const m = j && j.result && j.result.addressMatches && j.result.addressMatches[0];
      if (m && m.coordinates) return [+(+m.coordinates.y).toFixed(5), +(+m.coordinates.x).toFixed(5)];
    }
  } catch (e) { await sleep(300); }
  return null;
}
async function _geocodio(addr, city) {
  const url = 'https://api.geocod.io/v1.7/geocode?limit=1&api_key=' + GEOCODIO_KEY +
    '&q=' + encodeURIComponent(`${addr}, ${city}, TX`);
  try {
    const r = await fetchRetry(url, { headers: UA }, 2);
    await sleep(150);
    if (r && r.ok) {
      const j = await r.json(); const m = j && j.results && j.results[0];
      // reject city/county-centroid answers — approximate is exactly what this lane exists to beat
      if (m && m.location && m.accuracy >= 0.8 && !/^(place|county|state)$/.test(m.accuracy_type || ''))
        return [+(+m.location.lat).toFixed(5), +(+m.location.lng).toFixed(5)];
    }
  } catch (e) { await sleep(150); }
  return null;
}
async function _google(addr, city) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?key=' + process.env.GOOGLE_PLACES_KEY +
    '&address=' + encodeURIComponent(`${addr}, ${city}, TX`);
  try {
    const r = await fetchRetry(url, { headers: UA }, 2);
    await sleep(120);
    if (r && r.ok) {
      const j = await r.json(); const m = j && j.results && j.results[0];
      if (m && m.geometry && m.geometry.location && m.geometry.location_type !== 'APPROXIMATE')
        return [+(+m.geometry.location.lat).toFixed(5), +(+m.geometry.location.lng).toFixed(5)];
    }
  } catch (e) { await sleep(120); }
  return null;
}
const _paidLane = GEOCODIO_KEY ? _geocodio : (GOOGLE_OK ? _google : null);

// TX-specific normalization: corner/side prefixes off, highway abbreviations expanded to the
// names Nominatim indexes, intersections into "A and B" form.
function _txVariants(addr) {
  const out = [];
  let a = addr
    .replace(/^\s*(([NS][EW]?C|corner|side)\s+of\s+|(north|south|east|west)\s+side\s+of\s+)/i, '')
    .replace(/\bIH[- ]?(\d+)/gi, 'I-$1')
    .replace(/\bSH[- ]?(\d+)/gi, 'State Highway $1')
    .replace(/\bState Hwy\b/gi, 'State Highway')
    .replace(/\bHwy\b/gi, 'Highway')
    .replace(/\bCR[- ]?(\d+)/gi, 'County Road $1');
  if (a !== addr) out.push(a);
  const ix = a.split(/\s*(?:&|\bat\b|@)\s*/i);
  if (ix.length === 2 && ix[0].length > 3 && ix[1].length > 3) out.push(ix[0] + ' and ' + ix[1]);
  return out.slice(0, 2);
}
async function _cityApprox(city) {
  const ck2 = ('__city__' + city).toLowerCase();
  let cc = geoCache[ck2];
  if (cc === undefined) { cc = await _nominatim(`${city}, Texas`); geoCache[ck2] = cc; _geoSave(); }
  return Array.isArray(cc) ? { a: cc } : null;
}
/* Cache states: [la,lo] precise · {a:[la,lo],p?} city-approx (p = paid lane already tried the
   upgrade) · {x:1} legacy free-lane miss (retryable) · {x:2} even the city failed, no paid key
   yet · {x:3} paid lane also failed — absolutely terminal. Every state either resolves to a pin
   or records exactly why it can't, and a newly-supplied paid key upgrades approx pins and
   retries misses exactly once. */
// TDLR's city table has occasional label drift from the real place name.
const CITY_ALIAS = { 'Hudson Oak': 'Hudson Oaks' };
async function geocode(addr, city, opts) {
  if (!addr || !city) return null;
  city = CITY_ALIAS[city] || city;
  const clean = _cleanAddr(addr);
  const key = (clean + '|' + city).toLowerCase();
  const hit = geoCache[key];
  if (Array.isArray(hit)) return hit;
  if (hit && hit.a) {
    if (_paidLane && !hit.p) {                     // approx -> precise upgrade, once per key
      const pg = await _paidLane(clean, city);
      if (pg) { geoCache[key] = pg; _geoSave(); return pg; }
      hit.p = 1; geoCache[key] = hit; _geoSave();
    }
    return hit;
  }
  if (hit && hit.x) {
    if (hit.x >= 3) return null;
    if (hit.x === 2 && !_paidLane) return null;    // city unknown and nothing new to try
    let pg = _paidLane ? await _paidLane(clean, city) : null;
    if (!pg) pg = await _cityApprox(city);
    geoCache[key] = pg || { x: _paidLane ? 3 : 2 }; _geoSave();
    return pg;
  }
  let res = null;
  if (hit === undefined) res = await _nominatim(`${clean}, ${city}, TX`);   // lane 1 (v1 nulls skip: already tried)
  if (!res) for (const v of _txVariants(clean)) { res = await _nominatim(`${v}, ${city}, Texas`); if (res) break; }
  if (!res) res = await _censusTiger(clean, city);
  if (!res && _paidLane) res = await _paidLane(clean, city);
  // Universal last resort (user directive 2026-07-23: every record gets a pin): city centroid,
  // flagged approx:1, rendered ghosted+disclosed.
  if (!res) { const ap = await _cityApprox(city); if (ap) { geoCache[key] = ap; _geoSave(); return ap; } }
  geoCache[key] = res || { x: _paidLane ? 3 : 2 }; _geoSave();
  return res;
}

// ---- main ----------------------------------------------------------------------------------
// Single-instance lock: two concurrent runs clobber each other's checkpoint writes.
const LOCK = '.tabs.lock';
if (fs.existsSync(LOCK)) {
  const pid = parseInt(fs.readFileSync(LOCK, 'utf8'), 10);
  let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) {}
  if (alive) { console.log('Another build-tabs run (pid ' + pid + ') is active — exiting. Re-run when it finishes.'); process.exit(0); }
}
fs.writeFileSync(LOCK, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(LOCK); } catch (e) {} });

const cities = await cityLookup();
console.log('city lookup: ' + Object.keys(cities).length + ' entries');

let ck = FRESH ? { rows: null, det: {} } : loadJson(CKPT, { rows: null, det: {} });

if (!ck.rows) {
  console.log('\nphase 1 — county list pulls');
  ck.rows = [];
  for (const code of Object.keys(COUNTIES)) ck.rows.push(...await listCounty(+code));
  writeAtomic(CKPT, JSON.stringify(ck));
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
    // Ship ONLY what the UI reads — the raw detail (scope narratives, tenant addresses, statuses)
    // stays in the checkpoint. Full-shape: 4.3MB; slimmed: ~2MB. Tenant rows exist for the
    // facility rollup and need just name/fac/date/tenant.
    const row = (kind === 'tenant')
      ? { id: r.ProjectNumber, n: (r.ProjectName || '').trim(), kind,
          fac: facOf(r),
          city, cost: r.EstimatedCost || null,
          end: (r.EstimatedEndDate || '').slice(0, 10) || null,
          tenant: d.tenant || null, addr: d.addr || null }
      : { id: r.ProjectNumber, n: (r.ProjectName || '').trim(), kind,
          fac: facOf(r),
          city, cty: COUNTIES[r.County] || null, addr: d.addr || null,
          cost: r.EstimatedCost || null, sf: d.sf || null,
          tw: TW[r.TypeOfWork] || null,
          start: (r.EstimatedStartDate || '').slice(0, 10) || null,
          end: (r.EstimatedEndDate || '').slice(0, 10) || null,
          owner: d.owner || null, tenant: d.tenant || null };
    if (Array.isArray(d.geo)) { row.la = d.geo[0]; row.lo = d.geo[1]; }
    else if (d.geo && d.geo.a) { row.la = d.geo.a[0]; row.lo = d.geo.a[1]; row.approx = 1; }
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
  writeAtomic('dfw-commercial.json', JSON.stringify(out));
  const pinned = rows.filter(r => r.la != null).length;
  console.log(`  [flush ${tag}] dfw-commercial.json: ${rows.length} projects, ${pinned} pinned, ${vets.length} vet outlets`);
  return rows;
}

// Last-resort crash net: on ANY uncaught error or kill signal, save the checkpoint, the
// geocache, and the best-possible output file before dying. Everything fetched stays fetched.
let _crashSaved = false;
function crashSave(why) {
  if (_crashSaved) return; _crashSaved = true;
  console.log('\ncrash-save (' + why + ') — persisting checkpoint + output');
  try { writeAtomic(CKPT, JSON.stringify(ck)); } catch (e) {}
  try { writeAtomic(GEO, JSON.stringify(geoCache)); } catch (e) {}
  try { flushOutput('crash-save'); } catch (e) {}
}
process.on('uncaughtException', e => { console.log('FATAL: ' + (e && e.message)); crashSave('uncaughtException'); process.exit(1); });
process.on('unhandledRejection', e => { console.log('FATAL: ' + ((e && e.message) || e)); crashSave('unhandledRejection'); process.exit(1); });
process.on('SIGINT',  () => { crashSave('SIGINT');  process.exit(130); });
process.on('SIGTERM', () => { crashSave('SIGTERM'); process.exit(143); });

// Comptroller vets load FIRST (one cheap call) — a crash-save mid-detail-phase must not ship a
// file missing them (a shipped bug caught by the SIGTERM drill: "0 vet outlets" in the flush).
console.log('phase 2a — Comptroller sales-tax vet outlets (NAICS 541940, statewide)');
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
// cached geocodes are free — re-pin previously geocoded DFW outlets in every early flush
{
  const DFW_EARLY = new Set(Object.keys(COUNTIES).map(c => String(c - 2000).padStart(3, '0')));
  for (const v of vets) {
    if (!DFW_EARLY.has(v.cty) || !v.addr || !v.city) continue;
    const clean = v.addr.replace(/[,#]?\s*(ste|suite|unit|bldg|#)\.?\s*[\w-]+\s*$/i, '').trim();
    const hit = geoCache[(clean + '|' + v.city).toLowerCase()];
    if (Array.isArray(hit)) { v.la = hit[0]; v.lo = hit[1]; }
    else if (hit && hit.a) { v.la = hit.a[0]; v.lo = hit.a[1]; v.approx = 1; }
  }
}

let dn = 0;
for (const { r } of RUNSET) {
  const prev = ck.det[r.ProjectNumber];
  if (prev && !(prev.fail === 1)) { dn++; continue; }   // fail:1 = transient-era miss, retry once
  const d = await detail(r.ProjectNumber);
  ck.det[r.ProjectNumber] = d || { fail: (prev ? 2 : 1) };
  dn++;
  if (dn % 50 === 0) { writeAtomic(CKPT, JSON.stringify(ck)); console.log(`  ${dn}/${RUNSET.length}`); }
  if (dn % 500 === 0) flushOutput('detail ' + dn);
  await sleep(400);
}
writeAtomic(CKPT, JSON.stringify(ck));

console.log('phase 4 — geocode (priority: TABS vets -> Comptroller DFW vets -> new construction by cost)');
// DFW-county comptroller outlets get pins (county code = TDLR code - 2000, zero-padded)
const DFW_CPA = new Set(Object.keys(COUNTIES).map(c => String(c - 2000).padStart(3, '0')));
const cpaDfw = vets.filter(v => DFW_CPA.has(v.cty));
const cpaRun = PRIORITY ? cpaDfw.slice(0, 120) : cpaDfw;
let gn = 0;
for (const v of cpaRun) {                 // small set, most valuable, goes first
  const g = await geocode(v.addr, v.city, { vetApprox: true });
  if (Array.isArray(g)) { v.la = g[0]; v.lo = g[1]; }
  else if (g && g.a) { v.la = g.a[0]; v.lo = g.a[1]; v.approx = 1; }
}
flushOutput('cpa-vets');
// vet + new first (highest value), then tenant finish-outs — the user wants EVERY project
// mappable, and tenant addresses (established centers) actually geocode at a higher rate
// than new construction. Priority order comes from RUNSET's kind sort.
for (const { r, kind } of RUNSET) {
  const d = ck.det[r.ProjectNumber];
  if (!d || d.fail) continue;
  // skip only SUCCESSFUL geocodes — a null from the v1 pass means "Nominatim free-text missed",
  // and those are precisely the rows the ladder's other lanes exist for
  if (Array.isArray(d.geo) || (d.geo && d.geo.a)) continue;
  const g = await geocode(d.addr, cities[String(r.City)] || null, kind === 'vet' ? { vetApprox: true } : null);
  d.geo = g;                               // null is a valid "tried, no hit" marker
  gn++;
  if (gn % 100 === 0) { writeAtomic(CKPT, JSON.stringify(ck)); flushOutput('geo ' + gn); }
}
writeAtomic(CKPT, JSON.stringify(ck));
writeAtomic(GEO, JSON.stringify(geoCache));

const rows = flushOutput('final');
console.log(`\ndone: ${rows.length} projects (${rows.filter(r => r.la != null).length} pinned) · ` +
  `${vets.length} vet outlets · vet-flagged TABS ${rows.filter(r => r.kind === 'vet').length}`);
