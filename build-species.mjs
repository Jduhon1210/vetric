#!/usr/bin/env node
// build-species.mjs — classify each clinic's SPECIES FOCUS (small animal / large animal / mixed)
// by reading its website. Fixes the documented limit of the name-based equine classifier: a name
// can't tell you "Argyle Veterinary Hospital" is a mixed small-animal + equine practice, but its
// homepage says so. One fetch per clinic (homepage) + at most one "services/about" page when the
// homepage is thin. Local Node 18+, no keys, no cost. Mirrors build-vets.mjs patterns exactly:
// same clinic source (vet-clinics.js, rows with .web), same cell-key scheme, per-clinic wall-clock
// cap, checkpointed output, hard process.exit.
//
//   node build-species.mjs --region=dfw --limit=80    # pilot (default region=dfw)
//   node build-species.mjs --all                      # statewide (~4,400 sites, run when pilot validates)
//   node build-species.mjs --name=argyle              # test mode: match clinics by name substring
//
// Output → vet-species.js: window.VET_SPECIES = { "<cellKey>": "small"|"large"|"mixed" }
// (unknown/unclassifiable clinics are simply absent — the app treats absent as small/neutral,
//  falling back to the conservative name classifier.)
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true]; }));
const LIMIT = args.limit ? +args.limit : (args.all ? Infinity : 80);
const REGION = args.all ? null : (args.region || 'dfw');
const CONC = args.concurrency ? +args.concurrency : 8;
const OUT = args.out || 'vet-species.js';
const TIMEOUT = 12000, CLINIC_CAP = 30000;
const UA = 'Mozilla/5.0 (compatible; VetricBot/1.0; +https://vetric.co)';
const DFW = { s: 32.2, n: 33.5, w: -97.95, e: -96.2 };

const raw = fs.readFileSync('vet-clinics.js', 'utf8');
const i = raw.lastIndexOf('window.VET_CLINICS'), j = raw.indexOf('[', i), k = raw.lastIndexOf(']');
const all = JSON.parse(raw.slice(j, k + 1));
let clinics = all.filter(c => c.web);
if (REGION === 'dfw') clinics = clinics.filter(c => c.lat >= DFW.s && c.lat <= DFW.n && c.lon >= DFW.w && c.lon <= DFW.e);
if (args.name) clinics = clinics.filter(c => (c.name || '').toLowerCase().includes(String(args.name).toLowerCase()));
clinics = clinics.slice(0, LIMIT);
console.log(`Classifying species focus for ${clinics.length} clinics (of ${all.filter(c => c.web).length} with websites)…\n`);

const key = c => `${Math.round(c.lat * 1000)}_${Math.round(c.lon * 1000)}`;
const stripTags = html => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#0?39;|&rsquo;|&apos;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();

async function get(url) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, redirect: 'follow', signal: ac.signal });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct && !/html|text/.test(ct)) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

// ---- species signals — counted as DISTINCT terms present, word-boundary, case-insensitive ----
// LARGE: unambiguous large-animal service language. NO 'ranch'/'horse' alone (place names, "horse
// around"); equine/livestock terms are the professional vocabulary a large-animal page uses.
const LARGE_TERMS = ['equine', 'horses', 'stallion', 'mare and foal', 'foal', 'colic', 'lameness exam',
  'cattle', 'bovine', 'livestock', 'herd health', 'farm call', 'farm calls', 'ranch call', 'ambulatory service',
  'goats', 'sheep', 'camelid', 'llama', 'alpaca', 'swine', 'coggins', 'pre-purchase exam', 'dairy herd'];
// SMALL: companion-animal service language.
const SMALL_TERMS = ['dogs', 'cats', 'canine', 'feline', 'puppy', 'puppies', 'kitten', 'small animal',
  'companion animal', 'spay', 'neuter', 'dental cleaning', 'grooming', 'boarding', 'pocket pets', 'exotic pets', 'your pet'];
const count = (text, terms) => terms.filter(t => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)).length;

// find one services/about link worth a second fetch when the homepage is inconclusive
function serviceLink(html, baseUrl) {
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const txt = stripTags(m[2]).toLowerCase(), hl = m[1].toLowerCase();
    if (/service|what we (do|treat)|large animal|equine|livestock|about/.test(txt) || /service|equine|large-?animal|about/.test(hl)) {
      try { return new URL(m[1], baseUrl).href; } catch {}
    }
  }
  return null;
}

function classify(large, small) {
  if (large >= 2 && small >= 2) return 'mixed';
  if (large >= 2 && small < 2) return 'large';
  if (small >= 1 && large < 2) return 'small';
  return null;                                             // no clear signal either way
}

async function classifyClinic(c) {
  let url = c.web; if (!/^https?:/i.test(url)) url = 'https://' + url;
  const home = await get(url);
  if (!home) return { sp: null, via: 'unreachable' };
  const homeText = stripTags(home).slice(0, 60000);
  let L = count(homeText, LARGE_TERMS), S = count(homeText, SMALL_TERMS);
  let sp = classify(L, S), via = 'home';
  // Inconclusive or suspiciously one-sided-with-hints? one more page settles it.
  if (sp === null || (sp === 'small' && L === 1) || (sp === 'large' && S === 1)) {
    const link = serviceLink(home, url);
    if (link) {
      const svc = await get(link);
      if (svc) {
        // merge distinct-term counts across both pages, then re-classify
        const merged = homeText + ' ' + stripTags(svc).slice(0, 60000);
        L = count(merged, LARGE_TERMS); S = count(merged, SMALL_TERMS);
        sp = classify(L, S); via = 'home+services';
      }
    }
  }
  return { sp, via, L, S };
}

// ---- checkpointed run (mirrors build-vets.mjs: wall-clock cap per clinic, hard exit) ----
const result = {}; const rows = [];
let done = 0, processed = 0;
function flush() {
  const body = '// Auto-generated by build-species.mjs — species focus per clinic (website-read).\n' +
    '// key = "<round(lat*1000)>_<round(lon*1000)>". value = "small" | "large" | "mixed".\n' +
    'window.VET_SPECIES=' + JSON.stringify(result) + ';\n';
  fs.writeFileSync(OUT, body);
}
const queue = [...clinics];
const worker = async () => {
  for (;;) {
    const c = queue.shift(); if (!c) return;
    let r;
    try { r = await Promise.race([classifyClinic(c), new Promise(res => setTimeout(() => res({ sp: null, via: 'timeout' }), CLINIC_CAP))]); }
    catch { r = { sp: null, via: 'error' }; }
    processed++;
    if (r.sp) { result[key(c)] = r.sp; done++; }
    rows.push({ name: c.name.slice(0, 44), sp: r.sp || '—', via: r.via, L: r.L ?? '', S: r.S ?? '' });
    process.stdout.write(`  [${processed}/${clinics.length}] ${r.sp ? r.sp.padEnd(5) : '—    '} ${c.name.slice(0, 60)}\n`);
    if (processed % 300 === 0) flush();
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
flush();
const counts = rows.reduce((a, r) => (a[r.sp] = (a[r.sp] || 0) + 1, a), {});
console.log(`\nClassified ${done}/${clinics.length}:`, counts, `→ ${OUT}`);
console.table(rows.slice(0, 40));
process.exit(0);
