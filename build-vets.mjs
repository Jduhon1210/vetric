#!/usr/bin/env node
// build-vets.mjs — crawl each clinic's website to extract the VETERINARIANS ON STAFF
// (count + names; best-effort vet-school + grad-year). Two-step: homepage → "Our Doctors/Team" page.
// Runs over ALL clinics with a website (PE + independent). Local Node 18+ (global fetch). No API keys, no cost.
//
//   node build-vets.mjs                  # every clinic with a website (statewide)
//   node build-vets.mjs --region=dfw     # DFW metroplex bbox only
//   node build-vets.mjs --limit=50       # quick test on the first 50
//   node build-vets.mjs --concurrency=10 # parallel fetches (default 8)
//
// Output → vet-staff.js:
//   window.VET_STAFF = { "<round(lat*1000)>_<round(lon*1000)>": {n, vets:[names], years?, schools?, src} }
// The app loads it via <script src="vet-staff.js"> and looks clinics up by nearest cell.
// Heuristic extraction — eyeball a --limit run before trusting a full crawl.

import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=?(.*)$/); return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
}));
const REGION = args.region;
const LIMIT  = args.limit ? +args.limit : Infinity;
const CONC   = args.concurrency ? +args.concurrency : 8;
const OUT    = args.out || 'vet-staff.js';
const TIMEOUT = 12000;
const UA = 'Mozilla/5.0 (compatible; VetricBot/1.0; +https://vetfinder.pages.dev)';
const DFW = { s: 32.2, n: 33.5, w: -97.95, e: -96.2 };

// ---- load clinics from vet-clinics.js (rindex skips the comment line) ----
const raw = fs.readFileSync('vet-clinics.js', 'utf8');
const i = raw.lastIndexOf('window.VET_CLINICS'), j = raw.indexOf('[', i), k = raw.lastIndexOf(']');
const all = JSON.parse(raw.slice(j, k + 1));
let clinics = all.filter(c => c.web);
if (REGION === 'dfw') clinics = clinics.filter(c => c.lat >= DFW.s && c.lat <= DFW.n && c.lon >= DFW.w && c.lon <= DFW.e);
clinics = clinics.slice(0, LIMIT);
console.log(`Crawling ${clinics.length} clinics (of ${all.length} total · ${all.filter(c => c.web).length} have a website)…\n`);

const key = c => `${Math.round(c.lat * 1000)}_${Math.round(c.lon * 1000)}`;

const VET_SCHOOLS = ['Texas A&M', 'Texas Tech', 'Oklahoma State', 'Kansas State', 'Colorado State', 'Louisiana State', 'LSU',
  'Mississippi State', 'Auburn', 'Tuskegee', 'Purdue', 'Cornell', 'UC Davis', 'University of California, Davis', 'Ohio State',
  'Michigan State', 'University of Illinois', 'University of Missouri', 'University of Minnesota', 'University of Georgia',
  'North Carolina State', 'University of Florida', 'University of Tennessee', 'University of Wisconsin', 'Washington State',
  'Oregon State', 'Iowa State', 'Virginia-Maryland', 'Tufts', 'University of Pennsylvania', 'Western University',
  'Lincoln Memorial', 'Midwestern', 'Ross University', 'St. George', 'St. Matthew', 'St. Matthews'];

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

// rank candidate "team/doctors" pages by link text + href
function teamLinks(html, baseUrl) {
  const out = []; const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html))) {
    const href = m[1], txt = stripTags(m[2]).toLowerCase(), hl = href.toLowerCase();
    let score = 0;
    if (/our[- ]?(doctor|vet)|meet[- ]?(the |our )?(team|doctor|vet)|veterinarians?\b/.test(txt)) score = 5;
    else if (/\bdoctors?\b|\bveterinarian/.test(txt) || /doctor|veterinarian|our-?team|meet-the/.test(hl)) score = 4;
    else if (/\b(our )?team\b|\bstaff\b/.test(txt) || /\/(team|staff|doctors|vets)\b/.test(hl)) score = 3;
    else if (/about\s*us?/.test(txt) || /\/about/.test(hl)) score = 1;
    if (score > 0) { try { out.push({ url: new URL(href, baseUrl).href, score }); } catch {} }
  }
  const byU = new Map();
  for (const l of out) if (!byU.has(l.url) || byU.get(l.url).score < l.score) byU.set(l.url, l);
  return [...byU.values()].sort((a, b) => b.score - a.score).slice(0, 3);
}

