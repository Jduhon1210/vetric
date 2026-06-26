#!/usr/bin/env node
/* ============================================================================
   build-clinics.mjs — one-time / occasional statewide veterinary-clinic scan
   ----------------------------------------------------------------------------
   Discovers EVERY veterinary clinic in Texas via the Google Places API (New)
   and writes a static `vet-clinics.js` the app loads like pe-data.js. Run it
   locally; the API key stays on your machine, the committed output has no key.

   USAGE:
     export GOOGLE_PLACES_KEY=AIza...            # your Places API (New) key
     node build-clinics.mjs                      # scans all of Texas
     node build-clinics.mjs --region=dfw         # smaller test scan (cheaper)
     node build-clinics.mjs --dry=1              # estimate calls, no writing

   HOW IT STAYS COMPLETE & CHEAP:
     - Nearby Search (New) by includedTypes:['veterinary_care'] is category-
       accurate (not a fuzzy text match) but caps at 20 results per call with
       NO pagination — so we ADAPTIVELY TILE: query a circle covering a cell,
       and if it returns the full 20 (likely truncated) we split the cell into
       four and recurse. Rural cells return a handful and never subdivide;
       metros subdivide deep. This covers everything with the fewest calls.
     - Minimal field mask (id, displayName, location) = the cheapest SKU tier.
     - Dedupe by place_id. Polite delay + retry on 429/5xx.
   ============================================================================ */

const KEY = process.env.GOOGLE_PLACES_KEY;
const args = {};
for (const a of process.argv.slice(2)) { const m = a.match(/^--([^=]+)=?(.*)$/); if (m) args[m[1]] = m[2] || '1'; }
const DRY = args.dry === '1';

if (!DRY) {
  if (typeof fetch !== 'function') {
    console.error(`✖ This script needs Node 18+ (for built-in fetch). You have ${process.version}.`);
    console.error(`  Upgrade with:  nvm install 20   (or download from https://nodejs.org)`);
    process.exit(1);
  }
  if (!KEY) { console.error('✖ Set GOOGLE_PLACES_KEY in your env first.'); process.exit(1); }
}

// Region bounding boxes [south, west, north, east]
const REGIONS = {
  tx:  [25.83, -106.65, 36.50, -93.51],   // all of Texas
  dfw: [32.40, -97.70,  33.55, -96.45],   // DFW metro (cheap test scan)
};
const REGION = REGIONS[(args.region || 'tx').toLowerCase()] || REGIONS.tx;

const TYPE = 'veterinary_care';
const MAX_PER_CALL = 20;                  // Nearby Search (New) hard cap, no paging
const MIN_CELL_DEG = 0.035;               // ~3.9km — stop subdividing below this (a single dense block)
// We already pull displayName (Google "Pro" field tier), so types/primaryType/
// businessStatus ride the SAME billing tier — no extra cost — and let us drop
// non-clinics (pharmacies, kiosks, stores) and permanently-CLOSED businesses.
const FIELD_MASK = 'places.id,places.displayName,places.location,places.types,places.primaryType,places.businessStatus';
const RATE_MS = 120;                      // polite delay between calls
const OUT = 'vet-clinics.js';

let calls = 0, retries = 0;
const byId = new Map();                   // place_id -> {name, lat, lon}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const haversineDeg = (s, w, n, e) => Math.hypot(n - s, e - w); // cheap cell diagonal in degrees

async function nearby(centerLat, centerLon, radiusM) {
  calls++;
  if (DRY) return [];
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': KEY,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          includedTypes: [TYPE],
          maxResultCount: MAX_PER_CALL,
          locationRestriction: { circle: { center: { latitude: centerLat, longitude: centerLon }, radius: radiusM } },
        }),
      });
      if (res.status === 429 || res.status >= 500) { retries++; await sleep(800 * (attempt + 1)); continue; }
      if (!res.ok) { console.warn(`  ! ${res.status} at ${centerLat.toFixed(3)},${centerLon.toFixed(3)}`); return []; }
      const data = await res.json();
      return data.places || [];
    } catch (e) { retries++; await sleep(800 * (attempt + 1)); }
  }
  return [];
}

// Adaptive recursive scan of a [s,w,n,e] cell.
async function scanCell(s, w, n, e, depth) {
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  // circle radius = half the cell diagonal (metres) so the circle fully covers the rectangle
  const diagKm = haversineDeg(s, w, n, e) * 111;
  const radiusM = Math.min(diagKm * 1000 / 2, 50000); // Nearby Search max radius is 50km
  if (!DRY) await sleep(RATE_MS);
  const places = await nearby(cLat, cLon, radiusM);
  for (const p of places) {
    const loc = p.location; if (!loc) continue;
    byId.set(p.id, { name: (p.displayName && p.displayName.text) || '', lat: loc.latitude, lon: loc.longitude,
                     primaryType: p.primaryType || '', status: p.businessStatus || 'OPERATIONAL' });
  }
  const maxed = places.length >= MAX_PER_CALL;
  const cellDeg = haversineDeg(s, w, n, e);
  if (maxed && cellDeg > MIN_CELL_DEG) {           // likely truncated → subdivide into 4
    const mLat = (s + n) / 2, mLon = (w + e) / 2;
    await scanCell(s, w, mLat, mLon, depth + 1);
    await scanCell(s, mLon, mLat, e, depth + 1);
    await scanCell(mLat, w, n, mLon, depth + 1);
    await scanCell(mLat, mLon, n, e, depth + 1);
  }
  if (depth <= 1) console.log(`  …${byId.size} clinics so far (${calls} calls)`);
}