const STOP = new Set(('the our your new pet pets dog cat animal animals veterinary veterinarian veterinarians medicine '
  + 'medical hospital hospitals clinic clinics care center centre emergency wellness family small large north south east west '
  + 'home about contact services service team staff doctor doctors review reviews monday tuesday wednesday thursday friday '
  + 'saturday sunday welcome appointment read more view meet owner owners founder founded associate associates hours location '
  + 'locations surgery surgical dental exotic graduated graduate graduating born after before since joined joining earned '
  + 'received attended completed practice practicing university college school dvm vmd dabvp dacvim ms bs ba phd dr us usa '
  + 'states state texas member members guest column partner partners also both has had was were her his their she he they '
  + 'community are and of in at to with for from this that here when where what who how new york county city area best top '
  + 'cares loves enjoys husband wife children dogs cats horses years year experience board certified american').split(/\s+/));

// build a clean "First Last" from up to 3 captured words (drop middle initial, credentials, junk)
function cleanName(words) {
  const core = words.filter(w => w && !/^(dvm|vmd|d\.?v\.?m\.?|dabvp|dacvim|ms|bs|ba|phd|dr|doctor)$/i.test(w));
  if (core.length < 2) return null;
  const first = core[0], last = core[core.length - 1];
  for (const w of [first, last]) {
    const lw = w.toLowerCase().replace(/[^a-z'’-]/g, '');
    if (lw.length < 2 || STOP.has(lw) || !/[a-z]/.test(w)) return null;   // reject stopwords / all-caps / junk
  }
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);
  return cap(first) + ' ' + cap(last);
}

function extractVets(text) {
  const W = "[A-Z][A-Za-z'’-]*[a-z][A-Za-z'’-]*";   // a name word: caps start, has a lowercase letter, no period (won't span sentences)
  const seen = new Map();                            // lowercased "first last" -> display name (dedups "Name" vs "Name DVM")
  const add = (a, b, c) => { const n = cleanName([a, b, c].filter(Boolean)); if (n) { const k = n.toLowerCase(); if (!seen.has(k)) seen.set(k, n); } };
  let m;
  const reA = new RegExp(`\\bDr\\.?\\s+(${W})\\s+(${W})(?:\\s+(${W}))?`, 'g');         // Dr. First [Middle] Last
  while ((m = reA.exec(text))) add(m[1], m[2], m[3]);
  const reB = new RegExp(`\\b(${W})\\s+(${W})(?:\\s+(${W}))?,?\\s+(?:DVM|D\\.?V\\.?M\\.?|VMD)\\b`, 'g'); // First [Middle] Last, DVM
  while ((m = reB.exec(text))) add(m[1], m[2], m[3]);

  const years = new Set();
  const ctx = text.toLowerCase();
  const reY = /\b(19[6-9]\d|20[0-2]\d)\b/g;
  while ((m = reY.exec(text))) {
    const y = +m[1], around = ctx.slice(Math.max(0, m.index - 45), m.index + 8);
    if (/graduat|class of|d\.?v\.?m|earned|received|veterinary degree/.test(around) && y >= 1965 && y <= 2025) years.add(y);
  }
  const schools = new Set();
  for (const s of VET_SCHOOLS) if (text.includes(s)) schools.add(s === 'LSU' ? 'Louisiana State' : s);
  return { vets: [...seen.values()], years: [...years].sort(), schools: [...schools] };
}

const result = {}; let done = 0, hit = 0;
async function crawl(c) {
  let url = c.web.trim(); if (!/^https?:/i.test(url)) url = 'http://' + url; url = url.split(/[?#]/)[0];
  const home = await get(url);
  let text = '', src = '';
  if (home) {
    for (const l of teamLinks(home, url)) { const p = await get(l.url); if (p) { text = stripTags(p); src = l.url; break; } }
    if (!text) { text = stripTags(home); src = url; }
  }
  const ex = text ? extractVets(text) : { vets: [], years: [], schools: [] };
  done++;
  if (ex.vets.length) {
    hit++;
    result[key(c)] = { n: ex.vets.length, vets: ex.vets, ...(ex.years.length ? { years: ex.years } : {}), ...(ex.schools.length ? { schools: ex.schools } : {}), src };
  }
  if (done % 25 === 0 || done === clinics.length) console.log(`  ${done}/${clinics.length}  ·  ${hit} with a roster (${Math.round(100 * hit / done)}%)`);
}

let idx = 0;
const worker = async () => { while (idx < clinics.length) await crawl(clinics[idx++]); };
await Promise.all(Array.from({ length: CONC }, worker));

fs.writeFileSync(OUT,
  `// Auto-generated by build-vets.mjs — veterinarians on staff per clinic (count + names), heuristic web scrape.\n` +
  `// key = "<round(lat*1000)>_<round(lon*1000)>". value = {n: count, vets:[names], years?:[grad years], schools?:[...], src}\n` +
  `window.VET_STAFF=${JSON.stringify(result)};\n`);
console.log(`\nDone. ${hit}/${clinics.length} clinics got a vet roster (${Math.round(100 * hit / clinics.length)}%). Wrote ${OUT} (${Object.keys(result).length} entries).`);