// Classify a raw Places result so non-clinics never reach the app. CONSERVATIVE:
// a strong clinic signal (primaryType veterinary_care, or "animal hospital" /
// "veterinary clinic" / "surgical" / DVM in the name) KEEPS the entry even when it
// also mentions boarding/grooming/humane — under-counting real competition is worse
// than keeping a borderline one. Returns: 'clinic' | 'mobile' | 'closed' |
// 'pharmacy' | 'kiosk' | 'store' | 'shelter' | 'boarding'. Only clinic+mobile ship.
function classify(p) {
  const n = (p.name || '').toLowerCase();
  const pt = p.primaryType || '';
  const status = p.status || 'OPERATIONAL';
  if (status !== 'OPERATIONAL') return 'closed';                       // permanently/temporarily closed → not competition
  // DEFINITIVE non-clinics — the name is conclusive even if Google cross-lists vet care
  if (/\bpharmac|compounding|\brx\b|\bdrug(s| inc| co\b|store)/.test(n)) return 'pharmacy';
  if (/\bsupply\b|\bsupplies\b|distribut/.test(n)) return 'store';      // B2B suppliers
  if (/\bshotvet\b|shot vet @|(petvet|vetco|petco|luv-?my-?pet)\b.*vaccinat|vaccination clinic\b/.test(n)) return 'kiosk'; // in-store vaccine kiosks (have vet primaryType, but not real clinics)
  if (/animal control/.test(n)) return 'shelter';
  // strong clinic signal protects the SOFT categories below
  const clinicSignal = pt === 'veterinary_care'
    || /\banimal hospital\b|veterinary (hospital|clinic|center|medical|surgery|surgical|wellness)|animal (clinic|hospital|medical)|\bvet clinic\b|\bsurgical\b|\bdvm\b/.test(n);
  // SOFT non-clinics — dropped only when there's no clinic signal
  if (/\brescue\b|adoption|\bspca\b|aspca|sanctuary|humane society/.test(n) && !clinicSignal) return 'shelter';
  if ((pt === 'pet_store' || /pet ?store|petsmart|^petco\b|tractor supply|pet food|feed store/.test(n)) && !clinicSignal) return 'store';
  if ((pt === 'pet_boarding' || /pet (resort|hotel|spa)|boarding|kennel|doggie|grooming|day ?care/.test(n)) && !clinicSignal) return 'boarding';
  if ((/\bmobile\b|house ?calls?|housecall|in[- ]?home\b|\bconcierge\b|ambulatory|comes to you|traveling|travelling|house paws|readivet/.test(n)) && !/\bhospital\b/.test(n)) return 'mobile';
  return 'clinic';
}

(async () => {
  const [s, w, n, e] = REGION;
  console.log(`Scanning region [${s},${w} → ${n},${e}] for "${TYPE}"${DRY ? ' (DRY RUN)' : ''}`);
  // start with a coarse grid so each top-level cell is a reasonable circle, then recurse
  const STEP = 0.6; // ~66km starting cells
  const tasks = [];
  for (let la = s; la < n; la += STEP)
    for (let lo = w; lo < e; lo += STEP)
      tasks.push([la, lo, Math.min(la + STEP, n), Math.min(lo + STEP, e)]);
  console.log(`${tasks.length} top-level cells; recursing where dense…`);
  for (const [a, b, c, d] of tasks) await scanCell(a, b, c, d, 0);

  console.log(`\nDone: ${byId.size} raw results, ${calls} API calls (${retries} retries).`);
  if (DRY) { console.log('DRY RUN — nothing written. Estimated calls:', calls); return; }

  // Classify every raw result; keep only real clinics (+ mobile vets, tagged so the
  // app can include/exclude them via a settings toggle). Everything else is dropped.
  const kept = [], dropped = {};
  for (const v of byId.values()) {
    const cls = classify(v);
    if (cls === 'clinic')      kept.push({ name: v.name, lat: v.lat, lon: v.lon });
    else if (cls === 'mobile') kept.push({ name: v.name, lat: v.lat, lon: v.lon, mobile: 1 });
    else                       dropped[cls] = (dropped[cls] || 0) + 1;
  }
  kept.sort((p, q) => p.lat - q.lat);
  const mobileN = kept.filter(k => k.mobile).length;
  const dropStr = Object.entries(dropped).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(', ') || 'none';
  console.log(`Kept ${kept.length} clinics (${mobileN} mobile, tagged). Dropped ${byId.size - kept.length}: ${dropStr}.`);

  const fs = await import('node:fs');
  const header = `// Auto-generated by build-clinics.mjs on ${new Date().toISOString().slice(0,10)} — ${kept.length} TX vet clinics (Google Places, non-clinics filtered).\n// Do not hand-edit; re-run the script to refresh. Format: window.VET_CLINICS=[{name,lat,lon,mobile?}]\n`;
  const body = `window.VET_CLINICS=${JSON.stringify(kept)};\nif(typeof onVetClinicsReady==='function')onVetClinicsReady();\n`;
  fs.writeFileSync(OUT, header + body);
  console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size/1024).toFixed(0)} KB).`);
})();
